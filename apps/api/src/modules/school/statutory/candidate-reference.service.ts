import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import type {
  AssignCandidateNumbersDto,
  ImportIndexNumbersDto,
  UpsertExamReferenceDto,
} from './statutory.dto';

/** Levels a Uganda candidate sits, and the stage each belongs to. */
export const EXAM_LEVEL_STAGE: Record<string, string> = {
  PLE: 'PRIMARY_UPPER',
  UCE: 'LOWER_SECONDARY',
  UACE: 'ADVANCED_SECONDARY',
};

/**
 * The candidate-reference registry (Phase 6).
 *
 * A national result comes back keyed on an index number, not on a name. If the
 * mapping from learner to index number is a note in a book, a results enquiry
 * three years later has nothing to check against and a mis-keyed digit is
 * discovered by the family, not the school. This service is that mapping, with
 * a status that says how far the number has got: the school's own working
 * candidate number, the number as submitted, and the number the board returned.
 *
 * It never writes into `ExamCandidateEntry`. That snapshot records what the
 * examination was actually sat under and is frozen; when the registry and a
 * snapshot disagree, the disagreement is reported — the snapshot is not
 * quietly rewritten to agree with a number someone edited afterwards.
 */
@Injectable()
export class CandidateReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly placements: PlacementLookupService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  async list(query: {
    level?: string;
    registrationYear?: number;
    status?: string;
    classId?: string;
    search?: string;
  }) {
    const rows = await this.prisma.client.studentExamReference.findMany({
      where: {
        deletedAt: null,
        ...(query.level ? { level: query.level } : {}),
        ...(query.registrationYear ? { registrationYear: query.registrationYear } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      orderBy: [{ registrationYear: 'desc' }, { candidateNumber: 'asc' }],
      take: 2000,
    });
    const learners = await this.describeLearners(rows.map((r) => r.studentProfileId));
    return rows
      .map((r) => ({ ...r, student: learners.get(r.studentProfileId) ?? null }))
      .filter((r) => {
        if (query.classId && r.student?.classId !== query.classId) return false;
        if (query.search) {
          const hay = `${r.student?.name ?? ''} ${r.candidateNumber ?? ''} ${r.indexNumber ?? ''} ${r.student?.admissionNo ?? ''}`;
          if (!hay.toLowerCase().includes(query.search.toLowerCase())) return false;
        }
        return true;
      });
  }

  /** Every learner eligible for a level who has no reference yet. */
  async missing(level: string, registrationYear: number) {
    const stage = EXAM_LEVEL_STAGE[level];
    if (!stage) throw new BadRequestException(`Unknown examination level '${level}'.`);

    const enrollments = await this.prisma.client.studentEnrollment.findMany({
      where: { status: 'ACTIVE', programme: { stage: stage as never } },
      select: { studentProfileId: true, gradeLevel: { select: { id: true, name: true } }, programme: { select: { code: true, config: true } } },
    });
    if (enrollments.length === 0) return [];

    const held = await this.prisma.client.studentExamReference.findMany({
      where: { level, registrationYear, deletedAt: null },
      select: { studentProfileId: true },
    });
    const heldIds = new Set(held.map((h) => h.studentProfileId));
    const candidates = enrollments.filter((e) => !heldIds.has(e.studentProfileId));
    const learners = await this.describeLearners(candidates.map((c) => c.studentProfileId));

    return candidates.map((c) => ({
      studentProfileId: c.studentProfileId,
      gradeLevel: c.gradeLevel,
      programmeCode: c.programme?.code ?? null,
      student: learners.get(c.studentProfileId) ?? null,
    }));
  }

  async upsert(dto: UpsertExamReferenceDto) {
    const existing = await this.prisma.client.studentExamReference.findFirst({
      where: {
        studentProfileId: dto.studentProfileId,
        board: dto.board ?? 'UNEB',
        level: dto.level,
        registrationYear: dto.registrationYear,
        deletedAt: null,
      },
    });

    // A confirmed number is the board's, not ours. Changing it silently is how a
    // learner's results end up filed against another candidate; an explicit
    // withdrawal and re-registration leaves that on the record instead.
    if (existing && existing.status === 'confirmed' && dto.indexNumber && dto.indexNumber !== existing.indexNumber) {
      throw new ConflictException(
        'This reference is confirmed by the board. Withdraw it and register a new one rather than editing the confirmed index number.',
      );
    }

    await this.assertIndexFree(dto, existing?.id);

    const data = {
      organizationId: this.org,
      studentProfileId: dto.studentProfileId,
      board: dto.board ?? 'UNEB',
      level: dto.level,
      registrationYear: dto.registrationYear,
      centreNumber: dto.centreNumber ?? existing?.centreNumber ?? null,
      candidateNumber: dto.candidateNumber ?? existing?.candidateNumber ?? null,
      indexNumber: dto.indexNumber ?? existing?.indexNumber ?? null,
      status: (dto.status ?? existing?.status ?? 'provisional') as never,
      note: dto.note ?? existing?.note ?? null,
      ...(dto.status === 'confirmed'
        ? { verifiedAt: new Date(), verifiedById: this.tenant.userId ?? null }
        : {}),
      updatedBy: this.tenant.userId ?? null,
    };

    const row = existing
      ? await this.prisma.client.studentExamReference.update({ where: { id: existing.id }, data })
      : await this.prisma.client.studentExamReference.create({
          data: { ...data, createdBy: this.tenant.userId ?? null },
        });

    await this.audit.record({
      entity: 'StudentExamReference',
      entityId: row.id,
      action: existing ? 'update' : 'create',
      oldValues: existing ?? undefined,
      newValues: row,
    });
    return row;
  }

  /**
   * Give a class its candidate numbers in one pass.
   *
   * Numbers are assigned in the school's chosen order (admission number by
   * default) from a start value, and an existing number is never overwritten —
   * a candidate who already holds a number keeps it, because re-numbering a
   * registered candidate is the same accident as editing a confirmed one.
   */
  async assignNumbers(dto: AssignCandidateNumbersDto) {
    const stage = EXAM_LEVEL_STAGE[dto.level];
    if (!stage) throw new BadRequestException(`Unknown examination level '${dto.level}'.`);

    const learners = await this.prisma.client.studentProfile.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        ...(dto.classIds?.length ? this.placements.studentWhere({ classIds: dto.classIds }) : {}),
      },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
    });
    if (learners.length === 0) return { assigned: 0, skipped: 0, rows: [] };

    const ordered = [...learners].sort((a, b) =>
      dto.orderBy === 'name'
        ? (a.partner?.name ?? '').localeCompare(b.partner?.name ?? '')
        : (a.admissionNo ?? '').localeCompare(b.admissionNo ?? ''),
    );

    const existing = await this.prisma.client.studentExamReference.findMany({
      where: { level: dto.level, registrationYear: dto.registrationYear, deletedAt: null },
    });
    const byStudent = new Map(existing.map((e) => [e.studentProfileId, e]));

    const pad = dto.padTo ?? 3;
    let next = dto.startAt ?? 1;
    let assigned = 0;
    let skipped = 0;
    const rows: Array<{ studentProfileId: string; candidateNumber: string; name: string | null }> = [];

    for (const learner of ordered) {
      const held = byStudent.get(learner.id);
      if (held?.candidateNumber) {
        skipped += 1;
        continue;
      }
      const candidateNumber = `${dto.prefix ?? ''}${String(next).padStart(pad, '0')}`;
      next += 1;
      if (held) {
        await this.prisma.client.studentExamReference.update({
          where: { id: held.id },
          data: { candidateNumber, centreNumber: dto.centreNumber ?? held.centreNumber, updatedBy: this.tenant.userId ?? null },
        });
      } else {
        await this.prisma.client.studentExamReference.create({
          data: {
            organizationId: this.org,
            studentProfileId: learner.id,
            board: dto.board ?? 'UNEB',
            level: dto.level,
            registrationYear: dto.registrationYear,
            centreNumber: dto.centreNumber ?? null,
            candidateNumber,
            status: 'provisional',
            createdBy: this.tenant.userId ?? null,
          },
        });
      }
      assigned += 1;
      rows.push({ studentProfileId: learner.id, candidateNumber, name: learner.partner?.name ?? null });
    }

    await this.audit.record({
      entity: 'StudentExamReference',
      entityId: `${dto.level}:${dto.registrationYear}`,
      action: 'update',
      newValues: { assigned, skipped, startAt: dto.startAt, prefix: dto.prefix, centreNumber: dto.centreNumber },
    });
    return { assigned, skipped, rows };
  }

  /**
   * Record the index numbers a board returned.
   *
   * Rows are matched on candidate number, never on name: two learners called
   * "Nakato Sarah" in one S4 is ordinary, and a name match would put one
   * candidate's national results on the other's file. An unmatched row is
   * returned as an exception rather than dropped.
   */
  async importIndexNumbers(dto: ImportIndexNumbersDto) {
    const held = await this.prisma.client.studentExamReference.findMany({
      where: { level: dto.level, registrationYear: dto.registrationYear, deletedAt: null },
    });
    const byCandidateNo = new Map(held.filter((h) => h.candidateNumber).map((h) => [h.candidateNumber!, h]));

    const matched: string[] = [];
    const exceptions: Array<{ candidateNumber: string; indexNumber: string; reason: string }> = [];

    for (const row of dto.rows) {
      const target = byCandidateNo.get(row.candidateNumber);
      if (!target) {
        exceptions.push({ ...row, reason: 'No candidate holds this candidate number for the selected level and year.' });
        continue;
      }
      const clash = held.find((h) => h.indexNumber === row.indexNumber && h.id !== target.id);
      if (clash) {
        exceptions.push({ ...row, reason: 'Another candidate already holds this index number.' });
        continue;
      }
      await this.prisma.client.studentExamReference.update({
        where: { id: target.id },
        data: {
          indexNumber: row.indexNumber,
          status: 'confirmed',
          verifiedAt: new Date(),
          verifiedById: this.tenant.userId ?? null,
          updatedBy: this.tenant.userId ?? null,
        },
      });
      matched.push(target.id);
    }

    await this.audit.record({
      entity: 'StudentExamReference',
      entityId: `${dto.level}:${dto.registrationYear}:import`,
      action: 'update',
      newValues: { matched: matched.length, exceptions: exceptions.length },
    });
    return { matched: matched.length, exceptions };
  }

  async withdraw(id: string, reason: string) {
    const row = await this.prisma.client.studentExamReference.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Candidate reference not found.');
    const updated = await this.prisma.client.studentExamReference.update({
      where: { id },
      data: { status: 'withdrawn', note: reason, updatedBy: this.tenant.userId ?? null },
    });
    await this.audit.record({ entity: 'StudentExamReference', entityId: id, action: 'update', oldValues: row, newValues: updated });
    return updated;
  }

  /**
   * Where the registry and a frozen exam snapshot disagree.
   *
   * The snapshot is what the paper was sat under, so this is a reconciliation
   * report, not a repair: the office decides which of the two is wrong.
   */
  async reconcileWithSnapshot(examId: string) {
    const exam = await this.prisma.client.exam.findFirst({
      where: { id: examId },
      select: { id: true, name: true, activeSnapshotId: true },
    });
    if (!exam) throw new NotFoundException('Examination not found.');
    if (!exam.activeSnapshotId) {
      return { examId, snapshotId: null, checked: 0, differences: [], note: 'This examination has no frozen candidate list yet.' };
    }

    const entries = await this.prisma.client.examCandidateEntry.findMany({
      where: { snapshotId: exam.activeSnapshotId },
      select: { studentProfileId: true, candidateNumber: true, indexNumber: true },
    });
    const refs = await this.prisma.client.studentExamReference.findMany({
      where: { studentProfileId: { in: entries.map((e) => e.studentProfileId) }, deletedAt: null },
      orderBy: { registrationYear: 'desc' },
    });
    const byStudent = new Map<string, (typeof refs)[number]>();
    for (const r of refs) if (!byStudent.has(r.studentProfileId)) byStudent.set(r.studentProfileId, r);

    const differences: Array<{ studentProfileId: string; field: string; snapshot: string | null; registry: string | null }> = [];
    for (const entry of entries) {
      const ref = byStudent.get(entry.studentProfileId);
      if (!ref) {
        differences.push({ studentProfileId: entry.studentProfileId, field: 'reference', snapshot: entry.candidateNumber, registry: null });
        continue;
      }
      if ((entry.candidateNumber ?? null) !== (ref.candidateNumber ?? null)) {
        differences.push({ studentProfileId: entry.studentProfileId, field: 'candidateNumber', snapshot: entry.candidateNumber, registry: ref.candidateNumber });
      }
      if ((entry.indexNumber ?? null) !== (ref.indexNumber ?? null)) {
        differences.push({ studentProfileId: entry.studentProfileId, field: 'indexNumber', snapshot: entry.indexNumber, registry: ref.indexNumber });
      }
    }
    return { examId, snapshotId: exam.activeSnapshotId, checked: entries.length, differences };
  }

  /** Guard the uniqueness the database also enforces, so the caller gets a sentence rather than a constraint name. */
  private async assertIndexFree(dto: UpsertExamReferenceDto, exceptId?: string) {
    if (!dto.indexNumber) return;
    const clash = await this.prisma.client.studentExamReference.findFirst({
      where: {
        board: dto.board ?? 'UNEB',
        level: dto.level,
        registrationYear: dto.registrationYear,
        indexNumber: dto.indexNumber,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, studentProfileId: true },
    });
    if (clash) {
      throw new ConflictException(`Index number ${dto.indexNumber} is already held by another candidate in this sitting.`);
    }
  }

  /**
   * Name, admission number and CLASS for a set of learners.
   *
   * The class comes from placement history, not the StudentProfile projection
   * (ADR-027). A candidate reference is a statutory identifier: naming the
   * wrong class on a national submission is not a display bug, and the
   * submission cannot be recalled once it has left the school.
   */
  private async describeLearners(ids: string[]) {
    type Described = {
      name: string | null;
      admissionNo: string;
      classId: string | null;
      className: string | null;
    };
    if (ids.length === 0) return new Map<string, Described>();

    const rows = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
    });
    const placed = await this.placements.attach(rows);

    const classNames = new Map<string, string>(
      (
        await this.prisma.client.schoolClass.findMany({
          where: {
            id: {
              in: [...new Set(placed.map((r) => r.placement?.classId).filter(Boolean) as string[])],
            },
          },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );

    return new Map<string, Described>(
      placed.map((r) => {
        const classId = r.placement?.classId ?? null;
        return [
          r.id,
          {
            name: r.partner?.name ?? null,
            admissionNo: r.admissionNo,
            classId,
            className: classId ? (classNames.get(classId) ?? null) : null,
          },
        ];
      }),
    );
  }
}
