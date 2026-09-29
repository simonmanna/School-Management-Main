import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { FilesService } from '../../../kernel/files/files.service';
import { AdmissionsService } from './admissions.service';
import { AdmissionsPortalService } from './admissions-portal.service';

/**
 * Wave 16 — the public online application.
 *
 * A family applies from the school's website without an account. The request
 * goes through the same `AdmissionsService.create` the office uses — the same
 * duplicate guard, workflow snapshot, audit and notifications — and the family
 * then follows it through the existing magic-link portal, which is emailed to
 * the guardian address they gave. Nothing here is a second admissions engine.
 *
 * What the public may do is narrow on purpose: submit one application into an
 * OPEN cycle, and later attach documents to that one application by its token.
 * Everything else (review, offers, enrolment) stays with the office.
 */

const GENDERS = ['male', 'female'] as const;
const DOC_TYPES = ['birth_certificate', 'passport_photo', 'previous_report', 'immunisation_card', 'transfer_letter', 'other'] as const;
const DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const DOC_MAX_PER_APPLICATION = 12;
/** Once decided, the file is closed to uploads. */
const CLOSED_STATUSES = new Set(['enrolled', 'rejected', 'withdrawn', 'offer_declined', 'offer_expired']);

export class PublicGuardianDto {
  @IsString() @IsNotEmpty() @MaxLength(80) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) lastName!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) relationship!: string;
  /** Ugandan mobile, local or international form. */
  @Matches(/^(\+?256|0)7\d{8}$/, { message: 'phone must be a Ugandan mobile number, e.g. 0772 123456' })
  phone!: string;
  /** Required: the tracking link is emailed here. */
  @IsEmail() @MaxLength(120) email!: string;
}

export class PublicApplicationDto {
  @IsString() @IsNotEmpty() admissionCycleId!: string;
  @IsOptional() @IsString() applyingForClassId?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) applicantFirstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) applicantLastName!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'applicantDob must be YYYY-MM-DD' }) applicantDob!: string;
  @IsIn([...GENDERS]) applicantGender!: (typeof GENDERS)[number];
  @IsOptional() @IsString() @MaxLength(120) previousSchool?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @ValidateNested() @Type(() => PublicGuardianDto) guardian!: PublicGuardianDto;
  /** Honeypot. Humans never see this field; a value means a bot filled it. */
  @IsOptional() @IsString() website?: string;
}

export class PublicDocumentDto {
  @IsIn([...DOC_TYPES]) type!: (typeof DOC_TYPES)[number];
}

@Injectable()
export class PublicAdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly admissions: AdmissionsService,
    private readonly portal: AdmissionsPortalService,
    private readonly files: FilesService,
  ) {}

  private async org(orgCode: string) {
    const org = await this.prisma.raw.organization.findFirst({
      where: { code: orgCode },
      select: { id: true, name: true },
    });
    if (!org) throw new NotFoundException('School not found');
    return org;
  }

  private asApplicant<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return this.tenant.run({ organizationId, userId: 'portal:applicant', permissions: [] }, fn);
  }

  private async openCycles(now = new Date()) {
    const cycles = await this.prisma.client.admissionCycle.findMany({
      where: { status: 'open' },
      include: { academicYear: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return cycles.filter((c) => (!c.opensAt || c.opensAt <= now) && (!c.closesAt || c.closesAt >= now));
  }

  /** What the form offers: the school's name, open cycles and the classes it admits into. */
  async options(orgCode: string) {
    const org = await this.org(orgCode);
    return this.asApplicant(org.id, async () => {
      const [cycles, classes, profile] = await Promise.all([
        this.openCycles(),
        this.prisma.client.schoolClass.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, gradeLevel: { select: { order: true } } },
        }),
        this.prisma.client.schoolProfile.findFirst({ select: { name: true } }),
      ]);
      return {
        schoolName: profile?.name ?? org.name,
        cycles: cycles.map((c) => ({ id: c.id, name: c.name, academicYear: c.academicYear?.name ?? null, closesAt: c.closesAt })),
        classes: classes
          .sort((a, b) => (a.gradeLevel?.order ?? 0) - (b.gradeLevel?.order ?? 0) || a.name.localeCompare(b.name))
          .map((c) => ({ id: c.id, name: c.name })),
        documentTypes: DOC_TYPES,
      };
    });
  }

  /**
   * Submit an application. The response never names another applicant or
   * application: a duplicate is reported only as "already applied — contact
   * the school", so the form cannot be used to probe who has applied.
   */
  async apply(orgCode: string, dto: PublicApplicationDto) {
    if (dto.website) {
      // Look successful to the bot; store nothing.
      return { received: true };
    }
    const org = await this.org(orgCode);
    return this.asApplicant(org.id, async () => {
      const cycle = (await this.openCycles()).find((c) => c.id === dto.admissionCycleId);
      if (!cycle) throw new BadRequestException('Applications for that intake are not open.');
      if (dto.applyingForClassId) {
        const cls = await this.prisma.client.schoolClass.findFirst({ where: { id: dto.applyingForClassId, deletedAt: null }, select: { id: true } });
        if (!cls) throw new BadRequestException('Choose a class from the list.');
      }
      const dob = new Date(`${dto.applicantDob}T00:00:00Z`);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new BadRequestException('Enter the child\'s real date of birth.');

      let app: any;
      try {
        app = await this.admissions.create({
          academicYearId: cycle.academicYearId,
          admissionCycleId: cycle.id,
          applyingForClassId: dto.applyingForClassId,
          applicantFirstName: dto.applicantFirstName.trim(),
          applicantLastName: dto.applicantLastName.trim(),
          applicantDob: dto.applicantDob,
          applicantGender: dto.applicantGender,
          address: dto.address,
          sourceOfEnquiry: 'online',
          customFields: dto.previousSchool ? { previousSchool: dto.previousSchool } : {},
          guardians: [{
            firstName: dto.guardian.firstName.trim(),
            lastName: dto.guardian.lastName.trim(),
            relationship: dto.guardian.relationship,
            phone: dto.guardian.phone,
            email: dto.guardian.email.trim().toLowerCase(),
            isPrimary: true,
            financiallyResponsible: true,
          }],
        } as any);
      } catch (err) {
        if (err instanceof ConflictException) {
          throw new ConflictException('An application for this child is already with the school. Please contact the admissions office.');
        }
        throw err;
      }

      const link = await this.portal.issueAccessLink(app.id, dto.guardian.email.trim().toLowerCase());
      return {
        received: true,
        applicationNumber: app.applicationNumber,
        trackingLinkSentTo: maskEmail(dto.guardian.email.trim().toLowerCase()),
        // Only outside production, so tests and demos can follow the link.
        devToken: (link as any).devToken,
      };
    });
  }

  /** Attach one document to the token's application. */
  async uploadDocument(token: string, type: string, file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    if (!DOC_MIME.has(file.mimetype)) throw new BadRequestException('Upload a PDF, JPG or PNG.');
    if (file.size > DOC_MAX_BYTES) throw new BadRequestException('That file is over 10 MB.');
    if (!(DOC_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Choose what the document is.');

    const { organizationId, applicationId } = await this.portal.resolveToken(token);
    return this.asApplicant(organizationId, async () => {
      const app = await this.prisma.client.admissionApplication.findFirst({
        where: { id: applicationId },
        select: { status: true, _count: { select: { documents: true } } },
      });
      if (!app) throw new NotFoundException('Application not found');
      if (CLOSED_STATUSES.has(app.status)) throw new BadRequestException('This application is closed to new documents.');
      if (app._count.documents >= DOC_MAX_PER_APPLICATION) {
        throw new BadRequestException('This application already has the maximum number of documents. Contact the school.');
      }
      const stored = await this.files.upload({
        filename: file.originalname,
        contentType: file.mimetype,
        buffer: file.buffer,
        ownerType: 'AdmissionApplication',
        ownerId: applicationId,
      });
      const doc = await this.admissions.addDocument(applicationId, type, stored.id, false);
      return { id: doc.id, type: doc.type, uploadedAt: doc.uploadedAt };
    });
  }
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}
