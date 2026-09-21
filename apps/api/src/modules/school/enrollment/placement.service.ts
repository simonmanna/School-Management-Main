import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EVENTS, PERMISSIONS, resolveTerminology } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { ClassCohortService } from './class-cohort.service';
import { resolveAllowsSubdivision, validateSubdivision } from './subdivision';
import {
  describeViolation,
  projectBatch,
  seatViolation,
  type BatchTarget,
  type CapacityViolation,
} from './capacity';
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
  allowsSubdivision: boolean;
  /** The school's capacity policy at the time of resolution (ADR-030). */
  capacityPolicy: CapacityPolicyValue;
  warnings: string[];
  /** Seats this placement would take beyond configured capacity. */
  violations: CapacityViolation[];
}

export type CapacityPolicyValue = 'ENFORCE' | 'WARN' | 'OFF';

type PlacementInput = PlacementInputDto & {
  movementReason?: MovementReasonValue;
  overrideCapacity?: boolean;
  overrideReason?: string;
};

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
 * Two rules added by the academic structure redesign:
 *
 *   - Subdivision (ADR-029). A class is divided into sections (shown as
 *     "Streams") or it is not; `subdivision.ts` holds the rules.
 *   - Capacity (ADR-030). A NULL capacity is unlimited. Otherwise the school's
 *     `capacityPolicy` decides: ENFORCE refuses an over-capacity placement unless
 *     the user holds `school:enrollment:capacity:override` and gives a reason
 *     (both recorded on the placement); WARN seats and reports; OFF ignores it.
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
   * Turn a loose placement request (class or cohort, optional section) into a
   * validated target, or throw with every problem listed at once so a user fixes
   * one form rather than replaying five round-trips.
   *
   * `opts.lock` takes the capacity advisory locks. Only a write path passes it:
   * the lock is transaction-scoped, and a preview has no transaction to hold it.
   */
  async resolveTarget(
    tx: any,
    enrollment: { id?: string; academicYearId: string; organizationId: string },
    input: {
      termId?: string;
      classCohortId?: string;
      classId?: string;
      sectionId?: string | null;
    },
    fallbackTermId?: string,
    opts: { lock?: boolean } = {},
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

    let cohortId: string;
    if (input.classCohortId) {
      cohortId = input.classCohortId;
    } else if (input.classId) {
      cohortId = (await this.cohorts.ensureCohort(enrollment.academicYearId, input.classId, tx)).id;
    } else {
      throw new BadRequestException('A class or class cohort is required for a placement.');
    }
    const cohort = await tx.classCohort.findFirst({
      where: { id: cohortId },
      include: {
        schoolClass: { select: { id: true, name: true, capacity: true, allowsStreams: true, isActive: true } },
      },
    });
    if (!cohort) throw new NotFoundException(`Class cohort ${cohortId} not found`);
    if (cohort.academicYearId !== enrollment.academicYearId) {
      throw new BadRequestException('That class cohort belongs to a different academic year than this enrollment.');
    }

    const allowsSubdivision = resolveAllowsSubdivision({
      cohortOverride: cohort.allowsSubdivision,
      classAllowsStreams: cohort.schoolClass?.allowsStreams,
    });

    let section = input.sectionId
      ? await tx.section.findFirst({
          where: { id: input.sectionId },
          select: { id: true, classId: true, name: true, capacity: true, isActive: true },
        })
      : null;
    let sectionId = input.sectionId ?? null;

    const activeSections = await tx.section.findMany({
      where: { classId: cohort.classId, isActive: true, deletedAt: null },
      select: { id: true, classId: true, name: true, capacity: true, isActive: true },
      take: 2,
    });

    // When the class needs a section and the caller did not pick one, fill it in
    // ONLY if the choice is unambiguous. Promotion and rollover screens leave it
    // blank; guessing between two sections would be a silent placement decision.
    if (allowsSubdivision && !sectionId && activeSections.length === 1) {
      section = activeSections[0];
      sectionId = section.id;
    }

    const { label, capacityPolicy } = await this.schoolSettings(tx);
    const result = validateSubdivision({
      allowsSubdivision,
      cohortClassId: cohort.classId,
      classHasActiveSections: activeSections.length > 0,
      sectionId,
      section,
      label,
    });
    if (!result.ok) throw new BadRequestException(result.errors.join(' '));

    const { warnings, violations } =
      capacityPolicy === 'OFF'
        ? { warnings: [], violations: [] }
        : await this.capacityCheck(tx, {
            cohort,
            section,
            enrollmentId: enrollment.id ?? null,
            lock: !!opts.lock,
            label,
          });

    return {
      cohortId: cohort.id,
      classId: cohort.classId,
      termId,
      sectionId: result.value.sectionId,
      allowsSubdivision,
      capacityPolicy,
      warnings,
      violations,
    };
  }

  /**
   * The school's word for a subdivision (brief §2), for error messages, and its
   * capacity policy (ADR-030). A school with no profile yet enforces capacity —
   * which only ever bites where somebody configured a capacity.
   */
  private async schoolSettings(tx: any): Promise<{ label: string; capacityPolicy: CapacityPolicyValue }> {
    const profile = await tx.schoolProfile.findFirst({ select: { terminology: true, capacityPolicy: true } });
    return {
      label: resolveTerminology(profile?.terminology).section,
      capacityPolicy: (profile?.capacityPolicy ?? 'ENFORCE') as CapacityPolicyValue,
    };
  }

  /**
   * Would this placement overfill its class or stream?
   *
   * Three things make this right rather than merely present:
   *
   *   1. The learner's OWN seat is not counted against them. A learner already in
   *      the target class (or section) is not taking a new seat: a section change
   *      inside a full class, or a term rollover that keeps everyone where they
   *      are, occupies nothing new — and lowering a class's capacity must not make
   *      routine end-of-term rollover fail.
   *   2. The count is taken under a transaction-scoped advisory lock on the cohort
   *      and the section. `count` then `insert` is not serialisable under READ
   *      COMMITTED; without the lock two clerks can both seat the 41st pupil.
   *   3. Class capacity is the cohort's own, else the class default; `null` is
   *      unlimited and never a violation.
   */
  private async capacityCheck(
    tx: any,
    args: { cohort: any; section: any; enrollmentId: string | null; lock: boolean; label: string },
  ): Promise<{ warnings: string[]; violations: CapacityViolation[] }> {
    const { cohort, section, enrollmentId, lock, label } = args;
    const classCapacity: number | null = cohort.capacity ?? cohort.schoolClass?.capacity ?? null;
    const sectionCapacity: number | null = section?.capacity ?? null;
    if (classCapacity === null && sectionCapacity === null) return { warnings: [], violations: [] };

    const open = enrollmentId
      ? await tx.enrollmentPlacement.findFirst({
          where: { enrollmentId, effectiveTo: null },
          select: { classCohortId: true, sectionId: true },
        })
      : null;
    const alreadyInClass = open?.classCohortId === cohort.id;
    const alreadyInSection = alreadyInClass && !!section && open?.sectionId === section.id;

    if (lock) {
      await this.advisoryLock(tx, `cohort:${cohort.id}`);
      if (section) await this.advisoryLock(tx, `section:${section.id}`);
    }

    const others = (where: Record<string, unknown>) =>
      tx.enrollmentPlacement.count({
        where: {
          ...where,
          effectiveTo: null,
          ...(enrollmentId ? { enrollmentId: { not: enrollmentId } } : {}),
        },
      });

    const violations: CapacityViolation[] = [];
    if (classCapacity !== null && !alreadyInClass) {
      const v = seatViolation({
        kind: 'class',
        id: cohort.id,
        name: cohort.schoolClass?.name ?? 'This class',
        capacity: classCapacity,
        occupiedByOthers: await others({ classCohortId: cohort.id }),
      });
      if (v) violations.push(v);
    }
    if (sectionCapacity !== null && !alreadyInSection) {
      const v = seatViolation({
        kind: 'section',
        id: section.id,
        name: section.name,
        capacity: sectionCapacity,
        occupiedByOthers: await others({ sectionId: section.id }),
      });
      if (v) violations.push(v);
    }
    return { warnings: violations.map((v) => describeViolation(v, label)), violations };
  }

  private async advisoryLock(tx: any, key: string): Promise<void> {
    // pg_advisory_xact_lock returns void, which the raw client cannot decode, so
    // it is wrapped in a SELECT that returns a plain integer.
    await tx.$queryRawUnsafe('SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) l', key);
  }

  /**
   * Turn capacity violations into an outcome: refuse, warn, or seat under an
   * audited override. Returns the override to record, or null.
   */
  private applyCapacityPolicy(
    target: ResolvedTarget,
    input: { overrideCapacity?: boolean; overrideReason?: string },
  ): { overriddenById: string; reason: string } | null {
    if (target.violations.length === 0) return null;
    if (target.capacityPolicy !== 'ENFORCE') return null; // WARN: already on the target

    if (!input.overrideCapacity) {
      throw new ConflictException({
        message:
          `${target.warnings.join(' ')} Capacity is enforced. Choose another class or stream, raise its ` +
          'capacity, or seat the learner under a capacity override with a reason.',
        violations: target.violations,
      });
    }
    if (!this.tenant.permissions?.includes(PERMISSIONS.school.overrideCapacity)) {
      throw new ForbiddenException(
        `Seating a learner beyond capacity requires the ${PERMISSIONS.school.overrideCapacity} permission.`,
      );
    }
    const reason = input.overrideReason?.trim();
    if (!reason) {
      throw new BadRequestException('A capacity override needs a reason, which is recorded on the placement.');
    }
    return { overriddenById: this.tenant.userId ?? 'unknown', reason };
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
   *
   * Every command — create, move, bulk, rollover, promote, repeat — funnels
   * through here, which is why capacity is enforced here and nowhere else.
   */
  async appendPlacement(
    tx: any,
    enrollment: any,
    input: PlacementInput,
    opts: { closeReason?: MovementReasonValue; fallbackTermId?: string } = {},
  ) {
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    const target = await this.resolveTarget(tx, enrollment, input, opts.fallbackTermId, { lock: true });
    const override = this.applyCapacityPolicy(target, input);
    const movementReason = input.movementReason ?? 'INITIAL_PLACEMENT';

    const closed = await this.closeOpen(tx, enrollment.id, effectiveFrom, opts.closeReason ?? movementReason);

    const created = await tx.enrollmentPlacement.create({
      data: {
        organizationId: enrollment.organizationId,
        enrollmentId: enrollment.id,
        termId: target.termId,
        classCohortId: target.cohortId,
        sectionId: target.sectionId,
        rollNumber: input.rollNumber ?? closed?.rollNumber ?? null,
        effectiveFrom,
        movementReason,
        notes: input.notes ?? null,
        changedById: this.tenant.userId ?? null,
        capacityOverriddenById: override?.overriddenById ?? null,
        capacityOverrideReason: override?.reason ?? null,
      },
    });

    await this.audit.recordInTx(tx, {
      entity: 'EnrollmentPlacement',
      entityId: created.id,
      action: 'create',
      oldValues: closed
        ? { placementId: closed.id, classCohortId: closed.classCohortId, sectionId: closed.sectionId }
        : undefined,
      newValues: {
        enrollmentId: enrollment.id,
        termId: target.termId,
        classCohortId: target.cohortId,
        sectionId: target.sectionId,
        movementReason,
        effectiveFrom,
        ...(override
          ? { capacityOverride: { violations: target.violations, reason: override.reason } }
          : {}),
      },
    });
    await this.events.publishInTx(tx, EVENTS.SchoolPlacementChanged, {
      organizationId: enrollment.organizationId,
      enrollmentId: enrollment.id,
      studentProfileId: enrollment.studentProfileId,
      placementId: created.id,
      previousPlacementId: closed?.id ?? null,
      from: closed
        ? { classCohortId: closed.classCohortId, sectionId: closed.sectionId, termId: closed.termId }
        : null,
      to: { classCohortId: target.cohortId, sectionId: target.sectionId, termId: target.termId },
      movementReason,
      effectiveFrom,
      actorId: this.tenant.userId ?? null,
      requestId: this.tenant.requestId ?? null,
    });

    const warnings = override
      ? target.warnings.map((w) => `${w} Seated under a capacity override.`)
      : target.warnings;
    return { placement: created, closed, warnings };
  }

  /* ───────────────────────────── Commands ─────────────────────────────── */

  /** Move a learner: class and/or stream change inside the same year. */
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
          // case is a stream change, not a class change.
          classCohortId: dto.classCohortId ?? (dto.classId ? undefined : open?.classCohortId),
          classId: dto.classId,
          // Undefined means "keep what they had"; explicit null means "clear it".
          // A class change starts from no stream: the old one belongs to the old class.
          sectionId:
            dto.sectionId !== undefined ? dto.sectionId : dto.classId || dto.classCohortId ? null : (open?.sectionId ?? null),
          rollNumber: dto.rollNumber,
          effectiveFrom: dto.effectiveFrom,
          movementReason: dto.movementReason,
          notes: dto.notes ?? dto.reason,
          overrideCapacity: dto.overrideCapacity,
          overrideReason: dto.overrideReason,
        } as PlacementInput,
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
   * form change so a user sees "that stream is full" before they commit, not
   * after.
   */
  async preview(enrollmentId: string, dto: MovePlacementDto) {
    const enrollment = await this.loadEnrollment(this.prisma.client, enrollmentId);
    const open = await this.openPlacementOf(this.prisma.client, enrollmentId);
    const from = open
      ? { placementId: open.id, classCohortId: open.classCohortId, sectionId: open.sectionId, termId: open.termId }
      : null;
    try {
      const target = await this.resolveTarget(
        this.prisma.client,
        enrollment,
        {
          termId: dto.termId ?? open?.termId,
          classCohortId: dto.classCohortId ?? (dto.classId ? undefined : open?.classCohortId),
          classId: dto.classId,
          sectionId:
            dto.sectionId !== undefined ? dto.sectionId : dto.classId || dto.classCohortId ? null : (open?.sectionId ?? null),
        },
        open?.termId,
      );
      const blocked = target.violations.length > 0 && target.capacityPolicy === 'ENFORCE';
      return {
        ok: !blocked || !!dto.overrideCapacity,
        errors: [] as string[],
        warnings: target.warnings,
        needsCapacityOverride: blocked,
        from,
        to: target,
      };
    } catch (err: any) {
      return {
        ok: false,
        errors: [err?.response?.message ?? err?.message ?? 'Placement is not valid.'].flat() as string[],
        warnings: [] as string[],
        needsCapacityOverride: false,
        from,
        to: null,
      };
    }
  }

  /**
   * Place many learners at once.
   *
   * `dryRun` validates every row and projects the WHOLE batch against every class
   * and stream it touches — row-by-row checks let 40 rows each pass while the
   * batch of 41 overflows. It returns a `previewToken`; a commit that passes it
   * back is refused if occupancy has moved since, so nobody commits against a
   * stale preview. A committed run is all-or-nothing.
   */
  async bulkPlace(dto: BulkPlacementDto) {
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const run = async (tx: any) => {
      const plan = await this.planBatch(tx, dto);

      if (dto.dryRun) {
        return {
          dryRun: true,
          committed: false,
          total: plan.rows.length,
          ok: plan.rows.filter((r) => r.ok).length,
          failed: plan.rows.filter((r) => !r.ok).length,
          capacity: plan.projection,
          overflow: plan.projection.some((p) => p.overflow > 0),
          previewToken: plan.token,
          rows: plan.rows,
        };
      }

      if (dto.previewToken && dto.previewToken !== plan.token) {
        throw new ConflictException(
          'Class or stream occupancy has changed since this batch was previewed. Preview it again before committing.',
        );
      }
      const invalid = plan.rows.filter((r) => !r.ok);
      if (invalid.length) {
        throw new BadRequestException({
          message: `${invalid.length} of ${plan.rows.length} placements are invalid — nothing was saved.`,
          rows: plan.rows,
        });
      }

      const rows: Array<{ enrollmentId: string; placementId: string; warnings: string[] }> = [];
      const failures: Array<{ enrollmentId: string; errors: string[] }> = [];
      for (const row of dto.rows) {
        try {
          const enrollment = await this.loadEnrollment(tx, row.enrollmentId);
          const open = await this.openPlacementOf(tx, row.enrollmentId);
          const result = await this.appendPlacement(
            tx,
            enrollment,
            {
              termId: dto.termId,
              classCohortId: row.classCohortId ?? (row.classId ? undefined : open?.classCohortId),
              classId: row.classId,
              sectionId: row.sectionId !== undefined ? row.sectionId : (open?.sectionId ?? null),
              rollNumber: row.rollNumber,
              effectiveFrom: effectiveFrom.toISOString(),
              movementReason: dto.movementReason,
              notes: dto.reason,
              overrideCapacity: dto.overrideCapacity,
              overrideReason: dto.overrideReason,
            } as PlacementInput,
            { closeReason: dto.movementReason, fallbackTermId: dto.termId },
          );
          rows.push({ enrollmentId: row.enrollmentId, placementId: result.placement.id, warnings: result.warnings });
        } catch (err: any) {
          failures.push({
            enrollmentId: row.enrollmentId,
            errors: [err?.response?.message ?? err?.message ?? 'Placement failed.'].flat() as string[],
          });
        }
      }
      if (failures.length) {
        // Rejecting the whole batch is deliberate: partial application leaves a
        // class list nobody can reason about. Rows are written in order inside
        // one transaction, so the row that overflows a class fails here and takes
        // every earlier row with it.
        throw new BadRequestException({
          message: `${failures.length} of ${dto.rows.length} placements failed — nothing was saved.`,
          failures,
        });
      }
      return { dryRun: false, committed: true, total: rows.length, ok: rows.length, failed: 0, rows };
    };

    return this.prisma.client.$transaction(run, { timeout: 120_000 });
  }

  /**
   * Validate a batch and project it against capacity, writing nothing. Shared by
   * the dry run and the commit, so the token a preview returns is computed the
   * same way the commit recomputes it.
   */
  private async planBatch(tx: any, dto: BulkPlacementDto) {
    const batchIds = dto.rows.map((r) => r.enrollmentId);
    const rows: Array<{
      enrollmentId: string;
      studentProfileId?: string;
      ok: boolean;
      errors: string[];
      warnings: string[];
      target?: { cohortId: string; sectionId: string | null };
    }> = [];
    const targets = new Map<string, BatchTarget>();

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
        const target = await this.resolveTarget(
          tx,
          enrollment,
          {
            termId: dto.termId,
            classCohortId: row.classCohortId ?? (row.classId ? undefined : open?.classCohortId),
            classId: row.classId,
            sectionId: row.sectionId !== undefined ? row.sectionId : (open?.sectionId ?? null),
          },
          dto.termId,
        );
        rows.push({
          enrollmentId: row.enrollmentId,
          studentProfileId: enrollment.studentProfileId,
          ok: true,
          errors: [],
          warnings: target.warnings,
          target: { cohortId: target.cohortId, sectionId: target.sectionId },
        });
        await this.countTarget(tx, targets, 'class', target.cohortId, batchIds);
        if (target.sectionId) await this.countTarget(tx, targets, 'section', target.sectionId, batchIds);
      } catch (err: any) {
        rows.push({
          enrollmentId: row.enrollmentId,
          ok: false,
          errors: [err?.response?.message ?? err?.message ?? 'Placement failed.'].flat() as string[],
          warnings: [],
        });
      }
    }

    const projection = projectBatch([...targets.values()]);
    const token = createHash('sha256')
      .update(
        JSON.stringify({
          rows: rows.map((r) => [r.enrollmentId, r.target?.cohortId ?? null, r.target?.sectionId ?? null]).sort(),
          occupancy: projection.map((p) => [p.kind, p.id, p.openNow, p.capacity]).sort(),
        }),
      )
      .digest('hex')
      .slice(0, 32);
    return { rows, projection, token };
  }

  /** Add one incoming learner to a batch target, loading its occupancy once. */
  private async countTarget(
    tx: any,
    targets: Map<string, BatchTarget>,
    kind: 'class' | 'section',
    id: string,
    batchIds: string[],
  ) {
    const key = `${kind}:${id}`;
    let t = targets.get(key);
    if (!t) {
      const openNow = await tx.enrollmentPlacement.count({
        where: {
          effectiveTo: null,
          enrollmentId: { notIn: batchIds },
          ...(kind === 'class' ? { classCohortId: id } : { sectionId: id }),
        },
      });
      let name = id;
      let capacity: number | null = null;
      if (kind === 'class') {
        const c = await tx.classCohort.findFirst({
          where: { id },
          select: { capacity: true, schoolClass: { select: { name: true, capacity: true } } },
        });
        name = c?.schoolClass?.name ?? id;
        capacity = c?.capacity ?? c?.schoolClass?.capacity ?? null;
      } else {
        const s = await tx.section.findFirst({ where: { id }, select: { name: true, capacity: true } });
        name = s?.name ?? id;
        capacity = s?.capacity ?? null;
      }
      t = { kind, id, name, capacity, openNow, incoming: 0 };
      targets.set(key, t);
    }
    // Every batch member is counted as incoming, including one who already sits
    // here: batch members were excluded from `openNow`, so this counts them once.
    t.incoming += 1;
  }

  /**
   * Roll every open placement in a cohort forward into the next term with the
   * same class and stream. The ordinary end-of-term action; nothing about the
   * learner changes except the term the placement is recorded against — which is
   * also why it never trips capacity (see `capacityCheck`).
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
              rollNumber: p.rollNumber ?? undefined,
              effectiveFrom: effectiveFrom.toISOString(),
              movementReason: 'TERM_ROLLOVER',
              notes: dto.reason ?? `Rolled over from ${fromTerm.name} to ${toTerm.name}`,
            } as PlacementInput,
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
      },
    });
  }

  /**
   * Where was this learner on a given date? Answered from placement history, not
   * from the profile's current class fields.
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
  async roster(cohortId: string, opts: { at?: Date; sectionId?: string; termId?: string } = {}) {
    const at = opts.at ?? new Date();
    const rows = await this.prisma.client.enrollmentPlacement.findMany({
      where: {
        classCohortId: cohortId,
        ...(opts.sectionId ? { sectionId: opts.sectionId } : {}),
        ...(opts.termId ? { termId: opts.termId } : {}),
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ rollNumber: 'asc' }, { createdAt: 'asc' }],
      include: {
        section: { select: { id: true, name: true } },
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
