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
  ScoreApplicationDto,
  ScheduleInterviewDto,
  TransferInDto,
  UpdateApplicationDto,
  WithdrawStudentDto,
  ReEnrollDto,
} from './dto.types';
import { EnrollmentService, type EnrollNewStudentInput } from '../people/enrollment.service';

/**
 * Student lifecycle FSM (mirror of people/student.service.ts) used by
 * withdrawStudent() and reEnroll(). Now delegated to the canonical EnrollmentService
 * (single owner of the student-lifecycle FSM), so the local copy is removed.
 */

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
    private readonly enrollment: EnrollmentService,
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

      // Phase-2 identity/deduplication: find likely-duplicate existing people
      // (students or prior applicants) so an admissions officer can confirm or
      // dismiss — never auto-merge. Supports the reapplication invariant.
      await this.computeIdentityMatches(tx, organizationId, row);

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
   * Phase-2 identity matching. Builds non-destructive candidate matches for a
   * freshly-created application against existing students (StudentProfile) and
   * prior applicants (AdmissionApplication in other years) by name+DOB, guardian
   * phone/email, and stored national/birth-cert ids. Each match is a reviewable
   * ApplicantIdentityMatch row — the system never merges or blocks automatically.
   */
  private async computeIdentityMatches(tx: any, organizationId: string, app: { id: string; applicantFirstName: string; applicantLastName: string; applicantDob: Date | null; parentContactId?: string | null }) {
    const matches: Array<{ candidateType: string; candidateId: string; candidateName: string; matchMethod: string; matchScore: number }> = [];
    const first = app.applicantFirstName.trim().toLowerCase();
    const last = app.applicantLastName.trim().toLowerCase();
    const dobIso = app.applicantDob ? app.applicantDob.toISOString().slice(0, 10) : null;

    // Students: match by name + DOB, or by guardian contact phone/email.
    const students = await tx.studentProfile.findMany({
      where: { organizationId },
      include: { partner: true, guardians: { include: { guardianContact: true } } },
    });
    for (const s of students) {
      const sFirst = (s.partner?.name ?? '').trim().toLowerCase();
      const nameHit = sFirst.includes(first) || first.includes(sFirst);
      const dobHit = s.dateOfBirth && dobIso && s.dateOfBirth.toISOString().slice(0, 10) === dobIso;
      if (nameHit && dobHit) {
        matches.push({ candidateType: 'student', candidateId: s.id, candidateName: s.partner?.name ?? '', matchMethod: 'name_dob', matchScore: 90 });
        continue;
      }
      if (app.parentContactId && s.guardians?.some((g: any) => g.guardianContactId === app.parentContactId)) {
        matches.push({ candidateType: 'student', candidateId: s.id, candidateName: s.partner?.name ?? '', matchMethod: 'guardian_phone', matchScore: 70 });
      }
    }

    // Prior applicants in other academic years (reapplication invariant).
    const prior = await tx.admissionApplication.findMany({
      where: { organizationId, NOT: { id: app.id } },
    });
    for (const p of prior) {
      const pFirst = (p.applicantFirstName ?? '').trim().toLowerCase();
      const pLast = (p.applicantLastName ?? '').trim().toLowerCase();
      const pDob = p.applicantDob ? p.applicantDob.toISOString().slice(0, 10) : null;
      const nameHit = (pFirst.includes(first) || first.includes(pFirst)) && (pLast.includes(last) || last.includes(pLast));
      const dobHit = dobIso && pDob === dobIso;
      if (nameHit && dobHit) {
        matches.push({ candidateType: 'applicant', candidateId: p.id, candidateName: `${p.applicantFirstName} ${p.applicantLastName}`, matchMethod: 'name_dob', matchScore: 80 });
      }
    }

    for (const m of matches) {
      await tx.applicantIdentityMatch.create({
        data: { organizationId, applicationId: app.id, ...m },
      });
    }
  }

  /** Review a candidate identity match (confirm same person / dismiss). */
  async reviewIdentityMatch(matchId: string, decision: 'confirmed_same' | 'dismissed') {
    const match = await this.prisma.client.applicantIdentityMatch.findFirst({ where: { id: matchId } });
    if (!match) throw new NotFoundException(`Identity match ${matchId} not found`);
    return this.prisma.client.applicantIdentityMatch.update({
      where: { id: matchId },
      data: { status: decision, reviewedById: this.tenant.userId ?? null, reviewedAt: new Date() },
    });
  }

  /**
   * Enroll an offer_accepted application. Domain orchestrator: validates admission
   * eligibility, delegates all student-record creation to the canonical
   * EnrollmentService.enrollNewStudent(), then marks the application ENROLLED.
   */
  async enroll(dto: EnrollApplicationDto) {
    const organizationId = this.tenant.organizationId;
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: dto.applicationId } });
    if (!app) throw new NotFoundException(`Application ${dto.applicationId} not found`);
    if (app.status !== 'offer_accepted') {
      throw new NotFoundException(`Application ${dto.applicationId} is not ready to enroll (status=${app.status}; expected 'offer_accepted')`);
    }

    const input: EnrollNewStudentInput = {
      organizationId,
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
      // Separate admission/student numbers: admissionNo is generated by EnrollmentService
      // (STU-...) unless explicitly supplied; do NOT reuse applicationNumber.
      admissionNo: undefined,
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
      streamId: dto.streamId ?? null,
      termId: dto.termId,
      rollNumber: dto.rollNumber,
      guardians: dto.student.guardians,
    };

    const { profile, partner, enrollment } = await this.enrollment.enrollNewStudent(input);
    await this.prisma.client.admissionApplication.updateMany({ where: { id: app.id }, data: { status: 'enrolled' } });
    this.events.publish(EVENTS.SchoolAdmissionEnrolled, {
      organizationId,
      applicationId: app.id,
      studentProfileId: profile.id,
      classId: dto.classId,
      termId: dto.termId,
    });
    return { studentProfile: profile, partner, enrollment, application: { ...app, status: 'enrolled' } };
  }

  /**
   * Bulk enroll a set of offer_accepted applications. Each item is validated first;
   * readiness is reported in `enrolled`/`skipped` per item. (Phase-5 preview UI will
   * call validate-only before execute — this remains the execute path.)
   */
  async bulkEnroll(dto: BulkEnrollDto) {
    const organizationId = this.tenant.organizationId;
    const enrolled: any[] = [];
    const skipped: Array<{ applicationId: string; reason: string }> = [];

    for (const item of dto.items) {
      const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: item.applicationId } });
      if (!app) {
        skipped.push({ applicationId: item.applicationId, reason: 'not found' });
        continue;
      }
      if (app.status !== 'offer_accepted') {
        skipped.push({ applicationId: item.applicationId, reason: `status=${app.status} (expected offer_accepted)` });
        continue;
      }
      const input: EnrollNewStudentInput = {
        organizationId,
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
        admissionNo: undefined,
        classId: item.classId,
        sectionId: item.sectionId ?? null,
        streamId: item.streamId ?? null,
        termId: item.termId,
        rollNumber: item.rollNumber,
        guardians: item.student.guardians,
      };
      const { profile, enrollment } = await this.enrollment.enrollNewStudent(input);
      await this.prisma.client.admissionApplication.updateMany({ where: { id: app.id }, data: { status: 'enrolled' } });
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
   * Transfer an already-enrolled student IN from another school. Delegates the
   * student-record creation to the canonical EnrollmentService (no application);
   * the profile starts 'active' and records transferredFrom in customFields.
   */
  async transferIn(dto: TransferInDto) {
    const organizationId = this.tenant.organizationId;
    const { profile, enrollment } = await this.enrollment.enrollNewStudent({
      organizationId,
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
      streamId: dto.streamId ?? null,
      termId: dto.termId,
      rollNumber: dto.rollNumber,
      customFields: { transferredFrom: dto.transferredFrom ?? null },
    });
    return { studentProfile: profile, enrollment };
  }

  /** Withdraw a student — delegates to the canonical EnrollmentService (single owner of withdrawal). */
  async withdrawStudent(studentProfileId: string, dto: WithdrawStudentDto) {
    const org = this.tenant.organizationId;
    const active = await this.prisma.client.enrollment.findFirst({
      where: { organizationId: org, studentProfileId, status: 'enrolled' },
    });
    if (!active) throw new NotFoundException(`No active enrollment for student ${studentProfileId}`);
    return this.enrollment.withdraw(active.id, { reason: dto.reason });
  }

  /** Re-enroll a withdrawn/alumni student — delegates to the canonical EnrollmentService. */
  async reEnroll(studentProfileId: string, dto: ReEnrollDto) {
    const org = this.tenant.organizationId;
    const latest = await this.prisma.client.enrollment.findFirst({
      where: { organizationId: org, studentProfileId },
      orderBy: { enrolledAt: 'desc' },
    });
    if (!latest) throw new NotFoundException(`No enrollment found for student ${studentProfileId}`);
    return this.enrollment.reEnroll(latest.id, { reason: 'Re-enrolled' });
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

  /** ============================================================
   *  PHASE 3–5: Cycles, Capacity, Criteria/Scoring, Offers,
   *  Waitlist, Prerequisites, Bulk Preview, Analytics (SLA).
   *  ============================================================ */

  // ---- Admission Cycle ----
  async createCycle(dto: { academicYearId: string; name: string; opensAt?: string; closesAt?: string; admissionCycleId?: never }) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.admissionCycle.create({
      data: {
        organizationId,
        academicYearId: dto.academicYearId,
        name: dto.name,
        opensAt: dto.opensAt ? new Date(dto.opensAt) : null,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : null,
      },
    });
  }

  async listCycles(academicYearId?: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.admissionCycle.findMany({
      where: { organizationId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { capacities: true, criteriaSets: { include: { criteria: true } } },
    });
  }

  // ---- Capacity (DERIVED occupancy; declared capacity stored only) ----
  async setCapacity(dto: {
    admissionCycleId: string;
    classId: string;
    capacity: number;
    sectionId?: string;
    streamId?: string;
    campusId?: string;
    reservedCapacity?: number;
  }) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.admissionCapacity.upsert({
      where: {
        organizationId_admissionCycleId_classId_sectionId_streamId: {
          organizationId,
          admissionCycleId: dto.admissionCycleId,
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          streamId: dto.streamId ?? null,
        },
      } as any,
      create: { organizationId, ...dto },
      update: { capacity: dto.capacity, reservedCapacity: dto.reservedCapacity ?? 0 },
    });
  }

  /** Derived occupancy: occupied = active Enrollments for the class/section/stream. */
  async capacityStatus(admissionCycleId: string) {
    const caps = await this.prisma.client.admissionCapacity.findMany({ where: { admissionCycleId } });
    const out: any[] = [];
    for (const c of caps) {
      const occupied = await this.prisma.client.enrollment.count({
        where: {
          organizationId: c.organizationId,
          classId: c.classId,
          ...(c.sectionId ? { sectionId: c.sectionId } : {}),
          ...(c.streamId ? { streamId: c.streamId } : {}),
          status: 'enrolled',
        },
      });
      out.push({
        ...c,
        occupied,
        available: Math.max(0, c.capacity - c.reservedCapacity - occupied),
      });
    }
    return out;
  }

  // ---- Configurable criteria + weighted scoring ----
  async createCriteriaSet(dto: {
    admissionCycleId: string;
    name: string;
    classId?: string;
    isDefault?: boolean;
    criteria: Array<{ name: string; weight: number; maxScore?: number; required?: boolean; passMark?: number }>;
  }) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.admissionCriteriaSet.create({
      data: {
        organizationId,
        admissionCycleId: dto.admissionCycleId,
        name: dto.name,
        classId: dto.classId ?? null,
        isDefault: dto.isDefault ?? false,
        criteria: {
          create: dto.criteria.map((c) => ({
            organizationId,
            name: c.name,
            weight: c.weight,
            maxScore: c.maxScore ?? 100,
            required: c.required ?? false,
            passMark: c.passMark ?? 0,
          })),
        },
      },
      include: { criteria: true },
    });
  }

  /**
   * Weighted scoring engine. Replaces the old fixed "/3". Each criterion's score
   * is normalized to its maxScore, multiplied by its weight, summed across the
   * set. `breakdown` records each criterion contribution for audit/dispute.
   */
  async scoreApplicationWeighted(applicationId: string, scores: Record<string, number>) {
    const organizationId = this.tenant.organizationId;
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

    const set = await this.prisma.client.admissionCriteriaSet.findFirst({
      where: { organizationId, admissionCycleId: app.admissionCycleId ?? undefined, ...(app.admissionCycleId ? {} : { isDefault: true }) },
      include: { criteria: true },
    });
    if (!set || set.criteria.length === 0) {
      throw new BadRequestException('No admission criteria set configured for this application');
    }

    const breakdown: Record<string, number> = {};
    let weighted = 0;
    let weightSum = 0;
    for (const crit of set.criteria) {
      const raw = scores[crit.name] ?? 0;
      const normalized = crit.maxScore > 0 ? raw / crit.maxScore : 0;
      const contribution = normalized * crit.weight;
      breakdown[crit.name] = Math.round(contribution * 1000) / 1000;
      weighted += contribution;
      weightSum += crit.weight;
    }
    const totalScore = Math.round((weightSum > 0 ? weighted / weightSum : weighted) * 1000) / 1000;

    const record = await this.prisma.client.applicantScore.upsert({
      where: { applicationId },
      create: { organizationId, applicationId, totalScore, breakdown },
      update: { totalScore, breakdown },
    });
    await this.prisma.client.admissionApplication.updateMany({
      where: { id: applicationId },
      data: { scoredAt: new Date(), status: 'scored' },
    });
    return { totalScore, breakdown, record };
  }

  /** Record the final admission decision (accepted/rejected/waitlisted) with reason. */
  async recordDecision(applicationId: string, decision: 'accepted' | 'rejected' | 'waitlisted', reason?: string) {
    const organizationId = this.tenant.organizationId;
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
    const score = await this.prisma.client.applicantScore.findFirst({ where: { applicationId } });
    const decision_ = await this.prisma.client.admissionDecision.upsert({
      where: { applicationId },
      create: {
        organizationId,
        applicationId,
        decision,
        totalScore: score?.totalScore ? Number(score.totalScore) : null,
        breakdown: (score?.breakdown ?? undefined) as any,
        decidedById: this.tenant.userId ?? null,
        reason,
      },
      update: { decision, totalScore: score?.totalScore ? Number(score.totalScore) : null, breakdown: (score?.breakdown ?? undefined) as any, decidedById: this.tenant.userId ?? null, reason },
    });
    const ts = decision === 'accepted' ? { acceptedAt: new Date() } : decision === 'waitlisted' ? {} : {};
    await this.prisma.client.admissionApplication.updateMany({ where: { id: applicationId }, data: { status: decision, ...ts } });
    this.events.publish('school.admission.decision' as any, { organizationId, applicationId, decision, reason });
    return decision_;
  }

  // ---- Enrollment prerequisites (Phase 4) ----
  /** Returns READY or BLOCKED with the list of missing requirements. */
  async enrollmentEligibility(applicationId: string) {
    const app = await this.prisma.client.admissionApplication.findFirst({
      where: { id: applicationId },
      include: { documents: true, offerLetter: true, fee: true },
    });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
    const missing: string[] = [];
    if (app.status !== 'offer_accepted') missing.push('offer not accepted');
    const requiredDocs = app.documents.filter((d: any) => d.required);
    if (requiredDocs.some((d: any) => !d.verified)) missing.push('required documents not verified');
    if (!app.offerLetter) missing.push('no offer on file');
    return { applicationId, status: missing.length === 0 ? 'READY' : 'BLOCKED', missing };
  }

  // ---- Waitlist deterministic ranking (Phase 4) ----
  async rankWaitlist(classId: string) {
    const entries = await this.prisma.client.waitingList.findMany({
      where: { organizationId: this.tenant.organizationId, classId },
      include: { application: { include: { score: true } } },
    });
    const sorted = entries
      .map((e: any) => ({
        id: e.id,
        applicationId: e.applicationId,
        score: Number(e.application?.score?.totalScore ?? 0),
        createdAt: e.createdAt,
      }))
      .sort((a: any, b: any) => b.score - a.score || (a.createdAt < b.createdAt ? -1 : 1));
    // Persist deterministic positions.
    for (let i = 0; i < sorted.length; i++) {
      await this.prisma.client.waitingList.update({ where: { id: sorted[i].id }, data: { position: i + 1 } });
    }
    return sorted;
  }

  // ---- Bulk enroll PREVIEW (Phase 5) -----
  /** Validate-only: returns ready[] vs invalid[] with reasons. No writes. */
  async bulkEnrollPreview(items: Array<{ applicationId: string; classId: string; sectionId?: string; streamId?: string; termId: string; rollNumber: string }>) {
    const organizationId = this.tenant.organizationId;
    const ready: any[] = [];
    const invalid: Array<{ applicationId: string; reason: string }> = [];
    for (const item of items) {
      const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: item.applicationId } });
      if (!app) { invalid.push({ applicationId: item.applicationId, reason: 'not found' }); continue; }
      if (app.status !== 'offer_accepted') { invalid.push({ applicationId: item.applicationId, reason: `status=${app.status} (expected offer_accepted)` }); continue; }
      const dup = await this.prisma.client.enrollment.findFirst({ where: { organizationId, applicationId: item.applicationId, termId: item.termId, status: 'enrolled' } });
      if (dup) { invalid.push({ applicationId: item.applicationId, reason: 'already enrolled this term' }); continue; }
      ready.push(item);
    }
    return { total: items.length, readyCount: ready.length, invalidCount: invalid.length, ready, invalid };
  }

  // ---- Analytics / SLA pipeline (Phase 5) ----
  async pipelineMetrics() {
    const organizationId = this.tenant.organizationId;
    const apps = await this.prisma.client.admissionApplication.findMany({ where: { organizationId } });
    const byStatus: Record<string, number> = {};
    for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    const total = apps.length;
    const offersIssued = byStatus['offer_issued'] ?? 0;
    const offersAccepted = byStatus['offer_accepted'] ?? 0;
    const enrolled = byStatus['enrolled'] ?? 0;
    const rejected = byStatus['rejected'] ?? 0;
    const conversion = {
      applicationsToOffers: total ? (offersIssued / total) * 100 : 0,
      offersToAccepted: offersIssued ? (offersAccepted / offersIssued) * 100 : 0,
      acceptedToEnrolled: offersAccepted ? (enrolled / offersAccepted) * 100 : 0,
    };
    // Average processing times where both endpoints are present.
    const withSubmitted = apps.filter((a: any) => a.submittedAt);
    let avgProcessingDays: number | null = null;
    const deltas = withSubmitted
      .filter((a: any) => a.enrolledAt)
      .map((a: any) => (new Date(a.enrolledAt).getTime() - new Date(a.submittedAt).getTime()) / 86400000);
    if (deltas.length) avgProcessingDays = Math.round((deltas.reduce((s: number, d: number) => s + d, 0) / deltas.length) * 10) / 10;
    return { total, byStatus, conversion, avgProcessingDays };
  }

  async byStatus(status: string) {
    return this.prisma.client.admissionApplication.findMany({
      where: { status: status as any },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /**
   * Enrollment Summary Report (P-enroll-summary): the per-class roll-up of the
   * current student body — male / female, boarding / day, and totals — matching
   * the school's printed enrollment return.
   *
   * When `termId` is given we count Enrollment rows for that term (status
   * 'enrolled'), which is the true historical head-count for a term. When it is
   * omitted we fall back to the live StudentProfile roster (currentClassId) so
   * the report still works before any term enrollments are recorded.
   *
   * Classes are ordered by their GradeLevel.order so the table reads S.1 → S.6
   * (or P.1 → P.7) regardless of insertion order.
   */
  async enrollmentSummary(termId?: string) {
    const orgId = this.tenant.organizationId;

    // Fetch classes (with grade level) once, ordered for display.
    const classes = await this.prisma.client.schoolClass.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: { gradeLevel: true },
      orderBy: [{ gradeLevel: { order: 'asc' } }, { name: 'asc' }],
    });
    const classIds = classes.map((c: any) => c.id);

    // Resolve the set of studentProfileIds considered "enrolled" for the term.
    // enrollmentClass maps a student → the class they are enrolled in for the term
    // (handles mid-term transfers); when no term is given we group by the live roster.
    let studentFilter: any = { currentClassId: { in: classIds }, organizationId: orgId, deletedAt: null, status: 'active' as any };
    let enrollmentClass: Map<string, string> | null = null;
    if (termId) {
      const enrollments = await this.prisma.client.enrollment.findMany({
        where: { organizationId: orgId, termId, status: 'enrolled', endedAt: null },
        select: { studentProfileId: true, classId: true },
      });
      enrollmentClass = new Map<string, string>();
      for (const e of enrollments) enrollmentClass.set(e.studentProfileId, e.classId);
      studentFilter = { id: { in: [...enrollmentClass.keys()] }, organizationId: orgId, deletedAt: null, status: 'active' as any };
    }

    const students = await this.prisma.client.studentProfile.findMany({
      where: studentFilter,
      select: { id: true, currentClassId: true, gender: true, residenceType: true },
    });

    const rows = classes.map((c: any) => ({
      classId: c.id,
      className: c.name,
      gradeLevel: c.gradeLevel?.name ?? '',
      male: 0,
      female: 0,
      maleBoarding: 0,
      femaleBoarding: 0,
      maleDay: 0,
      femaleDay: 0,
      total: 0,
    }));
    const rowByClass = Object.fromEntries(rows.map((r: any) => [r.classId, r]));

    for (const s of students) {
      const classId = (enrollmentClass && enrollmentClass.get(s.id)) || s.currentClassId || '';
      if (!classId) continue;
      const row = rowByClass[classId];
      if (!row) continue;
      const isMale = (s.gender || '').toLowerCase() === 'male';
      const isFemale = (s.gender || '').toLowerCase() === 'female';
      const isBoarding = (s.residenceType || '').toLowerCase() === 'boarder' || (s.residenceType || '').toLowerCase() === 'boarding';
      if (isMale) { row.male++; if (isBoarding) row.maleBoarding++; else row.maleDay++; }
      else if (isFemale) { row.female++; if (isBoarding) row.femaleBoarding++; else row.femaleDay++; }
      row.total++;
    }

    const totals = rows.reduce(
      (acc: any, r: any) => {
        acc.male += r.male; acc.female += r.female;
        acc.maleBoarding += r.maleBoarding; acc.femaleBoarding += r.femaleBoarding;
        acc.maleDay += r.maleDay; acc.femaleDay += r.femaleDay;
        acc.total += r.total;
        return acc;
      },
      { male: 0, female: 0, maleBoarding: 0, femaleBoarding: 0, maleDay: 0, femaleDay: 0, total: 0 },
    );

    return { rows, totals, termId: termId ?? null, generatedAt: new Date().toISOString() };
  }
}