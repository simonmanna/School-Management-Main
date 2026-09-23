import { BadRequestException, Injectable } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { StudentEnrollmentService } from '../enrollment/student-enrollment.service';

const RESIDENCE = ['day', 'boarder'] as const;
const GENDERS = ['male', 'female', 'other'] as const;

export class GuardianInput {
  guardianContactId!: string;
  relationship!: string;
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
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

      for (const g of input.guardians ?? []) {
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
        const term = await tx.term.findFirst({
          where: { id: input.placement.termId },
          select: { id: true, academicYearId: true },
        });
        if (!term) throw new BadRequestException(`Term ${input.placement.termId} not found.`);
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
      const term = await tx.term.findFirst({ where: { id: input.placement.termId }, select: { id: true, academicYearId: true } });
      if (!term) throw new BadRequestException(`Term ${input.placement.termId} not found.`);
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
    for (const g of input.guardians ?? []) {
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
    const guardians = await this.resolveGuardian(dto, organizationId);
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
      guardians,
      placement: {
        termId: dto.termId,
        classId: dto.classId,
        sectionId: dto.sectionId ?? null,
        rollNumber: dto.rollNumber ?? null,
      },
    });
  }

  private async resolveGuardian(dto: RegisterStudentDto, organizationId: string): Promise<GuardianInput[]> {
    if (!dto.guardianName?.trim()) return [];
    const org = await this.prisma.client.organization.findFirst({ where: { id: organizationId } });
    const owner = org ? await this.prisma.client.partner.findFirst({ where: { code: org.code } }) : null;
    const contact = await this.prisma.client.contact.create({
      data: {
        organizationId,
        partnerId: owner?.id ?? '',
        firstName: dto.guardianName.trim(),
        lastName: '',
        phone: dto.guardianPhone ?? null,
      },
    });
    return [
      {
        guardianContactId: contact.id,
        relationship: dto.guardianRelationship?.trim() || 'guardian',
        isPrimary: true,
        canPickup: true,
        receivesStatements: true,
      },
    ];
  }
}
