import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdmissionApplication } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  AddExamScoreDto,
  BulkEnrollDto,
  ChargeFeeDto,
  CreateApplicationDto,
  EnrollApplicationDto,
  IssueOfferDto,
  ReEnrollDto,
  ScheduleInterviewDto,
  ScoreApplicationDto,
  TransferInDto,
  UpdateApplicationDto,
  WithdrawStudentDto,
} from './dto.types';
import { PeopleModule } from '../people/people.module';

/**
 * Student lifecycle FSM (mirror of people/student.service.ts) used by
 * withdrawStudent() and reEnroll(). Kept local to avoid a cross-module import.
 */
const STUDENT_STATUS_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  active: ['suspended', 'transferred', 'withdrawn', 'alumni'],
  suspended: ['active', 'withdrawn', 'transferred'],
  withdrawn: ['active', 'transferred'],
  transferred: [],
  alumni: [],
};

/**
 * P0-7 (C8): hand-rolled admission state machine.
 *
 * Extended lifecycle (Application → Screening → Interview → Admission → Enrollment):
 *
 *   submitted → under_review → screening → interview_scheduled → interviewed
 *        ↘          ↘              ↘                ↘                   ↘
 *       withdraw   reject       reject          reschedule           (exam_scheduled)
 *                                                        ↘
 *                                                    interview_scheduled
 *   interviewed → scored → accepted → offer_issued → offer_accepted → enrolled
 *                    ↘         ↘            ↘
 *                   reject   waitlisted    waitlisted → offer_issued
 *                              ↘
 *                            offer_issued → offer_accepted → enrolled
 *   accepted → withdraw → withdrawn (terminal)
 *   offer_issued → decline_offer → waitlisted | withdrawn
 *
 * Terminal states (rejected / withdrawn / enrolled) cannot be moved out of.
 * `review()` looks up the current status and validates the requested action
 * before writing. The WorkflowRegistry in school.module.ts mirrors this for
 * documentation/other consumers.
 */
const ADMISSION_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  submitted: ['review', 'withdraw'],
  under_review: ['review', 'screen', 'schedule_exam', 'accept', 'reject', 'withdraw'],
  screening: ['schedule_interview', 'schedule_exam', 'reject', 'withdraw'],
  interview_scheduled: ['schedule_interview', 'complete_interview', 'reschedule', 'reject', 'withdraw'],
  interviewed: ['schedule_exam', 'exam_done', 'score', 'accept', 'reject', 'withdraw'],
  scored: ['accept', 'reject', 'withdraw'],
  exam_scheduled: ['exam_done', 'accept', 'reject', 'withdraw'],
  accepted: ['waitlist', 'issue_offer', 'withdraw'],
  waitlisted: ['issue_offer', 'withdraw'],
  offer_issued: ['accept_offer', 'decline_offer'],
  offer_accepted: ['enroll'],
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
      this.events.publish(EVENTS.SchoolAdmissionSubmitted, {
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
   * Shared student-record factory used by enroll(), bulkEnroll(), transferIn(),
   * and reEnroll(). Creates the Partner + StudentProfile + Enrollment atomically
   * inside the caller's transaction. `student` carries the personalia; the
   * `applicationId` (when present) links the Enrollment back to the application.
   */
  private async createStudentRecords(
    tx: any,
    organizationId: string,
    args: {
      applicationId?: string | null;
      name: string;
      email?: string | null;
      phone?: string | null;
      dateOfBirth?: string | null;
      gender?: string | null;
      nationality?: string | null;
      religion?: string | null;
      house?: string | null;
      residenceType?: string;
      admissionNo?: string;
      classId: string;
      sectionId?: string | null;
      termId: string;
      rollNumber: string;
      customFields?: Record<string, unknown>;
    },
  ) {
    const code = await this.sequence.next(
      `student:${new Date().getUTCFullYear()}`,
      { prefix: 'STU-', padding: 6 },
      tx,
    );
    const partner = await tx.partner.create({
      data: {
        organizationId,
        code,
        name: args.name,
        isCompany: false,
        isCustomer: true,
        email: args.email ?? null,
        phone: args.phone ?? null,
        customFields: {
          dateOfBirth: args.dateOfBirth ?? null,
          gender: args.gender ?? null,
          nationality: args.nationality ?? null,
          religion: args.religion ?? null,
          house: args.house ?? null,
        },
      },
    });
    const profile = await tx.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: args.admissionNo ?? code,
        currentClassId: args.classId,
        currentSectionId: args.sectionId ?? null,
        enrollmentDate: new Date(),
        dateOfBirth: args.dateOfBirth ? new Date(args.dateOfBirth) : null,
        gender: args.gender ?? null,
        nationality: args.nationality ?? null,
        religion: args.religion ?? null,
        residenceType: args.residenceType ?? 'day',
        house: args.house ?? null,
        customFields: args.customFields ?? {},
      },
    });
    const enrollment = await tx.enrollment.create({
      data: {
        organizationId,
        applicationId: args.applicationId ?? null,
        studentProfileId: profile.id,
        classId: args.classId,
        sectionId: args.sectionId ?? null,
        termId: args.termId,
        rollNumber: args.rollNumber,
      },
    });
    await this.audit.recordInTx(tx, {
      entity: 'StudentProfile',
      entityId: profile.id,
      action: 'create',
      newValues: { partner, profile, enrollment },
    });
    this.events.publish(EVENTS.SchoolStudentCreated, {
      organizationId,
      studentProfileId: profile.id,
      partnerId: partner.id,
      admissionNo: profile.admissionNo,
    });
    return { partner, profile, enrollment };
  }

  /**
   * Enroll an offer_accepted application. This is the keystone side-effect of the
   * admissions workflow: it creates a Partner(isCustomer=true), StudentProfile,
   * and an Enrollment row in one transaction. After this, the student is fully
   * on the books and appears on the class roster.
   */
  async enroll(dto: EnrollApplicationDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const app = await tx.admissionApplication.findFirst({ where: { id: dto.applicationId } });
      if (!app) throw new NotFoundException(`Application ${dto.applicationId} not found`);
      if (app.status !== 'offer_accepted') {
        throw new NotFoundException(`Application ${dto.applicationId} is not ready to enroll (status=${app.status}; expected 'offer_accepted')`);
      }

      const { profile, partner, enrollment } = await this.createStudentRecords(tx, organizationId, {
        applicationId: app.id,
        name: dto.student.name,
        email: dto.student.email ?? null,
        phone: dto.student.phone ?? null,
        dateOfBirth: dto.student.dateOfBirth ?? null,
        gender: dto.student.gender ?? null,
        nationality: dto.student.nationality ?? null,
        religion: dto.student.religion ?? null,
        house: dto.student.house ?? null,
        residenceType: dto.student.residenceType ?? 'day',
        admissionNo: app.applicationNumber,
        classId: dto.classId,
        sectionId: dto.sectionId ?? null,
        termId: dto.termId,
        rollNumber: dto.rollNumber,
      });

      await tx.admissionApplication.updateMany({ where: { id: app.id }, data: { status: 'enrolled' } });

      this.events.publish(EVENTS.SchoolAdmissionEnrolled, {
        organizationId,
        applicationId: app.id,
        studentProfileId: profile.id,
        classId: dto.classId,
        termId: dto.termId,
      });

      return { studentProfile: profile, partner, enrollment, application: { ...app, status: 'enrolled' } };
    });
  }

  /**
   * Bulk enroll a set of offer_accepted applications in one transaction.
   * Each item that is not in `offer_accepted` is skipped and reported in
   * `skipped`; the rest are enrolled via createStudentRecords.
   */
  async bulkEnroll(dto: BulkEnrollDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const enrolled: any[] = [];
      const skipped: Array<{ applicationId: string; reason: string }> = [];

      for (const item of dto.items) {
        const app = await tx.admissionApplication.findFirst({ where: { id: item.applicationId } });
        if (!app) {
          skipped.push({ applicationId: item.applicationId, reason: 'not found' });
          continue;
        }
        if (app.status !== 'offer_accepted') {
          skipped.push({ applicationId: item.applicationId, reason: `status=${app.status} (expected offer_accepted)` });
          continue;
        }
        const { profile, enrollment } = await this.createStudentRecords(tx, organizationId, {
          applicationId: app.id,
          name: item.student.name,
          email: item.student.email ?? null,
          phone: item.student.phone ?? null,
          dateOfBirth: item.student.dateOfBirth ?? null,
          gender: item.student.gender ?? null,
          nationality: item.student.nationality ?? null,
          religion: item.student.religion ?? null,
          house: item.student.house ?? null,
          residenceType: item.student.residenceType ?? 'day',
          admissionNo: app.applicationNumber,
          classId: item.classId,
          sectionId: item.sectionId ?? null,
          termId: item.termId,
          rollNumber: item.rollNumber,
        });
        await tx.admissionApplication.updateMany({ where: { id: app.id }, data: { status: 'enrolled' } });
        this.events.publish(EVENTS.SchoolAdmissionEnrolled, {
          organizationId,
          applicationId: app.id,
          studentProfileId: profile.id,
          classId: item.classId,
          termId: item.termId,
        });
        enrolled.push({ applicationId: app.id, studentProfileId: profile.id, enrollmentId: enrollment.id });
      }

      return { enrolled, skipped };
    });
  }

  /**
   * Schedule an interview for an application in `screening` or
   * `interview_scheduled`. If rating/recommendation/panelNotes are supplied in
   * the same call, the interview is recorded as completed (complete_interview).
   */
  async scheduleInterview(applicationId: string, dto: ScheduleInterviewDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'schedule_interview');

      const interview = await tx.interview.upsert({
        where: { applicationId },
        create: {
          organizationId: app.organizationId,
          applicationId,
          interviewerId: dto.interviewerId ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          rating: dto.rating ?? null,
          recommendation: dto.recommendation ?? null,
          panelNotes: dto.panelNotes ?? null,
          completedAt: dto.rating != null || dto.recommendation || dto.panelNotes ? new Date() : null,
        },
        update: {
          interviewerId: dto.interviewerId ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          rating: dto.rating ?? null,
          recommendation: dto.recommendation ?? null,
          panelNotes: dto.panelNotes ?? null,
          completedAt: dto.rating != null || dto.recommendation || dto.panelNotes ? new Date() : null,
        },
      });

      // Move the application forward only if it carries a completed outcome.
      if (interview.completedAt) {
        await this.applyReview(tx, applicationId, 'complete_interview');
      } else {
        await this.applyReview(tx, applicationId, 'schedule_interview');
      }
      return interview;
    });
  }

  /** Record an interview outcome (rating, recommendation, notes). */
  async completeInterview(applicationId: string, dto: ScheduleInterviewDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'complete_interview');
      const interview = await tx.interview.upsert({
        where: { applicationId },
        create: {
          organizationId: app.organizationId,
          applicationId,
          interviewerId: dto.interviewerId ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          rating: dto.rating ?? null,
          recommendation: dto.recommendation ?? null,
          panelNotes: dto.panelNotes ?? null,
          completedAt: new Date(),
        },
        update: {
          interviewerId: dto.interviewerId ?? null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          rating: dto.rating ?? null,
          recommendation: dto.recommendation ?? null,
          panelNotes: dto.panelNotes ?? null,
          completedAt: new Date(),
        },
      });
      await this.applyReview(tx, applicationId, 'complete_interview');
      return interview;
    });
  }

  /**
   * Compute the aggregate applicant score from entrance exams, the interview,
   * and document completeness. Equal-weight default; extend with per-school
   * weights later. Requires the application to be in `scored`-eligible state
   * (interviewed / exam_scheduled / scored).
   */
  async scoreApplication(applicationId: string, dto: ScoreApplicationDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'score');

      const examRows = await tx.entranceExam.findMany({ where: { applicationId } });
      const examScore = examRows.length
        ? examRows.reduce((s: number, e: any) => s + Number(e.score ?? 0), 0) / examRows.length
        : dto.examScore ?? 0;
      const interview = await tx.interview.findFirst({ where: { applicationId } });
      const interviewScore = interview?.rating != null ? Number(interview.rating) * 20 : dto.interviewScore ?? 0;
      const docs = await tx.applicationDocument.findMany({ where: { applicationId } });
      const documentScore = docs.length
        ? (docs.filter((d: any) => d.verified).length / docs.length) * 100
        : dto.documentScore ?? 0;
      const totalScore = Math.round(((examScore + interviewScore + documentScore) / 3) * 100) / 100;

      const score = await tx.applicantScore.upsert({
        where: { applicationId },
        create: {
          organizationId: app.organizationId,
          applicationId,
          examScore,
          interviewScore,
          documentScore,
          totalScore,
        },
        update: { examScore, interviewScore, documentScore, totalScore },
      });
      await this.applyReview(tx, applicationId, 'score');
      return score;
    });
  }

  /** Issue an offer letter. Requires the application to be `accepted` or `waitlisted`. */
  async issueOffer(applicationId: string, dto: IssueOfferDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'issue_offer');
      const offer = await tx.offerLetter.upsert({
        where: { applicationId },
        create: {
          organizationId: app.organizationId,
          applicationId,
          templateId: dto.templateId ?? null,
          body: dto.body ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          status: 'issued',
        },
        update: {
          templateId: dto.templateId ?? null,
          body: dto.body ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          status: 'issued',
        },
      });
      await this.applyReview(tx, applicationId, 'issue_offer');
      return offer;
    });
  }

  async acceptOffer(applicationId: string) {
    return this.applyReview(this.prisma.client, applicationId, 'accept_offer');
  }

  async declineOffer(applicationId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'decline_offer');
      await tx.offerLetter.updateMany({ where: { applicationId }, data: { status: 'declined', acceptedAt: null } });
      return this.applyReview(tx, applicationId, 'decline_offer');
    });
  }

  /**
   * Charge the application fee by issuing a sales_invoice Document (reusing the
   * invoicing/accounting stack — zero new accounting code). Sets feeStatus to
   * 'pending' and links the invoice. The fee becomes 'paid' when the invoice is
   * settled (see markFeePaid / payment webhook).
   */
  async chargeApplicationFee(applicationId: string, dto: ChargeFeeDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      if (app.feeStatus === 'paid') {
        throw new BadRequestException(`Application ${applicationId} fee already paid`);
      }
      const documentNumber = await this.sequence.next(
        `admfee:${new Date().getUTCFullYear()}`,
        { prefix: 'ADMFEE-', padding: 6 },
        tx,
      );
      const invoice = await tx.document.create({
        data: {
          organizationId: app.organizationId,
          documentNumber,
          documentType: 'sales_invoice',
          documentTypeId: await this.resolveDmsTypeId(tx, 'sales_invoice'),
          partnerId: app.parentContactId,
          issueDate: new Date(),
          dueDate: new Date(),
          status: 'draft',
          reference: `ADMISSION-FEE-${app.applicationNumber}`,
          notes: `Application fee for ${app.applicantFirstName} ${app.applicantLastName}`,
          sourceType: 'school_admission_fee',
          sourceId: app.id,
          subtotal: dto.amount,
          totalAmount: dto.amount,
          amountResidual: dto.amount,
          paymentStatus: 'not_paid',
        },
      });
      await tx.admissionFee.upsert({
        where: { applicationId },
        create: {
          organizationId: app.organizationId,
          applicationId,
          amount: dto.amount,
          invoiceId: invoice.id,
        },
        update: { amount: dto.amount, invoiceId: invoice.id, paid: false, paidAt: null },
      });
      await tx.admissionApplication.updateMany({
        where: { id: applicationId },
        data: { feeStatus: 'pending', feeInvoiceId: invoice.id },
      });
      this.events.publish(EVENTS.SchoolAdmissionFeeInvoiced, {
        organizationId: app.organizationId,
        applicationId,
        invoiceId: invoice.id,
      });
      return { invoiceId: invoice.id, documentNumber: invoice.documentNumber, amount: dto.amount };
    });
  }

  /** Mark the application fee paid (called by payment settlement / webhook). */
  async markFeePaid(applicationId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      await tx.admissionFee.updateMany({ where: { applicationId }, data: { paid: true, paidAt: new Date() } });
      await tx.admissionApplication.updateMany({ where: { id: applicationId }, data: { feeStatus: 'paid' } });
      return { applicationId, feeStatus: 'paid' };
    });
  }

  /**
   * Transfer an already-enrolled student IN from another school. Creates the
   * Partner + StudentProfile + Enrollment directly (no application). The
   * profile starts 'active' and records transferredFrom in customFields.
   */
  async transferIn(dto: TransferInDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const { profile, enrollment } = await this.createStudentRecords(tx, organizationId, {
        name: dto.name,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        gender: dto.gender ?? null,
        nationality: dto.nationality ?? null,
        religion: dto.religion ?? null,
        house: dto.house ?? null,
        residenceType: dto.residenceType ?? 'day',
        admissionNo: dto.admissionNo ?? undefined,
        classId: dto.classId,
        sectionId: dto.sectionId ?? null,
        termId: dto.termId,
        rollNumber: dto.rollNumber,
        customFields: { transferredFrom: dto.transferredFrom ?? null },
      });
      return { studentProfile: profile, enrollment };
    });
  }

  /** Withdraw an active/transferred student. Writes StudentStatusHistory + Enrollment status. */
  async withdrawStudent(studentProfileId: string, dto: WithdrawStudentDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const profile = await tx.studentProfile.findFirst({ where: { id: studentProfileId } });
      if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);
      const allowed = STUDENT_STATUS_TRANSITIONS[profile.status] ?? [];
      if (!allowed.includes('withdrawn')) {
        throw new BadRequestException(
          `Cannot withdraw student with status '${profile.status}'. Allowed: [${allowed.join(', ') || '(none — terminal)'}].`,
        );
      }
      await tx.studentStatusHistory.create({
        data: {
          organizationId: profile.organizationId,
          studentProfileId,
          fromStatus: profile.status,
          toStatus: 'withdrawn',
          reason: dto.reason,
          changedById: this.tenant.userId ?? null,
        },
      });
      await tx.studentProfile.updateMany({ where: { id: studentProfileId }, data: { status: 'withdrawn' } });
      await tx.enrollment.updateMany({
        where: { studentProfileId, status: 'enrolled' },
        data: { status: 'withdrawn', withdrawnAt: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date() },
      });
      this.events.publish(EVENTS.SchoolStudentStatusChanged, {
        organizationId: this.tenant.organizationId,
        studentProfileId,
        fromStatus: profile.status,
        toStatus: 'withdrawn',
      });
      return { studentProfileId, status: 'withdrawn' };
    });
  }

  /** Re-enroll a withdrawn/alumni student into a new term (new Enrollment; profile back to active). */
  async reEnroll(studentProfileId: string, dto: ReEnrollDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const profile = await tx.studentProfile.findFirst({ where: { id: studentProfileId } });
      if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);
      const allowed = STUDENT_STATUS_TRANSITIONS[profile.status] ?? [];
      if (!allowed.includes('active')) {
        throw new BadRequestException(
          `Cannot re-enroll student with status '${profile.status}'. Allowed: [${allowed.join(', ') || '(none — terminal)'}].`,
        );
      }
      const existing = await tx.enrollment.findFirst({
        where: { studentProfileId, termId: dto.termId, classId: dto.classId },
      });
      if (existing) {
        throw new BadRequestException(`Student already has an enrollment for this term/class`);
      }
      const enrollment = await tx.enrollment.create({
        data: {
          organizationId: profile.organizationId,
          studentProfileId,
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          termId: dto.termId,
          rollNumber: dto.rollNumber,
          status: 'enrolled',
        },
      });
      await tx.studentStatusHistory.create({
        data: {
          organizationId: profile.organizationId,
          studentProfileId,
          fromStatus: profile.status,
          toStatus: 'active',
          reason: 're-enrollment',
          changedById: this.tenant.userId ?? null,
        },
      });
      await tx.studentProfile.updateMany({ where: { id: studentProfileId }, data: { status: 'active', currentClassId: dto.classId, currentSectionId: dto.sectionId ?? null } });
      this.events.publish(EVENTS.SchoolStudentStatusChanged, {
        organizationId: this.tenant.organizationId,
        studentProfileId,
        fromStatus: profile.status,
        toStatus: 'active',
      });
      return { studentProfileId, enrollmentId: enrollment.id, status: 'active' };
    });
  }

  /**
   * Apply a `review()`-style transition (status change + audit + event) inside
   * an existing transaction. Shared by the interview/score/offer helpers so the
   * FSM guard + audit trail stay consistent with review().
   */
  private async applyReview(tx: any, applicationId: string, action: string) {
    const statusMap: Record<string, string> = {
      review: 'under_review',
      screen: 'screening',
      schedule_interview: 'interview_scheduled',
      complete_interview: 'interviewed',
      reschedule: 'interview_scheduled',
      schedule_exam: 'exam_scheduled',
      exam_done: 'interviewed',
      score: 'scored',
      accept: 'accepted',
      reject: 'rejected',
      waitlist: 'waitlisted',
      issue_offer: 'offer_issued',
      accept_offer: 'offer_accepted',
      decline_offer: 'waitlisted',
      withdraw: 'withdrawn',
    };
    const newStatus = statusMap[action];
    const before = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!before) throw new NotFoundException(`Application ${applicationId} not found`);
    this.assertTransition(before.status, action);
    await tx.admissionApplication.updateMany({ where: { id: applicationId }, data: { status: newStatus } });
    await this.audit.recordInTx(tx, {
      entity: 'AdmissionApplication',
      entityId: applicationId,
      action: 'update' as const,
      oldValues: { status: before.status },
      newValues: { status: newStatus, action },
    });
    this.events.publish(
      (
        {
          review: EVENTS.SchoolAdmissionUnderReview,
          screen: EVENTS.SchoolAdmissionScreened,
          schedule_interview: EVENTS.SchoolAdmissionInterviewScheduled,
          complete_interview: EVENTS.SchoolAdmissionInterviewed,
          reschedule: EVENTS.SchoolAdmissionInterviewScheduled,
          schedule_exam: EVENTS.SchoolAdmissionExamScheduled,
          exam_done: EVENTS.SchoolAdmissionInterviewed,
          score: EVENTS.SchoolAdmissionScored,
          accept: EVENTS.SchoolAdmissionAccepted,
          reject: EVENTS.SchoolAdmissionRejected,
          waitlist: EVENTS.SchoolAdmissionWaitlisted,
          issue_offer: EVENTS.SchoolAdmissionOfferIssued,
          accept_offer: EVENTS.SchoolAdmissionOfferAccepted,
          decline_offer: EVENTS.SchoolAdmissionOfferDeclined,
          withdraw: EVENTS.SchoolAdmissionWithdrawn,
        } as Record<string, string>
      )[action] as any,
      { organizationId: this.tenant.organizationId, applicationId, reason: action },
    );
    return { id: applicationId, status: newStatus };
  }

  /** Reusable FSM guard that throws BadRequestException on an illegal transition. */
  private assertTransition(current: string, action: string) {
    const allowed = ADMISSION_TRANSITIONS[current] ?? [];
    if (!allowed.includes(action)) {
      throw new BadRequestException(
        `Cannot ${action} an application in status '${current}'. ` +
          `Allowed actions from '${current}': [${allowed.join(', ') || '(none — terminal)'}].`,
      );
    }
  }

  /** Resolve a DMS document-type id within a transaction. */
  private async resolveDmsTypeId(tx: any, code: string): Promise<string> {
    const row = await tx.documentTypeDef.findFirst({ where: { code } });
    if (!row) throw new BadRequestException(`DMS document type '${code}' not registered`);
    return row.id;
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

  async review(applicationId: string, action:
    | 'review' | 'screen' | 'schedule_interview' | 'complete_interview' | 'reschedule'
    | 'schedule_exam' | 'exam_done' | 'score' | 'accept' | 'reject' | 'waitlist'
    | 'issue_offer' | 'accept_offer' | 'decline_offer' | 'withdraw', notes?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const statusMap: Record<string, string> = {
        review: 'under_review',
        screen: 'screening',
        schedule_interview: 'interview_scheduled',
        complete_interview: 'interviewed',
        reschedule: 'interview_scheduled',
        schedule_exam: 'exam_scheduled',
        exam_done: 'interviewed',
        score: 'scored',
        accept: 'accepted',
        reject: 'rejected',
        waitlist: 'waitlisted',
        issue_offer: 'offer_issued',
        accept_offer: 'offer_accepted',
        decline_offer: 'waitlisted',
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
      // Map the admission transition to a valid AuditAction enum value — the
      // raw action ('review'/'accept'/...) is not one, so the audit write threw
      // a Prisma validation error and rolled back the whole transition. The
      // domain action is preserved in newValues.
      const auditAction: 'update' | 'approve' | 'reject' | 'cancel' = (
        {
          review: 'update',
          screen: 'update',
          schedule_interview: 'update',
          complete_interview: 'update',
          reschedule: 'update',
          schedule_exam: 'update',
          exam_done: 'update',
          score: 'update',
          accept: 'approve',
          reject: 'reject',
          waitlist: 'update',
          issue_offer: 'update',
          accept_offer: 'approve',
          decline_offer: 'cancel',
          withdraw: 'cancel',
        } as const
      )[action];
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: applicationId,
        action: auditAction,
        oldValues: { status: before.status },
        newValues: { status: newStatus, action, notes },
      });
      this.events.publish(
        (
          {
            review: EVENTS.SchoolAdmissionUnderReview,
            screen: EVENTS.SchoolAdmissionScreened,
            schedule_interview: EVENTS.SchoolAdmissionInterviewScheduled,
            complete_interview: EVENTS.SchoolAdmissionInterviewed,
            reschedule: EVENTS.SchoolAdmissionInterviewScheduled,
            schedule_exam: EVENTS.SchoolAdmissionExamScheduled,
            exam_done: EVENTS.SchoolAdmissionInterviewed,
            score: EVENTS.SchoolAdmissionScored,
            accept: EVENTS.SchoolAdmissionAccepted,
            reject: EVENTS.SchoolAdmissionRejected,
            waitlist: EVENTS.SchoolAdmissionWaitlisted,
            issue_offer: EVENTS.SchoolAdmissionOfferIssued,
            accept_offer: EVENTS.SchoolAdmissionOfferAccepted,
            decline_offer: EVENTS.SchoolAdmissionOfferDeclined,
            withdraw: EVENTS.SchoolAdmissionWithdrawn,
          } as Record<string, string>
        )[action] as any,
        {
          organizationId: this.tenant.organizationId,
          applicationId,
          reason: notes,
        },
      );
      return after;
    });
  }

  async addDocument(applicationId: string, type: string, fileId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      return tx.applicationDocument.create({
        data: {
          organizationId: app.organizationId,
          applicationId,
          type,
          // P0/B10: references a platform File row instead of a bare URL string.
          fileId,
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