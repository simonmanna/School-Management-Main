import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import type { PromoteStudentDto, PromotionOutcome, RolloverDto } from './promotion.dto';

/**
 * PromotionService (P5c/P5d) — student promotion + academic-year rollover.
 *
 * The one invariant: NEVER mutate a historical enrollment. Promoting a student
 * marks their current-term enrollment `completed` and CREATES a fresh
 * enrollment for the next term — academic history is immutable, exactly like a
 * posted journal entry. Graduation (reaching the final grade) writes no new
 * enrollment and moves the student to `alumni`.
 */
@Injectable()
export class PromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Promote a single student. Explicit, transactional, idempotent per term. */
  async promote(dto: PromoteStudentDto) {
    return this.prisma.client.$transaction((tx: any) => this.promoteOne(tx, dto));
  }

  /**
   * Academic-year rollover: advance every active student one grade.
   *
   * Dry-run by default — returns the plan (promote / graduate / skip buckets)
   * so it can be reviewed before committing. Execution runs one transaction PER
   * student, so a batch that fails partway can simply be re-run: an already-
   * promoted student is detected (enrolled in the target term) and skipped.
   */
  async rolloverTerm(dto: RolloverDto) {
    const dryRun = dto.dryRun ?? true;
    const client = this.prisma.client;

    // Grade ladder: order → the class to promote INTO for that order.
    const classes = await client.schoolClass.findMany({
      where: { deletedAt: null },
      include: { gradeLevel: true },
    });
    const maxOrder = classes.reduce((m: number, c: any) => Math.max(m, c.gradeLevel?.order ?? 0), 0);
    const classByOrder = new Map<number, any[]>();
    for (const c of classes) {
      const o = c.gradeLevel?.order ?? -1;
      if (o < 0) continue;
      const bucket = classByOrder.get(o) ?? [];
      bucket.push(c);
      classByOrder.set(o, bucket);
    }
    // Prefer a target class on the same campus as the student's current class.
    const pickClass = (order: number, campusId: string | null) => {
      const cands = classByOrder.get(order) ?? [];
      if (cands.length === 0) return null;
      return cands.find((c: any) => c.campusId === campusId) ?? cands[0];
    };

    // Subdivisions, keyed by class, so a student's "West" can be re-resolved
    // inside the TARGET class. Section/Stream are unique per (org, class, name),
    // so ids are never portable between classes — only the name is.
    const [allSections, allStreams] = await Promise.all([
      client.section.findMany({ where: { deletedAt: null }, select: { id: true, classId: true, name: true } }),
      client.stream.findMany({ where: { deletedAt: null }, select: { id: true, classId: true, name: true } }),
    ]);
    // Sections and streams are indexed SEPARATELY. One map keyed on
    // classId::name collided whenever a class had a section AND a stream of the
    // same name — "West" as both — and whichever loaded second silently won, so
    // a section resolved to a stream's id. The integration spec builds exactly
    // that fixture, which is how this was caught.
    const nameById = new Map<string, string>();
    const sectionByClassAndName = new Map<string, string>();
    const streamByClassAndName = new Map<string, string>();
    const key = (classId: string, name: string) => `${classId}::${name.trim().toLowerCase()}`;
    for (const row of allSections) {
      nameById.set(row.id, row.name);
      sectionByClassAndName.set(key(row.classId, row.name), row.id);
    }
    for (const row of allStreams) {
      nameById.set(row.id, row.name);
      streamByClassAndName.set(key(row.classId, row.name), row.id);
    }
    /** The same-named subdivision OF THE SAME KIND inside the target class. */
    const resolveSubdivision = (
      kind: 'section' | 'stream',
      sourceId: string | null | undefined,
      targetClassId: string | null,
    ) => {
      if (!sourceId || !targetClassId) return { id: null as string | null, name: null as string | null };
      const name = nameById.get(sourceId);
      if (!name) return { id: null, name: null };
      const index = kind === 'section' ? sectionByClassAndName : streamByClassAndName;
      return { id: index.get(key(targetClassId, name)) ?? null, name };
    };

    const students = await client.studentProfile.findMany({
      where: { status: 'active' },
      include: { currentClass: { include: { gradeLevel: true } } },
    });

    type PlanRow = {
      studentProfileId: string;
      admissionNo: string;
      outcome: PromotionOutcome | 'skipped';
      toClassId: string | null;
      toSectionId: string | null;
      toStreamId: string | null;
      /** Human-readable subdivision carried forward, e.g. "West" — shown in the dry run. */
      subdivision?: string | null;
      reason?: string;
    };
    const promote: PlanRow[] = [];
    const repeat: PlanRow[] = [];
    const graduate: PlanRow[] = [];
    const skip: PlanRow[] = [];

    for (const s of students) {
      const base = { studentProfileId: s.id, admissionNo: s.admissionNo };
      const cur = s.currentClass;
      if (!cur || !cur.gradeLevel) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, toStreamId: null, reason: 'no current class/grade' });
        continue;
      }
      // Resumable: already enrolled in the target term → leave alone.
      const existing = await client.enrollment.findFirst({
        where: { studentProfileId: s.id, termId: dto.toTermId },
        select: { id: true },
      });
      if (existing) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, toStreamId: null, reason: 'already enrolled in target term' });
        continue;
      }
      const order = cur.gradeLevel.order;
      if (order >= maxOrder) {
        graduate.push({ ...base, outcome: 'graduated', toClassId: null, toSectionId: null, toStreamId: null });
        continue;
      }
      // A8: consult the published result spine for the term being closed. A
      // 'repeat' recommendation (or ineligible result) holds the student in the
      // SAME class instead of promoting. No result → fall back to order-based
      // promotion (no academic gate available for that student).
      const rec = await this.latestRecommendation(client, s.id, dto.fromTermId);
      if (rec === 'repeat') {
        // Repeating the same class keeps the identical subdivision rows — the
        // class has not changed, so the ids remain valid as-is.
        repeat.push({
          ...base,
          outcome: 'repeated',
          toClassId: cur.id,
          toSectionId: s.currentSectionId ?? null,
          toStreamId: s.currentStreamId ?? null,
          subdivision: s.currentSectionId ? nameById.get(s.currentSectionId) ?? null : null,
          reason: 'result: repeat recommended',
        });
        continue;
      }

      const target = pickClass(order + 1, cur.campusId ?? null);
      if (!target) {
        skip.push({ ...base, outcome: 'skipped', toClassId: null, toSectionId: null, toStreamId: null, reason: `no class for grade order ${order + 1}` });
        continue;
      }
      const section = resolveSubdivision('section', s.currentSectionId, target.id);
      const stream = resolveSubdivision('stream', s.currentStreamId, target.id);
      // A subdivision the target class does not define is dropped deliberately
      // and said so in the plan, rather than silently vanishing at write time.
      const lost = [
        section.name && !section.id ? `section "${section.name}"` : null,
        stream.name && !stream.id ? `stream "${stream.name}"` : null,
      ].filter(Boolean);
      const why = rec ? `result: ${rec}` : 'order-based (no result)';
      promote.push({
        ...base,
        outcome: 'promoted',
        toClassId: target.id,
        toSectionId: section.id,
        toStreamId: stream.id,
        subdivision: section.name ?? stream.name ?? null,
        reason: lost.length ? `${why} — ${lost.join(', ')} not defined in target class` : why,
      });
    }

    const plan = {
      fromTermId: dto.fromTermId,
      toTermId: dto.toTermId,
      dryRun,
      counts: { promoted: promote.length, repeated: repeat.length, graduated: graduate.length, skipped: skip.length, total: students.length },
      promote,
      repeat,
      graduate,
      skip,
    };
    if (dryRun) return plan;

    // Execute — one tx per student so a mid-batch failure is resumable.
    const executed: Array<{ studentProfileId: string; outcome: string; enrollmentId: string | null; error?: string }> = [];
    for (const row of [...promote, ...repeat, ...graduate]) {
      try {
        const res = await this.prisma.client.$transaction((tx: any) =>
          this.promoteOne(tx, {
            studentProfileId: row.studentProfileId,
            toTermId: dto.toTermId,
            toClassId: row.toClassId ?? undefined,
            toSectionId: row.toSectionId ?? undefined,
            toStreamId: row.toStreamId ?? undefined,
            outcome: row.outcome as PromotionOutcome,
            reason: 'academic-year rollover',
          }),
        );
        executed.push({ studentProfileId: row.studentProfileId, outcome: res.outcome, enrollmentId: res.enrollmentId });
      } catch (err) {
        executed.push({ studentProfileId: row.studentProfileId, outcome: 'error', enrollmentId: null, error: String((err as Error)?.message ?? err) });
      }
    }
    return { ...plan, executed };
  }

  /**
   * The promotion recommendation from the latest PUBLISHED result set for a
   * student in a term (A3 computes it). Null when no published result exists.
   */
  private async latestRecommendation(client: any, studentProfileId: string, termId: string): Promise<string | null> {
    const t = await client.studentTermResult.findFirst({
      where: { studentProfileId, termId, resultSet: { status: 'published' } },
      include: { resultSet: true },
      orderBy: { resultSet: { revision: 'desc' } },
    });
    return t?.promotionRecommendation ?? null;
  }

  /**
   * Core promotion applied inside a caller-provided transaction. Shared by the
   * single-student endpoint and the batch rollover.
   */
  private async promoteOne(
    tx: any,
    dto: PromoteStudentDto,
  ): Promise<{ studentProfileId: string; outcome: PromotionOutcome; enrollmentId: string | null }> {
    const organizationId = this.tenant.organizationId;
    const student = await tx.studentProfile.findFirst({
      where: { id: dto.studentProfileId },
      include: { currentClass: true },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

    const outcome: PromotionOutcome = dto.outcome ?? (dto.toClassId ? 'promoted' : 'graduated');
    const needsClass = outcome === 'promoted' || outcome === 'repeated';
    if (needsClass && !dto.toClassId) {
      throw new BadRequestException(`Outcome '${outcome}' requires toClassId.`);
    }

    // Guard the per-term uniqueness (org, student, term) before writing so we
    // return a clean 400 instead of a Prisma unique-constraint 500.
    if (needsClass) {
      const dupe = await tx.enrollment.findFirst({
        where: { studentProfileId: student.id, termId: dto.toTermId },
        select: { id: true },
      });
      if (dupe) throw new BadRequestException(`Student already has an enrollment for term ${dto.toTermId}.`);
    }

    // Close every still-open enrollment BEFORE creating the new one (so the new
    // row is not swept into 'completed').
    await tx.enrollment.updateMany({
      where: { studentProfileId: student.id, status: 'enrolled' },
      data: { status: 'completed' },
    });

    let enrollmentId: string | null = null;
    if (needsClass) {
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId,
          studentProfileId: student.id,
          classId: dto.toClassId!,
          sectionId: dto.toSectionId ?? null,
          streamId: dto.toStreamId ?? null,
          termId: dto.toTermId,
          rollNumber: dto.rollNumber ?? student.admissionNo,
          status: 'enrolled',
        },
      });
      enrollmentId = enrollment.id;
      // All THREE snapshot fields move together with the enrollment. Updating
      // only class and section left currentStreamId pointing at the OLD class's
      // stream — a profile that disagreed with its own enrollment, which is
      // worse than a null. The placement invariant spec asserts they agree.
      await tx.studentProfile.update({
        where: { id: student.id },
        data: {
          currentClassId: dto.toClassId!,
          currentSectionId: dto.toSectionId ?? null,
          currentStreamId: dto.toStreamId ?? null,
        },
      });
    }

    // Graduation moves the lifecycle to alumni (FSM: active → alumni is legal).
    if (outcome === 'graduated' && student.status !== 'alumni') {
      await tx.studentStatusHistory.create({
        data: {
          organizationId,
          studentProfileId: student.id,
          fromStatus: student.status,
          toStatus: 'alumni',
          reason: dto.reason ?? 'graduated',
          changedById: this.tenant.userId ?? null,
        },
      });
      await tx.studentProfile.update({ where: { id: student.id }, data: { status: 'alumni' } });
      await this.events.publishInTx(tx, EVENTS.SchoolStudentStatusChanged, {
        organizationId,
        studentProfileId: student.id,
        fromStatus: student.status,
        toStatus: 'alumni',
      });
    }

    await this.audit.recordInTx(tx, {
      entity: 'StudentProfile',
      entityId: student.id,
      action: 'update',
      newValues: { action: 'promote', outcome, toClassId: dto.toClassId ?? null, toTermId: dto.toTermId, enrollmentId },
    });

    await this.events.publishInTx(tx, EVENTS.SchoolStudentPromoted, {
      organizationId,
      studentProfileId: student.id,
      outcome,
      fromClassId: student.currentClassId ?? null,
      toClassId: dto.toClassId ?? null,
      fromTermId: null,
      toTermId: dto.toTermId,
      enrollmentId,
    });

    return { studentProfileId: student.id, outcome, enrollmentId };
  }
}
