import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { MarksWorkspaceService } from './marks-workspace.service';

/**
 * Exam results to parents by SMS (review A17, owner decision 5).
 *
 * After BOT/MOT/EOT a Ugandan school texts each family the child's marks:
 *   "Sunrise Academy: Kato Patrick P.5 Mid Term III — ENG 92 D1, MTC 83 D2,
 *    SCI 90 D1, SST 88 D2. Agg 6, Div I. Position 1 of 91."
 * Built from the same merit list the DOS prints, so the two never disagree.
 *
 * Safeguards:
 *   - only when every paper for the class is APPROVED — no family is told a
 *     mark that is still being entered, corrected or checked. (This used to ask
 *     only for a lock, which the exams office can set on marks nobody has
 *     approved, so families were texted provisional marks and positions.);
 *   - only to guardians whose `receivesResults` preference is on;
 *   - one message per pupil per exam (dedupe key), however often it is sent;
 *   - a nursery class (descriptors, no exam marks) is never texted marks.
 */
@Injectable()
export class ExamResultsMessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly notifications: NotificationsService,
    private readonly marks: MarksWorkspaceService,
  ) {}

  private async build(dto: { examId: string; classId: string; sectionId?: string }) {
    const grid: any = await this.marks.grid(dto);
    if (grid.reporting?.descriptor) throw new BadRequestException('Nursery classes are reported in descriptors, not exam marks.');
    if (grid.paperCount === 0) throw new BadRequestException('This class does not sit this exam.');
    const locked = grid.lockedPaperCount === grid.paperCount;
    const approved = grid.approved === true;
    const school = await this.prisma.client.schoolProfile.findFirst({ select: { name: true } });
    const klass = await this.prisma.client.schoolClass.findFirst({ where: { id: dto.classId }, select: { name: true } });
    const ranked = grid.students.filter((s: any) => s.position != null).length;
    const messages = grid.students
      .filter((s: any) => s.subjectsMarked > 0)
      .map((s: any) => {
        const papers = grid.subjects
          .map((sub: any) => {
            const c = s.cells[sub.subjectId];
            if (!c) return null;
            if (c.marks == null) return c.participation && c.participation !== 'present' ? `${sub.code || sub.name} ${c.participation.toUpperCase()}` : null;
            return `${sub.code || sub.name} ${c.marks}${c.grade ? ` ${c.grade}` : ''}`;
          })
          .filter(Boolean)
          .join(', ');
        const headline = grid.reporting?.hasAggregate
          ? s.aggregate != null ? `Agg ${s.aggregate}, Div ${s.division}.` : s.division === 'U' ? 'Ungraded: a paper was not sat.' : ''
          : s.average != null ? `Average ${s.average}.` : '';
        const position = s.position != null ? ` Position ${s.position} of ${ranked}.` : '';
        return {
          studentProfileId: s.studentProfileId,
          name: s.name,
          body: `${school?.name ?? 'School'}: ${s.name} ${klass?.name ?? ''} ${grid.exam.name} — ${papers}. ${headline}${position}`.replace(/\s+/g, ' ').trim(),
        };
      });
    return { grid, locked, approved, messages };
  }

  /** What would be sent, and to how many guardians — before anything goes. */
  async preview(dto: { examId: string; classId: string; sectionId?: string }) {
    const { locked, approved, messages, grid } = await this.build(dto);
    const recipients = await this.recipients(messages.map((m: any) => m.studentProfileId));
    return {
      locked,
      lockedPaperCount: grid.lockedPaperCount,
      approved,
      approvedPaperCount: grid.approvedPaperCount,
      paperCount: grid.paperCount,
      pupils: messages.length,
      guardians: [...recipients.values()].reduce((n, list) => n + list.length, 0),
      pupilsWithoutGuardian: messages.filter((m: any) => !(recipients.get(m.studentProfileId)?.length)).length,
      sample: messages[0]?.body ?? null,
    };
  }

  async send(dto: { examId: string; classId: string; sectionId?: string }) {
    const { approved, messages, grid } = await this.build(dto);
    if (!approved) {
      throw new BadRequestException(
        `Only ${grid.approvedPaperCount} of ${grid.paperCount} papers are approved. Every paper must be approved first, so families only receive final marks.`,
      );
    }
    const organizationId = this.tenant.organizationId;
    const recipients = await this.recipients(messages.map((m: any) => m.studentProfileId));
    let pupils = 0;
    let delivered = 0;
    for (const m of messages) {
      const contacts = recipients.get(m.studentProfileId) ?? [];
      if (!contacts.length) continue;
      pupils += 1;
      for (const c of contacts) {
        delivered += await this.notifications.notifyContact({
          organizationId,
          contact: { id: c.id, email: c.email, phone: c.phone },
          category: 'results',
          title: 'Exam results',
          body: m.body,
          payload: { studentProfileId: m.studentProfileId, examId: dto.examId },
          dedupeKey: `exam-results:${dto.examId}:${m.studentProfileId}`,
        });
      }
    }
    return { pupils, delivered };
  }

  /** Guardians who have results messages switched on, per pupil. */
  private async recipients(studentProfileIds: string[]) {
    const links = studentProfileIds.length
      ? await this.prisma.client.studentGuardian.findMany({
          where: { studentProfileId: { in: studentProfileIds }, receivesResults: true, deletedAt: null } as any,
          include: { guardianContact: true },
        })
      : [];
    const out = new Map<string, Array<{ id: string; email: string | null; phone: string | null }>>();
    for (const l of links as any[]) {
      const c = l.guardianContact;
      if (!c || (!c.phone && !c.email)) continue;
      const list = out.get(l.studentProfileId) ?? [];
      list.push({ id: c.id, email: c.email ?? null, phone: c.phone ?? null });
      out.set(l.studentProfileId, list);
    }
    return out;
  }
}
