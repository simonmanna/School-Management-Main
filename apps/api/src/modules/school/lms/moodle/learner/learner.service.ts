import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { ViewEnvelopeService } from '../course/view-envelope.service';
import { AvailabilityService } from '../availability/availability.service';

/**
 * The learner's own view of the LMS (L3.1) — "My learning".
 *
 * Everything a student sees is keyed off the subject on their token, never a
 * parameter. A guardian may ask for one of their children by id, which is checked
 * against their guardianships; anyone else gets nothing rather than everyone.
 *
 * This is the surface that was entirely missing: every `/school/lms/*` route was
 * a staff route, so a pupil had no way in at all.
 */
@Injectable()
export class LearnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly envelope: ViewEnvelopeService,
    private readonly availability: AvailabilityService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Whose dashboard this request is for. Guardians must name a child they hold. */
  private async subject(asStudent?: string): Promise<string> {
    const p = this.portalIdentity.principal();
    if (p.kind === 'student') return p.studentProfileId;
    if (p.kind === 'guardian') {
      if (!asStudent) {
        const children = await this.portalIdentity.accessibleStudents();
        if (children.length === 1) return children[0];
        throw new ForbiddenException('Name which child to view');
      }
      if (!(await this.portalIdentity.canAccessStudent(asStudent))) {
        throw new ForbiddenException('Not a guardian of this student');
      }
      return asStudent;
    }
    // Staff previewing a learner dashboard must say whose.
    if (!asStudent) throw new ForbiddenException('Name the student whose dashboard to view');
    return asStudent;
  }

  /** Children a guardian may switch between, for the portal's child picker. */
  async myChildren() {
    const ids = await this.portalIdentity.accessibleStudents();
    const names = await this.envelope.studentNames(ids);
    return ids.map((id) => ({
      studentProfileId: id,
      name: names.get(id)?.name ?? 'Student',
      admissionNo: names.get(id)?.admissionNo ?? null,
    }));
  }

  /**
   * Courses the learner is enrolled in, each with its real progress. The percent
   * comes from CourseModuleCompletion, so it reflects work actually done rather
   * than modules that merely exist.
   */
  async myCourses(asStudent?: string) {
    const studentProfileId = await this.subject(asStudent);
    const enrolments = await this.prisma.client.courseEnrolment.findMany({
      where: { organizationId: this.org, studentProfileId, status: 'active' },
      select: { courseOfferingId: true },
    });
    const ids = enrolments.map((e) => e.courseOfferingId);
    if (ids.length === 0) return { studentProfileId, courses: [] };

    const offerings = await this.prisma.client.courseOffering.findMany({
      where: { id: { in: ids }, organizationId: this.org, deletedAt: null, visible: true },
    });
    const courses = await Promise.all(
      offerings.map(async (o) => ({
        ...(await this.envelope.courseHeader(o)),
        progress: await this.envelope.progressFor(o.id, studentProfileId),
      })),
    );
    return {
      studentProfileId,
      courses: courses.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * What is due next, across every course.
   *
   * Only work that is actually actionable appears: hidden modules, modules whose
   * availability rules are unmet, and anything already submitted are all filtered
   * out. A "due soon" list that shows work a student cannot open, or has already
   * handed in, trains them to ignore it.
   */
  async dueSoon(asStudent?: string, withinDays = 14) {
    const studentProfileId = await this.subject(asStudent);
    const enrolments = await this.prisma.client.courseEnrolment.findMany({
      where: { organizationId: this.org, studentProfileId, status: 'active' },
      select: { courseOfferingId: true },
    });
    const courseIds = enrolments.map((e) => e.courseOfferingId);
    if (courseIds.length === 0) return [];

    const horizon = new Date(Date.now() + withinDays * 86400000);
    const modules = await this.prisma.client.courseModule.findMany({
      where: {
        organizationId: this.org,
        courseOfferingId: { in: courseIds },
        deletedAt: null,
        visible: true,
        dueAt: { not: null, lte: horizon },
      },
      orderBy: { dueAt: 'asc' },
      take: 100,
    });
    if (modules.length === 0) return [];

    // Drop anything the availability rules keep shut for this student.
    const open: typeof modules = [];
    const availByModule = new Map<string, { available: boolean; reasons: string[]; greyed: boolean }>();
    for (const m of modules) {
      const a = await this.availability.evaluate(m.availability, {
        studentProfileId, courseOfferingId: m.courseOfferingId,
      });
      if (!a.available) continue;
      availByModule.set(m.id, { available: a.available, reasons: a.reasons, greyed: a.showGreyed });
      open.push(m);
    }

    const views = await this.envelope.moduleViews(open, {
      studentProfileId, availabilityByModule: availByModule, showGrades: true,
    });
    const offerings = await this.prisma.client.courseOffering.findMany({
      where: { id: { in: [...new Set(open.map((m) => m.courseOfferingId))] } },
    });
    const headers = new Map(
      await Promise.all(offerings.map(async (o) => [o.id, await this.envelope.courseHeader(o)] as const)),
    );
    const byModule = new Map(open.map((m) => [m.id, m]));

    return views
      // Work already handed in is no longer "due".
      .filter((v) => !(v.completion && v.completion.state !== 'incomplete'))
      .filter((v) => !(v.grade?.submissionStatus && v.grade.submissionStatus !== 'assigned'))
      .map((v) => ({
        ...v,
        courseId: byModule.get(v.id)?.courseOfferingId ?? null,
        courseName: headers.get(byModule.get(v.id)?.courseOfferingId ?? '')?.name ?? null,
        overdue: Boolean(v.dueAt && new Date(v.dueAt) < new Date()),
      }));
  }

  /**
   * Marks released to this learner recently. Only APPROVED marks: an entered but
   * unmoderated score must not reach a pupil, and a parent must not see one either.
   */
  async recentGrades(asStudent?: string, limit = 10) {
    const studentProfileId = await this.subject(asStudent);
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: { organizationId: this.org, studentProfileId, approvalStatus: 'approved', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        assessmentId: true, effectiveScore: true, percentage: true, updatedAt: true,
        assessment: { select: { title: true, maxScore: true, hiddenFromStudents: true, subjectId: true } },
      },
    });
    return rows
      .filter((r) => r.assessment && !r.assessment.hiddenFromStudents)
      .map((r) => ({
        assessmentId: r.assessmentId,
        title: r.assessment!.title,
        score: r.effectiveScore != null ? Number(r.effectiveScore) : null,
        maxScore: Number(r.assessment!.maxScore ?? 100),
        percentage: r.percentage != null ? Number(r.percentage) : null,
        at: r.updatedAt.toISOString(),
      }));
  }

  /** The whole dashboard in one round trip. */
  async dashboard(asStudent?: string) {
    const [{ studentProfileId, courses }, due, grades] = await Promise.all([
      this.myCourses(asStudent),
      this.dueSoon(asStudent),
      this.recentGrades(asStudent),
    ]);
    const names = await this.envelope.studentNames([studentProfileId]);
    return {
      student: {
        studentProfileId,
        name: names.get(studentProfileId)?.name ?? null,
        admissionNo: names.get(studentProfileId)?.admissionNo ?? null,
      },
      courses,
      dueSoon: due,
      recentGrades: grades,
      viewingAs: this.portalIdentity.principal().kind,
    };
  }
}
