import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Discount,
  FeeCategory,
  FeeSchedule,
  FeeStructure,
  InstallmentPlan,
  PenaltyRule,
  PenaltyRun,
  Scholarship,
  StudentFeeAssignment,
} from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  BulkStudentOptionalFeeDto,
  CreateDiscountDto,
  CreateFeeCategoryDto,
  CreateFeeScheduleDto,
  CreateFeeStructureDto,
  CreateInstallmentPlanDto,
  CreatePenaltyRuleDto,
  CreateScholarshipDto,
  CreateStudentFeeAssignmentDto,
  UpdateDiscountDto,
  UpdateFeeCategoryDto,
  UpdateFeeScheduleDto,
  UpdateFeeStructureDto,
  UpdateInstallmentPlanDto,
  UpdatePenaltyRuleDto,
  UpdateScholarshipDto,
  UpdateStudentFeeAssignmentDto,
} from './dto.types';
import type { FeeComponent } from './dto.types';

@Injectable()
export class FeeStructureService extends BaseCrudService<FeeStructure, CreateFeeStructureDto, UpdateFeeStructureDto> {
  protected readonly entityName = 'FeeStructure';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { academicYear: true, schedules: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.feeStructure as unknown as CrudDelegate);
  }

  /**
   * Resolve every component against the Fee Categories catalog and stamp the
   * denormalised fields the billing engine reads: `feeCategoryId`, the display
   * `name`, and `isOptional` (derived from the category's `type`).
   *
   * Denormalising `isOptional` here rather than joining at billing time is
   * deliberate: a structure is a *priced agreement*, so flipping a category
   * from mandatory to optional next year must not silently un-bill students
   * on last year's published structure. Re-saving the structure is the
   * explicit act that adopts the new classification.
   */
  private async normalizeComponents(components: FeeComponent[] = []): Promise<FeeComponent[]> {
    const organizationId = this.tenant.organizationId;
    const categories = await this.prisma.client.feeCategory.findMany({ where: { organizationId } });
    const byId = new Map(categories.map((c) => [c.id, c]));
    const byCode = new Map(categories.map((c) => [c.code.toUpperCase(), c]));

    return components
      .filter((c) => c && (c.code || c.feeCategoryId))
      .map((c) => {
        const cat = (c.feeCategoryId ? byId.get(c.feeCategoryId) : undefined) ?? byCode.get((c.code ?? '').toUpperCase());
        return {
          code: (cat?.code ?? c.code ?? '').toUpperCase(),
          name: c.name?.trim() || cat?.name || c.code,
          feeCategoryId: cat?.id ?? c.feeCategoryId,
          productId: c.productId || undefined,
          amount: Number(c.amount) || 0,
          // An explicit isOptional on the payload wins (lets a structure bill a
          // mandatory category optionally); otherwise inherit the category.
          isOptional: c.isOptional ?? (cat ? cat.type === 'optional' : false),
        } satisfies FeeComponent;
      });
  }

  async create(dto: CreateFeeStructureDto): Promise<FeeStructure> {
    const components = await this.normalizeComponents(dto.components);
    if (components.length === 0) {
      throw new BadRequestException('A fee structure needs at least one component');
    }
    const organizationId = this.tenant.organizationId;

    // The (org, name, academicYearId) unique index has no deletedAt column, so a
    // soft-deleted structure permanently squats on its name. Revive it instead
    // of 409-ing the bursar out of a name they just deleted.
    const buried = await this.prisma.client.feeStructure.findFirst({
      where: { organizationId, name: dto.name, academicYearId: dto.academicYearId, deletedAt: { not: null } },
    });

    return this.prisma.client.$transaction(async (tx: any) => {
      const data = {
        name: dto.name,
        academicYearId: dto.academicYearId,
        components: components as any,
        applicableTo: (dto.applicableTo as any) ?? {},
        isActive: dto.isActive ?? true,
      };
      let row;
      if (buried) {
        await tx.feeStructure.updateMany({ where: { id: buried.id }, data: { ...data, deletedAt: null } });
        row = await tx.feeStructure.findFirst({ where: { id: buried.id } });
      } else {
        try {
          row = await tx.feeStructure.create({ data: { organizationId, ...data } });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            throw new ConflictException(`A fee structure named "${dto.name}" already exists for that academic year`);
          }
          throw err;
        }
      }
      await this.audit.recordInTx(tx, { entity: 'FeeStructure', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }

  async update(id: string, dto: UpdateFeeStructureDto): Promise<FeeStructure> {
    const data: Record<string, unknown> = { ...dto };
    if (dto.components) {
      const components = await this.normalizeComponents(dto.components);
      if (components.length === 0) throw new BadRequestException('A fee structure needs at least one component');
      data.components = components;
    }
    return super.update(id, data as UpdateFeeStructureDto);
  }

  /**
   * Deleting a structure that a term still bills from would leave the billing
   * run with no schedule and no explanation, so refuse and name the terms.
   */
  async remove(id: string): Promise<void> {
    const organizationId = this.tenant.organizationId;
    const schedules = await this.prisma.client.feeSchedule.findMany({
      where: { organizationId, feeStructureId: id },
      include: { term: true },
    });
    if (schedules.length > 0) {
      const terms = schedules.map((s: any) => s.term?.name ?? s.termId).join(', ');
      throw new ConflictException(
        `This fee structure is scheduled to ${schedules.length} term(s) (${terms}). Remove those schedules first.`,
      );
    }
    return super.remove(id);
  }

  /**
   * B5: publish a fee structure — freeze its current components JSON as an
   * immutable FeeStructureVersion with priced FeeItems, and stamp it current.
   * Editing a published structure later creates version N+1 (provenance +
   * reproducibility). DocumentLine already protects historical invoices, so a
   * version exists for traceability, not to guard old money.
   */
  async publish(id: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const structure = await tx.feeStructure.findFirst({ where: { id, organizationId } });
      if (!structure) throw new NotFoundException(`FeeStructure ${id} not found`);
      const last = await tx.feeStructureVersion.findFirst({
        where: { organizationId, feeStructureId: id },
        orderBy: { versionNo: 'desc' },
      });
      const versionNo = (last?.versionNo ?? 0) + 1;
      const version = await tx.feeStructureVersion.create({
        data: {
          organizationId,
          feeStructureId: id,
          versionNo,
          isImmutable: true,
          publishedAt: new Date(),
          publishedById: this.tenant.userId ?? null,
        },
      });
      const components = (structure.components as any[]) ?? [];
      for (const c of components) {
        await tx.feeItem.create({
          data: {
            organizationId,
            feeStructureVersionId: version.id,
            code: c.code ?? 'FEE',
            name: c.name ?? c.code ?? 'Fee',
            productId: c.productId ?? null,
            amount: c.amount ?? 0,
            isOptional: c.isOptional ?? false,
            frequency: c.frequency ?? 'per_term',
            appliesTo: c.appliesTo ?? {},
          },
        });
      }
      await tx.feeStructure.update({
        where: { id },
        data: { status: 'published', currentVersionId: version.id },
      });
      await this.audit.recordInTx(tx, { entity: 'FeeStructureVersion', entityId: version.id, action: 'create', newValues: { versionNo } });
      return version;
    });
  }

  async listVersions(id: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.feeStructureVersion.findMany({
      where: { organizationId, feeStructureId: id },
      include: { items: true },
      orderBy: { versionNo: 'desc' },
    });
  }
}

@Injectable()
export class FeeScheduleService extends BaseCrudService<FeeSchedule, CreateFeeScheduleDto, UpdateFeeScheduleDto> {
  protected readonly entityName = 'FeeSchedule';
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude = { term: true, feeStructure: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.feeSchedule as unknown as CrudDelegate);
  }

  /**
   * Prisma 6 no longer coerces a date-only string ("YYYY-MM-DD") into a
   * DateTime, so a `dueDate` coming from an `<input type="date">` (which sends
   * exactly that shape) would throw PrismaClientValidationError → HTTP 500.
   * Normalize any date-only value to a full ISO-8601 timestamp before create.
   */
  async create(data: CreateFeeScheduleDto): Promise<FeeSchedule> {
    const coerced = { ...data };
    if (typeof coerced.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(coerced.dueDate)) {
      coerced.dueDate = `${coerced.dueDate}T00:00:00.000Z` as unknown as CreateFeeScheduleDto['dueDate'];
    }
    if (coerced.lateFeePolicy && typeof coerced.lateFeePolicy === 'object') {
      const p = coerced.lateFeePolicy as unknown as Record<string, unknown>;
      if (typeof p.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.from)) p.from = `${p.from}T00:00:00.000Z`;
      if (typeof p.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.to)) p.to = `${p.to}T00:00:00.000Z`;
    }
    return super.create(coerced as CreateFeeScheduleDto);
  }

  async update(id: string, data: UpdateFeeScheduleDto): Promise<FeeSchedule> {
    const coerced = { ...(data as Record<string, unknown>) };
    if (typeof coerced.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(coerced.dueDate)) {
      coerced.dueDate = `${coerced.dueDate}T00:00:00.000Z`;
    }
    return super.update(id, coerced as UpdateFeeScheduleDto);
  }

  async forTerm(termId: string) {
    return this.prisma.client.feeSchedule.findMany({
      where: { termId },
      include: { feeStructure: true },
    });
  }
}

@Injectable()
export class StudentFeeAssignmentService extends BaseCrudService<StudentFeeAssignment, CreateStudentFeeAssignmentDto, UpdateStudentFeeAssignmentDto> {
  protected readonly entityName = 'StudentFeeAssignment';
  protected readonly searchFields: string[] = [];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.studentFeeAssignment as unknown as CrudDelegate);
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.studentFeeAssignment.findMany({
      where: { studentProfileId },
      include: { feeStructure: true, term: true },
    });
  }
}

@Injectable()
export class DiscountService extends BaseCrudService<Discount, CreateDiscountDto, UpdateDiscountDto> {
  protected readonly entityName = 'Discount';
  protected readonly searchFields = ['code', 'name'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.discount as unknown as CrudDelegate);
  }
}

@Injectable()
export class ScholarshipService extends BaseCrudService<Scholarship, CreateScholarshipDto, UpdateScholarshipDto> {
  protected readonly entityName = 'Scholarship';
  protected readonly searchFields = ['code', 'name'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.scholarship as unknown as CrudDelegate);
  }

  async activeForStudent(studentProfileId: string, asOf: Date = new Date()): Promise<Scholarship[]> {
    return this.prisma.client.scholarship.findMany({
      where: {
        studentProfileId,
        isActive: true,
        validFrom: { lte: asOf },
        OR: [{ validTo: null }, { validTo: { gte: asOf } }],
      },
    });
  }
}

@Injectable()
export class InstallmentPlanService extends BaseCrudService<InstallmentPlan, CreateInstallmentPlanDto, UpdateInstallmentPlanDto> {
  protected readonly entityName = 'InstallmentPlan';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.installmentPlan as unknown as CrudDelegate);
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.installmentPlan.findMany({
      where: { studentProfileId },
      include: { term: true },
    });
  }
}

@Injectable()
export class PenaltyRuleService extends BaseCrudService<PenaltyRule, CreatePenaltyRuleDto, UpdatePenaltyRuleDto> {
  protected readonly entityName = 'PenaltyRule';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.penaltyRule as unknown as CrudDelegate);
  }
}

@Injectable()
export class PenaltyRunService {
  protected readonly entityName = 'PenaltyRun';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  async list() {
    return this.prisma.client.penaltyRun.findMany({
      orderBy: { runAt: 'desc' },
      take: 50,
    });
  }

  async get(id: string) {
    const r = await this.prisma.client.penaltyRun.findFirst({ where: { id } });
    if (!r) throw new NotFoundException(`PenaltyRun ${id} not found`);
    return r;
  }

  async bySchedule(scheduleId: string) {
    return this.prisma.client.penaltyRun.findMany({
      where: { scheduleId },
      orderBy: { runAt: 'desc' },
    });
  }
}

/**
 * P2 — Fee Categories catalog. A standalone, reusable master of fee types that
 * FeeStructures reference by `code`. Soft-delete + org-scoped via the tenancy
 * extension (FeeCategory is registered in SOFT_DELETE + ORG_SCOPED there).
 */
@Injectable()
export class FeeCategoryService extends BaseCrudService<FeeCategory, CreateFeeCategoryDto, UpdateFeeCategoryDto> {
  protected readonly entityName = 'FeeCategory';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultOrderBy = [{ paymentOrder: 'asc' }, { name: 'asc' }] as Array<Record<string, 'asc' | 'desc'>>;
  protected readonly defaultInclude = undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.feeCategory as unknown as CrudDelegate);
  }

  /**
   * `@@unique([organizationId, code])` does not include `deletedAt`, so a
   * soft-deleted category keeps its code reserved forever — the bursar deletes
   * "SWIMMING", re-adds it, and gets a permanent 409 with no way out from the
   * UI. Revive the buried row instead, which also keeps any structures that
   * still reference the code pointing at something real.
   */
  async create(dto: CreateFeeCategoryDto): Promise<FeeCategory> {
    const organizationId = this.tenant.organizationId;
    const code = dto.code.trim().toUpperCase();
    const buried = await this.prisma.client.feeCategory.findFirst({
      where: { organizationId, code, deletedAt: { not: null } },
    });
    if (buried) {
      await this.prisma.client.feeCategory.updateMany({
        where: { id: buried.id, deletedAt: { not: null } },
        data: { ...dto, code, deletedAt: null },
      });
      return this.findOne(buried.id);
    }
    return super.create({ ...dto, code });
  }

  async update(id: string, dto: UpdateFeeCategoryDto): Promise<FeeCategory> {
    const data = { ...dto };
    if (data.code) data.code = data.code.trim().toUpperCase();

    // Renaming a code silently orphans every structure component that joins on
    // it, so carry the rename through to the structures too.
    if (data.code) {
      const current = await this.findOne(id);
      if (current.code !== data.code) await this.renameCodeInStructures(current.code, data.code);
    }
    return super.update(id, data);
  }

  private async renameCodeInStructures(from: string, to: string): Promise<void> {
    const organizationId = this.tenant.organizationId;
    const structures = await this.prisma.client.feeStructure.findMany({ where: { organizationId } });
    for (const st of structures) {
      const comps = (st.components as unknown as FeeComponent[]) ?? [];
      if (!comps.some((c) => c.code === from)) continue;
      await this.prisma.client.feeStructure.updateMany({
        where: { id: st.id },
        data: { components: comps.map((c) => (c.code === from ? { ...c, code: to } : c)) as any },
      });
    }
  }

  /**
   * Refuse to delete a category any structure still prices, or any student is
   * still opted into — otherwise invoice lines survive carrying a code that no
   * longer resolves to anything.
   */
  async remove(id: string): Promise<void> {
    const organizationId = this.tenant.organizationId;
    const cat = await this.findOne(id);
    const structures = await this.prisma.client.feeStructure.findMany({ where: { organizationId } });
    const used = structures.filter((st: any) => {
      const comps = (st.components as unknown as FeeComponent[]) ?? [];
      return comps.some((c) => c.feeCategoryId === id || c.code === cat.code);
    });
    if (used.length > 0) {
      throw new ConflictException(
        `"${cat.name}" is used by ${used.length} fee structure(s): ${used.map((s: any) => s.name).join(', ')}. Remove it there first.`,
      );
    }
    const optIns = await this.prisma.client.studentOptionalFee.count({ where: { organizationId, feeCategoryId: id } });
    if (optIns > 0) {
      throw new ConflictException(`"${cat.name}" still has ${optIns} student opt-in(s). Clear those first.`);
    }
    return super.remove(id);
  }
}

/**
 * P3 — the Optional Fees roster. Backs the "set or update <Category> amounts
 * for <Year> <Term>" screen: one term + one optional category, a class-filtered
 * list of students, and an amount per student.
 *
 * Presence of a row is the opt-in. `amount` null means "charge whatever the fee
 * structure's component says"; a number overrides it for that one student.
 */
@Injectable()
export class StudentOptionalFeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Students eligible for one optional category in one term, each with their
   * current opt-in (or null). Returns the whole roster — not just opted-in
   * students — because the screen is an editable grid, not a report.
   */
  async roster(params: { termId: string; feeCategoryId: string; classId?: string; search?: string }) {
    const organizationId = this.tenant.organizationId;
    const { termId, feeCategoryId, classId, search } = params;
    if (!termId || !feeCategoryId) throw new BadRequestException('termId and feeCategoryId are required');

    const category = await this.prisma.client.feeCategory.findFirst({ where: { organizationId, id: feeCategoryId } });
    if (!category) throw new NotFoundException(`FeeCategory ${feeCategoryId} not found`);

    const where: any = { status: 'active' };
    if (classId) where.currentClassId = classId;
    if (search && search.trim()) {
      const q = search.trim();
      // A student's display name lives on the linked Partner, not the profile.
      where.OR = [
        { admissionNo: { contains: q, mode: 'insensitive' } },
        { partner: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [students, optIns] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        where,
        include: { partner: true, currentClass: true },
        orderBy: [{ currentClassId: 'asc' }, { admissionNo: 'asc' }],
        take: 1000,
      }),
      this.prisma.client.studentOptionalFee.findMany({ where: { organizationId, termId, feeCategoryId } }),
    ]);
    const byStudent = new Map(optIns.map((o: any) => [o.studentProfileId, o]));

    return {
      category,
      rows: students.map((s: any) => {
        const opt: any = byStudent.get(s.id);
        return {
          studentProfileId: s.id,
          admissionNo: s.admissionNo,
          name: s.partner?.name?.trim() || s.admissionNo,
          className: s.currentClass?.name ?? '—',
          classId: s.currentClassId,
          optedIn: !!opt?.isActive,
          amount: opt?.amount != null ? Number(opt.amount) : null,
          notes: opt?.notes ?? null,
        };
      }),
    };
  }

  /** Every opt-in for one student (all terms) — feeds the student fee profile. */
  async byStudent(studentProfileId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.studentOptionalFee.findMany({
      where: { organizationId, studentProfileId },
      include: { feeCategory: true, term: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Save the roster grid. A row arriving with `isActive === false` is deleted
   * rather than stored inactive, so unticking a student genuinely stops billing
   * them on the next run instead of leaving a dormant row behind.
   *
   * `upsert` is avoided on purpose: the tenancy extension injects a top-level
   * `where.organizationId`, which Prisma rejects alongside a compound-unique
   * selector. Explicit find-then-write keeps that scoping honest.
   */
  async bulkUpsert(dto: BulkStudentOptionalFeeDto) {
    const organizationId = this.tenant.organizationId;
    const { termId, feeCategoryId } = dto;

    const category = await this.prisma.client.feeCategory.findFirst({ where: { organizationId, id: feeCategoryId } });
    if (!category) throw new NotFoundException(`FeeCategory ${feeCategoryId} not found`);

    const existing = await this.prisma.client.studentOptionalFee.findMany({
      where: { organizationId, termId, feeCategoryId },
    });
    const byStudent = new Map(existing.map((e: any) => [e.studentProfileId, e]));

    let created = 0;
    let updated = 0;
    let removed = 0;
    for (const row of dto.rows ?? []) {
      const prior: any = byStudent.get(row.studentProfileId);
      const keep = row.isActive !== false;

      if (!keep) {
        if (prior) {
          await this.prisma.client.studentOptionalFee.deleteMany({ where: { id: prior.id } });
          removed++;
        }
        continue;
      }

      const amount = row.amount == null || Number.isNaN(Number(row.amount)) ? null : Number(row.amount);
      if (prior) {
        await this.prisma.client.studentOptionalFee.updateMany({
          where: { id: prior.id },
          data: { amount, isActive: true, notes: row.notes ?? null, updatedBy: this.tenant.userId ?? null },
        });
        updated++;
      } else {
        await this.prisma.client.studentOptionalFee.create({
          data: {
            organizationId,
            studentProfileId: row.studentProfileId,
            termId,
            feeCategoryId,
            amount,
            isActive: true,
            notes: row.notes ?? null,
            createdBy: this.tenant.userId ?? null,
          },
        });
        created++;
      }
    }
    return { created, updated, removed };
  }

  async remove(id: string): Promise<void> {
    const organizationId = this.tenant.organizationId;
    const res = await this.prisma.client.studentOptionalFee.deleteMany({ where: { id, organizationId } });
    if (res.count === 0) throw new NotFoundException(`StudentOptionalFee ${id} not found`);
  }
}