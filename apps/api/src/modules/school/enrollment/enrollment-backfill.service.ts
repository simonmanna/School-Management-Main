import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { ClassCohortService } from './class-cohort.service';
import { validateGrouping, resolveGroupingMode, type GroupingModeValue } from './grouping';
import type { EnrollmentStatusValue } from './enrollment-fsm';
import type { BackfillDto, ResolveExceptionDto } from './enrollment.dto';

/** Legacy `Enrollment.status` → canonical membership status. */
const LEGACY_STATUS: Record<string, EnrollmentStatusValue> = {
  enrolled: 'ACTIVE',
  completed: 'COMPLETED',
  transferred_out: 'TRANSFERRED',
  withdrawn: 'WITHDRAWN',
};

interface BackfillRow {
  legacyEnrollmentId: string;
  studentProfileId: string;
  academicYearId: string;
  termId: string;
  classId: string;
  sectionId: string | null;
  streamId: string | null;
  rollNumber: string | null;
  effectiveDate: Date;
  endedAt: Date | null;
  status: string;
}

/**
 * Phase 1 migration: legacy `Enrollment` → `StudentEnrollment` + placements.
 *
 * Rules the Phase 0.5 plan makes non-negotiable, and how they land here:
 *
 *  - **Dry-run first.** Nothing is written unless `dryRun` is explicitly false.
 *  - **Idempotent.** `EnrollmentPlacement.legacyEnrollmentId` is unique, so a
 *    re-run maps each legacy row exactly once. Re-running is safe and is how a
 *    partially completed migration is finished.
 *  - **Tagged.** Every row carries the `migrationRunId`, so a failed gate can
 *    remove exactly those rows and nothing else.
 *  - **Nothing discarded.** A legacy row that cannot be mapped lands in
 *    `AcademicMigrationException` as a visible queue item, never in a log line.
 *
 * The shape change is real: legacy enrollment is one row PER TERM, canonical
 * membership is one row PER YEAR with a placement per term. So the backfill
 * groups legacy rows by (learner, academic year) and appends their placements
 * in effective-date order.
 */
@Injectable()
export class EnrollmentBackfillService {
  private readonly logger = new Logger('EnrollmentBackfill');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly cohorts: ClassCohortService,
  ) {}

  async run(dto: BackfillDto) {
    const organizationId = this.tenant.organizationId;
    const dryRun = dto.dryRun !== false;
    const migrationRunId = dto.migrationRunId ?? `p1-enrollment-${Date.now()}`;

    const legacy = await this.loadLegacy(dto.academicYearId);
    const already = await this.prisma.client.enrollmentPlacement.findMany({
      where: { legacyEnrollmentId: { in: legacy.map((r) => r.legacyEnrollmentId) } },
      select: { legacyEnrollmentId: true },
    });
    const mappedIds = new Set(already.map((r: any) => r.legacyEnrollmentId));

    const pending = legacy.filter((r) => !mappedIds.has(r.legacyEnrollmentId));

    // Group by learner + academic year — the canonical membership grain.
    const groups = new Map<string, BackfillRow[]>();
    for (const row of pending) {
      const key = `${row.studentProfileId}::${row.academicYearId}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime());
    }

    const report = {
      migrationRunId,
      dryRun,
      legacyRows: legacy.length,
      alreadyMapped: mappedIds.size,
      candidates: pending.length,
      enrollmentsCreated: 0,
      enrollmentsReused: 0,
      placementsCreated: 0,
      exceptions: [] as Array<{ sourceId: string; reason: string }>,
    };

    for (const [key, rows] of groups) {
      const [studentProfileId, academicYearId] = key.split('::');
      try {
        const planned = await this.planGroup(studentProfileId, academicYearId, rows, dto.defaultGroupingMode);
        if (dryRun) {
          report.enrollmentsCreated += planned.willCreateEnrollment ? 1 : 0;
          report.enrollmentsReused += planned.willCreateEnrollment ? 0 : 1;
          report.placementsCreated += planned.placements.length;
          continue;
        }
        const applied = await this.applyGroup(organizationId, migrationRunId, planned);
        report.enrollmentsCreated += applied.createdEnrollment ? 1 : 0;
        report.enrollmentsReused += applied.createdEnrollment ? 0 : 1;
        report.placementsCreated += applied.placements;
      } catch (err: any) {
        const reason = [err?.response?.message ?? err?.message ?? 'Unmapped'].flat().join(' ');
        for (const row of rows) {
          report.exceptions.push({ sourceId: row.legacyEnrollmentId, reason });
          if (!dryRun) {
            await this.recordException(organizationId, migrationRunId, row, reason);
          }
        }
      }
    }

    if (!dryRun) {
      await this.audit.record({
        entity: 'StudentEnrollment',
        entityId: migrationRunId,
        action: 'create',
        newValues: { ...report, exceptions: report.exceptions.length },
      });
    }
    return report;
  }

  /* ─────────────────────────────── Planning ───────────────────────────── */

  private async loadLegacy(academicYearId?: string): Promise<BackfillRow[]> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: { ...(academicYearId ? { term: { academicYearId } } : {}) },
      include: { term: { select: { id: true, academicYearId: true } } },
      orderBy: { effectiveDate: 'asc' },
    });
    return rows.map((r: any) => ({
      legacyEnrollmentId: r.id,
      studentProfileId: r.studentProfileId,
      academicYearId: r.term.academicYearId,
      termId: r.termId,
      classId: r.classId,
      sectionId: r.sectionId,
      streamId: r.streamId,
      rollNumber: r.rollNumber,
      effectiveDate: r.effectiveDate ?? r.enrolledAt,
      endedAt: r.endedAt,
      status: r.status,
    }));
  }

  private async planGroup(
    studentProfileId: string,
    academicYearId: string,
    rows: BackfillRow[],
    defaultMode?: GroupingModeValue,
  ) {
    const last = rows[rows.length - 1];
    const cls = await this.prisma.client.schoolClass.findFirst({
      where: { id: last.classId },
      select: { id: true, name: true, gradeLevelId: true },
    });
    if (!cls) throw new BadRequestException(`Class ${last.classId} no longer exists.`);

    const link = await this.prisma.client.programmeGradeLevel.findFirst({
      where: { gradeLevelId: cls.gradeLevelId },
      select: { programmeId: true },
    });
    if (!link) {
      throw new BadRequestException(
        `No academic programme covers the grade level of class "${cls.name}". Run the Uganda programme templates (or link the grade level) and re-run.`,
      );
    }

    const existing = await this.prisma.client.studentEnrollment.findFirst({
      where: { studentProfileId, academicYearId },
    });

    const placements = [];
    for (const row of rows) {
      const rowClass = await this.prisma.client.schoolClass.findFirst({
        where: { id: row.classId },
        select: { id: true, name: true },
      });
      if (!rowClass) throw new BadRequestException(`Class ${row.classId} no longer exists.`);

      const cohort = await this.prisma.client.classCohort.findFirst({
        where: { academicYearId, classId: row.classId },
        include: { programme: true },
      });

      const section = row.sectionId
        ? await this.prisma.client.section.findFirst({
            where: { id: row.sectionId },
            select: { id: true, classId: true, name: true },
          })
        : null;
      const stream = row.streamId
        ? await this.prisma.client.stream.findFirst({
            where: { id: row.streamId },
            select: { id: true, classId: true, sectionId: true, name: true },
          })
        : null;

      // Backfill validates the CLASS relationship (a section from another class
      // is real corruption and must surface), but not the mode requirement: a
      // legacy row with no section is a fact of history, and rejecting it would
      // discard the learner rather than migrate them.
      const structural = validateGrouping({
        mode: 'NONE',
        cohortClassId: row.classId,
        sectionId: row.sectionId,
        streamId: row.streamId,
        section,
        stream,
      }).errors.filter((e) => !e.includes('not subdivided'));
      if (structural.length) throw new BadRequestException(structural.join(' '));

      placements.push({
        row,
        classId: row.classId,
        cohortId: cohort?.id ?? null,
        sectionId: row.sectionId,
        streamId: row.streamId,
        groupingMode: resolveGroupingMode(
          (cohort?.groupingMode ?? null) as GroupingModeValue | null,
          (cohort?.programme?.groupingMode ?? defaultMode ?? null) as GroupingModeValue | null,
        ),
      });
    }

    return {
      studentProfileId,
      academicYearId,
      gradeLevelId: cls.gradeLevelId,
      programmeId: link.programmeId,
      admissionDate: rows[0].effectiveDate,
      status: LEGACY_STATUS[last.status] ?? 'ACTIVE',
      completionDate: last.endedAt,
      existingEnrollmentId: existing?.id ?? null,
      willCreateEnrollment: !existing,
      legacyEnrollmentId: rows[0].legacyEnrollmentId,
      placements,
    };
  }

  /* ─────────────────────────────── Applying ───────────────────────────── */

  private async applyGroup(organizationId: string, migrationRunId: string, plan: any) {
    return this.prisma.client.$transaction(async (tx: any) => {
      let enrollmentId = plan.existingEnrollmentId;
      let createdEnrollment = false;

      if (!enrollmentId) {
        const enrollment = await tx.studentEnrollment.create({
          data: {
            organizationId,
            studentProfileId: plan.studentProfileId,
            academicYearId: plan.academicYearId,
            programmeId: plan.programmeId,
            gradeLevelId: plan.gradeLevelId,
            admissionDate: plan.admissionDate,
            completionDate: plan.completionDate,
            status: plan.status,
            enrollmentType: 'NEW',
            legacyEnrollmentId: plan.legacyEnrollmentId,
            migrationRunId,
            notes: 'Backfilled from legacy Enrollment (Phase 1).',
          },
        });
        enrollmentId = enrollment.id;
        createdEnrollment = true;
        await tx.studentEnrollmentEvent.create({
          data: {
            organizationId,
            enrollmentId,
            toStatus: plan.status,
            reason: 'Backfilled from legacy Enrollment',
            changedById: this.tenant.userId ?? null,
            metadata: { migrationRunId },
          },
        });
      }

      let placements = 0;
      for (const p of plan.placements) {
        const cohortId = p.cohortId ?? (await this.cohorts.ensureCohort(plan.academicYearId, p.classId, tx)).id;
        const previous = await tx.enrollmentPlacement.findFirst({
          where: { enrollmentId, effectiveTo: null },
        });
        const effectiveFrom = p.row.effectiveDate;
        if (previous) {
          const closeAt = effectiveFrom > previous.effectiveFrom ? effectiveFrom : previous.effectiveFrom;
          await tx.enrollmentPlacement.updateMany({
            where: { id: previous.id },
            data: { effectiveTo: closeAt, endReason: 'BACKFILL' },
          });
        }
        await tx.enrollmentPlacement.create({
          data: {
            organizationId,
            enrollmentId,
            termId: p.row.termId,
            classCohortId: cohortId,
            sectionId: p.sectionId,
            streamId: p.streamId,
            rollNumber: p.row.rollNumber,
            effectiveFrom,
            effectiveTo: p.row.endedAt,
            movementReason: 'BACKFILL',
            endReason: p.row.endedAt ? 'BACKFILL' : null,
            notes: 'Backfilled from legacy Enrollment (Phase 1).',
            changedById: this.tenant.userId ?? null,
            migrationRunId,
            legacyEnrollmentId: p.row.legacyEnrollmentId,
          },
        });
        placements += 1;
      }

      // Re-derive the compatibility projection from what we just wrote, so the
      // profile agrees with placement history the moment the backfill lands.
      const open = await tx.enrollmentPlacement.findFirst({
        where: { effectiveTo: null, enrollment: { studentProfileId: plan.studentProfileId } },
        orderBy: { effectiveFrom: 'desc' },
        include: { classCohort: { select: { classId: true } } },
      });
      await tx.studentProfile.updateMany({
        where: { id: plan.studentProfileId },
        data: {
          currentClassId: open?.classCohort?.classId ?? null,
          currentSectionId: open?.sectionId ?? null,
          currentStreamId: open?.streamId ?? null,
        },
      });

      return { createdEnrollment, placements };
    });
  }

  private async recordException(organizationId: string, migrationRunId: string, row: BackfillRow, reason: string) {
    await this.prisma.client.academicMigrationException.create({
      data: {
        organizationId,
        migrationRunId,
        sourceEntity: 'Enrollment',
        sourceId: row.legacyEnrollmentId,
        reason,
        payload: row as any,
      },
    });
  }

  /* ───────────────────────── Reconciliation & rollback ─────────────────── */

  /**
   * The reconciliation report Phase 0.5 §9 requires. Every number here is one a
   * reviewer can act on: a non-zero `unmapped` blocks the gate, a non-zero
   * `placementMismatch` means history did not survive the shape change.
   */
  async reconcile(academicYearId?: string) {
    const legacy = await this.loadLegacy(academicYearId);
    const legacyIds = legacy.map((r) => r.legacyEnrollmentId);

    const mapped = await this.prisma.client.enrollmentPlacement.findMany({
      where: { legacyEnrollmentId: { in: legacyIds } },
      select: {
        legacyEnrollmentId: true,
        enrollmentId: true,
        sectionId: true,
        streamId: true,
        termId: true,
        rollNumber: true,
        classCohort: { select: { classId: true } },
      },
    });
    const byLegacy = new Map(mapped.map((m: any) => [m.legacyEnrollmentId, m]));

    const unmapped: string[] = [];
    const differences: Array<{ legacyEnrollmentId: string; field: string; legacy: unknown; canonical: unknown }> = [];

    for (const row of legacy) {
      const m: any = byLegacy.get(row.legacyEnrollmentId);
      if (!m) {
        unmapped.push(row.legacyEnrollmentId);
        continue;
      }
      const checks: Array<[string, unknown, unknown]> = [
        ['classId', row.classId, m.classCohort?.classId ?? null],
        ['sectionId', row.sectionId, m.sectionId],
        ['streamId', row.streamId, m.streamId],
        ['termId', row.termId, m.termId],
        ['rollNumber', row.rollNumber, m.rollNumber],
      ];
      for (const [field, legacyValue, canonicalValue] of checks) {
        if ((legacyValue ?? null) !== (canonicalValue ?? null)) {
          differences.push({ legacyEnrollmentId: row.legacyEnrollmentId, field, legacy: legacyValue, canonical: canonicalValue });
        }
      }
    }

    const [canonicalEnrollments, canonicalPlacements, openPlacements, exceptions] = await Promise.all([
      this.prisma.client.studentEnrollment.count({ where: academicYearId ? { academicYearId } : {} }),
      this.prisma.client.enrollmentPlacement.count(
        academicYearId ? { where: { enrollment: { academicYearId } } } : undefined,
      ),
      this.prisma.client.enrollmentPlacement.count({
        where: { effectiveTo: null, ...(academicYearId ? { enrollment: { academicYearId } } : {}) },
      }),
      this.prisma.client.academicMigrationException.count({ where: { resolvedAt: null } }),
    ]);

    // The invariant behind the whole model: at most one open placement each.
    const duplicateOpen: Array<{ enrollmentId: string; open: number }> = (
      await this.prisma.client.$queryRawUnsafe<Array<{ enrollmentId: string; open: bigint }>>(
        `SELECT "enrollmentId", COUNT(*)::bigint AS open
           FROM "EnrollmentPlacement"
          WHERE "effectiveTo" IS NULL AND "organizationId" = $1
          GROUP BY "enrollmentId" HAVING COUNT(*) > 1`,
        this.tenant.organizationId,
      )
    ).map((r) => ({ enrollmentId: r.enrollmentId, open: Number(r.open) }));

    return {
      academicYearId: academicYearId ?? null,
      legacyRows: legacy.length,
      mappedRows: byLegacy.size,
      unmappedRows: unmapped.length,
      unmapped: unmapped.slice(0, 100),
      differenceCount: differences.length,
      differences: differences.slice(0, 100),
      canonicalEnrollments,
      canonicalPlacements,
      openPlacements,
      duplicateOpenPlacements: duplicateOpen,
      openExceptionQueue: exceptions,
      clean: unmapped.length === 0 && differences.length === 0 && duplicateOpen.length === 0,
    };
  }

  async listExceptions(opts: { migrationRunId?: string; resolved?: boolean } = {}) {
    return this.prisma.client.academicMigrationException.findMany({
      where: {
        ...(opts.migrationRunId ? { migrationRunId: opts.migrationRunId } : {}),
        ...(opts.resolved === undefined ? {} : opts.resolved ? { resolvedAt: { not: null } } : { resolvedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async resolveException(id: string, dto: ResolveExceptionDto) {
    const row = await this.prisma.client.academicMigrationException.findFirst({ where: { id } });
    if (!row) throw new NotFoundException(`Migration exception ${id} not found`);
    await this.prisma.client.academicMigrationException.updateMany({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedById: this.tenant.userId ?? null,
        resolutionNote: dto.resolutionNote,
      },
    });
    await this.audit.record({
      entity: 'AcademicMigrationException',
      entityId: id,
      action: 'update',
      oldValues: { resolvedAt: null },
      newValues: { resolutionNote: dto.resolutionNote },
    });
    return this.prisma.client.academicMigrationException.findFirst({ where: { id } });
  }

  /**
   * Remove ONLY the rows a given run wrote. This is step 4 of the Phase 0.5
   * rollback plan — the pre-cutover escape hatch. It refuses once a run's rows
   * have been edited by a real user, because at that point the rollback would
   * destroy academic facts rather than migration artefacts.
   */
  async rollback(migrationRunId: string) {
    const placements = await this.prisma.client.enrollmentPlacement.findMany({
      where: { migrationRunId },
      select: { id: true, enrollmentId: true },
    });
    const enrollmentIds = [...new Set(placements.map((p: any) => p.enrollmentId))];

    const touched = await this.prisma.client.enrollmentPlacement.count({
      where: { enrollmentId: { in: enrollmentIds }, migrationRunId: null },
    });
    if (touched > 0) {
      throw new BadRequestException(
        `Refusing to roll back run ${migrationRunId}: ${touched} placement(s) on these enrollments were written outside the migration. ` +
          'Restore from the pre-migration backup instead of deleting real movements.',
      );
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const deletedPlacements = await tx.enrollmentPlacement.deleteMany({ where: { migrationRunId } });
      const deletedEvents = await tx.studentEnrollmentEvent.deleteMany({
        where: { enrollmentId: { in: enrollmentIds } },
      });
      const deletedEnrollments = await tx.studentEnrollment.deleteMany({ where: { migrationRunId } });
      await this.audit.recordInTx(tx, {
        entity: 'StudentEnrollment',
        entityId: migrationRunId,
        action: 'delete',
        oldValues: {
          placements: deletedPlacements.count,
          enrollments: deletedEnrollments.count,
          events: deletedEvents.count,
        },
      });
      return {
        migrationRunId,
        deletedPlacements: deletedPlacements.count,
        deletedEnrollments: deletedEnrollments.count,
        deletedEvents: deletedEvents.count,
      };
    });
  }
}
