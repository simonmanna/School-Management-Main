import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { StudentProfile, Partner } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS, type PaginatedResult, type PaginationQuery } from '@erp/shared';
import { POSTED_FEE_WHERE } from '../fees/fee-document.constants';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import { StudentAdmissionService } from './student-admission.service';
import type { CreateStudentDto, StudentListQueryDto, UpdateStudentDto } from './dto.types';

/**
 * P5: the student lifecycle. `active` is the working state (enrolled students).
 * `transferred` and `alumni` (graduated) are terminal. `withdrawn`/`suspended`
 * can return to `active` (re-admission / reinstatement).
 */
const STUDENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  applicant: ['active', 'withdrawn', 'archived'],
  active: ['suspended', 'transferred', 'withdrawn', 'graduated', 'deceased', 'archived'],
  suspended: ['active', 'withdrawn', 'transferred', 'deceased', 'archived'],
  withdrawn: ['active', 'transferred', 'archived'],
  transferred: ['active', 'withdrawn', 'archived'],
  graduated: ['archived'],
  deceased: ['archived'],
  archived: [],
  alumni: [],
};

/**
 * Student = Partner (the person) + StudentProfile (the school metadata).
 *
 * Per ADR-008 / ADR-011: we DO NOT add a "Student" entity. We reuse the
 * universal Partner model and tag it with customFields.house, bloodGroup, etc.
 * Status transitions (active → suspended → withdrawn → alumni) are tracked
 * in StudentStatusHistory for audit.
 */
@Injectable()
export class StudentService extends BaseCrudService<StudentProfile, CreateStudentDto, UpdateStudentDto> {
  protected readonly entityName = 'StudentProfile';
  protected readonly searchFields: string[] = ['admissionNo'];
  protected readonly defaultInclude = {
    // partner carries the student's name/email/phone (the AR account); the UI
    // roster and every dropdown needs it, so include it by default.
    partner: true,
    guardians: true,
    medicalRecord: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    // D1: the ONE canonical fee calculation. The statement must not compute a
    // balance of its own, or it will disagree with the parent portal.
    private readonly finance: SchoolFinanceQueryService,
    private readonly placements: PlacementLookupService,
    private readonly admission: StudentAdmissionService,
  ) {
    super(prisma.client.studentProfile as unknown as CrudDelegate);
  }

  /**
   * Where each learner sits now, from placement history, as read-only
   * `currentClass` / `currentSection` objects on the response. Derived on every
   * read — there is no class column on the profile to drift out of step.
   */
  private async withPlacement<T extends { id: string }>(rows: T[]) {
    const described = await this.placements.describe(rows.map((r) => r.id));
    return rows.map((r) => {
      const d = described.get(r.id);
      return {
        ...r,
        currentClass: d?.classId
          ? { id: d.classId, name: d.className, gradeLevel: d.gradeLevelId ? { id: d.gradeLevelId, name: d.gradeLevelName } : null }
          : null,
        currentSection: d?.sectionId ? { id: d.sectionId, name: d.sectionName } : null,
      };
    });
  }

  /** Paginated roster, optionally narrowed to learners placed in a class or stream now. */
  override async list(query: PaginationQuery & StudentListQueryDto): Promise<PaginatedResult<StudentProfile>> {
    const target = {
      ...(query.classId ? { classIds: [query.classId] } : {}),
      ...(query.sectionId ? { sectionIds: [query.sectionId] } : {}),
    };
    if (Object.keys(target).length === 0) {
      const page = await super.list(query);
      return { ...page, data: (await this.withPlacement(page.data)) as any };
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50));
    const where: Record<string, unknown> = { ...this.placements.studentWhere(target) };
    if (query.search) where.admissionNo = { contains: query.search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        where,
        orderBy: { admissionNo: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.defaultInclude,
      }),
      this.prisma.client.studentProfile.count({ where }),
    ]);
    return {
      data: (await this.withPlacement(rows)) as any,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  override async findOne(id: string): Promise<StudentProfile> {
    const row = await super.findOne(id);
    return (await this.withPlacement([row]))[0] as any;
  }

  /**
   * Create a learner. With a class, this is an admission: the learner is
   * enrolled for the term's academic year and seated in one transaction by
   * StudentAdmissionService. Without one they are created unplaced, to be
   * enrolled later.
   */
  async create(dto: CreateStudentDto): Promise<StudentProfile> {
    let termId = dto.termId ?? null;
    if (dto.classId && !termId) {
      const term = await this.prisma.client.term.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!term) {
        throw new BadRequestException(
          'No current term is set, so this learner cannot be placed in a class yet. Set the current term under ' +
            'School → Academic Years, choose a term, or admit them without a class and enrol them afterwards.',
        );
      }
      termId = term.id;
    }
    const { profile } = await this.admission.admit({
      organizationId: this.tenant.organizationId,
      name: dto.name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      admissionNo: dto.admissionNo,
      enrollmentDate: dto.enrollmentDate,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      nationality: dto.nationality ?? null,
      religion: dto.religion ?? null,
      residenceType: dto.residenceType ?? null,
      house: dto.house ?? null,
      partnerCustomFields: {
        ...(dto.customFields ?? {}),
        middleName: dto.middleName ?? null,
        preferredName: dto.preferredName ?? null,
        countryOfBirth: dto.countryOfBirth ?? null,
        placeOfBirth: dto.placeOfBirth ?? null,
        address: dto.address ?? null,
      },
      customFields: {
        ...(dto.customFields ?? {}),
        middleName: dto.middleName ?? null,
        preferredName: dto.preferredName ?? null,
        countryOfBirth: dto.countryOfBirth ?? null,
        placeOfBirth: dto.placeOfBirth ?? null,
        address: dto.address ?? null,
      },
      placement:
        dto.classId && termId
          ? { termId, classId: dto.classId, sectionId: dto.sectionId ?? null, rollNumber: dto.admissionNo }
          : null,
    });
    return profile;
  }

  /**
   * Update either the Partner-level fields, the StudentProfile fields, or the
   * status (which writes to StudentStatusHistory).
   */
  async update(id: string, dto: UpdateStudentDto): Promise<StudentProfile> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.studentProfile.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Student ${id} not found`);

      // Partner-side updates
      const partnerUpdates: Partial<Partner> = {};
      if (dto.name !== undefined) partnerUpdates.name = dto.name;
      if (dto.email !== undefined) partnerUpdates.email = dto.email;
      if (dto.phone !== undefined) partnerUpdates.phone = dto.phone;
      if (Object.keys(partnerUpdates).length > 0) {
        await tx.partner.updateMany({ where: { id: before.partnerId }, data: partnerUpdates });
      }

      // Status transition? P5: enforce the student lifecycle FSM. The old code
      // wrote whatever status the caller asked for; now illegal jumps (e.g.
      // reviving a transferred/alumni record) are rejected. Every legal change
      // still records StudentStatusHistory + emits the event.
      if (dto.status && dto.status !== before.status) {
        const allowed = STUDENT_STATUS_TRANSITIONS[before.status] ?? [];
        if (!allowed.includes(dto.status)) {
          throw new BadRequestException(
            `Cannot change student status '${before.status}' → '${dto.status}'. ` +
              `Allowed from '${before.status}': [${allowed.join(', ') || '(none — terminal)'}].`,
          );
        }
        await tx.studentStatusHistory.create({
          data: {
            organizationId: before.organizationId,
            studentProfileId: id,
            fromStatus: before.status,
            toStatus: dto.status,
            reason: dto.reason ?? null,
            changedById: this.tenant.userId ?? null,
          },
        });
        this.events.publish(EVENTS.SchoolStudentStatusChanged, {
          organizationId: this.tenant.organizationId,
          studentProfileId: id,
          fromStatus: before.status,
          toStatus: dto.status,
        });
      }

      // Profile-side updates. The new name/birth fields live on customFields;
      // we merge them in rather than overwrite the whole object.
      const profileUpdates: Record<string, unknown> = {};
      for (const k of [
        // Class and stream are absent by design — see UpdateStudentDto.
        // Moving a learner is a placement, through the enrollment endpoints.
        'dateOfBirth',
        'gender',
        'nationality',
        'religion',
        'residenceType',
        'house',
        'studentCategoryId',
      ] as const) {
        if (dto[k] !== undefined) profileUpdates[k] = dto[k];
      }
      if (dto.status !== undefined) profileUpdates.status = dto.status;

      // Merge the new editable profile fields into customFields.
      const newCfKeys = ['middleName', 'preferredName', 'countryOfBirth', 'placeOfBirth', 'address'] as const;
      const hasNewCf = newCfKeys.some((k) => dto[k] !== undefined);
      if (hasNewCf || dto.customFields !== undefined) {
        const merged = { ...(before.customFields ?? {}) };
        for (const k of newCfKeys) {
          if (dto[k] !== undefined) merged[k] = dto[k];
        }
        if (dto.customFields) Object.assign(merged, dto.customFields);
        profileUpdates.customFields = merged;
      }

      await tx.studentProfile.updateMany({ where: { id }, data: profileUpdates });
      const after = await tx.studentProfile.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'StudentProfile',
        entityId: id,
        action: 'update',
        oldValues: before,
        newValues: after,
      });
      return after;
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx: any) => {
      const profile = await tx.studentProfile.findFirst({ where: { id } });
      if (!profile) throw new NotFoundException(`Student ${id} not found`);
      await tx.studentProfile.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await tx.partner.updateMany({ where: { id: profile.partnerId }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'StudentProfile', entityId: id, action: 'delete' });
    });
  }

  /** Active learners placed in a class now, with their stream. */
  async listByClass(classId: string) {
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { status: 'active', ...this.placements.studentWhere({ classIds: [classId] }) },
      orderBy: { admissionNo: 'asc' },
      include: { partner: true },
    });
    return this.withPlacement(rows);
  }

  /**
   * Bulk-import learners from parsed CSV rows. The controller lowercases the
   * headers, so keys arrive as `admissionno`, `classcode`, … .
   *
   * Columns: admissionNo, name, enrollmentDate?, dateOfBirth?, gender?,
   * classCode?, sectionCode?, termId?, house?, email?, phone?
   *
   * Class and stream resolve by CODE (brief §27), never by display name — names
   * change, codes do not. An unresolvable code fails that row with a reason;
   * other rows still import, each in its own transaction.
   */
  async bulkImport(rows: Array<Record<string, string>>) {
    const created: StudentProfile[] = [];
    const skipped: Array<{ row: number; reason: string; admissionNo?: string }> = [];
    const val = (row: Record<string, string>, key: string) => (row[key.toLowerCase()] ?? row[key] ?? '').trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const admissionNo = val(row, 'admissionNo');
      const name = val(row, 'name');
      if (!admissionNo || !name) {
        skipped.push({ row: i, reason: 'missing admissionNo or name' });
        continue;
      }
      try {
        let classId: string | undefined;
        let sectionId: string | undefined;
        const classCode = val(row, 'classCode').toUpperCase();
        if (classCode) {
          const cls = await this.prisma.client.schoolClass.findFirst({ where: { code: classCode } });
          if (!cls) throw new BadRequestException(`Unknown class code "${classCode}".`);
          classId = cls.id;
          const sectionCode = val(row, 'sectionCode').toUpperCase();
          if (sectionCode) {
            const section = await this.prisma.client.section.findFirst({ where: { classId: cls.id, code: sectionCode } });
            if (!section) throw new BadRequestException(`Unknown stream code "${sectionCode}" in class ${classCode}.`);
            sectionId = section.id;
          }
        }
        const student = await this.create({
          name,
          admissionNo,
          enrollmentDate: val(row, 'enrollmentDate') || new Date().toISOString(),
          email: val(row, 'email') || undefined,
          phone: val(row, 'phone') || undefined,
          dateOfBirth: val(row, 'dateOfBirth') || undefined,
          gender: (val(row, 'gender').toLowerCase() as any) || undefined,
          house: val(row, 'house') || undefined,
          classId,
          sectionId,
          termId: val(row, 'termId') || undefined,
        });
        created.push(student);
      } catch (e: any) {
        skipped.push({ row: i, admissionNo, reason: e?.response?.message ?? e?.message ?? 'unknown' });
      }
    }

    return { created: created.length, skipped };
  }

  async activitiesForStudent(studentProfileId: string) {
    return this.prisma.client.activity.findMany({
      where: { subjectType: 'student', subjectId: studentProfileId },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async statement(studentProfileId: string) {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: {
        guardians: true,
        medicalRecord: true,
        academicEnrollments: {
          orderBy: { admissionDate: 'desc' },
          include: {
            academicYear: { select: { id: true, name: true } },
            gradeLevel: { select: { id: true, name: true } },
            placements: {
              orderBy: { effectiveFrom: 'desc' },
              include: {
                term: { select: { id: true, name: true } },
                classCohort: { select: { schoolClass: { select: { id: true, name: true } } } },
                section: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);
    const partner = await this.prisma.client.partner.findFirst({ where: { id: profile.partnerId } });

    // H: the fee statement was a stub (profile + partner only). Aggregate the
    // student's actual fee invoices and receipts so the bursar UI and guardian
    // portal show a real balance. Billed = sum of fee-document totals; balance =
    // sum of their residuals; paid is the difference (derived from the invoices
    // themselves, so it always reconciles).
    // P0-7: scope to financially active documents. The previous query applied
    // no `status` filter at all, so draft invoices (never issued) and cancelled
    // invoices (withdrawn) were both counted in the student's billed total.
    const invoices = await this.prisma.client.document.findMany({
      where: { ...POSTED_FEE_WHERE, partnerId: profile.partnerId },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        documentNumber: true,
        issueDate: true,
        dueDate: true,
        totalAmount: true,
        amountResidual: true,
        paymentStatus: true,
        sourceType: true,
      },
    });
    const payments = await this.prisma.client.payment.findMany({
      where: { partnerId: profile.partnerId, direction: 'inbound' },
      orderBy: { paymentDate: 'desc' },
      select: { id: true, paymentNumber: true, amount: true, paymentDate: true, paymentMethod: true },
    });

    // D1: every figure comes from the ONE canonical calculation.
    //
    // `totalPaid` used to be `totalBilled - balance`. `balance` sums
    // `amountResidual`, which waivers, credit applications and credit
    // adjustments all reduce — so forgiven money was reported as money
    // received. This statement renders that figure directly beside the
    // `payments` array below, so on any pupil who had ever received a waiver
    // the two numbers on the same page contradicted each other.
    //
    // The old comment claimed this method "then delegates to"
    // SchoolFinanceQueryService. It did not; that delegation is now real, so
    // the bursar statement, the parent portal and the ledger cannot disagree
    // (FINANCIAL_INVARIANTS §Terminology).
    //
    // `collected` is SUM(PaymentAllocation) and now reconciles exactly with
    // the receipts listed below it. Reductions are reported as their own
    // figures rather than folded into "paid", because a parent asking why
    // their balance fell deserves to know whether it was paid or forgiven.
    const b = await this.finance.studentBalance(studentProfileId);

    return {
      studentId: profile.id,
      studentName: partner?.name ?? null,
      admissionNo: profile.admissionNo,
      profile: (await this.withPlacement([profile]))[0],
      partner,
      totalBilled: b.billed,
      collected: b.collected,
      waived: b.waived,
      credited: b.credited,
      adjusted: b.adjusted,
      balance: b.balance,
      invoices,
      payments,
    };
  }
}