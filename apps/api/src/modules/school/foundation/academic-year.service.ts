import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AcademicYear, Term } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS, PERMISSIONS } from '@erp/shared';
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
      const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
      const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
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
      const row = await tx.academicYear.create({ data: { ...dto, startDate, endDate } as any });
      await this.audit.recordInTx(tx, { entity: 'AcademicYear', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }

  async setCurrent({ academicYearId }: SetCurrentYearDto): Promise<AcademicYear> {
    return this.prisma.client.$transaction(async (tx: any) => {
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
      // Also unset any "current" terms; the operator must re-pick one for the new year.
      await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const row = await tx.academicYear.findFirst({ where: { id: academicYearId }, include: { terms: true } });
      this.events.publish(EVENTS.SchoolAcademicYearSetCurrent, {
        organizationId: this.tenant.organizationId,
        academicYearId,
      });
      return row;
    });
  }

  async update(id: string, dto: UpdateAcademicYearDto): Promise<AcademicYear> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
      const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      const res = await tx.academicYear.updateMany({
        where: { id },
        data: { ...dto, startDate, endDate } as any,
      });
      if (res.count === 0) throw new NotFoundException(`AcademicYear ${id} not found`);
      const row = await tx.academicYear.findFirst({ where: { id }, include: { terms: true } });
      await this.audit.recordInTx(tx, { entity: 'AcademicYear', entityId: id, action: 'update', newValues: row });
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
        if (!this.tenant.permissions?.includes(PERMISSIONS.school.runAcademicMigration)) {
          throw new BadRequestException(
            'Re-opening a closed academic year makes historical records writable again. ' +
              `It requires the ${PERMISSIONS.school.runAcademicMigration} permission.`,
          );
        }
        if (!dto.reason?.trim()) {
          throw new BadRequestException('Re-opening a closed academic year requires a reason.');
        }
      }

      // A closed or archived year cannot also be the current one.
      const clearsCurrent = to === 'CLOSED' || to === 'ARCHIVED';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.term as unknown as CrudDelegate);
  }

  async create(dto: CreateTermDto): Promise<Term> {
    return this.prisma.client.$transaction(async (tx: any) => {
      // JSON bodies arrive as date-only strings; Prisma's DateTime filter rejects
      // them, so coerce to Date before any query or write.
      const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
      const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
      // Guard: terms within the same academic year must not overlap in time.
      const clash = await tx.term.findFirst({
        where: {
          organizationId: this.tenant.organizationId,
          academicYearId: dto.academicYearId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });
      if (clash) {
        throw new BadRequestException(
          `Term dates overlap with "${clash.name}" (${clash.startDate.toISOString().slice(0, 10)} – ${clash.endDate.toISOString().slice(0, 10)}).`,
        );
      }
      if (dto.isCurrent) {
        await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      return tx.term.create({ data: { ...dto, startDate, endDate } as any });
    });
  }

  async setCurrent({ termId }: SetCurrentTermDto): Promise<Term> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      // Mark the parent year as current too, so dashboards agree.
      const term = await tx.term.findFirst({ where: { id: termId } });
      if (!term) throw new NotFoundException(`Term ${termId} not found`);
      await tx.academicYear.updateMany({ where: { id: term.academicYearId }, data: { isCurrent: true } });
      await tx.academicYear.updateMany({
        where: { id: { not: term.academicYearId }, isCurrent: true },
        data: { isCurrent: false },
      });
      const res = await tx.term.updateMany({ where: { id: termId }, data: { isCurrent: true } });
      if (res.count === 0) throw new NotFoundException(`Term ${termId} not found`);
      const row = await tx.term.findFirst({ where: { id: termId }, include: { academicYear: true } });
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
      const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
      const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
      if (dto.isCurrent) {
        await tx.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      const res = await tx.term.updateMany({
        where: { id },
        data: { ...dto, startDate, endDate } as any,
      });
      if (res.count === 0) throw new NotFoundException(`Term ${id} not found`);
      const row = await tx.term.findFirst({ where: { id }, include: { academicYear: true } });
      return row;
    });
  }
}