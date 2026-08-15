import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { StudentProfile, Partner } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type { CreateStudentDto, UpdateStudentDto } from './dto.types';

/**
 * P5: the student lifecycle. `active` is the working state (enrolled students).
 * `transferred` and `alumni` (graduated) are terminal. `withdrawn`/`suspended`
 * can return to `active` (re-admission / reinstatement).
 */
const STUDENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  active: ['suspended', 'transferred', 'withdrawn', 'alumni'],
  suspended: ['active', 'withdrawn', 'transferred'],
  withdrawn: ['active', 'transferred'],
  transferred: [],
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
    currentClass: { include: { gradeLevel: true } },
    currentSection: true,
    guardians: true,
    medicalRecord: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
  ) {
    super(prisma.client.studentProfile as unknown as CrudDelegate);
  }

  /**
   * Create the Partner + StudentProfile atomically. The Partner gets a unique
   * sequential code (STU-...) and StudentProfile gets the user-provided
   * admissionNo. School-specific scalars (house, bloodGroup, etc.) go into
   * Partner.customFields AND are mirrored on StudentProfile where the school
   * needs to query them efficiently.
   */
  async create(dto: CreateStudentDto): Promise<StudentProfile> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const code = dto.code ?? (await this.sequence.next(`student:${new Date().getUTCFullYear()}`, { prefix: 'STU-', padding: 6 }, tx));

      // School-specific fields mirrored into customFields for partner-side searches.
      const customFields = {
        ...(dto.customFields ?? {}),
        dateOfBirth: dto.dateOfBirth ?? null,
        gender: dto.gender ?? null,
        nationality: dto.nationality ?? null,
        religion: dto.religion ?? null,
        house: dto.house ?? null,
      };

      const partner = await tx.partner.create({
        data: {
          organizationId,
          code,
          name: dto.name,
          isCompany: dto.isCompany ?? false,
          isCustomer: true,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          customFields,
        },
      });

      const profile = await tx.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: dto.admissionNo,
          currentClassId: dto.currentClassId ?? null,
          currentSectionId: dto.currentSectionId ?? null,
          enrollmentDate: new Date(dto.enrollmentDate),
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          gender: dto.gender ?? null,
          nationality: dto.nationality ?? null,
          religion: dto.religion ?? null,
          residenceType: dto.residenceType ?? 'day',
          house: dto.house ?? null,
          customFields: dto.customFields ?? {},
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'StudentProfile',
        entityId: profile.id,
        action: 'create',
        newValues: { partner, profile },
      });

      this.events.publish(EVENTS.SchoolStudentCreated, {
        organizationId,
        studentProfileId: profile.id,
        partnerId: partner.id,
        admissionNo: profile.admissionNo,
      });

      return profile;
    });
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

      // Profile-side updates
      const profileUpdates: Record<string, unknown> = {};
      for (const k of [
        'currentClassId',
        'currentSectionId',
        'dateOfBirth',
        'gender',
        'nationality',
        'religion',
        'residenceType',
        'house',
        'customFields',
      ] as const) {
        if (dto[k] !== undefined) profileUpdates[k] = dto[k];
      }
      if (dto.status !== undefined) profileUpdates.status = dto.status;

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

  async listByClass(classId: string) {
      return this.prisma.client.studentProfile.findMany({
        where: { currentClassId: classId, status: 'active' },
        orderBy: { admissionNo: 'asc' },
        include: { currentSection: true, partner: true },
      });
    }

    /**
     * Bulk-import students from a parsed CSV row-set.
     *
     * Each row maps to one student (Partner + StudentProfile atomic). Rows with
     * a duplicate admissionNo are skipped. The whole batch runs in a single
     * transaction per row so a single bad row doesn't roll back the rest.
     *
     * Expected columns (header row required):
     *   admissionNo, name, enrollmentDate, dateOfBirth?, gender?, classCode?, sectionCode?, house?, email?, phone?
     *
     * `classCode` matches SchoolClass.name (e.g. "P.1 A"). `sectionCode` matches
     * Section.name within that class. Both optional — student just won't be
     * assigned to one if the codes don't resolve.
     */
    async bulkImport(rows: Array<Record<string, string>>) {
      const organizationId = this.tenant.organizationId;
      const created: StudentProfile[] = [];
      const skipped: Array<{ row: number; reason: string; admissionNo?: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const admissionNo = (row.admissionNo ?? '').trim();
        const name = (row.name ?? '').trim();
        if (!admissionNo || !name) {
          skipped.push({ row: i, reason: 'missing admissionNo or name' });
          continue;
        }
        try {
          // Resolve class + section codes.
          let currentClassId: string | undefined;
          let currentSectionId: string | undefined;
          if (row.classCode) {
            const cls = await this.prisma.client.schoolClass.findFirst({
              where: { organizationId, name: row.classCode.trim() },
            });
            if (cls) {
              currentClassId = cls.id;
              if (row.sectionCode) {
                const section = await this.prisma.client.section.findFirst({
                  where: { organizationId, classId: cls.id, name: row.sectionCode.trim() },
                });
                if (section) currentSectionId = section.id;
              }
            }
          }

          const student = await this.create({
            name,
            admissionNo,
            enrollmentDate: row.enrollmentDate || new Date().toISOString(),
            email: row.email || undefined,
            phone: row.phone || undefined,
            dateOfBirth: row.dateOfBirth || undefined,
            gender: (row.gender as any) || undefined,
            house: row.house || undefined,
            currentClassId,
            currentSectionId,
          });
          created.push(student);
        } catch (e: any) {
          skipped.push({ row: i, admissionNo, reason: e?.message ?? 'unknown' });
        }
      }

      return { created: created.length, skipped };
    }

  async statement(studentProfileId: string) {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: {
        currentClass: { include: { gradeLevel: true } },
        currentSection: true,
        guardians: true,
        medicalRecord: true,
        enrollments: { include: { term: true, schoolClass: true } },
      },
    });
    if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);
    const partner = await this.prisma.client.partner.findFirst({ where: { id: profile.partnerId } });

    // H: the fee statement was a stub (profile + partner only). Aggregate the
    // student's actual fee invoices and receipts so the bursar UI and guardian
    // portal show a real balance. Billed = sum of fee-document totals; balance =
    // sum of their residuals; paid is the difference (derived from the invoices
    // themselves, so it always reconciles).
    const invoices = await this.prisma.client.document.findMany({
      where: {
        partnerId: profile.partnerId,
        documentType: 'sales_invoice',
        sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
      },
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

    const totalBilled = invoices.reduce((s, d) => s + Number(d.totalAmount), 0);
    const balance = invoices.reduce((s, d) => s + Number(d.amountResidual), 0);
    const totalPaid = totalBilled - balance;

    return {
      studentId: profile.id,
      studentName: partner?.name ?? null,
      admissionNo: profile.admissionNo,
      profile,
      partner,
      totalBilled,
      totalPaid,
      balance,
      invoices,
      payments,
    };
  }
}