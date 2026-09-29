import { loadCustomFieldDefinitions, validateCustomFieldValues } from '../foundation/custom-field-values';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { ConflictException, Injectable, BadRequestException, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import type { StudentProfile, Partner } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS, PERMISSIONS, type PaginatedResult, type PaginationQuery } from '@erp/shared';
import { EncryptionService } from '../../../kernel/encryption/encryption.service';
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
/** Statuses an operator may set on the profile directly; the rest follow the enrollment. */
const MANUAL_STUDENT_STATUSES = ['deceased', 'archived'];

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
    // roster and every dropdown needs it, so include it by default. The medical
    // record is NOT here: it travels only to callers holding the medical-read
    // grant (F08) — see `include()`.
    partner: true,
    guardians: true,
  };

  private canReadMedical(): boolean {
    return (this.tenant.permissions ?? []).includes(PERMISSIONS.school.readMedical);
  }

  /** The include for a response to THIS caller (F08). */
  private include(): Record<string, unknown> {
    return this.canReadMedical() ? { ...this.defaultInclude, medicalRecord: true } : this.defaultInclude;
  }

  /**
   * Strip identifiers that must not ride along with an ordinary pupil response
   * (F08): the national ID lives encrypted and is shown masked; revealing it is
   * its own audited action.
   */
  private redact<T extends Record<string, any>>(row: T): T {
    const scrub = (cf: any) => {
      if (!cf || typeof cf !== 'object') return cf;
      const { nin: _nin, ninEncrypted: _enc, ...rest } = cf;
      return rest;
    };
    const cf = (row as any).customFields ?? {};
    return {
      ...row,
      customFields: { ...scrub(cf), ninOnFile: !!(cf.ninEncrypted || cf.nin), ninLast4: cf.ninLast4 ?? null },
      ...((row as any).partner ? { partner: { ...(row as any).partner, customFields: scrub((row as any).partner.customFields) } } : {}),
    } as T;
  }

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
    private readonly encryption: EncryptionService,
    @Optional() private readonly dataScope?: DataScopeService,
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
        ...this.redact(r as any),
        currentClass: d?.classId
          ? { id: d.classId, name: d.className, gradeLevel: d.gradeLevelId ? { id: d.gradeLevelId, name: d.gradeLevelName } : null }
          : null,
        currentSection: d?.sectionId ? { id: d.sectionId, name: d.sectionName } : null,
      };
    });
  }

  /** Paginated roster, optionally narrowed to learners placed in a class or stream now. */
  override async list(query: PaginationQuery & StudentListQueryDto): Promise<PaginatedResult<StudentProfile>> {
    // R1 (Wave 5): a class-scoped teacher lists only the pupils of classes they
    // teach. Every staff preset holds school:read, so the Class Teacher's
    // `dataScope: 'class'` used to change nothing here — the whole school came back.
    // F07: authority is a list of seats. No seats means no pupils — an empty
    // list was read as "no filter" and returned the whole school.
    if (query.classId) await this.dataScope?.assertMayReadClass(query.classId, query.sectionId ?? null);
    const scopeWhere = this.dataScope ? await this.dataScope.studentReadWhere() : null;
    const target = {
      ...(query.classId ? { classIds: [query.classId] } : {}),
      ...(query.sectionId ? { sectionIds: [query.sectionId] } : {}),
    };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50));
    const clauses: Record<string, unknown>[] = [];
    if (Object.keys(target).length || query.termId) {
      clauses.push(this.placements.studentWhere(target, query.termId ? { termId: query.termId } : {}) as Record<string, unknown>);
    }
    if (scopeWhere) clauses.push(scopeWhere);
    // The search box says "name or admission no", but the name lives on the
    // Partner — a pupil registered a moment ago must be findable by name.
    if (query.search) {
      const term = { contains: query.search, mode: 'insensitive' };
      clauses.push({ OR: [{ admissionNo: term }, { partner: { name: term } }] });
    }
    const where: Record<string, unknown> = clauses.length ? { AND: clauses } : {};
    const [rows, total] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        where,
        orderBy: { admissionNo: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.include(),
      }),
      this.prisma.client.studentProfile.count({ where }),
    ]);
    return {
      data: (await this.withPlacement(rows)) as any,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  override async findOne(id: string): Promise<StudentProfile> {
    await this.dataScope?.assertMayReadStudent(id);
    const row = await this.prisma.client.studentProfile.findFirst({ where: { id }, include: this.include() });
    if (!row) throw new NotFoundException(`StudentProfile ${id} not found`);
    return (await this.withPlacement([row]))[0] as any;
  }

  /**
   * The pupil's national ID, decrypted — an audited act for staff who manage
   * pupil records, never part of an ordinary response (F08).
   */
  async revealNin(id: string): Promise<{ nin: string | null }> {
    await this.dataScope?.assertMayReadStudent(id);
    const row = await this.prisma.client.studentProfile.findFirst({ where: { id }, select: { customFields: true } });
    if (!row) throw new NotFoundException(`StudentProfile ${id} not found`);
    const cf: any = row.customFields ?? {};
    const nin = cf.ninEncrypted ? this.encryption.decrypt(cf.ninEncrypted) : (cf.nin ?? null);
    await this.audit.record({ entity: 'StudentProfile', entityId: id, action: 'read', newValues: { field: 'nin', revealed: nin != null } });
    return { nin };
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
    // Wave 16: the school's own custom fields are checked, and required ones enforced.
    dto.customFields = validateCustomFieldValues(
      await loadCustomFieldDefinitions(this.prisma.client, 'student'),
      dto.customFields,
      { requireAll: true },
    );
    // The likely-duplicate check lives in `admit` for every path (audit F07).
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
      allowDuplicate: dto.allowDuplicate ?? false,
      duplicateReason: dto.duplicateReason ?? null,
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

      // Partner-side updates: name, contact and photo belong to the person and
      // are saved here, in the same transaction as the profile, so one save is
      // all-or-nothing and needs only the pupil-record grant (F15).
      const partnerUpdates: Record<string, unknown> = {};
      if (dto.name !== undefined) partnerUpdates.name = dto.name;
      if (dto.email !== undefined) partnerUpdates.email = dto.email || null;
      if (dto.phone !== undefined) partnerUpdates.phone = dto.phone || null;
      if (dto.photoUrl !== undefined) {
        const partner = await tx.partner.findFirst({ where: { id: before.partnerId }, select: { customFields: true } });
        partnerUpdates.customFields = { ...((partner?.customFields as any) ?? {}), photoUrl: dto.photoUrl || null };
      }
      if (Object.keys(partnerUpdates).length > 0) {
        await tx.partner.updateMany({ where: { id: before.partnerId }, data: partnerUpdates });
      }

      // Status transition? P5: enforce the student lifecycle FSM. The old code
      // wrote whatever status the caller asked for; now illegal jumps (e.g.
      // reviving a transferred/alumni record) are rejected. Every legal change
      // still records StudentStatusHistory + emits the event.
      if (dto.status && dto.status !== before.status) {
        // Membership statuses are projections of the enrollment (ADR-018): a
        // learner becomes withdrawn, suspended, transferred or graduated through
        // the enrollment endpoints, which also end the class seat. Editing the
        // profile directly would leave the two disagreeing.
        if (!MANUAL_STUDENT_STATUSES.includes(dto.status)) {
          throw new BadRequestException(
            `'${dto.status}' is set through the learner's enrollment (withdraw, suspend, transfer, complete), ` +
              'not by editing the profile.',
          );
        }
        if (dto.status === 'deceased' || dto.status === 'archived') {
          const seated = await tx.studentEnrollment.count({
            where: { studentProfileId: id, status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED'] } },
          });
          if (seated > 0) {
            throw new BadRequestException(
              'This learner still holds a class seat. End the enrollment first (withdraw), then update the record.',
            );
          }
        }
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
      // The national ID is never stored in the clear (F08): whether it arrives
      // as `nin` or inside customFields, it is encrypted and only its last four
      // characters stay readable.
      const { nin: cfNin, ninEncrypted: _e, ninOnFile: _o, ninLast4: _l, ...rawIncomingCf } = (dto.customFields ?? {}) as any;
      // Wave 16: defined custom fields are type-checked; a required one cannot be cleared.
      const incomingCf = validateCustomFieldValues(
        await loadCustomFieldDefinitions(tx, 'student'),
        rawIncomingCf,
        { requireAll: false },
      );
      const nin = dto.nin !== undefined ? dto.nin : cfNin;
      if (hasNewCf || dto.customFields !== undefined || nin !== undefined) {
        const merged: any = { ...(before.customFields ?? {}) };
        delete merged.nin;
        for (const k of newCfKeys) {
          if (dto[k] !== undefined) merged[k] = dto[k];
        }
        Object.assign(merged, incomingCf);
        if (nin !== undefined) {
          const clean = typeof nin === 'string' ? nin.trim() : '';
          merged.ninEncrypted = clean ? this.encryption.encrypt(clean) : null;
          merged.ninLast4 = clean ? clean.slice(-4) : null;
        }
        profileUpdates.customFields = merged;
      }

      await tx.studentProfile.updateMany({ where: { id }, data: profileUpdates });
      const after = await tx.studentProfile.findFirst({ where: { id }, include: { partner: true } });
      await this.audit.recordInTx(tx, {
        entity: 'StudentProfile',
        entityId: id,
        action: 'update',
        oldValues: this.redact(before),
        newValues: this.redact(after),
      });
      return this.redact(after);
    });
  }

  /**
   * Delete is for a record created by mistake and never used. A learner with any
   * enrollment, fee or attendance history is part of the school's record; they
   * leave through their enrollment (withdraw/transfer/complete) and are archived.
   */
  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx: any) => {
      const profile = await tx.studentProfile.findFirst({ where: { id } });
      if (!profile) throw new NotFoundException(`Student ${id} not found`);
      const [enrollments, feeAssignments, attendance, invoices] = await Promise.all([
        tx.studentEnrollment.count({ where: { studentProfileId: id } }),
        tx.studentFeeAssignment.count({ where: { studentProfileId: id } }),
        tx.studentAttendance.count({ where: { studentProfileId: id } }),
        tx.document.count({ where: { partnerId: profile.partnerId } }),
      ]);
      const blockers = [
        enrollments ? `${enrollments} enrollment(s)` : null,
        feeAssignments ? `${feeAssignments} fee assignment(s)` : null,
        attendance ? `${attendance} attendance record(s)` : null,
        invoices ? `${invoices} financial document(s)` : null,
      ].filter(Boolean);
      if (blockers.length > 0) {
        throw new ConflictException(
          `This learner has ${blockers.join(', ')} and cannot be deleted. ` +
            'Withdraw or complete their enrollment and archive the record instead.',
        );
      }
      await tx.studentProfile.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await tx.partner.updateMany({ where: { id: profile.partnerId }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'StudentProfile', entityId: id, action: 'delete' });
    });
  }

  /** Active learners placed in a class now, with their stream. */
  async listByClass(classId: string) {
    await this.dataScope?.assertMayReadClass(classId);
    // A stream-only reader sees their stream of the class, not all of it (D4).
    const scopeWhere = this.dataScope ? await this.dataScope.studentReadWhere() : null;
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { AND: [{ status: 'active' }, this.placements.studentWhere({ classIds: [classId] }), ...(scopeWhere ? [scopeWhere] : [])] } as any,
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
    // R03: the school's own pupil fields import from a column of the same name
    // (or `cf_<name>`); `admit` enforces the required ones per row.
    const schoolFields = await loadCustomFieldDefinitions(this.prisma.client, 'student');
    const customFieldsOf = (row: Record<string, string>) => {
      const out: Record<string, unknown> = {};
      for (const f of schoolFields) {
        const v = val(row, f.name) || val(row, `cf_${f.name}`);
        if (v) out[f.name] = v;
      }
      return out;
    };

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
          customFields: customFieldsOf(row),
          allowDuplicate: val(row, 'allowDuplicate').toLowerCase() === 'true',
          duplicateReason: val(row, 'duplicateReason') || 'Marked as a different child in the import file',
        });
        created.push(student);
      } catch (e: any) {
        skipped.push({ row: i, admissionNo, reason: e?.response?.message ?? e?.message ?? 'unknown' });
      }
    }

    return { created: created.length, skipped };
  }

  async activitiesForStudent(studentProfileId: string) {
    await this.dataScope?.assertMayReadStudent(studentProfileId);
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
        ...(this.canReadMedical() ? { medicalRecord: true } : {}),
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