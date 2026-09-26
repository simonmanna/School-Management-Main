import { BadRequestException, Injectable } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { StudentEnrollmentService } from '../enrollment/student-enrollment.service';

/**
 * Last nine digits, so `+256 790 600 100`, `0790600100` and `790600100` are one
 * parent. Ugandan subscriber numbers are nine digits after the country code.
 */
function normalizePhone(raw?: string | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits || null;
}

const RESIDENCE = ['day', 'boarder'] as const;
const GENDERS = ['male', 'female', 'other'] as const;

export class GuardianInput {
  guardianContactId!: string;
  relationship!: string;
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
}

/** A guardian named on the registration screen rather than picked from Contacts. */
export interface InlineGuardianInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  relationship?: string | null;
}

/**
 * Where a new learner is seated. The academic year is the term's; the grade and
 * programme follow from the class (ADR-028). Omit the whole thing to admit a
 * learner with no class yet.
 */
export interface AdmissionPlacement {
  termId: string;
  classId: string;
  sectionId?: string | null;
  rollNumber?: string | null;
  /** When the learner actually joined; defaults to now. */
  effectiveFrom?: string | null;
  overrideCapacity?: boolean;
  overrideReason?: string;
  /** NEW by default; TRANSFER_IN for a learner arriving from another school. */
  enrollmentType?: 'NEW' | 'TRANSFER_IN';
}

/** Everything needed to create a learner (Partner + StudentProfile) and seat them. */
export class AdmitStudentInput {
  organizationId!: string;
  applicationId?: string | null;
  name!: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  religion?: string | null;
  house?: string | null;
  residenceType?: string | null;
  studentCategoryId?: string | null;
  admissionNo?: string | null;
  enrollmentDate?: string | null;
  guardians?: GuardianInput[];
  /**
   * A guardian typed inline on the front desk. Resolved to a Contact INSIDE the
   * admission transaction (see `resolveGuardianInTx`) so a later capacity or
   * duplicate failure cannot leave an orphaned contact behind.
   */
  inlineGuardian?: InlineGuardianInput | null;
  customFields?: Record<string, unknown>;
  partnerCustomFields?: Record<string, unknown>;
  placement?: AdmissionPlacement | null;
  /**
   * Admit an EXISTING learner (a returning pupil, or an applicant confirmed as
   * the same child) — no second Partner/StudentProfile is created; only the new
   * enrollment and placement.
   */
  existingStudentProfileId?: string | null;
}

/** Quick "register & place" payload — everything a secretary types on one screen. */
export class RegisterStudentDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() admissionNo?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsIn([...GENDERS]) gender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() religion?: string;
  @IsOptional() @IsString() house?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsString() studentCategoryId?: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsString() rollNumber?: string;
  /** Optional guardian created inline so the whole placement is one action. */
  @IsOptional() @IsString() guardianName?: string;
  @IsOptional() @IsString() guardianPhone?: string;
  @IsOptional() @IsString() guardianRelationship?: string;
}

/**
 * Admitting a new learner: the one path that creates a StudentProfile.
 *
 * Partner + StudentProfile + guardians + status history, and — when a class is
 * given — a canonical StudentEnrollment with its opening EnrollmentPlacement,
 * all in ONE transaction. Used by the front-desk register, the student form,
 * CSV import and admissions. Before this existed the profile carried a
 * "current class" column written separately from any enrollment, which is how
 * learners appeared in a class on their record but on no class list.
 */
@Injectable()
export class StudentAdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly enrollments: StudentEnrollmentService,
  ) {}

  /**
   * Create the learner and, when asked, enrol and seat them.
   *
   * Accepts an outer transaction so admissions can mark the application
   * enrolled in the same atomic unit — Prisma cannot nest interactive
   * transactions. Idempotent per application: a second call for an application
   * that already produced an enrollment returns that one.
   */
  async admit(input: AdmitStudentInput, outerTx?: any) {
    const run = async (tx: any) => {
      const organizationId = input.organizationId;

      if (input.applicationId) {
        const prior = await tx.studentEnrollment.findFirst({
          where: { admissionApplicationId: input.applicationId },
        });
        if (prior) {
          const profile = await tx.studentProfile.findFirst({ where: { id: prior.studentProfileId } });
          return { partner: null, profile, enrollment: prior, placement: null, warnings: [] as string[] };
        }
      }

      // Before the Partner, the StudentProfile or the sequence number: a term
      // from the wrong academic year must cost nothing and leave nothing behind.
      if (input.placement) await this.resolveTermInTx(tx, input);

      if (input.existingStudentProfileId) {
        return this.enrolExisting(tx, input);
      }

      const code = await this.sequence.next(
        `student:${new Date().getUTCFullYear()}`,
        { prefix: 'STU-', padding: 6 },
        tx,
      );
      const partner = await tx.partner.create({
        data: {
          organizationId,
          code,
          name: input.name,
          isCompany: false,
          isCustomer: true,
          email: input.email ?? null,
          phone: input.phone ?? null,
          customFields: {
            ...(input.partnerCustomFields ?? {}),
            dateOfBirth: input.dateOfBirth ?? null,
            gender: input.gender ?? null,
            nationality: input.nationality ?? null,
            religion: input.religion ?? null,
            house: input.house ?? null,
          },
        },
      });
      const profile = await tx.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: input.admissionNo ?? code,
          enrollmentDate: input.enrollmentDate ? new Date(input.enrollmentDate) : new Date(),
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          gender: input.gender ?? null,
          nationality: input.nationality ?? null,
          religion: input.religion ?? null,
          residenceType: input.residenceType ?? 'day',
          house: input.house ?? null,
          studentCategoryId: input.studentCategoryId ?? null,
          status: 'active',
          customFields: (input.customFields ?? {}) as any,
        },
      });

      await tx.studentStatusHistory.create({
        data: {
          organizationId,
          studentProfileId: profile.id,
          fromStatus: 'applicant',
          toStatus: 'active',
          reason: input.applicationId ? 'Admitted from application' : 'Admission',
          changedById: this.tenant.userId ?? null,
        },
      });

      const guardians = await this.collectGuardians(tx, organizationId, input);
      for (const g of guardians) {
        await tx.studentGuardian.create({
          data: {
            organizationId,
            studentProfileId: profile.id,
            guardianContactId: g.guardianContactId,
            relationship: g.relationship,
            isPrimary: g.isPrimary ?? false,
            canPickup: g.canPickup ?? true,
            receivesStatements: g.receivesStatements ?? true,
          },
        });
      }

      let enrollment: any = null;
      let placement: any = null;
      let warnings: string[] = [];
      if (input.placement) {
        const term = await this.resolveTermInTx(tx, input);
        const admissionDate = input.placement.effectiveFrom ?? input.enrollmentDate ?? new Date().toISOString();
        const created = await this.enrollments.createInTx(tx, {
          studentProfileId: profile.id,
          academicYearId: term.academicYearId,
          admissionDate,
          enrollmentType: input.placement.enrollmentType ?? 'NEW',
          admissionApplicationId: input.applicationId ?? undefined,
          placement: {
            termId: term.id,
            classId: input.placement.classId,
            sectionId: input.placement.sectionId ?? null,
            rollNumber: input.placement.rollNumber ?? undefined,
            effectiveFrom: admissionDate,
            overrideCapacity: input.placement.overrideCapacity,
            overrideReason: input.placement.overrideReason,
          },
        } as any);
        enrollment = created.enrollment;
        placement = created.placement;
        warnings = created.warnings;
      }

      await this.audit.recordInTx(tx, {
        entity: 'StudentProfile',
        entityId: profile.id,
        action: 'create',
        newValues: { partner, profile, enrollmentId: enrollment?.id ?? null },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolStudentCreated, {
        organizationId,
        studentProfileId: profile.id,
        partnerId: partner.id,
        admissionNo: profile.admissionNo,
      });
      return { partner, profile, enrollment, placement, warnings };
    };
    return outerTx ? run(outerTx) : this.prisma.client.$transaction(run);
  }

  /**
   * Learners that are probably the same child: same name (case/space-insensitive)
   * AND same date of birth. Name alone is never enough — two pupils may share it.
   */
  async findLikelyDuplicates(client: any, name: string, dateOfBirth: string | null) {
    if (!dateOfBirth) return [];
    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) return [];
    const rows = await client.studentProfile.findMany({
      where: {
        dateOfBirth: dob,
        partner: { name: { equals: name.trim().replace(/\s+/g, ' '), mode: 'insensitive' } },
      },
      select: { id: true, admissionNo: true, status: true },
      take: 5,
    });
    return rows as Array<{ id: string; admissionNo: string; status: string }>;
  }

  /** Enrol a learner who already has a StudentProfile (no new master record). */
  private async enrolExisting(tx: any, input: AdmitStudentInput) {
    const profile = await tx.studentProfile.findFirst({ where: { id: input.existingStudentProfileId } });
    if (!profile) throw new BadRequestException(`Student ${input.existingStudentProfileId} not found.`);
    if (['deceased', 'archived'].includes(profile.status)) {
      throw new BadRequestException(`That learner's record is ${profile.status}; they cannot be re-admitted.`);
    }
    let enrollment: any = null;
    let placement: any = null;
    let warnings: string[] = [];
    if (input.placement) {
      const term = await this.resolveTermInTx(tx, input);
      const admissionDate = input.placement.effectiveFrom ?? input.enrollmentDate ?? new Date().toISOString();
      const created = await this.enrollments.createInTx(tx, {
        studentProfileId: profile.id,
        academicYearId: term.academicYearId,
        admissionDate,
        enrollmentType: input.placement.enrollmentType ?? 'RE_ENTRY',
        admissionApplicationId: input.applicationId ?? undefined,
        placement: {
          termId: term.id,
          classId: input.placement.classId,
          sectionId: input.placement.sectionId ?? null,
          rollNumber: input.placement.rollNumber ?? undefined,
          effectiveFrom: admissionDate,
          overrideCapacity: input.placement.overrideCapacity,
          overrideReason: input.placement.overrideReason,
        },
      } as any);
      enrollment = created.enrollment;
      placement = created.placement;
      warnings = created.warnings;
    }
    const guardians = await this.collectGuardians(tx, profile.organizationId, input);
    for (const g of guardians) {
      const exists = await tx.studentGuardian.findFirst({
        where: { studentProfileId: profile.id, guardianContactId: g.guardianContactId },
      });
      if (exists) continue;
      await tx.studentGuardian.create({
        data: {
          organizationId: profile.organizationId,
          studentProfileId: profile.id,
          guardianContactId: g.guardianContactId,
          relationship: g.relationship,
          isPrimary: g.isPrimary ?? false,
          canPickup: g.canPickup ?? true,
          receivesStatements: g.receivesStatements ?? true,
        },
      });
    }
    await this.audit.recordInTx(tx, {
      entity: 'StudentProfile',
      entityId: profile.id,
      action: 'update',
      newValues: { readmitted: true, applicationId: input.applicationId ?? null, enrollmentId: enrollment?.id ?? null },
    });
    return { partner: null, profile, enrollment, placement, warnings };
  }

  /**
   * Front-desk "register & place": create the learner and seat them in one
   * action. A guardian named inline becomes a Contact linked as primary, so the
   * parent can later be invited to the portal without a second trip.
   */
  async register(dto: RegisterStudentDto) {
    const organizationId = this.tenant.organizationId;
    return this.admit({
      organizationId,
      name: dto.name,
      admissionNo: dto.admissionNo ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      nationality: dto.nationality ?? null,
      religion: dto.religion ?? null,
      house: dto.house ?? null,
      residenceType: dto.residenceType ?? null,
      studentCategoryId: dto.studentCategoryId ?? null,
      inlineGuardian: dto.guardianName?.trim()
        ? {
            name: dto.guardianName.trim(),
            phone: dto.guardianPhone ?? null,
            relationship: dto.guardianRelationship ?? null,
          }
        : null,
      placement: {
        termId: dto.termId,
        classId: dto.classId,
        sectionId: dto.sectionId ?? null,
        rollNumber: dto.rollNumber ?? null,
      },
    });
  }

  /**
   * The term the learner is being seated in, guarded against the year the family
   * applied for.
   *
   * `AdmissionsService.enroll` already rejects a mismatched term before any
   * record is written, but it is not the only caller: the student form, the CSV
   * import and the front desk all reach `admit` directly. Without the guard here
   * a 2027 applicant could be given a 2026 enrollment and placement, because the
   * enrollment's academic year is derived from the term (ADR-028) while the
   * admission seat was counted against the application's year.
   */
  private async resolveTermInTx(tx: any, input: AdmitStudentInput) {
    const term = await tx.term.findFirst({
      where: { id: input.placement!.termId },
      select: { id: true, name: true, academicYearId: true },
    });
    if (!term) throw new BadRequestException(`Term ${input.placement!.termId} not found.`);
    if (input.applicationId) {
      const app = await tx.admissionApplication.findFirst({
        where: { id: input.applicationId },
        select: { academicYearId: true, applicationNumber: true },
      });
      if (app?.academicYearId && app.academicYearId !== term.academicYearId) {
        throw new BadRequestException(
          `${term.name} is not in the academic year application ${app.applicationNumber ?? input.applicationId} is for. ` +
            'Choose a term of that year.',
        );
      }
    }
    return term as { id: string; name: string; academicYearId: string };
  }

  /** Explicitly linked guardians, plus the inline one once it has a Contact. */
  private async collectGuardians(
    tx: any,
    organizationId: string,
    input: AdmitStudentInput,
  ): Promise<GuardianInput[]> {
    const guardians = [...(input.guardians ?? [])];
    if (input.inlineGuardian?.name?.trim()) {
      guardians.push(await this.resolveGuardianInTx(tx, organizationId, input.inlineGuardian));
    }
    return guardians;
  }

  /**
   * Find or create the Contact for a guardian typed inline.
   *
   * Runs in the admission transaction, so a failed admission takes the contact
   * with it — the front desk used to create it first and leave it orphaned when
   * the placement then failed on capacity or a duplicate constraint. Reuses an
   * existing contact matched on normalized phone or email: a parent registering a
   * second child should not become a second contact, and then a second fee payer.
   */
  private async resolveGuardianInTx(
    tx: any,
    organizationId: string,
    guardian: InlineGuardianInput,
  ): Promise<GuardianInput> {
    const link = {
      relationship: guardian.relationship?.trim() || 'guardian',
      isPrimary: true,
      canPickup: true,
      receivesStatements: true,
    };

    const phone = normalizePhone(guardian.phone);
    const email = guardian.email?.trim().toLowerCase() || null;
    if (phone || email) {
      const candidates = await tx.contact.findMany({
        where: { organizationId, deletedAt: null, OR: [{ phone: { not: null } }, { email: { not: null } }] },
        select: { id: true, phone: true, email: true },
      });
      const hit = candidates.find(
        (c: any) =>
          (phone && normalizePhone(c.phone) === phone) ||
          (email && (c.email ?? '').trim().toLowerCase() === email),
      );
      if (hit) return { guardianContactId: hit.id, ...link };
    }

    // `Contact.partnerId` is a required FK to the Partner the contact belongs to
    // — here the school itself. This used to pass `''` when that Partner was
    // missing, which failed the FK and took the whole admission down with it.
    const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { code: true, name: true } });
    if (!org) throw new BadRequestException(`Organization ${organizationId} not found.`);
    const owner =
      (await tx.partner.findFirst({ where: { organizationId, code: org.code }, select: { id: true } })) ??
      (await tx.partner.create({
        data: { organizationId, code: org.code, name: org.name, isCompany: true },
        select: { id: true },
      }));
    const contact = await tx.contact.create({
      data: {
        organizationId,
        partnerId: owner.id,
        firstName: guardian.name.trim(),
        lastName: '',
        phone: guardian.phone ?? null,
        email: guardian.email ?? null,
      },
    });
    return { guardianContactId: contact.id, ...link };
  }
}
