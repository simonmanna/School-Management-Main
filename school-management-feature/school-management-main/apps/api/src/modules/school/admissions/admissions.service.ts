import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdmissionApplication } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type { AddExamScoreDto, CreateApplicationDto, EnrollApplicationDto, UpdateApplicationDto } from './dto.types';
import { PeopleModule } from '../people/people.module';

/**
 * P0-7 (C8): hand-rolled admission state machine.
 *
 *   submitted → under_review → exam_scheduled → accepted → enrolled
 *      ↘           ↘               ↘
 *      withdraw    reject         reject
 *      ↘           ↘               ↘
 *       withdrawn  rejected        withdrawn
 *
 * Terminal states (rejected / withdrawn / enrolled) cannot be moved
 * out of. `review()` looks up the current status and validates the
 * requested action before writing.
 */
const ADMISSION_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  submitted: ['review', 'withdraw'],
  under_review: ['review', 'schedule_exam', 'accept', 'reject', 'withdraw'],
  exam_scheduled: ['accept', 'reject', 'withdraw'],
  accepted: ['withdraw'],   // enroll() is the only way out, not review()
  rejected: [],
  withdrawn: [],
  enrolled: [],
};

/**
 * AdmissionsService — drives the admission workflow.
 *
 * The `enroll` action creates the actual StudentPartner + StudentProfile + Enrollment
 * in a single transaction. After enrollment the student appears on the class roster.
 */
@Injectable()
export class AdmissionsService extends BaseCrudService<AdmissionApplication, CreateApplicationDto, UpdateApplicationDto> {
  protected readonly entityName = 'AdmissionApplication';
  protected readonly searchFields: string[] = ['applicationNumber', 'applicantFirstName', 'applicantLastName'];
  protected readonly defaultInclude = {
    academicYear: true,
    documents: true,
    entranceExams: { include: { subject: true } },
    waitingList: true,
    enrollment: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
  ) {
    super(prisma.client.admissionApplication as unknown as CrudDelegate);
  }

  async create(dto: CreateApplicationDto): Promise<AdmissionApplication> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;

      // P0-7 (C7): duplicate-application guard. A parent can no longer
      // submit the same child twice in a year — we match on
      // (academicYearId, normalizedFirstName, normalizedLastName,
      // applicantDob). Names are normalized to lowercase + trimmed
      // so "Alice" and "ALICE " don't slip through.
      const normalizedFirst = dto.applicantFirstName.trim().toLowerCase();
      const normalizedLast = dto.applicantLastName.trim().toLowerCase();
      const dob = dto.applicantDob ? new Date(dto.applicantDob) : null;

      const existing = await tx.admissionApplication.findFirst({
        where: {
          organizationId,
          academicYearId: dto.academicYearId,
          // Prisma's `equals` + `mode: 'insensitive'` handles the
          // case-insensitive name match. We also filter on
          // applicantDob so that two applicants with the same name
          // but different DoBs are NOT flagged as duplicates.
          applicantFirstName: { equals: dto.applicantFirstName.trim(), mode: 'insensitive' },
          applicantLastName: { equals: dto.applicantLastName.trim(), mode: 'insensitive' },
          ...(dob
            ? { applicantDob: dob }
            : { applicantDob: null }),
        },
      });
      if (existing) {
        throw new BadRequestException(
          `An application already exists for ${dto.applicantFirstName} ${dto.applicantLastName}` +
            ` in this academic year (${existing.applicationNumber}).`,
        );
      }

      const applicationNumber = await this.sequence.next(
        `admission:${new Date().getUTCFullYear()}`,
        { prefix: 'APP-', padding: 6 },
        tx,
      );
      const row = await tx.admissionApplication.create({
        data: {
          organizationId,
          academicYearId: dto.academicYearId,
          applicationNumber,
          applicantFirstName: dto.applicantFirstName,
          applicantLastName: dto.applicantLastName,
          applicantDob: dob,
          applicantGender: dto.applicantGender ?? null,
          applyingForClassId: dto.applyingForClassId ?? null,
          parentContactId: dto.parentContactId ?? null,
          customFields: dto.customFields ?? {},
          status: 'submitted',
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: row.id,
        action: 'create',
        newValues: row,
      });
      this.events.publish(EVENTS.AdmissionSubmitted, {
        organizationId,
        applicationId: row.id,
        applicationNumber: row.applicationNumber,
      });
      // Silence "unused variable" warnings for the normalized form
      // (kept for future expansion — the same normalization can be
      // applied to customFields free-text values).
      void normalizedFirst;
      void normalizedLast;
      return row;
    });
  }

  /**
   * Enroll an accepted application. This is the keystone side-effect of the
   * admissions workflow: it creates a Partner(isCustomer=true), StudentProfile,
   * and an Enrollment row in one transaction. After this, the student is fully
   * on the books and appears on the class roster.
   */
  async enroll(dto: EnrollApplicationDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const app = await tx.admissionApplication.findFirst({ where: { id: dto.applicationId } });
      if (!app) throw new NotFoundException(`Application ${dto.applicationId} not found`);
      if (app.status !== 'accepted') {
        throw new NotFoundException(`Application ${dto.applicationId} is not accepted (status=${app.status})`);
      }

      // 1) Create Partner.
      const code = await this.sequence.next(
        `student:${new Date().getUTCFullYear()}`,
        { prefix: 'STU-', padding: 6 },
        tx,
      );
      const partner = await tx.partner.create({
        data: {
          organizationId,
          code,
          name: dto.student.name,
          isCustomer: true,
          email: dto.student.email ?? null,
          phone: dto.student.phone ?? null,
          customFields: {
            dateOfBirth: dto.student.dateOfBirth ?? null,
            gender: dto.student.gender ?? null,
            nationality: dto.student.nationality ?? null,
            religion: dto.student.religion ?? null,
            house: dto.student.house ?? null,
          },
        },
      });

      // 2) Create StudentProfile.
      const profile = await tx.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: app.applicationNumber,
          currentClassId: dto.classId,
          currentSectionId: dto.sectionId ?? null,
          enrollmentDate: new Date(),
          dateOfBirth: dto.student.dateOfBirth ? new Date(dto.student.dateOfBirth) : null,
          gender: dto.student.gender ?? null,
          nationality: dto.student.nationality ?? null,
          religion: dto.student.religion ?? null,
          residenceType: dto.student.residenceType ?? 'day',
          house: dto.student.house ?? null,
        },
      });

      // 3) Create Enrollment for the requested term.
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId,
          applicationId: app.id,
          studentProfileId: profile.id,
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          termId: dto.termId,
          rollNumber: dto.rollNumber,
        },
      });

      // 4) Update application status.
      await tx.admissionApplication.updateMany({
        where: { id: app.id },
        data: { status: 'enrolled' },
      });

      // 5) Move application.status history (the engine's transition action).
      // The WorkflowService.transition wraps this but we run inside our own tx
      // for atomicity with the side-effects. The audit + event still go through.
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: app.id,
        action: 'enroll' as any,
        newValues: { studentProfileId: profile.id, enrollmentId: enrollment.id },
      });
      this.events.publish(EVENTS.AdmissionEnrolled, {
        organizationId,
        applicationId: app.id,
        studentProfileId: profile.id,
        classId: dto.classId,
        termId: dto.termId,
      });
      this.events.publish(EVENTS.StudentCreated, {
        organizationId,
        studentProfileId: profile.id,
        partnerId: partner.id,
        admissionNo: profile.admissionNo,
      });

      return { studentProfile: profile, partner, enrollment, application: { ...app, status: 'enrolled' } };
    });
  }

  async addExamScore(dto: AddExamScoreDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: dto.applicationId } });
      if (!app) throw new NotFoundException(`Application ${dto.applicationId} not found`);
      const row = await tx.entranceExam.upsert({
        where: {
          applicationId_subjectId: {
            applicationId: dto.applicationId,
            subjectId: dto.subjectId,
          } as any,
        },
        create: {
          organizationId: app.organizationId,
          applicationId: dto.applicationId,
          subjectId: dto.subjectId,
          score: dto.score,
          maxScore: dto.maxScore ?? 100,
          grade: dto.grade ?? null,
          notes: dto.notes ?? null,
          enteredAt: new Date(),
          enteredById: this.tenant.userId ?? null,
        },
        update: {
          score: dto.score,
          maxScore: dto.maxScore ?? 100,
          grade: dto.grade ?? null,
          notes: dto.notes ?? null,
          enteredAt: new Date(),
          enteredById: this.tenant.userId ?? null,
        },
      });
      return row;
    });
  }

  async review(applicationId: string, action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw', notes?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const statusMap: Record<string, string> = {
        review: 'under_review',
        accept: 'accepted',
        reject: 'rejected',
        schedule_exam: 'exam_scheduled',
        withdraw: 'withdrawn',
      };
      const newStatus = statusMap[action];
      if (!newStatus) {
        throw new BadRequestException(`Unknown admission action: ${action}`);
      }

      const before = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!before) throw new NotFoundException(`Application ${applicationId} not found`);

      // P0-7 (C8): state machine guard. The old code blindly wrote
      // whatever status the caller asked for. The new code checks
      // that the requested action is allowed from the current
      // status. Rejected/withdrawn/enrolled are terminal.
      const allowed = ADMISSION_TRANSITIONS[before.status] ?? [];
      if (!allowed.includes(action)) {
        throw new BadRequestException(
          `Cannot ${action} an application in status '${before.status}'. ` +
            `Allowed actions from '${before.status}': [${allowed.join(', ') || '(none — terminal)'}].`,
        );
      }

      const updated = await tx.admissionApplication.updateMany({
        where: { id: applicationId },
        data: { status: newStatus, decisionNotes: notes ?? null },
      });
      if (updated.count === 0) throw new NotFoundException(`Application ${applicationId} not found`);
      const after = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: applicationId,
        action: action as any,
        oldValues: { status: before.status },
        newValues: { status: newStatus, notes },
      });
      this.events.publish(
        ({
          review: EVENTS.AdmissionUnderReview,
          accept: EVENTS.AdmissionAccepted,
          reject: EVENTS.AdmissionRejected,
          schedule_exam: EVENTS.AdmissionExamScheduled,
          withdraw: EVENTS.AdmissionWithdrawn,
        } as Record<string, string>)[action] as any,
        {
          organizationId: this.tenant.organizationId,
          applicationId,
          reason: notes,
        },
      );
      return after;
    });
  }

  async addDocument(applicationId: string, type: string, fileUrl: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      return tx.applicationDocument.create({
        data: {
          organizationId: app.organizationId,
          applicationId,
          type,
          fileUrl,
        },
      });
    });
  }

  async verifyDocument(documentId: string, verified: boolean) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.applicationDocument.updateMany({
        where: { id: documentId },
        data: {
          verified,
          verifiedById: this.tenant.userId ?? null,
          verifiedAt: verified ? new Date() : null,
        },
      });
      if (res.count === 0) throw new NotFoundException(`Document ${documentId} not found`);
    });
  }

  async byStatus(status: string) {
    return this.prisma.client.admissionApplication.findMany({
      where: { status: status as any },
      orderBy: { submittedAt: 'desc' },
    });
  }
}