import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/** Placement end reasons that mean the learner LEFT, as opposed to moving on. */
const LEAVING_REASONS: Record<string, string> = {
  WITHDRAWAL: 'withdrawn',
  TRANSFER_OUT: 'transferred_out',
  CORRECTION: 'cancelled',
};

export interface RosterRow {
  id: string;
  organizationId: string;
  enrollmentId: string;
  studentProfileId: string;
  classId: string;
  sectionId: string | null;
  termId: string;
  rollNumber: string | null;
  /** `enrolled` while the learner belonged to the class for the term; otherwise why they left. */
  status: string;
  enrolledAt: Date;
  endedAt: Date | null;
  student: any;
  schoolClass: any;
  section: any;
  term: any;
}

/**
 * Term class lists for reports, read from placement history.
 *
 * One row per enrollment per term: the learner's LAST placement inside that
 * term, so a mid-term section change shows the section they finished in and a
 * learner is never listed twice. Rows ended by withdrawal, transfer-out or a
 * correction carry that as their status; everything else — still open, rolled
 * into the next term, promoted, completed — was on the roll and is `enrolled`.
 */
@Injectable()
export class EnrollmentRosterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    opts: { studentProfileId?: string; termId?: string; status?: string } = {},
  ): Promise<RosterRow[]> {
    const placements = await this.prisma.client.enrollmentPlacement.findMany({
      where: {
        organizationId,
        ...(opts.termId ? { termId: opts.termId } : {}),
        ...(opts.studentProfileId ? { enrollment: { studentProfileId: opts.studentProfileId } } : {}),
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        enrollment: { include: { student: { include: { partner: true } } } },
        classCohort: { include: { schoolClass: true } },
        section: true,
        term: true,
      },
    });

    const seen = new Set<string>();
    const rows: RosterRow[] = [];
    for (const p of placements as any[]) {
      const key = `${p.enrollmentId}:${p.termId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const status =
        p.enrollment.status === 'CANCELLED'
          ? 'cancelled'
          : p.endReason && LEAVING_REASONS[p.endReason]
            ? LEAVING_REASONS[p.endReason]
            : 'enrolled';
      if (opts.status && opts.status !== status) continue;
      rows.push({
        id: p.id,
        organizationId: p.organizationId,
        enrollmentId: p.enrollmentId,
        studentProfileId: p.enrollment.studentProfileId,
        classId: p.classCohort.classId,
        sectionId: p.sectionId ?? null,
        termId: p.termId,
        rollNumber: p.rollNumber ?? null,
        status,
        enrolledAt: p.effectiveFrom,
        endedAt: p.effectiveTo ?? null,
        student: p.enrollment.student,
        schoolClass: p.classCohort.schoolClass,
        section: p.section ?? null,
        term: p.term,
      });
    }
    return rows;
  }
}
