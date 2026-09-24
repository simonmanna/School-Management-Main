import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AcademicYear, Term } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS, PERMISSIONS } from '@erp/shared';
import { assertYearWritable } from './academic-year-guard';
import type {
  CreateAcademicYearDto,
  CreateTermDto,
  SetAcademicYearStatusDto,
  SetCurrentYearDto,
  SetCurrentTermDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './dto.types';

type YearStatus = 'PLANNING' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

/**
 * Academic-year lifecycle (brief para 3).
 *
 * `isCurrent` says which year the school is working in today. It cannot say
 * whether last year is finished or next year is still being planned, which is
 * why status exists alongside it rather than instead of it.
 *
 * The only backward edge is CLOSED to ACTIVE. Re-opening a closed year is a
 * real need (a correction found after results were published) but it makes
 * historical records writable again, so it is gated on the academic-migration
 * grant and demands a reason. ARCHIVED is deliberately terminal.
 */
const YEAR_TRANSITIONS: Readonly<Record<YearStatus, readonly YearStatus[]>> = Object.freeze({
  PLANNING: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['CLOSED'],
  CLOSED: ['ARCHIVED', 'ACTIVE'],
  ARCHIVED: [],
});

/** Parse a date-only or ISO string, refusing garbage instead of storing Invalid Date. */
function parseDate(value: string | undefined, label: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} "${value}" is not a valid date.`);
  return d;
}

function assertOrdered(start: Date | undefined, end: Date | undefined, what: string) {
  if (start && end && end <= start) {
    throw new BadRequestException(`${what} must end after it starts.`);
  }
}

/** Lock a year row for a lifecycle change; serializes with assertYearWritable's FOR SHARE. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lockYear(tx: any, organizationId: string, id: string) {
  await tx.$queryRaw`SELECT 1 FROM "AcademicYear" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
}

@Injectable()
export class AcademicYearService extends BaseCrudService<AcademicYear, CreateAcademicYearDto, UpdateAcademicYearDto> {
  protected readonly entityName = 'AcademicYear';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { terms: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.academicYear as unknown as CrudDelegate);
  }

  async create(dto: CreateAcademicYearDto): Promise<AcademicYear> {
    return this.prisma.client.$transaction(async (tx: any) => {
      // JSON bodies arrive as date-only strings; Prisma's DateTime filter rejects
      // them, so coerce to Date before any query or write.
      const startDate = parseDate(dto.startDate, 'Start date');
      const endDate = parseDate(dto.endDate, 'End date');
      assertOrdered(startDate, endDate, 'An academic year');
      // Guard: no two academic years may overlap in time (same org).
      const clash = await tx.academicYear.findFirst({
        where: {
          organizationId: this.tenant.organizationId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });
      if (clash) {
        throw new BadRequestException(
          `Academic year dates overlap with "${clash.name}" (${clash.startDate.toISOString().slice(0, 10)} – ${clash.endDate.toISOString().slice(0, 10)}).`,
        );
      }
      // At most one year can be current — if this is current, unset the others.
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      // A year created as the current one is being worked in, so it is ACTIVE.
      const row = await tx.academicYear.create({
        data: { ...dto, startDate, endDate, ...(dto.isCurrent ? { status: 'ACTIVE' } : {}) } as any,
      });
      await this.audit.recordInTx(tx, { entity: 'AcademicYear', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }

  /**
   * The year the school is working in: the one flagged current, else the ACTIVE
   * year whose dates contain today. Never "the first year in the list" — that
   * returned a PLANNING year as current (E2E audit P2).
   */
  async current(): Promise<AcademicYear | null> {
    const flagged = await this.prisma.client.academicYear.findFirst({
      where: { isCurrent: true, deletedAt: null },
      include: { terms: true },
    });
    if (flagged) return flagged;
    const today = new Date();
    return this.prisma.client.academicYear.findFirst({
      where: { status: 'ACTIVE', deletedAt: null, startDate: { lte: today }, endDate: { gte: today } },
      include: { terms: true },
    });
  }

  async setCurrent({ academicYearId }: SetCurrentYearDto): Promise<AcademicYear> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await lockYear(tx, this.tenant.organizationId, academicYearId);
      const target = await tx.academicYear.findFirst({ where: { id: academicYearId } });
      if (!target) throw new NotFoundException(`AcademicYear ${academicYearId} not found`);
      // Making a year current must not become a back door around the lifecycle:
      // a CLOSED year re-opens only through setStatus (permission + reason), and
      // an ARCHIVED one never does.
      if (target.status === 'CLOSED' || target.status === 'ARCHIVED') {
        throw new BadRequestException(
          `"${target.name}" is ${target.status}. ` +
            (target.status === 'CLOSED'
              ? 'Re-open it (PATCH /status to ACTIVE, with a reason) before making it current.'
              : 'An archived year cannot become current again.'),
        );
      }
      // Re-selecting the year that is ALREADY current changes nothing. It used to
      // fall through and clear the current term, so saving any edit to the
      // current year (the form re-sends isCurrent) silently left the school
      // with no current term (E2E audit Y1).
      if (target.isCurrent && target.status === 'ACTIVE') {
        return tx.academicYear.findFirst({ where: { id: academicYearId }, include: { terms: true } });
      }
      await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      // Making a year current also makes it ACTIVE: a year the school is
      // working in is not still being planned, and it is certainly not closed.
      // Without this the two fields drift apart and every screen has to decide
      // which one it believes.
      const res = await tx.academicYear.updateMany({
        where: { id: academicYearId },
        data: { isCurrent: true, status: 'ACTIVE', closedAt: null, closedById: null },
      });
      if (res.count === 0) throw new NotFoundException(`AcademicYear ${academicYearId} not found`);
      // The current year really changed: a term of the old year cannot stay
      // current, so the operator re-picks one for the new year.
      await tx.term.updateMany({ where: { isCurrent: true, academicYearId: { not: academicYearId } }, data: { isCurrent: false } });
      const row = await tx.academicYear.findFirst({ where: { id: academicYearId }, include: { terms: true } });
      await this.audit.recordInTx(tx, {
        entity: 'AcademicYear',
        entityId: academicYearId,
        action: 'update',
        oldValues: { status: target.status, isCurrent: target.isCurrent },
        newValues: { status: 'ACTIVE', isCurrent: true },
      });
      this.events.publish(EVENTS.SchoolAcademicYearSetCurrent, {
        organizationId: this.tenant.organizationId,
        academicYearId,
      });
      return row;
    });
  }

  async update(id: string, dto: UpdateAcademicYearDto): Promise<AcademicYear> {
    if (dto.isCurrent) {
      // `isCurrent` has one entry point, the one with the lifecycle rules.
      await this.setCurrent({ academicYearId: id });
      const { isCurrent: _current, ...rest } = dto;
      if (Object.keys(rest).length === 0) return this.findOne(id);
      dto = rest;
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      await lockYear(tx, this.tenant.organizationId, id);
      const before = await tx.academicYear.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`AcademicYear ${id} not found`);
      const startDate = parseDate(dto.startDate, 'Start date');
      const endDate = parseDate(dto.endDate, 'End date');
      if ((startDate || endDate) && (before.status === 'CLOSED' || before.status === 'ARCHIVED')) {
        throw new BadRequestException(`"${before.name}" is ${before.status}; its dates are part of the historical record.`);
      }
      const nextStart = startDate ?? before.startDate;
      const nextEnd = endDate ?? before.endDate;
      assertOrdered(nextStart, nextEnd, 'An academic year');
      if (startDate || endDate) {
        const clash = await tx.academicYear.findFirst({
          where: { id: { not: id }, startDate: { lte: nextEnd }, endDate: { gte: nextStart } },
        });
        if (clash) throw new BadRequestException(`Academic year dates overlap with "${clash.name}".`);
        const outside = await tx.term.findFirst({
          where: { academicYearId: id, OR: [{ startDate: { lt: nextStart } }, { endDate: { gt: nextEnd } }] },
          select: { name: true },
        });
        if (outside) {
          throw new BadRequestException(`Term "${outside.name}" would fall outside the new year dates. Adjust the term first.`);
        }
      }
      const res = await tx.academicYear.updateMany({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(dto.isCurrent === false ? { isCurrent: false } : {}),
          updatedBy: this.tenant.userId ?? null,
        },
      });
      if (res.count === 0) throw new NotFoundException(`AcademicYear ${id} not found`);
      const row = await tx.academicYear.findFirst({ where: { id }, include: { terms: true } });
      await this.audit.recordInTx(tx, { entity: 'AcademicYear', entityId: id, action: 'update', oldValues: before, newValues: row });
      return row;
    });
  }
  /**
   * Move a year through its lifecycle.
   *
   * Closing a year does NOT touch its enrollments or placements. Closure means
   * "no new writes", not "this never happened" — every past class list, report
   * card and fee statement stays exactly as queryable as it was.
   */
  async setStatus(id: string, dto: SetAcademicYearStatusDto): Promise<AcademicYear> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.client.$transaction(async (tx: any) => {
      // Serializes with every in-flight write holding the year FOR SHARE, so a
      // year cannot close underneath an enrollment that is being created.
      await lockYear(tx, this.tenant.organizationId, id);
      const before = await tx.academicYear.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`AcademicYear ${id} not found`);

      const from = (before.status ?? 'PLANNING') as YearStatus;
      const to = dto.status;
      if (from === to) return before;

      if (!YEAR_TRANSITIONS[from].includes(to)) {
        const allowed = YEAR_TRANSITIONS[from];
        throw new BadRequestException(
          `An academic year cannot go from ${from} to ${to}. ` +
            (allowed.length
              ? `From ${from} it may only become ${allowed.join(' or ')}.`
              : `${from} is the end of the lifecycle.`),
        );
      }

      if (from === 'CLOSED' && to === 'ACTIVE') {
        const held = this.tenant.permissions ?? [];
        if (!held.includes(PERMISSIONS.school.runAcademicMigration) && !held.includes('*')) {
          throw new ForbiddenException(
            'Re-opening a closed academic year makes historical records writable again. ' +
              `It requires the ${PERMISSIONS.school.runAcademicMigration} permission.`,
          );
        }
        if (!dto.reason?.trim()) {
          throw new BadRequestException('Re-opening a closed academic year requires a reason.');
        }
      }

      // A closed or archived year cannot also be the current one — nor can any
      // of its terms. Closing used to leave its term flagged current, so every
      // "this term" screen kept writing into a closed year's term (Y1).
      const clearsCurrent = to === 'CLOSED' || to === 'ARCHIVED';
      if (clearsCurrent) {
        await tx.term.updateMany({ where: { academicYearId: id, isCurrent: true }, data: { isCurrent: false } });
      }
      await tx.academicYear.updateMany({
        where: { id },
        data: {
          status: to,
          ...(clearsCurrent ? { isCurrent: false } : {}),
          ...(to === 'CLOSED'
            ? { closedAt: new Date(), closedById: this.tenant.userId ?? null }
            : {}),
          ...(to === 'ACTIVE' ? { closedAt: null, closedById: null } : {}),
        },
      });

      const after = await tx.academicYear.findFirst({ where: { id }, include: { terms: true } });
      await this.audit.recordInTx(tx, {
        entity: 'AcademicYear',
        entityId: id,
        action: 'update',
        oldValues: { status: from, isCurrent: before.isCurrent },
        newValues: { status: to, isCurrent: after?.isCurrent, reason: dto.reason ?? null },
      });
      return after;
    });
  }

  /**
   * Deleting a year that carries academic history would take the history with
   * it. Only a year still being PLANNED, with nothing hanging off it, can go.
   */
  async remove(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.academicYear.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`AcademicYear ${id} not found`);

      const [cohorts, enrollments, terms] = await Promise.all([
        tx.classCohort.count({ where: { academicYearId: id } }),
        tx.studentEnrollment.count({ where: { academicYearId: id } }),
        tx.term.count({ where: { academicYearId: id, deletedAt: null } }),
      ]);
      const blockers = [
        cohorts ? `${cohorts} class cohort(s)` : null,
        enrollments ? `${enrollments} enrollment(s)` : null,
        terms ? `${terms} term(s)` : null,
      ].filter(Boolean);

      if (blockers.length > 0 || (before.status ?? 'PLANNING') !== 'PLANNING') {
        throw new ConflictException(
          `"${before.name}" cannot be deleted` +
            (blockers.length ? ` because it still has ${blockers.join(', ')}` : '') +
            '. Academic years are the spine of every historical report, so close or ' +
            'archive the year instead of deleting it.',
        );
      }

      await tx.academicYear.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, {
        entity: 'AcademicYear',
        entityId: id,
        action: 'delete',
        oldValues: before,
      });
    });
  }
}

@Injectable()
export class TermService extends BaseCrudService<Term, CreateTermDto, UpdateTermDto> {
  protected readonly entityName = 'Term';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { academicYear: true };

  // Terms were the one calendar object whose edits left no audit trail —
  // re-dating a term moves fee periods and attendance windows (E2E audit P3).
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.term as unknown as CrudDelegate);
  }

  /**
   * Validate a term's dates against its year and its siblings: inside the year,
   * start before end, and no overlap with another term of the same year.
   */
  private async validateTermDates(
    tx: any,
    academicYearId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ) {
    assertOrdered(startDate, endDate, 'A term');
    const year = await tx.academicYear.findFirst({ where: { id: academicYearId } });
    if (!year) throw new NotFoundException(`Academic year ${academicYearId} not found`);
    if (startDate < year.startDate || endDate > year.endDate) {
      throw new BadRequestException(
        `A term must fall inside its academic year "${year.name}" ` +
          `(${year.startDate.toISOString().slice(0, 10)} – ${year.endDate.toISOString().slice(0, 10)}).`,
      );
    }
    const clash = await tx.term.findFirst({
      where: {
        academicYearId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (clash) {
      throw new BadRequestException(
        `Term dates overlap with "${clash.name}" (${clash.startDate.toISOString().slice(0, 10)} – ${clash.endDate.toISOString().slice(0, 10)}).`,
      );
    }
  }

  async create(dto: CreateTermDto): Promise<Term> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await assertYearWritable(tx, this.tenant.organizationId, dto.academicYearId, 'create');
      const startDate = parseDate(dto.startDate, 'Start date')!;
      const endDate = parseDate(dto.endDate, 'End date')!;
      await this.validateTermDates(tx, dto.academicYearId, startDate, endDate);
      if (dto.isCurrent) {
        await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      const row = await tx.term.create({ data: { ...dto, startDate, endDate } as any });
      await this.audit.recordInTx(tx, { entity: 'Term', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }

  async setCurrent({ termId }: SetCurrentTermDto): Promise<Term> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const term = await tx.term.findFirst({ where: { id: termId } });
      if (!term) throw new NotFoundException(`Term ${termId} not found`);
      // The parent year becomes current too, so it must be a year that may be
      // worked in: never a CLOSED or ARCHIVED one (that is a re-open, which has
      // its own permission and reason).
      const year = await assertYearWritable(tx, this.tenant.organizationId, term.academicYearId, 'modify');
      await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      await tx.academicYear.updateMany({
        where: { id: term.academicYearId },
        data: { isCurrent: true, ...(year.status === 'PLANNING' ? { status: 'ACTIVE' } : {}) },
      });
      await tx.academicYear.updateMany({
        where: { id: { not: term.academicYearId }, isCurrent: true },
        data: { isCurrent: false },
      });
      const res = await tx.term.updateMany({ where: { id: termId }, data: { isCurrent: true } });
      if (res.count === 0) throw new NotFoundException(`Term ${termId} not found`);
      const row = await tx.term.findFirst({ where: { id: termId }, include: { academicYear: true } });
      await this.audit.recordInTx(tx, {
        entity: 'Term',
        entityId: termId,
        action: 'update',
        oldValues: { isCurrent: term.isCurrent },
        newValues: { isCurrent: true },
      });
      this.events.publish(EVENTS.SchoolTermSetCurrent, {
        organizationId: this.tenant.organizationId,
        termId,
      });
      return row;
    });
  }

  /** Returns the currently active term (isCurrent=true) for the org, or null. */
  async getCurrent(): Promise<Term | null> {
    return this.prisma.client.term.findFirst({ where: { isCurrent: true } });
  }

  async byAcademicYear(academicYearId: string): Promise<Term[]> {
    return this.prisma.client.term.findMany({
      where: { academicYearId },
      orderBy: { startDate: 'asc' },
    });
  }

  async update(id: string, dto: UpdateTermDto): Promise<Term> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.term.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Term ${id} not found`);
      await assertYearWritable(tx, this.tenant.organizationId, before.academicYearId, 'modify');

      const targetYearId = dto.academicYearId ?? before.academicYearId;
      if (targetYearId !== before.academicYearId) {
        // Placements, fees and results hang off a term through its year. Moving
        // the term would silently re-date every one of them.
        const used = await tx.enrollmentPlacement.count({ where: { termId: id } });
        if (used > 0) {
          throw new BadRequestException(
            `Term "${before.name}" already has ${used} placement(s); it cannot be moved to another academic year.`,
          );
        }
        await assertYearWritable(tx, this.tenant.organizationId, targetYearId, 'create');
      }

      const startDate = parseDate(dto.startDate, 'Start date') ?? before.startDate;
      const endDate = parseDate(dto.endDate, 'End date') ?? before.endDate;
      if (dto.startDate || dto.endDate || targetYearId !== before.academicYearId) {
        await this.validateTermDates(tx, targetYearId, startDate, endDate, id);
      }
      if (dto.isCurrent) {
        await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      const res = await tx.term.updateMany({
        where: { id },
        data: { ...dto, startDate, endDate } as any,
      });
      if (res.count === 0) throw new NotFoundException(`Term ${id} not found`);
      const row = await tx.term.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, { entity: 'Term', entityId: id, action: 'update', oldValues: before, newValues: row });
      return tx.term.findFirst({ where: { id }, include: { academicYear: true } });
    });
  }

  /** A term that carries history (placements, assignments, fees) is not deletable. */
  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.term.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Term ${id} not found`);
      await assertYearWritable(tx, this.tenant.organizationId, before.academicYearId, 'modify');
      const [placements, fees, assignments] = await Promise.all([
        tx.enrollmentPlacement.count({ where: { termId: id } }),
        tx.studentFeeAssignment.count({ where: { termId: id } }),
        tx.teacherAssignment.count({ where: { termId: id } }),
      ]);
      const blockers = [
        placements ? `${placements} placement(s)` : null,
        fees ? `${fees} fee assignment(s)` : null,
        assignments ? `${assignments} teacher assignment(s)` : null,
      ].filter(Boolean);
      if (blockers.length > 0) {
        throw new ConflictException(`Term "${before.name}" cannot be deleted because it has ${blockers.join(', ')}.`);
      }
      await tx.term.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'Term', entityId: id, action: 'delete', oldValues: before });
    });
  }
}