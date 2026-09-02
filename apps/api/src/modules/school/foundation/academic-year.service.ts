import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { AcademicYear, Term } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateAcademicYearDto,
  CreateTermDto,
  SetCurrentYearDto,
  SetCurrentTermDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './dto.types';

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
      const res = await tx.academicYear.updateMany({ where: { id: academicYearId }, data: { isCurrent: true } });
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