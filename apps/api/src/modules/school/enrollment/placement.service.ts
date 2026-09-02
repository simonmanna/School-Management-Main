import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { ClassCohortService } from './class-cohort.service';
import { resolveGroupingMode, validateGrouping, type GroupingModeValue } from './grouping';
import { holdsPlacement, type EnrollmentStatusValue, type MovementReasonValue } from './enrollment-fsm';
import type {
  BulkPlacementDto,
  MovePlacementDto,
  PlacementInputDto,
  TermRolloverDto,
} from './enrollment.dto';

export interface ResolvedTarget {
  cohortId: string;
  classId: string;
  termId: string;
  sectionId: string | null;
  streamId: string | null;
  groupingMode: GroupingModeValue;
  warnings: string[];
}

/**
 * EnrollmentPlacement — append-only, effective-dated class membership.
 *
 * The one rule everything else rests on: **a movement never updates a placement
 * in place**. It end-dates the open row and inserts a new one in the same
 * transaction. That is what lets the system answer "which class was this
 * learner in on 12 May?" after a mid-term stream change, a transfer and a
 * re-entry, and it is why a withdrawn learner still appears in the roster that
 * produced last term's results.
 *
 * `StudentProfile.currentClassId/currentSectionId/currentStreamId` are kept in
 * sync as a PROJECTION of the newest open placement (ADR-018). They are a
 * compatibility surface for existing consumers, never a source of truth.
 */
@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly cohorts: ClassCohortService,
  ) {}

  /* ───────────────────────────── Resolution ───────────────────────────── */

  /**
   * Turn a loose placement request (class or cohort, optional section/stream)
   * into a validated tuple, or throw with every problem listed at once so a
   * user fixes one form rather than replaying five round-trips.
   */
  async resolveTarget(
    tx: any,
    enrollment: { academicYearId: string; organizationId: string },
    input: { termId?: string; classCohortId?: string; classId?: string; sectionId?: string | null; streamId?: string | null },
    fallbackTermId?: string,
  ): Promise<ResolvedTarget> {
    const termId = input.termId ?? fallbackTermId;
    if (!termId) throw new BadRequestException('A term is required for a placement.');

    const term = await tx.term.findFirst({ where: { id: termId }, select: { id: true, academicYearId: true, name: true } });
    if (!term) throw new NotFoundException(`Term ${termId} not found`);
    if (term.academicYearId !== enrollment.academicYearId) {
      throw new BadRequestException(
        `Term "${term.name}" belongs to a different academic year than this enrollment. ` +
          'A learner moving into another year needs a new enrollment (promotion, repeat or re-entry).',
      );
    }

    let cohort: any = null;
    if (input.classCohortId) {
      cohort = await tx.classCohort.findFirst({ where: { id: input.classCohortId }, include: { programme: true } });
      if (!cohort) throw new NotFoundException(`Class cohort ${input.classCohortId} not found`);
      if (cohort.academicYearId !== enrollment.academicYearId) {
        throw new BadRequestException('That class cohort belongs to a different academic year than this enrollment.');
      }
    } else if (input.classId) {
      cohort = await this.cohorts.ensureCohort(enrollment.academicYearId, input.classId, tx);
      cohort = await tx.classCohort.findFirst({ where: { id: cohort.id }, include: { programme: true } });
    } else {
      throw new BadRequestException('A class or class cohort is required for a placement.');
    }

    const mode = resolveGroupingMode(
      cohort.groupingMode as GroupingModeValue | null,
      (cohort.programme?.groupingMode ?? null) as GroupingModeValue | null,
    );

    const section = input.sectionId
      ? await tx.section.findFirst({ where: { id: input.sectionId }, select: { id: true, classId: true, name: true, capacity: true } })
      : null;
    const stream = input.streamId
      ? await tx.stream.findFirst({
          where: { id: input.streamId },
          select: { id: true, classId: true, sectionId: true, name: true, capacity: true },
        })
      : null;

    // When the mode needs a section (or stream) and the caller did not pick one,
    // fill it in ONLY if the choice is unambiguous. Promotion and rollover
    // screens legitimately leave it blank; guessing between two sections would
    // be a silent placement decision, so that still asks the user.
    const filled = await this.autoFillGrouping(tx, mode, cohort.classId, {
      sectionId: input.sectionId ?? null,
      streamId: input.streamId ?? null,
      section,
      stream,
    });

    const result = validateGrouping({
      mode,
      cohortClassId: cohort.classId,
      sectionId: filled.sectionId,
      streamId: filled.streamId,
      section: filled.section,
      stream: filled.stream,
    });
    if (!result.ok) throw new BadRequestException(result.errors.join(' '));

    const warnings = await this.capacityWarnings(tx, cohort, filled.section, filled.stream);

    return {
      cohortId: cohort.id,
      classId: cohort.classId,
      termId,
      sectionId: result.value.sectionId,
      streamId: result.value.streamId,
      groupingMode: mode,
      warnings,
    };
  }

  /**
   * Fill in an omitted section/stream when the cohort offers exactly one legal
   * choice. Anything ambiguous is left alone so `validateGrouping` produces the
   * "choose a section" message rather than the system deciding for the school.
   */
  private async autoFillGrouping(
    tx: any,
    mode: GroupingModeValue,
    cohortClassId: string,
    current: { sectionId: string | null; streamId: string | null; section: any; stream: any },
  ) {
    let { sectionId, streamId, section, stream } = current;
    const needsSection = mode === 'SECTION_ONLY' || mode === 'SECTION_AND_STREAM';
    const needsStream = mode === 'STREAM_ONLY' || mode === 'SECTION_AND_STREAM';

    if (needsSection && !sectionId) {
      const options = await tx.section.findMany({
        where: { classId: cohortClassId },
        select: { id: true, classId: true, name: true, capacity: true },
        take: 2,
      });
      if (options.length === 1) {
        section = options[0];
        sectionId = section.id;
      }
    }

    if (needsStream && !streamId) {
      const options = await tx.stream.findMany({
        where: { classId: cohortClassId, ...(mode === 'SECTION_AND_STREAM' && sectionId ? { sectionId } : {}) },
        select: { id: true, classId: true, sectionId: true, name: true, capacity: true },
        take: 2,
      });
      if (options.length === 1) {
        stream = options[0];
        streamId = stream.id;
      }
    }

    return { sectionId, streamId, section, stream };
  }

  /**
   * Capacity is reported, not enforced. A Ugandan school that must seat a late
   * admission in an over-subscribed P5 needs the placement to succeed and the
   * over-subscription to be visible — a hard block would just be worked around
   * by editing the capacity field.
   */
  private async capacityWarnings(tx: any, cohort: any, section: any, stream: any): Promise<string[]> {
    const warnings: string[] = [];
    const countOpen = (where: any) => tx.enrollmentPlacement.count({ where: { ...where, effectiveTo: null } });
    if (cohort.capacity) {
      const n = await countOpen({ classCohortId: cohort.id });
      if (n >= cohort.capacity) warnings.push(`Class is at or over capacity (${n}/${cohort.capacity}).`);
    }
    if (section?.capacity) {
      const n = await countOpen({ sectionId: section.id });
      if (n >= section.capacity) warnings.push(`Section "${section.name}" is at or over capacity (${n}/${section.capacity}).`);
    }
    if (stream?.capacity) {
      const n = await countOpen({ streamId: stream.id });
      if (n >= stream.capacity) warnings.push(`Stream "${stream.name}" is at or over capacity (${n}/${stream.capacity}).`);
    }
    return warnings;
  }

  /* ─────────────────────────── Write primitives ────────────────────────── */

  /** The learner's currently open placement, if any. */
  async openPlacementOf(tx: any, enrollmentId: string) {
    return tx.enrollmentPlacement.findFirst({ where: { enrollmentId, effectiveTo: null } });
  }

  /**
   * Close the open placement at `at`. Returns the closed row, or null when the
   * learner had no seat (a PENDING enrollment, or one already ended).
   */
  async closeOpen(tx: any, enrollmentId: string, at: Date, endReason: MovementReasonValue) {
    const open = await this.openPlacementOf(tx, enrollmentId);
    if (!open) return null;
    if (at < open.effectiveFrom) {
      throw new BadRequestException(
        `Cannot end a placement on ${at.toISOString().slice(0, 10)} — it only started on ${open.effectiveFrom
          .toISOString()
          .slice(0, 10)}. Correct the earlier placement instead of back-dating over it.`,
      );
    }
    await tx.enrollmentPlacement.updateMany({ where: { id: open.id }, data: { effectiveTo: at, endReason } });
    return { ...open, effectiveTo: at, endReason };
  }

  /**
   * Append a placement, closing any open one at the same instant. Both rows land
   * in one transaction, so a learner is never briefly in two classes or none.
   */
  async appendPlacement(
    tx: any,
    enrollment: any,
    input: PlacementInputDto & { movementReason?: MovementReasonValue },
    opts: { closeReason?: MovementReasonValue; fallbackTermId?: string } = {},
  ) {
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    const target = await this.resolveTarget(tx, enrollment, input, opts.fallbackTermId);
    const movementReason = input.movementReason ?? 'INITIAL_PLACEMENT';

    const closed = await this.closeOpen(tx, enrollment.id, effectiveFrom, opts.closeReason ?? movementReason);

    const created = await tx.enrollmentPlacement.create({
      data: {
        organizationId: enrollment.organizationId,
        enrollmentId: enrollment.id,
        termId: target.termId,
        classCohortId: target.cohortId,
        sectionId: target.sectionId,
        streamId: target.streamId,
        rollNumber: input.rollNumber ?? closed?.rollNumber ?? null,
        effectiveFrom,
        movementReason,
        notes: input.notes ?? null,
        changedById: this.tenant.userId ?? null,
      },
    });

    await this.syncProjection(tx, enrollment.studentProfileId);

    await this.audit.recordInTx(tx, {
      entity: 'EnrollmentPlacement',
      entityId: created.id,
      action: 'create',
      oldValues: closed
        ? { placementId: closed.id, classCohortId: closed.classCohortId, sectionId: closed.sectionId, streamId: closed.streamId }
        : undefined,
      newValues: {
        enrollmentId: enrollment.id,
        termId: target.termId,
        classCohortId: target.cohortId,
        sectionId: target.sectionId,
        streamId: target.streamId,
        movementReason,
        effectiveFrom,
      },
    });
    await this.events.publishInTx(tx, EVENTS.SchoolPlacementChanged, {
      organizationId: enrollment.organizationId,
      enrollmentId: enrollment.id,
      studentProfileId: enrollment.studentProfileId,
      placementId: created.id,
      previousPlacementId: closed?.id ?? null,
      from: closed
        ? { classCohortId: closed.classCohortId, sectionId: closed.sectionId, streamId: closed.streamId, termId: closed.termId }
        : null,
      to: { classCohortId: target.cohortId, sectionId: target.sectionId, streamId: target.streamId, termId: target.termId },
      movementReason,
      effectiveFrom,
      actorId: this.tenant.userId ?? null,
      requestId: this.tenant.requestId ?? null,
    });

    return { placement: created, closed, warnings: target.warnings };
  }

  /**
   * Recompute the compatibility projection on StudentProfile from the newest
   * OPEN placement. No open placement means no current class — leaving stale ids
   * behind is how departed pupils kept showing up in their old class list.
   */
  async syncProjection(tx: any, studentProfileId: string) {
    const open = await tx.enrollmentPlacement.findFirst({
      where: { effectiveTo: null, enrollment: { studentProfileId } },
      orderBy: { effectiveFrom: 'desc' },
      include: { classCohort: { select: { classId: true } } },
    });
    await tx.studentProfile.updateMany({
      where: { id: studentProfileId },
      data: {
        currentClassId: open?.classCohort?.classId ?? null,
        currentSectionId: open?.sectionId ?? null,
        currentStreamId: open?.streamId ?? null,
      },
    });
    return open ?? null;
  }

  /* ───────────────────────────── Commands ─────────────────────────────── */

  /** Move a learner: class, section and/or stream change inside the same year. */
  async move(enrollmentId: string, dto: MovePlacementDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const enrollment = await this.loadEnrollment(tx, enrollmentId);
      if (!holdsPlacement(enrollment.status as EnrollmentStatusValue)) {
        throw new BadRequestException(
          `Enrollment is '${enrollment.status}' and holds no class seat. Reinstate it before moving the learner.`,
        );
      }
      const open = await this.openPlacementOf(tx, enrollmentId);
      const result = await this.appendPlacement(
        tx,
        enrollment,
        {
          termId: dto.termId ?? open?.termId,
          // A move that names no class stays in the current one — the common
          // case is a section or stream change, not a class change.
          classCohortId: dto.classCohortId ?? (dto.classId ? undefined : open?.classCohortId),
          classId: dto.classId,
          // Undefined means "keep what they had"; explicit null means "clear it".
          sectionId: dto.sectionId !== undefined ? dto.sectionId : (open?.sectionId ?? null),
          streamId: dto.streamId !== undefined ? dto.streamId : (open?.streamId ?? null),
          rollNumber: dto.rollNumber,
          effectiveFrom: dto.effectiveFrom,
          movementReason: dto.movementReason,
          notes: dto.notes ?? dto.reason,
        } as PlacementInputDto & { movementReason: MovementReasonValue },
        { closeReason: dto.movementReason, fallbackTermId: open?.termId },
      );
      return {
        enrollmentId,
        placement: result.placement,
        endedPlacementId: result.closed?.id ?? null,
        warnings: result.warnings,
      };
    });
  }

  /**
   * Validate a move without writing anything. The workspace calls this on every
   * form change so a user sees "stream belongs to another section" before they
   * commit, not after.
   */
  async preview(enrollmentId: string, dto: MovePlacementDto) {
    const enrollment = await this.loadEnrollment(this.prisma.client, enrollmentId);
    const open = await this.openPlacementOf(this.prisma.client, enrollmentId);
    try {
      const target = await this.resolveTarget(
        this.prisma.client,
        enrollment,
        {
          termId: dto.termId ?? open?.termId,
          classCohortId: dto.classCohortId ?? (dto.classId ? undefined : open?.classCohortId),
          classId: dto.classId,
          sectionId: dto.sectionId !== undefined ? dto.sectionId : (open?.sectionId ?? null),
          streamId: dto.streamId !== undefined ? dto.streamId : (open?.streamId ?? null),
        },
        open?.termId,
      );
      return {
        ok: true,
        errors: [] as string[],
        warnings: target.warnings,
        from: open
          ? { placementId: open.id, classCohortId: open.classCohortId, sectionId: open.sectionId, streamId: open.streamId, termId: open.termId }
          : null,
        to: target,
      };
    } catch (err: any) {
      return {
        ok: false,
        errors: [err?.response?.message ?? err?.message ?? 'Placement is not valid.'].flat() as string[],
        warnings: [] as string[],
        from: open ? { placementId: open.id, classCohortId: open.classCohortId, sectionId: open.sectionId, streamId: open.streamId, termId: open.termId } : null,
        to: null,
      };
    }
  }

  /**
   * Place many learners at once. `dryRun` validates every row and writes
   * nothing; a committed run is all-or-nothing, because a half-applied class
   * reshuffle is worse than a rejected one.
   */
  async bulkPlace(dto: BulkPlacementDto) {
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const run = async (tx: any) => {
      const rows: Array<{
        enrollmentId: string;
        studentProfileId?: string;
        ok: boolean;
        errors: string[];
        warnings: string[];
        placementId?: string;
      }> = [];

      for (const row of dto.rows) {
        try {
          const enrollment = await this.loadEnrollment(tx, row.enrollmentId);
          if (!holdsPlacement(enrollment.status as EnrollmentStatusValue)) {
            rows.push({
              enrollmentId: row.enrollmentId,
              studentProfileId: enrollment.studentProfileId,
              ok: false,
              errors: [`Enrollment is '${enrollment.status}' and holds no class seat.`],
              warnings: [],
            });
            continue;
          }
          const open = await this.openPlacementOf(tx, row.enrollmentId);
          if (dto.dryRun) {
            const target = await this.resolveTarget(
              tx,
              enrollment,
              {
                termId: dto.termId,
                classCohortId: row.classCohortId ?? (row.classId ? undefined : open?.classCohortId),
                classId: row.classId,
                sectionId: row.sectionId !== undefined ? row.sectionId : (open?.sectionId ?? null),
                streamId: row.streamId !== undefined ? row.streamId : (open?.streamId ?? null),
              },
              dto.termId,
            );
            rows.push({
              enrollmentId: row.enrollmentId,
              studentProfileId: enrollment.studentProfileId,
              ok: true,
              errors: [],
              warnings: target.warnings,
            });
          } else {
            const result = await this.appendPlacement(
              tx,
              enrollment,
              {
                termId: dto.termId,
                classCohortId: row.classCohortId ?? (row.classId ? undefined : open?.classCohortId),
                classId: row.classId,
                sectionId: row.sectionId !== undefined ? row.sectionId : (open?.sectionId ?? null),
                streamId: row.streamId !== undefined ? row.streamId : (open?.streamId ?? null),
                rollNumber: row.rollNumber,
                effectiveFrom: effectiveFrom.toISOString(),
                movementReason: dto.movementReason,
                notes: dto.reason,
              } as PlacementInputDto & { movementReason: MovementReasonValue },
              { closeReason: dto.movementReason, fallbackTermId: dto.termId },
            );
            rows.push({
              enrollmentId: row.enrollmentId,
              studentProfileId: enrollment.studentProfileId,
              ok: true,
              errors: [],
              warnings: result.warnings,
              placementId: result.placement.id,
            });
          }
        } catch (err: any) {
          rows.push({
            enrollmentId: row.enrollmentId,
            ok: false,
            errors: [err?.response?.message ?? err?.message ?? 'Placement failed.'].flat() as string[],
            warnings: [],
          });
        }
      }

      const failed = rows.filter((r) => !r.ok);
      if (failed.length && !dto.dryRun) {
        // Rejecting the whole batch is deliberate: partial application leaves a
        // class list nobody can reason about. The response still names every
        // bad row so the operator fixes them in one pass.
        throw new BadRequestException({
          message: `${failed.length} of ${rows.length} placements are invalid — nothing was saved.`,
          rows,
        });
      }
      return {
        dryRun: !!dto.dryRun,
        committed: !dto.dryRun,
        total: rows.length,
        ok: rows.filter((r) => r.ok).length,
        failed: failed.length,
        rows,
      };
    };

    return this.prisma.client.$transaction(run, { timeout: 120_000 });
  }

  /**
   * Roll every open placement in a cohort forward into the next term with the
   * same class/section/stream. This is the ordinary end-of-term action; nothing
   * about the learner changes except the term the placement is recorded against.
   */
  async termRollover(dto: TermRolloverDto) {
    const fromTerm = await this.prisma.client.term.findFirst({ where: { id: dto.fromTermId } });
    const toTerm = await this.prisma.client.term.findFirst({ where: { id: dto.toTermId } });
    if (!fromTerm) throw new NotFoundException(`Term ${dto.fromTermId} not found`);
    if (!toTerm) throw new NotFoundException(`Term ${dto.toTermId} not found`);
    if (fromTerm.academicYearId !== toTerm.academicYearId) {
      throw new BadRequestException(
        'Term rollover moves learners between terms of the SAME academic year. Crossing years is promotion or repeat.',
      );
    }
    if (fromTerm.id === toTerm.id) throw new BadRequestException('Source and target term are the same.');

    const open = await this.prisma.client.enrollmentPlacement.findMany({
      where: {
        termId: dto.fromTermId,
        effectiveTo: null,
        ...(dto.classCohortId ? { classCohortId: dto.classCohortId } : {}),
      },
      include: { enrollment: true },
    });
    const movable = open.filter((p: any) => holdsPlacement(p.enrollment.status as EnrollmentStatusValue));

    if (dto.dryRun) {
      return {
        dryRun: true,
        committed: false,
        total: open.length,
        eligible: movable.length,
        skipped: open.length - movable.length,
        rows: open.map((p: any) => ({
          enrollmentId: p.enrollmentId,
          studentProfileId: p.enrollment.studentProfileId,
          classCohortId: p.classCohortId,
          sectionId: p.sectionId,
          streamId: p.streamId,
          eligible: holdsPlacement(p.enrollment.status as EnrollmentStatusValue),
          reason: holdsPlacement(p.enrollment.status as EnrollmentStatusValue) ? null : `enrollment is ${p.enrollment.status}`,
        })),
      };
    }

    const effectiveFrom = toTerm.startDate > new Date() ? toTerm.startDate : new Date();
    return this.prisma.client.$transaction(
      async (tx: any) => {
        const rows: any[] = [];
        for (const p of movable) {
          const result = await this.appendPlacement(
            tx,
            p.enrollment,
            {
              termId: dto.toTermId,
              classCohortId: p.classCohortId,
              sectionId: p.sectionId,
              streamId: p.streamId,
              rollNumber: p.rollNumber ?? undefined,
              effectiveFrom: effectiveFrom.toISOString(),
              movementReason: 'TERM_ROLLOVER',
              notes: dto.reason ?? `Rolled over from ${fromTerm.name} to ${toTerm.name}`,
            } as PlacementInputDto & { movementReason: MovementReasonValue },
            { closeReason: 'TERM_ROLLOVER', fallbackTermId: dto.toTermId },
          );
          rows.push({ enrollmentId: p.enrollmentId, placementId: result.placement.id });
        }
        return {
          dryRun: false,
          committed: true,
          total: open.length,
          eligible: movable.length,
          skipped: open.length - movable.length,
          rows,
        };
      },
      { timeout: 180_000 },
    );
  }

  /* ───────────────────────────── Queries ──────────────────────────────── */

  /** Full append-only placement history for one enrollment, oldest first. */
  async history(enrollmentId: string) {
    return this.prisma.client.enrollmentPlacement.findMany({
      where: { enrollmentId },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      include: {
        term: { select: { id: true, name: true } },
        classCohort: { include: { schoolClass: { select: { id: true, name: true } }, academicYear: { select: { id: true, name: true } } } },
        section: { select: { id: true, name: true } },
        stream: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Where was this learner on a given date? The exit gate for Phase 1 is that
   * this answer comes from placement history, not from the profile's current
   * class fields.
   */
  async placementAt(studentProfileId: string, at: Date) {
    const row = await this.prisma.client.enrollmentPlacement.findFirst({
      where: {
        enrollment: { studentProfileId },
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        term: { select: { id: true, name: true } },
        classCohort: { include: { schoolClass: { select: { id: true, name: true } }, academicYear: { select: { id: true, name: true } } } },
        section: { select: { id: true, name: true } },
        stream: { select: { id: true, name: true } },
        enrollment: { select: { id: true, status: true, academicYearId: true, programmeId: true } },
      },
    });
    return row ?? null;
  }

  /**
   * The class list for a cohort at a point in time. Passing a past date
   * reconstructs the roster as it stood then — including learners who have since
   * left, which is exactly what a published result must be reproducible against.
   */
  async roster(cohortId: string, opts: { at?: Date; sectionId?: string; streamId?: string; termId?: string } = {}) {
    const at = opts.at ?? new Date();
    const rows = await this.prisma.client.enrollmentPlacement.findMany({
      where: {
        classCohortId: cohortId,
        ...(opts.sectionId ? { sectionId: opts.sectionId } : {}),
        ...(opts.streamId ? { streamId: opts.streamId } : {}),
        ...(opts.termId ? { termId: opts.termId } : {}),
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ rollNumber: 'asc' }, { createdAt: 'asc' }],
      include: {
        section: { select: { id: true, name: true } },
        stream: { select: { id: true, name: true } },
        enrollment: {
          include: {
            student: { include: { partner: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    return rows.map((p: any) => ({
      placementId: p.id,
      enrollmentId: p.enrollmentId,
      studentProfileId: p.enrollment.studentProfileId,
      admissionNo: p.enrollment.student?.admissionNo ?? null,
      name: p.enrollment.student?.partner?.name ?? null,
      enrollmentStatus: p.enrollment.status,
      rollNumber: p.rollNumber,
      sectionId: p.sectionId,
      sectionName: p.section?.name ?? null,
      streamId: p.streamId,
      streamName: p.stream?.name ?? null,
      termId: p.termId,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
    }));
  }

  private async loadEnrollment(client: any, enrollmentId: string) {
    const enrollment = await client.studentEnrollment.findFirst({ where: { id: enrollmentId } });
    if (!enrollment) throw new NotFoundException(`Enrollment ${enrollmentId} not found`);
    return enrollment;
  }
}
