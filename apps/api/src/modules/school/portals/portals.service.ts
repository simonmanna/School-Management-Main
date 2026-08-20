import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AttendanceStatusConfigService } from '../attendance/attendance-status-config.service';

/**
 * PortalsService — composes existing services to build role-specific dashboards.
 *
 * Parent: children, attendance, grades, fees, announcements.
 * Student: timetable, attendance, grades, assignments, announcements.
 * Teacher: classes, attendance, grade entry, assignments, schedule.
 *
 * These are pure read-side aggregations — no new tables, no new state.
 */
@Injectable()
export class PortalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly statusConfig: AttendanceStatusConfigService,
  ) {}

  /**
   * Parent portal — given a parent's contact id (from auth context in production),
   * return their children's overview.
   */
  async parentDashboard(studentProfileIds: string[]) {
    const students = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentProfileIds } },
      include: {
        currentClass: { include: { gradeLevel: true } },
        currentSection: true,
      },
    });

    // For each student, fetch latest attendance, grades, fees.
    const result = [];
    for (const s of students) {
      const [attendance, fees, announcements] = await Promise.all([
        this.recentAttendance(s.id),
        this.feeBalance(s.partnerId),
        this.recentAnnouncements(s.currentClassId),
      ]);
      result.push({ student: s, attendance, fees, announcements });
    }
    return result;
  }

  async studentDashboard(studentProfileId: string) {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (!profile) return null;

    const [timetable, attendance, grades, assignments, announcements, publishedResults, certificates] = await Promise.all([
      this.studentTimetable(profile.currentClassId, profile.id),
      this.recentAttendance(studentProfileId),
      this.recentGrades(studentProfileId),
      this.studentAssignments(studentProfileId),
      this.recentAnnouncements(profile.currentClassId),
      this.publishedResults(studentProfileId),
      this.studentCertificates(studentProfileId),
    ]);
    // A8: published results + certificates read the result spine, not raw marks.
    return { profile, timetable, attendance, grades, assignments, announcements, publishedResults, certificates };
  }

  async teacherDashboard(teacherPartnerId: string) {
    const classes = await this.prisma.client.teacherAssignment.findMany({
      where: { teacherPartnerId },
      include: { subject: true, schoolClass: { include: { gradeLevel: true } }, section: true },
    });

    // Today's schedule
    const today = new Date();
    const dayOfWeek = ((today.getDay() + 6) % 7) + 1; // JS Sun=0 → ISO Mon=1
    const todaySchedule = await this.prisma.client.timetableSlot.findMany({
      where: {
        teacherPartnerId,
        dayOfWeek,
      },
      include: { subject: true, schoolClass: true, period: true },
      orderBy: { period: { order: 'asc' } } as any,
    });

    // Pending grade submissions
    const pendingGrades = await this.prisma.client.gradeEntry.count({
      where: {
        enteredById: teacherPartnerId,
        status: 'draft',
      },
    });

    // A8: spine-side marking queue — assessments this teacher entered awaiting
    // approval, plus any open amendment requests to review.
    const pendingApprovals = await this.prisma.client.studentAssessment.count({
      where: { enteredById: teacherPartnerId, approvalStatus: 'submitted' },
    });
    const draftMarks = await this.prisma.client.studentAssessment.count({
      where: { enteredById: teacherPartnerId, approvalStatus: 'draft' },
    });

    return { classes, todaySchedule, pendingGrades, marking: { pendingApprovals, draftMarks } };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async recentAttendance(studentProfileId: string) {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const [rows, cfg] = await Promise.all([
      this.prisma.client.studentAttendance.findMany({
        where: { studentProfileId, date: { gte: from } },
        orderBy: { date: 'desc' },
        take: 30,
      }),
      // P-att-status: rate maths uses the org's configured present/late flags.
      this.statusConfig.catalogByCode(),
    ]);
    const total = rows.length;
    const present = rows.filter((r) => cfg[r.status]?.isPresent).length;
    const late = rows.filter((r) => cfg[r.status]?.isLate).length;
    const absent = rows.filter((r) => cfg[r.status]?.isAbsent).length;
    return { total, present, late, absent, rate: total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 0 };
  }

  private async feeBalance(partnerId: string) {
    const docs = await this.prisma.client.document.findMany({
      where: {
        partnerId,
        documentType: 'sales_invoice',
        sourceType: 'school_fee',
        paymentStatus: { in: ['partial', 'paid'] },
      },
    });
    const total = docs.reduce((s, d) => s + Number(d.totalAmount), 0);
    const paid = docs.reduce((s, d) => s + Number(d.amountPaid), 0);
    return { total, paid, balance: total - paid, invoiceCount: docs.length };
  }

  private async recentAnnouncements(classId: string | null | undefined) {
    return this.prisma.client.announcement.findMany({
      where: {
        publishedAt: { not: null },
        OR: [{ scope: 'school' }, ...(classId ? [{ classId }] : [])],
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });
  }

  private async studentTimetable(classId: string | null | undefined, studentProfileId: string) {
    if (!classId) return [];
    const profile = await this.prisma.client.studentProfile.findFirst({ where: { id: studentProfileId } });
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { classId, sectionId: profile?.currentSectionId ?? null },
      include: { subject: true, period: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }] as any,
    });
    return slots;
  }

  private async recentGrades(studentProfileId: string) {
    return this.prisma.client.gradeEntry.findMany({
      where: { studentProfileId },
      orderBy: { enteredAt: 'desc' },
      take: 10,
      include: { examSchedule: { include: { subject: true, exam: true } } },
    });
  }

  private async studentAssignments(studentProfileId: string) {
    const profile = await this.prisma.client.studentProfile.findFirst({ where: { id: studentProfileId } });
    if (!profile?.currentClassId) return [];
    const assignments = await this.prisma.client.homeworkAssignment.findMany({
      where: { classId: profile.currentClassId },
      orderBy: { dueDate: 'asc' },
      include: { subject: true, submissions: { where: { studentProfileId } } },
    });
    return assignments;
  }

  /** A8: the student's published term results from the A3 result spine. */
  private async publishedResults(studentProfileId: string) {
    const terms = await this.prisma.client.studentTermResult.findMany({
      where: { studentProfileId, resultSet: { status: 'published' } },
      include: { resultSet: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    return terms.map((t) => ({
      termId: t.termId,
      resultSetRevision: t.resultSet.revision,
      gpa: t.gpa != null ? String(t.gpa) : null,
      aggregate: t.aggregate,
      division: t.division,
      meanPercent: t.meanPercent != null ? String(t.meanPercent) : null,
      classRank: t.classRank,
      promotionRecommendation: t.promotionRecommendation,
    }));
  }

  /** A8: issued certificates for the student (A6). */
  private async studentCertificates(studentProfileId: string) {
    return this.prisma.client.certificate.findMany({
      where: { studentProfileId, status: 'issued' },
      select: { id: true, type: true, title: true, serialNumber: true, verificationCode: true, issuedAt: true },
      orderBy: { issuedAt: 'desc' },
    });
  }
}