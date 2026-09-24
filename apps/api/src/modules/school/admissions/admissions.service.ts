import { normalizePhone } from '../people/guardian.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AdmissionApplication } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { EncryptionService } from '../../../kernel/encryption/encryption.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS, PERMISSIONS } from '@erp/shared';
import type {
  AddExamScoreDto,
  BulkEnrollDto,
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
import { StudentAdmissionService, type AdmitStudentInput } from '../people/student-admission.service';
import { StudentEnrollmentService } from '../enrollment/student-enrollment.service';
import { AdmissionsWorkflowService } from './admissions-workflow.service';
import type { StageKey } from './admission-workflow.schema';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import { AdmissionFeeService } from './admission-fee.service';

/**
 * Human titles for documents carried from an application onto a pupil record.
 * StudentDocument requires a title; ApplicationDocument has only a type.
 */
const TITLE_BY_DOC_TYPE: Record<string, string> = {
  birth_cert: 'Birth certificate',
  report_card: 'Previous report card',
  recommendation: 'Letter of recommendation',
  photo: 'Passport photograph',
  transfer_letter: 'Transfer letter',
  medical: 'Medical record',
  other: 'Admission document',
};

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
  // Phase 1: a draft is a not-yet-submitted application (portal or front desk).
  draft: ['submit', 'withdraw'],
  submitted: ['review', 'request_documents', 'withdraw'],
  // Missing required documents — the applicant completes them, then it re-enters review.
  documents_pending: ['resolve_documents', 'reject', 'withdraw'],
  under_review: ['review', 'screen', 'request_documents', 'schedule_interview', 'schedule_exam', 'accept', 'reject', 'waitlist', 'withdraw'],
  screening: ['schedule_interview', 'schedule_exam', 'reject', 'withdraw'],
  interview_scheduled: ['schedule_interview', 'complete_interview', 'reschedule', 'reject', 'withdraw'],
  interviewed: ['schedule_exam', 'exam_done', 'score', 'accept', 'reject', 'waitlist', 'withdraw'],
  // 'score' is a self-loop so a reviewer can correct a criterion before the
  // decision is taken; every re-score still writes an audit row.
  scored: ['score', 'accept', 'reject', 'waitlist', 'withdraw'],
  exam_scheduled: ['exam_done', 'score', 'accept', 'reject', 'waitlist', 'withdraw'],
  accepted: ['waitlist', 'issue_offer', 'enroll', 'withdraw'],
  waitlisted: ['issue_offer', 'reject', 'withdraw'],
  offer_issued: ['accept_offer', 'decline_offer', 'expire_offer', 'withdraw'],
  offer_accepted: ['enroll', 'withdraw'],
  // A lapsed offer can be re-issued (offer_expired → offer_issued) rather than
  // forcing the applicant to reapply.
  offer_expired: ['issue_offer', 'withdraw'],
  offer_declined: [],
  rejected: [],
  withdrawn: [],
  enrolled: [],
};

/** action → resulting status. The single source of truth for every transition. */
const STATUS_MAP: Record<string, string> = {
  submit: 'submitted',
  review: 'under_review',
  request_documents: 'documents_pending',
  resolve_documents: 'under_review',
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
  // Fixed semantics: declining an offer is terminal (offer_declined), not a
  // silent bounce back onto the waitlist.
  decline_offer: 'offer_declined',
  expire_offer: 'offer_expired',
  enroll: 'enrolled',
  withdraw: 'withdrawn',
};

/** action → domain event. Actions without a dedicated event simply publish nothing. */
const EVENT_MAP: Record<string, string> = {
  submit: EVENTS.SchoolAdmissionSubmitted,
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
  enroll: EVENTS.SchoolAdmissionEnrolled,
  withdraw: EVENTS.SchoolAdmissionWithdrawn,
};

/** action → AuditLog action enum. Everything else is an 'update'. */
const AUDIT_ACTION_MAP: Record<string, 'update' | 'approve' | 'reject' | 'cancel'> = {
  accept: 'approve',
  accept_offer: 'approve',
  reject: 'reject',
  decline_offer: 'cancel',
  withdraw: 'cancel',
};

/** Milestone timestamps stamped on the application as it moves through the funnel. */
const TIMESTAMP_MAP: Record<string, string> = {
  screen: 'screenedAt',
  complete_interview: 'interviewedAt',
  schedule_exam: 'examScheduledAt',
  score: 'scoredAt',
  accept: 'acceptedAt',
  issue_offer: 'offerIssuedAt',
  accept_offer: 'offerAcceptedAt',
  enroll: 'enrolledAt',
};

/**
 * The action each admission decision maps onto. `recordDecision` used to write
 * `status` directly with no guard, which let a terminal `enrolled` application be
 * flipped back to `rejected` — orphaning a live Enrollment and StudentProfile.
 */
const DECISION_ACTIONS = {
  accepted: 'accept',
  rejected: 'reject',
  waitlisted: 'waitlist',
} as const;

/** Where an applicant is being placed — used by the enrollment eligibility gate. */
interface EnrollmentTarget {
  classId?: string | null;
  sectionId?: string | null;
  termId?: string | null;
}

/**
 * AdmissionsService — drives the admission workflow.
 *
 * The `enroll` action creates the learner (Partner + StudentProfile), their
 * StudentEnrollment and opening placement in a single transaction. After
 * enrollment the learner appears on the class list.
 */
@Injectable()
export class AdmissionsService extends BaseCrudService<AdmissionApplication, CreateApplicationDto, UpdateApplicationDto> {
  private readonly logger = new Logger('AdmissionsService');
  protected readonly entityName = 'AdmissionApplication';
  protected readonly searchFields: string[] = ['applicationNumber', 'applicantFirstName', 'applicantLastName'];
  protected readonly defaultInclude = {
    academicYear: true,
    documents: true,
    entranceExams: { include: { subject: true } },
    waitingList: true,
    studentEnrollment: true,
    guardians: true,
    offerLetter: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly admission: StudentAdmissionService,
    private readonly studentEnrollments: StudentEnrollmentService,
    private readonly encryption: EncryptionService,
    private readonly workflow: AdmissionsWorkflowService,
    private readonly placements: PlacementLookupService,
    private readonly admissionFees: AdmissionFeeService,
  ) {
    super(prisma.client.admissionApplication as unknown as CrudDelegate);
  }

  /**
   * Override the base CRUD update: `nin` must be encrypted into its three
   * columns rather than written as a plaintext field, and `guardians` is a
   * relation the flat updateMany cannot set — so both are transformed/stripped
   * here before delegating.
   */
  async update(id: string, dto: UpdateApplicationDto): Promise<AdmissionApplication> {
    const { nin, guardians, admissionCycleId, ...rest } = dto as any;

    // Admission-cycle validation (Task 2): if the caller is (re)assigning a
    // cycle, it must exist and belong to this organization. A closed cycle may
    // not be (re)attached to an application.
    if (admissionCycleId !== undefined && admissionCycleId !== null) {
      const organizationId = this.tenant.organizationId;
      const cycle = await this.prisma.client.admissionCycle.findFirst({
        where: { id: admissionCycleId, organizationId },
      });
      if (!cycle) {
        throw new BadRequestException(
          `Admission cycle ${admissionCycleId} does not exist or belongs to another organization.`,
        );
      }
      if (cycle.status === 'closed') {
        throw new BadRequestException(
          `Admission cycle ${cycle.name} is closed and cannot be assigned to an application.`,
        );
      }
      rest.admissionCycleId = admissionCycleId;
    }

    const data: Record<string, unknown> = { ...rest };
    if (nin !== undefined) {
      const enc = this.encryption.encrypt(nin);
      data.ninCiphertext = enc?.ciphertext ?? null;
      data.ninIv = enc?.iv ?? null;
      data.ninTag = enc?.tag ?? null;
    }
    const res = await this.prisma.client.admissionApplication.updateMany({ where: { id }, data });
    if (res.count === 0) throw new NotFoundException(`AdmissionApplication ${id} not found`);
    // Replace the structured guardians when the caller sends a new set.
    if (Array.isArray(guardians)) {
      const app = await this.prisma.client.admissionApplication.findFirst({ where: { id }, select: { organizationId: true } });
      await this.prisma.client.admissionGuardian.deleteMany({ where: { applicationId: id, contactId: null } });
      for (const g of guardians) {
        await this.prisma.client.admissionGuardian.create({
          data: {
            organizationId: app!.organizationId,
            applicationId: id,
            firstName: g.firstName,
            lastName: g.lastName ?? null,
            relationship: g.relationship,
            phone: g.phone ?? null,
            altPhone: g.altPhone ?? null,
            email: g.email ?? null,
            occupation: g.occupation ?? null,
            address: g.address ?? null,
            isPrimary: g.isPrimary ?? false,
            isEmergency: g.isEmergency ?? false,
            financiallyResponsible: g.financiallyResponsible ?? false,
          },
        });
      }
    }
    return this.findOne(id);
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

      // Advisory duplicate detection (Task 5): same name + same admission cycle +
      // same applying-for class. This is a WARNING, never a hard block, so that
      // a legitimate re-application (e.g. different DoB) is still possible. The
      // hard same-year guard above remains the authoritative rejection.
      if (dto.admissionCycleId && dto.applyingForClassId) {
        const advisory = await tx.admissionApplication.findFirst({
          where: {
            organizationId,
            admissionCycleId: dto.admissionCycleId,
            applyingForClassId: dto.applyingForClassId,
            applicantFirstName: { equals: dto.applicantFirstName.trim(), mode: 'insensitive' },
            applicantLastName: { equals: dto.applicantLastName.trim(), mode: 'insensitive' },
          },
          select: { id: true, applicationNumber: true },
        });
        if (advisory) {
          throw new ConflictException({
            code: 'ADVISORY_DUPLICATE',
            message:
              `Possible existing application ${advisory.applicationNumber} for the same ` +
              `applicant, admission cycle and class. Confirm this is not a duplicate.`,
            existingApplicationNumber: advisory.applicationNumber,
          });
        }
      }

      // Admission-cycle validation (Task 2): if supplied, the cycle must exist,
      // belong to this organization, and be open.
      if (dto.admissionCycleId) {
        const cycle = await tx.admissionCycle.findFirst({
          where: { id: dto.admissionCycleId, organizationId },
        });
        if (!cycle) {
          throw new BadRequestException(
            `Admission cycle ${dto.admissionCycleId} does not exist or belongs to another organization.`,
          );
        }
        if (cycle.status === 'closed') {
          throw new BadRequestException(
            `Admission cycle ${cycle.name} is closed and cannot accept new applications.`,
          );
        }
      }

      const applicationNumber = await this.sequence.next(
        `admission:${new Date().getUTCFullYear()}`,
        { prefix: 'APP-', padding: 6 },
        tx,
      );
      // NIN is PII: store it AES-256-GCM encrypted, never in plaintext
      // customFields where every `school:read` holder could read it.
      const nin = this.encryption.encrypt(dto.nin);
      const status = dto.asDraft ? 'draft' : 'submitted';

      // Freeze the admission workflow onto the application, once, at creation.
      // `workflowSnapshot` is authoritative for this application's whole lifecycle:
      // later edits to the workflow, or reassignment of the cycle's workflow, must
      // never retroactively change the stages an in-flight application has to clear.
      // `workflowId` alongside it is provenance only — progression never reads it.
      const { snapshot, workflowId } = await this.workflow.snapshotForCycle(
        tx,
        dto.admissionCycleId ?? null,
      );

      const row = await tx.admissionApplication.create({
        data: {
          organizationId,
          academicYearId: dto.academicYearId,
          admissionCycleId: dto.admissionCycleId ?? null,
          workflowId,
          workflowSnapshot: snapshot as any,
          applicationNumber,
          applicantFirstName: dto.applicantFirstName,
          applicantLastName: dto.applicantLastName,
          applicantDob: dob,
          applicantGender: dto.applicantGender ?? null,
          applyingForClassId: dto.applyingForClassId ?? null,
          parentContactId: dto.parentContactId ?? null,
          sourceOfEnquiry: dto.sourceOfEnquiry ?? null,
          siblingOfStudentId: dto.siblingOfStudentId ?? null,
          // Promoted operational fields (Task 3) — stored top-level, not in customFields.
          nationality: dto.nationality ?? null,
          residenceType: dto.residenceType ?? null,
          entryStatus: dto.entryStatus ?? null,
          address: dto.address ?? null,
          studentCategoryId: dto.studentCategoryId ?? null,
          ninCiphertext: nin?.ciphertext ?? null,
          ninIv: nin?.iv ?? null,
          ninTag: nin?.tag ?? null,
          customFields: dto.customFields ?? {},
          status,
        },
      });

      // Structured guardians (Phase 1) — no longer 12 flat strings in customFields.
      // Promoted to real Contact + StudentGuardian rows at enrollment.
      if (dto.guardians?.length) {
        for (const g of dto.guardians) {
          await tx.admissionGuardian.create({
            data: {
              organizationId,
              applicationId: row.id,
              firstName: g.firstName,
              lastName: g.lastName ?? null,
              relationship: g.relationship,
              phone: g.phone ?? null,
              altPhone: g.altPhone ?? null,
              email: g.email ?? null,
              occupation: g.occupation ?? null,
              address: g.address ?? null,
              isPrimary: g.isPrimary ?? false,
              isEmergency: g.isEmergency ?? false,
              financiallyResponsible: g.financiallyResponsible ?? false,
            },
          });
        }
      }

      await tx.admissionStatusHistory.create({
        data: { organizationId, applicationId: row.id, fromStatus: null, toStatus: status, action: 'create', changedById: this.tenant.userId ?? null },
      });

      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: row.id,
        action: 'create',
        newValues: { ...row, ninCiphertext: undefined, ninIv: undefined, ninTag: undefined },
      });
      // A draft is not yet in the pipeline, so it does not announce a submission.
      if (status === 'submitted') {
        await this.events.publishInTx(tx, EVENTS.SchoolAdmissionSubmitted, {
          organizationId,
          applicationId: row.id,
          applicationNumber: row.applicationNumber,
        });
      }
      void normalizedFirst;
      void normalizedLast;
      return row;
    }).then(async (row: AdmissionApplication) => {
      // Phase-2 identity/deduplication runs AFTER the create commits — it is
      // advisory (a reviewable match queue, never an auto-merge), so it must not
      // hold write locks on the create transaction, and it is now an indexed
      // lookup rather than a full-table scan of every student and application.
      try {
        await this.computeIdentityMatches(this.prisma.client, this.tenant.organizationId, row);
      } catch (err) {
        this.logger.warn(`identity matching failed for ${row.id}: ${(err as Error).message}`);
      }
      return row;
    });
  }

  /**
   * Submit a draft into the pipeline (draft → submitted), or when required
   * documents/fields are missing, park it in documents_pending instead. This is
   * the server-side completeness gate the front-desk and portal both call.
   */
  async submitApplication(applicationId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({
        where: { id: applicationId },
        include: { documents: true, guardians: true },
      });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      if (app.status !== 'draft') {
        throw new BadRequestException(`Only a draft application can be submitted (status=${app.status}).`);
      }

      const missing = await this.missingSubmitRequirements(tx, app);
      await this.applyReview(tx, applicationId, 'submit');
      if (missing.length) {
        // It is submitted, but incomplete — route it to documents_pending so the
        // applicant is chased for what is missing rather than silently accepted.
        await this.applyReview(tx, applicationId, 'request_documents', `Missing: ${missing.join(', ')}`);
      }
      return { applicationId, status: missing.length ? 'documents_pending' : 'submitted', missing };
    });
  }

  /**
   * The required items a submitted application must satisfy, resolved from
   * AdmissionRequirement (gate='submit') for the application's cycle/class.
   * Returns the labels of anything not yet present.
   */
  private async missingSubmitRequirements(tx: any, app: any): Promise<string[]> {
    const reqs = await tx.admissionRequirement.findMany({
      where: {
        organizationId: app.organizationId,
        gate: 'submit',
        required: true,
        OR: [
          { admissionCycleId: app.admissionCycleId ?? undefined },
          { admissionCycleId: null },
        ],
        AND: [{ OR: [{ classId: app.applyingForClassId ?? undefined }, { classId: null }] }],
      },
    });
    const docTypes = new Set((app.documents ?? []).map((d: any) => d.type));
    const missing: string[] = [];
    for (const r of reqs) {
      if (r.kind === 'document' && !docTypes.has(r.code)) missing.push(r.label);
      if (r.kind === 'field') {
        const present = app[r.code] != null || (app.customFields ?? {})[r.code] != null;
        if (!present) missing.push(r.label);
      }
    }
    return missing;
  }

  /**
   * Phase-2 identity matching. Builds non-destructive candidate matches for a
   * freshly-created application against existing students (StudentProfile) and
   * prior applicants (AdmissionApplication in other years) by name+DOB, guardian
   * phone/email, and stored national/birth-cert ids. Each match is a reviewable
   * ApplicantIdentityMatch row — the system never merges or blocks automatically.
   */
  private async computeIdentityMatches(client: any, organizationId: string, app: { id: string; applicantFirstName: string; applicantLastName: string; applicantDob: Date | null; parentContactId?: string | null }) {
    const matches: Array<{ candidateType: string; candidateId: string; candidateName: string; matchMethod: string; matchScore: number }> = [];
    const first = app.applicantFirstName.trim().toLowerCase();
    const last = app.applicantLastName.trim().toLowerCase();

    // The old version loaded EVERY student (with partner + guardians) and EVERY
    // application into memory on each create, then substring-matched in JS —
    // seconds-to-OOM at scale. These are now bounded, indexed lookups:
    //   • students sharing the applicant's exact DOB (indexed column),
    //   • students sharing a guardian contact (indexed FK),
    //   • prior applications sharing DOB (or exact last name when DOB is absent).
    // The fuzzy name comparison then runs over a handful of rows, not the table.
    const nameLooseHit = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);

    if (app.applicantDob) {
      const dobStudents = await client.studentProfile.findMany({
        where: { organizationId, dateOfBirth: app.applicantDob },
        include: { partner: { select: { name: true } } },
        take: 50,
      });
      for (const s of dobStudents) {
        const sName = (s.partner?.name ?? '').trim().toLowerCase();
        if (nameLooseHit(sName, first) || sName.includes(last)) {
          matches.push({ candidateType: 'student', candidateId: s.id, candidateName: s.partner?.name ?? '', matchMethod: 'name_dob', matchScore: 90 });
        }
      }
    }

    // Students sharing a guardian contact — indexed on StudentGuardian.guardianContactId.
    if (app.parentContactId) {
      const links = await client.studentGuardian.findMany({
        where: { organizationId, guardianContactId: app.parentContactId },
        include: { studentProfile: { include: { partner: { select: { name: true } } } } },
        take: 50,
      });
      for (const l of links) {
        if (l.studentProfile && !matches.some((m) => m.candidateId === l.studentProfile.id)) {
          matches.push({ candidateType: 'student', candidateId: l.studentProfile.id, candidateName: l.studentProfile.partner?.name ?? '', matchMethod: 'guardian_phone', matchScore: 70 });
        }
      }
    }

    // Prior applicants (reapplication invariant): narrowed by DOB when present,
    // otherwise by an exact last-name match — never the whole table.
    const prior = await client.admissionApplication.findMany({
      where: {
        organizationId,
        NOT: { id: app.id },
        ...(app.applicantDob
          ? { applicantDob: app.applicantDob }
          : { applicantLastName: { equals: app.applicantLastName.trim(), mode: 'insensitive' } }),
      },
      take: 50,
    });
    for (const p of prior) {
      const pFirst = (p.applicantFirstName ?? '').trim().toLowerCase();
      const pLast = (p.applicantLastName ?? '').trim().toLowerCase();
      if (nameLooseHit(pFirst, first) && nameLooseHit(pLast, last)) {
        matches.push({ candidateType: 'applicant', candidateId: p.id, candidateName: `${p.applicantFirstName} ${p.applicantLastName}`, matchMethod: 'name_dob', matchScore: 80 });
      }
    }

    for (const m of matches) {
      await client.applicantIdentityMatch.create({
        data: { organizationId, applicationId: app.id, ...m },
      });
    }
  }

  /**
   * Promote the application's AdmissionGuardian rows into real Contact +
   * StudentGuardian records for the freshly-enrolled student. Idempotent: a
   * guardian already promoted (contactId set) is skipped, so a retried enroll
   * does not duplicate guardians. Contacts belong to the student's own Partner,
   * matching the convention in people/guardian.service.ts.
   */
  /**
   * Carry the applicant's uploaded documents onto the pupil record.
   *
   * Enrolment converted the application's guardians into contacts but left its
   * documents behind: the birth certificate a parent uploaded to apply was
   * checked by the eligibility gate and then never seen again, so the Student
   * 360 showed no documents and the school asked for a second copy. Only the
   * file reference is copied — the same fileId is pointed at from both rows,
   * so nothing is re-uploaded and the application keeps its own evidence.
   *
   * Idempotent: re-running skips any type/fileId pair the pupil already has,
   * so a retried enrolment cannot duplicate the set.
   */
  private async copyApplicationDocuments(tx: any, applicationId: string, studentProfileId: string): Promise<number> {
    const docs = await tx.applicationDocument.findMany({ where: { applicationId } });
    if (docs.length === 0) return 0;

    const existing = await tx.studentDocument.findMany({
      where: { studentProfileId },
      select: { type: true, fileId: true },
    });
    const seen = new Set(existing.map((d: any) => `${d.type}::${d.fileId}`));

    let copied = 0;
    for (const doc of docs) {
      if (seen.has(`${doc.type}::${doc.fileId}`)) continue;
      await tx.studentDocument.create({
        data: {
          organizationId: this.tenant.organizationId,
          studentProfileId,
          type: doc.type,
          title: TITLE_BY_DOC_TYPE[doc.type] ?? 'Admission document',
          fileId: doc.fileId,
          // A reviewer's verification carries over: it was the same document.
          verified: doc.verified,
          verifiedById: doc.verifiedById ?? null,
          verifiedAt: doc.verifiedAt ?? null,
          customFields: { source: 'admission', applicationId },
        },
      });
      copied++;
    }
    return copied;
  }

  private async promoteGuardians(tx: any, applicationId: string, organizationId: string, partnerId: string, studentProfileId: string) {
    const guardians = await tx.admissionGuardian.findMany({ where: { applicationId } });
    for (const g of guardians) {
      if (g.contactId) continue;
      // A parent who already has a child here is the SAME guardian record, not a
      // second one: match on phone or email among existing guardians.
      const phone = normalizePhone(g.phone);
      const email = g.email?.trim().toLowerCase() || null;
      let contact: any = null;
      if (phone || email) {
        const links = await tx.studentGuardian.findMany({
          where: {
            guardianContact: {
              OR: [
                ...(email ? [{ email: { equals: email, mode: 'insensitive' } }] : []),
                ...(phone ? [{ phone: { contains: phone.slice(-9) } }] : []),
              ],
            },
          },
          include: { guardianContact: true },
          take: 20,
        });
        contact =
          links
            .map((l: any) => l.guardianContact)
            .find((c: any) => (email && c.email?.trim().toLowerCase() === email) || (phone && normalizePhone(c.phone) === phone)) ??
          null;
      }
      contact ??= await tx.contact.create({
        data: {
          organizationId,
          partnerId,
          firstName: g.firstName,
          lastName: g.lastName ?? null,
          email: g.email ?? null,
          phone: g.phone ?? null,
          isPrimary: g.isPrimary,
        },
      });
      const linked = await tx.studentGuardian.findFirst({ where: { studentProfileId, guardianContactId: contact.id } });
      if (linked) {
        await tx.admissionGuardian.updateMany({ where: { id: g.id }, data: { contactId: contact.id } });
        continue;
      }
      await tx.studentGuardian.create({
        data: {
          organizationId,
          studentProfileId,
          guardianContactId: contact.id,
          relationship: g.relationship,
          isPrimary: g.isPrimary,
          canPickup: true,
          receivesStatements: g.financiallyResponsible || g.isPrimary,
        },
      });
      await tx.admissionGuardian.updateMany({ where: { id: g.id }, data: { contactId: contact.id } });
    }
  }

  /** Review a candidate identity match (confirm same person / dismiss). */
  async reviewIdentityMatch(matchId: string, decision: 'confirmed_same' | 'dismissed') {
    // Validated by ReviewIdentityMatchDto at the edge; re-checked here because
    // an arbitrary string used to be written straight into `status` (AD3).
    if (decision !== 'confirmed_same' && decision !== 'dismissed') {
      throw new BadRequestException(`decision must be 'confirmed_same' or 'dismissed'`);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const match = await tx.applicantIdentityMatch.findFirst({ where: { id: matchId } });
      if (!match) throw new NotFoundException(`Identity match ${matchId} not found`);
      if (match.status !== 'open') {
        throw new ConflictException(`This possible match was already ${String(match.status).replace('_', ' ')}.`);
      }
      const updated = await tx.applicantIdentityMatch.update({
        where: { id: matchId },
        data: { status: decision, reviewedById: this.tenant.userId ?? null, reviewedAt: new Date() },
      });
      // Confirming "same child" decides which student record the applicant
      // becomes, so it is audited like any other admission decision.
      await this.audit.recordInTx(tx, {
        entity: 'ApplicantIdentityMatch',
        entityId: matchId,
        action: 'update',
        oldValues: { status: match.status },
        newValues: { status: decision, applicationId: match.applicationId, candidateId: match.candidateId },
      });
      return updated;
    });
  }

  /** Candidate duplicate-pupil matches for an application, for the review panel. */
  async identityMatches(applicationId: string) {
    return this.prisma.client.applicantIdentityMatch.findMany({
      where: { applicationId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Reveal the decrypted NIN for one application. Deliberately a separate,
   * audited endpoint rather than a field on the list/detail payload — the NIN is
   * encrypted at rest precisely so it is not handed to every `school:read` holder.
   */
  async revealNin(applicationId: string): Promise<{ nin: string | null }> {
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
    const nin = app.ninCiphertext
      ? this.encryption.decrypt({ ciphertext: app.ninCiphertext, iv: app.ninIv!, tag: app.ninTag! })
      : null;
    await this.audit.record({
      entity: 'AdmissionApplication',
      entityId: applicationId,
      action: 'read',
      newValues: { field: 'nin', revealed: nin != null },
    });
    return { nin };
  }

  /** The append-only status timeline for one application (newest first). */
  async statusHistory(applicationId: string) {
    return this.prisma.client.admissionStatusHistory.findMany({
      where: { applicationId },
      orderBy: { changedAt: 'desc' },
    });
  }

  /**
   * Enroll an offer_accepted application. Domain orchestrator: validates admission
   * eligibility, delegates all student-record creation to
   * StudentAdmissionService.admit(), then marks the application ENROLLED.
   */
  async enroll(dto: EnrollApplicationDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({
        where: { id: dto.applicationId },
        include: { offerLetter: true, decision: true },
      });
      if (!app) throw new NotFoundException(`Application ${dto.applicationId} not found`);

      // Enforcement order: workflow → eligibility → seat → promotion → transition.
      //
      // 1. Workflow. Throws 409 naming the first REQUIRED stage this school's
      //    configuration demands that is not yet complete. A school configured
      //    Application → Enrollment has none, so a submitted application passes
      //    straight through; a Selective school does not.
      // 0. The term must belong to the year the family applied for. Enrolling a
      //    2027 applicant into a 2026 term placed them a year early, and the
      //    capacity counted against the wrong year (E2E audit AD2).
      if (app.academicYearId) {
        const term = await tx.term.findFirst({ where: { id: dto.termId }, select: { academicYearId: true, name: true } });
        if (!term) throw new NotFoundException(`Term ${dto.termId} not found`);
        if (term.academicYearId !== app.academicYearId) {
          throw new BadRequestException(
            `${term.name} is not in the academic year this application is for. Choose a term of that year.`,
          );
        }
      }

      const stages = this.workflow.stagesFor(app);
      this.workflow.validateProgress(app, 'ENROLLMENT', stages);

      // 2. The workflow's authorization for a direct transition, plus the record of
      //    what it bypasses. Both are derived here, on the server, from the
      //    application's frozen snapshot — never from the request.
      const workflowAllowed = this.workflow.shortcutAllowed(app, stages);
      const skippedStages = this.workflow.skippedStagesFor(app, 'ENROLLMENT', stages);

      // 2b. FSM legality, checked HERE rather than only at the closing applyReview.
      //     The transition would be rejected there anyway and the transaction rolled
      //     back, but not before a Partner, StudentProfile and Enrollment had been
      //     created and a seat claimed. Fail before doing any of that work.
      this.assertTransition(app.status, 'enroll', workflowAllowed);

      // 3. The eligibility gate is enforced, not advisory: every required stage
      //    complete, offer valid where the workflow uses offers, required documents
      //    verified, application fee settled, and a seat available in the target
      //    class. None of these is skippable by configuration.
      const gate = await this.checkEligibility(tx, app.id, {
        classId: dto.classId,
        sectionId: dto.sectionId ?? null,
        termId: dto.termId,
      });
      if (gate.status !== 'READY') {
        throw new BadRequestException(
          `Application ${dto.applicationId} is not ready to enroll: ${gate.missing.join('; ')}.`,
        );
      }

      // 3b. Identity. An applicant flagged as possibly an existing pupil must be
      //     resolved before admission: either confirmed as the same child (then
      //     the existing record is re-used — one child, one student record) or
      //     dismissed. Admitting with an open match is how duplicates are born.
      const matches = await tx.applicantIdentityMatch.findMany({
        where: { applicationId: app.id, candidateType: 'student' },
        select: { status: true, candidateId: true, candidateName: true },
      });
      const open = matches.filter((m: any) => m.status === 'open');
      if (open.length > 0) {
        throw new BadRequestException(
          `Application ${app.applicationNumber ?? app.id} may be an existing pupil (${open.map((m: any) => m.candidateName).join(', ')}). ` +
            'Confirm or dismiss the identity match before enrolling.',
        );
      }
      const confirmed = [...new Set(matches.filter((m: any) => m.status === 'confirmed_same').map((m: any) => m.candidateId))];
      if (confirmed.length > 1) {
        throw new BadRequestException('The applicant is confirmed as more than one existing pupil. Dismiss the wrong match.');
      }
      const existingStudentProfileId = (confirmed[0] as string | undefined) ?? null;

      // Concurrency-safe seat claim. `claimedSeats` is the SINGLE seat ledger (see the
      // capacity state contract on `resolveCapacity`): it counts every seat consumed by a
      // committed or in-flight enrollment, and is released on withdrawal. The claim is a
      // conditional update inside this transaction — it only succeeds while
      // claimedSeats < capacity − reserved — so the loser of a race on the last seat
      // affects 0 rows and is rejected. At most `capacity − reserved` enrollments ever
      // commit for this row.
      //
      // `occupied` (the derived Enrollment count) is deliberately NOT in this guard.
      // Subtracting it as well double-counted every committed seat — it appears in both
      // `occupied` and `claimedSeats` once the enrollment commits — so a capacity-2 class
      // admitted only one student sequentially. `occupied` is now a reporting figure only.
      if (gate.capacity?.id) {
        const cap = gate.capacity;
        const headroom = cap.capacity - cap.reservedCapacity;
        const claimed = await tx.admissionCapacity.updateMany({
          where: {
            id: cap.id,
            claimedSeats: { lt: headroom },
          },
          data: { claimedSeats: { increment: 1 } },
        });
        if (claimed.count === 0) {
          throw new BadRequestException(
            `No seat available for the requested class (capacity ${cap.capacity}, reserved ${cap.reservedCapacity}, claimed ${cap.claimedSeats ?? 0}).`,
          );
        }
      }

      const input: AdmitStudentInput = {
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
        // Separate admission/student numbers: admissionNo is generated (STU-...)
        // unless explicitly supplied; do NOT reuse applicationNumber.
        admissionNo: undefined,
        guardians: dto.student.guardians,
        existingStudentProfileId,
        placement: {
          termId: dto.termId,
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          rollNumber: dto.rollNumber,
        },
      };

      // Same transaction as the status change: a student can no longer be created
      // and left behind an application still sitting in 'offer_accepted'.
      const { profile, partner, enrollment } = await this.admission.admit(input, tx);

      // Promote the application's structured guardians into real Contact +
      // StudentGuardian rows. Previously guardians lived as flat strings in
      // customFields and were dropped on the floor at enrollment, so every
      // enrolled student had zero guardians (no fee payer, no emergency contact).
      await this.promoteGuardians(tx, app.id, organizationId, profile.partnerId, profile.id);
      await this.copyApplicationDocuments(tx, app.id, profile.id);

      await this.applyReview(
        tx,
        app.id,
        'enroll',
        undefined,
        { allowed: workflowAllowed, skippedStages },
        app.status,
      );

      await this.events.publishInTx(tx, EVENTS.SchoolAdmissionEnrolled, {
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
   * Bulk enroll a set of offer_accepted applications. Each item is validated first;
   * readiness is reported in `enrolled`/`skipped` per item. (Phase-5 preview UI will
   * call validate-only before execute — this remains the execute path.)
   */
  async bulkEnroll(dto: BulkEnrollDto) {
    const enrolled: any[] = [];
    const skipped: Array<{ applicationId: string; reason: string }> = [];

    // Delegates to enroll() per item rather than re-implementing it. The previous
    // copy checked only `status === 'offer_accepted'`, so a bulk run bypassed the
    // document / fee / capacity gate that the single-enrollment path applies —
    // and each item's student creation was not atomic with its status change.
    for (const item of dto.items) {
      try {
        const res = await this.enroll(item);
        enrolled.push({
          applicationId: item.applicationId,
          studentProfileId: res.studentProfile.id,
          enrollmentId: res.enrollment.id,
        });
      } catch (err) {
        skipped.push({
          applicationId: item.applicationId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
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
          // A re-issued offer starts a fresh lifecycle; without this reset a
          // revised offer inherited the previous acceptedAt/declinedAt.
          acceptedAt: null,
          declinedAt: null,
          withdrawnAt: null,
          viewedAt: null,
          version: { increment: 1 },
        },
      });
      await this.applyReview(tx, applicationId, 'issue_offer');
      await tx.admissionApplication.updateMany({
        where: { id: applicationId },
        data: { offerIssuedAt: new Date() },
      });
      return offer;
    });
  }

  /**
   * Accept an issued offer.
   *
   * Three things were wrong here and all three mattered:
   *  - `OfferLetter.expiresAt` was written by issueOffer and read by nothing, so
   *    an offer that lapsed two years ago was still acceptable.
   *  - the OfferLetter row was never moved to 'accepted' (declineOffer did move
   *    it to 'declined'), so the offer and the application disagreed.
   *  - `this.prisma.client` was passed where a transaction client belongs, so the
   *    status write and its audit row were not atomic.
   */
  async acceptOffer(applicationId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'accept_offer');

      const offer = await tx.offerLetter.findFirst({ where: { applicationId } });
      if (!offer) throw new BadRequestException(`Application ${applicationId} has no offer on file`);
      if (offer.status === 'withdrawn') {
        throw new BadRequestException(`Offer for application ${applicationId} has been withdrawn`);
      }
      if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
        await tx.offerLetter.updateMany({ where: { applicationId }, data: { status: 'expired' } });
        throw new BadRequestException(
          `Offer for application ${applicationId} expired on ${offer.expiresAt.toISOString().slice(0, 10)}.`,
        );
      }

      await tx.offerLetter.updateMany({
        where: { applicationId },
        data: { status: 'accepted', acceptedAt: new Date(), declinedAt: null },
      });
      const result = await this.applyReview(tx, applicationId, 'accept_offer');
      await tx.admissionApplication.updateMany({
        where: { id: applicationId },
        data: { offerAcceptedAt: new Date() },
      });
      return result;
    });
  }

  /**
   * Expire every issued offer whose expiresAt has passed, AND move its still-in-flight
   * application to offer_expired. Called by the offer-expiry cron; safe to re-run.
   * Only applications still sitting in offer_issued are transitioned — one already
   * accepted/declined is left as-is.
   */
  async expireLapsedOffers(now: Date = new Date()) {
    const lapsed = await this.prisma.client.offerLetter.findMany({
      where: { status: { in: ['issued', 'viewed'] }, expiresAt: { lt: now } },
      select: { applicationId: true },
    });
    let expired = 0;
    for (const o of lapsed) {
      await this.prisma.client.$transaction(async (tx: any) => {
        await tx.offerLetter.updateMany({ where: { applicationId: o.applicationId }, data: { status: 'expired' } });
        const app = await tx.admissionApplication.findFirst({ where: { id: o.applicationId } });
        if (app && app.status === 'offer_issued') {
          await this.applyReview(tx, o.applicationId, 'expire_offer', 'Offer lapsed unaccepted');
        }
      });
      expired++;
    }
    return { expired };
  }

  async declineOffer(applicationId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      this.assertTransition(app.status, 'decline_offer');
      await tx.offerLetter.updateMany({
        where: { applicationId },
        data: { status: 'declined', acceptedAt: null, declinedAt: new Date() },
      });
      return this.applyReview(tx, applicationId, 'decline_offer');
    });
  }

  /**
   * Transfer an already-enrolled student IN from another school. Delegates the
   * student-record creation to StudentAdmissionService (no application); the
   * enrollment is typed TRANSFER_IN and the profile records transferredFrom.
   */
  async transferIn(dto: TransferInDto) {
    const organizationId = this.tenant.organizationId;
    const { profile, enrollment } = await this.admission.admit({
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
      studentCategoryId: dto.studentCategoryId ?? null,
      admissionNo: dto.admissionNo ?? undefined,
      customFields: { transferredFrom: dto.transferredFrom ?? null },
      placement: {
        termId: dto.termId,
        classId: dto.classId,
        sectionId: dto.sectionId ?? null,
        rollNumber: dto.rollNumber,
        enrollmentType: 'TRANSFER_IN',
      },
    });
    return { studentProfile: profile, enrollment };
  }

  /**
   * Withdraw a learner — delegates to StudentEnrollmentService, the single owner
   * of enrollment status. Closing the placement returns any admission seat.
   */
  async withdrawStudent(studentProfileId: string, dto: WithdrawStudentDto) {
    const active = await this.prisma.client.studentEnrollment.findFirst({
      where: { studentProfileId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      orderBy: { admissionDate: 'desc' },
    });
    if (!active) throw new NotFoundException(`No active enrollment for student ${studentProfileId}`);
    return this.studentEnrollments.withdraw(active.id, { reason: dto.reason, effectiveAt: dto.effectiveDate });
  }

  /**
   * Bring a withdrawn or transferred-out learner back.
   *
   * Within the same academic year this reinstates their enrollment with a fresh
   * placement (RE_ENTRY); in a later year it opens that year's enrollment. The
   * placement re-claims an admission seat where one was configured.
   */
  async reEnroll(studentProfileId: string, dto: ReEnrollDto) {
    const term = await this.prisma.client.term.findFirst({
      where: { id: dto.termId },
      select: { id: true, academicYearId: true },
    });
    if (!term) throw new NotFoundException(`Term ${dto.termId} not found`);
    const placement = {
      termId: term.id,
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
      rollNumber: dto.rollNumber,
    };
    const sameYear = await this.prisma.client.studentEnrollment.findFirst({
      where: { studentProfileId, academicYearId: term.academicYearId },
    });
    if (sameYear) {
      return this.studentEnrollments.changeStatus(sameYear.id, {
        toStatus: 'ACTIVE',
        reason: 'Re-enrolled',
        placement: { ...placement, movementReason: 'RE_ENTRY' },
      } as any);
    }
    const prior = await this.prisma.client.studentEnrollment.findFirst({ where: { studentProfileId } });
    if (!prior) throw new NotFoundException(`No enrollment found for student ${studentProfileId}`);
    return this.studentEnrollments.create({
      studentProfileId,
      academicYearId: term.academicYearId,
      enrollmentType: 'RE_ENTRY',
      notes: 'Re-enrolled',
      placement: { ...placement, movementReason: 'RE_ENTRY' },
    } as any);
  }

  /**
   * Apply a `review()`-style transition (status change + audit + event) inside
   * an existing transaction. Shared by the interview/score/offer helpers so the
   * FSM guard + audit trail stay consistent with review().
   */
  /**
   * The single canonical transition engine. Every status change in the module —
   * review(), the interview/score/offer helpers, recordDecision, enroll — routes
   * through here, so the FSM guard, the milestone timestamp, the append-only
   * status history, the AuditLog row and the domain event are applied uniformly
   * and cannot be bypassed. `review()` used to carry a second copy of all of this.
   */
  private async applyReview(
    tx: any,
    applicationId: string,
    action: string,
    reason?: string,
    /**
     * Workflow extension + provenance, supplied only by callers that resolved the
     * workflow first (currently enroll()). `skippedStages` is what this REAL
     * transition legitimately bypassed; it is always computed server-side from the
     * snapshot and never accepted from a request body.
     */
    workflow?: { allowed: readonly string[]; skippedStages: StageKey[] },
    /**
     * The status the caller validated against when it began. enroll() checks
     * the workflow, eligibility and seat for the status it read FIRST, then does
     * a lot of work before arriving here; a concurrent withdraw committed in
     * between must fail this call, not be overwritten — the workflow shortcut
     * would otherwise legalise 'enroll' from whatever status it finds now.
     */
    expectedStatus?: string,
  ) {
    const newStatus = STATUS_MAP[action];
    if (!newStatus) throw new BadRequestException(`Unknown admission action: ${action}`);
    const before = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!before) throw new NotFoundException(`Application ${applicationId} not found`);
    if (expectedStatus && before.status !== expectedStatus) {
      throw new ConflictException(
        `Application ${before.applicationNumber ?? applicationId} changed while you were working on it ` +
          `(it is now '${before.status}'). Reload it and try again.`,
      );
    }

    // Decision-grade actions must carry a non-empty reason. Enforced here (not
    // just in the UI) so the rule holds even if the web client is bypassed.
    const REQUIRED_REASON_ACTIONS = ['accept', 'reject', 'waitlist', 'withdraw'];
    if (REQUIRED_REASON_ACTIONS.includes(action) && (!reason || !reason.trim())) {
      throw new BadRequestException(
        `A reason is required to ${action} an application.`,
      );
    }

    this.assertTransition(before.status, action, workflow?.allowed ?? []);

    const stampField = TIMESTAMP_MAP[action];
    // Compare-and-set on the status we validated against. Two officers acting on
    // one application at once (enroll vs withdraw) both read the same `before`
    // and both passed the FSM check; the last write won and the history showed
    // two transitions out of one state (E2E audit AD1). Now the loser updates
    // nothing and gets a 409 instead of silently overwriting.
    const cas = await tx.admissionApplication.updateMany({
      where: { id: applicationId, status: expectedStatus ?? before.status },
      data: {
        status: newStatus,
        ...(reason ? { decisionNotes: reason } : {}),
        ...(stampField ? { [stampField]: new Date() } : {}),
      },
    });
    if (cas.count === 0) {
      throw new ConflictException(
        `Application ${before.applicationNumber ?? applicationId} changed while you were working on it ` +
          `(it is no longer '${before.status}'). Reload it and try again.`,
      );
    }

    // NOTE: the admission seat is released when the learner's enrollment ends
    // (StudentEnrollmentService), not here. `enrolled` is a TERMINAL admission status (ADMISSION_TRANSITIONS above),
    // so a release hanging off `withdraw` from `enrolled` could never fire — a seat
    // was never actually returned, and every departure permanently shrank the class.
    // Ending the Enrollment is the path that really happens.

    // Queryable per-application timeline the UI renders (the AuditLog is the
    // system-wide record; this is the admissions-scoped one).
    await tx.admissionStatusHistory.create({
      data: {
        organizationId: before.organizationId,
        applicationId,
        fromStatus: before.status,
        toStatus: newStatus,
        action,
        reason: reason ?? null,
        // Which business stages this real transition bypassed, e.g. a `simple`
        // workflow enrolling straight from `submitted`. Nothing is synthesized: there
        // is no fabricated `accepted`/`offer_issued`/`offer_accepted` row and no
        // OfferLetter, so `offer_issued` always means an offer really was issued.
        skippedStages: workflow?.skippedStages ?? [],
        changedById: this.tenant.userId ?? null,
      },
    });

    await this.audit.recordInTx(tx, {
      entity: 'AdmissionApplication',
      entityId: applicationId,
      action: AUDIT_ACTION_MAP[action] ?? 'update',
      oldValues: { status: before.status },
      newValues: { status: newStatus, action, reason },
    });

    const eventName = EVENT_MAP[action];
    if (eventName) {
      await this.events.publishInTx(tx, eventName as any, {
        organizationId: this.tenant.organizationId,
        applicationId,
        reason: reason ?? action,
      });
    }
    return { id: applicationId, status: newStatus };
  }

  /**
   * Reusable FSM guard that throws BadRequestException on an illegal transition.
   *
   * `workflowAllowed` is the narrow extension the admission workflow may grant on top
   * of ADMISSION_TRANSITIONS — see AdmissionsWorkflowService.shortcutAllowed(). It can
   * only ever ADD an action, never remove one, and only ever an action belonging to
   * the application's next required stage when every intervening stage is configured
   * `skip`. The base table itself is never rewritten, so the FSM stays the canonical
   * description of the domain.
   */
  private assertTransition(current: string, action: string, workflowAllowed: readonly string[] = []) {
    const allowed = ADMISSION_TRANSITIONS[current] ?? [];
    if (allowed.includes(action) || workflowAllowed.includes(action)) return;
    throw new BadRequestException(
      `Cannot ${action} an application in status '${current}'. ` +
        `Allowed actions from '${current}': [${allowed.join(', ') || '(none — terminal)'}].`,
    );
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
      // Entrance scores were editable forever, including after the admission
      // decision and after enrollment, with no audit row. Once a decision has
      // been taken the score that informed it must not move underneath it.
      if (['accepted', 'rejected', 'waitlisted', 'offer_issued', 'offer_accepted', 'enrolled', 'withdrawn'].includes(app.status)) {
        throw new BadRequestException(
          `Cannot change entrance-exam scores on a '${app.status}' application — the decision has already been taken.`,
        );
      }
      if (dto.maxScore != null && dto.score > dto.maxScore) {
        throw new BadRequestException(`Score ${dto.score} exceeds maxScore ${dto.maxScore}`);
      }
      const prior = await tx.entranceExam.findFirst({
        where: { applicationId: dto.applicationId, subjectId: dto.subjectId },
      });
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
      await this.audit.recordInTx(tx, {
        entity: 'EntranceExam',
        entityId: row.id,
        action: prior ? ('update' as const) : ('create' as const),
        oldValues: prior ? { score: prior.score, maxScore: prior.maxScore, grade: prior.grade } : undefined,
        newValues: { applicationId: dto.applicationId, subjectId: dto.subjectId, score: dto.score, maxScore: dto.maxScore ?? 100, grade: dto.grade },
      });
      return row;
    });
  }

  /**
   * Public transition entrypoint. Now a thin wrapper over the shared engine —
   * it used to carry a second, drifting copy of the status map, guard, audit and
   * event logic (with `decline_offer` still mapped to the wrong target).
   */
  async review(applicationId: string, action: string, notes?: string) {
    // Accept / reject / waitlist are DECISIONS, separately delegable from the
    // processing actions that share this endpoint (screen, interview, score...).
    if (['accept', 'reject', 'waitlist'].includes(action)) this.assertMayDecide();
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.applyReview(tx, applicationId, action, notes);
      return tx.admissionApplication.findFirst({ where: { id: applicationId } });
    });
  }

  async addDocument(applicationId: string, type: string, fileId: string, required = false) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      // The File must belong to this tenant. `file` is org-scoped, so a fileId
      // from another organization simply does not resolve — without this check an
      // application could be made to reference a file it must not expose.
      const file = await tx.file.findFirst({ where: { id: fileId, deletedAt: null }, select: { id: true } });
      if (!file) throw new BadRequestException(`File ${fileId} not found`);

      const row = await tx.applicationDocument.create({
        data: {
          organizationId: app.organizationId,
          applicationId,
          type,
          required,
          // P0/B10: references a platform File row instead of a bare URL string.
          fileId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ApplicationDocument',
        entityId: row.id,
        action: 'create',
        newValues: { applicationId, type, fileId, required },
      });
      return row;
    });
  }

  /**
   * Verify or reject a supporting document. Rejection now carries a reason so the
   * applicant can be told what to replace, and either way the decision is audited
   * — document verification gates enrollment, so it is a decision-grade action.
   */
  async verifyDocument(documentId: string, verified: boolean, rejectionReason?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.applicationDocument.findFirst({ where: { id: documentId } });
      if (!before) throw new NotFoundException(`Document ${documentId} not found`);
      if (!verified && !rejectionReason) {
        throw new BadRequestException('A rejection reason is required when rejecting a document');
      }
      await tx.applicationDocument.updateMany({
        where: { id: documentId },
        data: {
          verified,
          verifiedById: this.tenant.userId ?? null,
          verifiedAt: verified ? new Date() : null,
          rejectionReason: verified ? null : (rejectionReason ?? null),
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ApplicationDocument',
        entityId: documentId,
        action: verified ? ('approve' as const) : ('reject' as const),
        oldValues: { verified: before.verified, rejectionReason: before.rejectionReason },
        newValues: { verified, rejectionReason: verified ? null : rejectionReason },
      });
      return { id: documentId, verified, rejectionReason: verified ? null : (rejectionReason ?? null) };
    });
  }

  /** ============================================================
   *  PHASE 3–5: Cycles, Capacity, Criteria/Scoring, Offers,
   *  Waitlist, Prerequisites, Bulk Preview, Analytics (SLA).
   *  ============================================================ */

  // ---- Admission Cycle ----
  async createCycle(dto: { academicYearId: string; name: string; opensAt?: string; closesAt?: string; admissionCycleId?: never }) {
    const organizationId = this.tenant.organizationId;
    if (!dto.academicYearId) throw new BadRequestException('academicYearId is required.');
    // Validate the academic year belongs to this organization.
    const ay = await this.prisma.client.academicYear.findFirst({ where: { id: dto.academicYearId, organizationId } });
    if (!ay) throw new BadRequestException('Academic year not found for this organization.');
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

  // ── Nationalities (org-scoped master data) ──
  async listNationalities() {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.nationality.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async createNationality(dto: { name: string }) {
    const organizationId = this.tenant.organizationId;
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nationality name is required.');
    const existing = await this.prisma.client.nationality.findFirst({
      where: { organizationId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      // Hard duplicate within the org (Task 6): reject rather than silently
      // re-activating, so the UI can surface a clear "already exists" message.
      if (existing.isActive) {
        throw new ConflictException(`Nationality "${name}" already exists.`);
      }
      // Allow re-creation of a deactivated (soft-removed) value by re-activating it.
      return this.prisma.client.nationality.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return this.prisma.client.nationality.create({ data: { organizationId, name } });
  }

  async updateNationality(id: string, dto: { name?: string; isActive?: boolean }) {
    const organizationId = this.tenant.organizationId;
    const current = await this.prisma.client.nationality.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException(`Nationality ${id} not found.`);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Nationality name cannot be empty.');
      const clash = await this.prisma.client.nationality.findFirst({
        where: { organizationId, name: { equals: name, mode: 'insensitive' }, id: { not: id } },
      });
      if (clash) throw new BadRequestException(`Nationality "${name}" already exists.`);
      data.name = name;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.client.nationality.update({ where: { id }, data });
  }

  // ---- Capacity (DERIVED occupancy; declared capacity stored only) ----
  async setCapacity(dto: {
    admissionCycleId: string;
    classId: string;
    capacity: number;
    sectionId?: string;
    campusId?: string;
    reservedCapacity?: number;
  }) {
    const organizationId = this.tenant.organizationId;
    // Sentinel for null nullable FKs in the compound-unique key. Prisma 6 rejects a
    // real `null` in a compound-unique `where`, so we key the row with '__none__' in
    // BOTH the lookup and the stored value. That keeps the upsert idempotent (no
    // duplicate rows) AND lets findFirst/countOccupied find it. countOccupied maps
    // the sentinel back to `null` when counting placements (which store null).
    const SENT = '__none__';
    const sectionKey = dto.sectionId ?? SENT;
    const where = {
      organizationId_admissionCycleId_classId_sectionId: {
        organizationId,
        admissionCycleId: dto.admissionCycleId,
        classId: dto.classId,
        sectionId: sectionKey,
      },
    } as any;
    return this.prisma.client.admissionCapacity.upsert({
      where,
      create: { organizationId, ...dto, sectionId: sectionKey },
      update: { capacity: dto.capacity, reservedCapacity: dto.reservedCapacity ?? 0 },
    });
  }

  /**
   * Derived occupancy: occupied = learners placed in the class/stream IN THE
   * CYCLE'S ACADEMIC YEAR.
   *
   * The year scope is the point. Without it this counted every enrollment the
   * class had ever had, so from a school's second admissions cycle onward the
   * occupancy — and therefore "available" — was wrong, and grew wronger each year.
   */
  async capacityStatus(admissionCycleId: string) {
    const organizationId = this.tenant.organizationId;
    const cycle = await this.prisma.client.admissionCycle.findFirst({
      where: { id: admissionCycleId, organizationId },
    });
    if (!cycle) throw new NotFoundException(`Admission cycle ${admissionCycleId} not found`);

    const caps = await this.prisma.client.admissionCapacity.findMany({
      where: { organizationId, admissionCycleId },
    });
    const out: any[] = [];
    for (const c of caps) {
      const occupied = await this.countOccupied(this.prisma.client, c, cycle.academicYearId);
      out.push({
        ...c,
        academicYearId: cycle.academicYearId,
        occupied,
        claimedSeats: c.claimedSeats ?? 0,
        // `claimedSeats` is the seat ledger; `occupied` is reported alongside it so an
        // operator can reconcile the two (they should match for settled data). See the
        // capacity state contract on resolveCapacity().
        available: Math.max(0, c.capacity - c.reservedCapacity - (c.claimedSeats ?? 0)),
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

    // The status change goes through applyReview so the FSM guard, the audit row
    // and the domain event all fire — previously this wrote `status: 'scored'`
    // directly, so an `enrolled` application could be dragged back to `scored`.
    return this.prisma.client.$transaction(async (tx: any) => {
      const record = await tx.applicantScore.upsert({
        where: { applicationId },
        create: { organizationId, applicationId, totalScore, breakdown },
        update: { totalScore, breakdown },
      });
      await this.applyReview(tx, applicationId, 'score');
      await tx.admissionApplication.updateMany({
        where: { id: applicationId },
        data: { scoredAt: new Date() },
      });
      return { totalScore, breakdown, record };
    });
  }

  /**
   * Record the final admission decision (accepted/rejected/waitlisted) with reason.
   *
   * The status change is applied through `applyReview`, so the FSM guard rejects a
   * decision taken on a terminal application, and the transition is audited and
   * published like every other one. Writing `status` directly (as this used to)
   * meant `POST /:id/decision` could move an `enrolled` application to `rejected`,
   * leaving a live Enrollment and StudentProfile behind a rejected application.
   *
   * When the applicant is waitlisted we also place them on the WaitingList for the
   * class they applied to, so the waitlist is populated by the decision rather
   * than by a separate manual step nobody remembers to take.
   */
  private assertMayDecide() {
    const held = this.tenant.permissions ?? [];
    if (!held.includes(PERMISSIONS.school.decideAdmissions) && !held.includes('*')) {
      throw new ForbiddenException(
        `Accepting, rejecting or waitlisting an application requires the ${PERMISSIONS.school.decideAdmissions} permission.`,
      );
    }
  }

  async recordDecision(applicationId: string, decision: 'accepted' | 'rejected' | 'waitlisted', reason?: string) {
    this.assertMayDecide();
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

      const action = DECISION_ACTIONS[decision];
      this.assertTransition(app.status, action);

      const score = await tx.applicantScore.findFirst({ where: { applicationId } });
      const decision_ = await tx.admissionDecision.upsert({
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
        update: {
          decision,
          totalScore: score?.totalScore ? Number(score.totalScore) : null,
          breakdown: (score?.breakdown ?? undefined) as any,
          decidedById: this.tenant.userId ?? null,
          reason,
        },
      });

      await this.applyReview(tx, applicationId, action, reason);
      if (decision === 'accepted') {
        await tx.admissionApplication.updateMany({ where: { id: applicationId }, data: { acceptedAt: new Date() } });
      }
      if (decision === 'waitlisted' && app.applyingForClassId) {
        const existing = await tx.waitingList.findFirst({ where: { applicationId } });
        if (!existing) {
          const count = await tx.waitingList.count({
            where: { organizationId, classId: app.applyingForClassId },
          });
          await tx.waitingList.create({
            data: {
              organizationId,
              applicationId,
              classId: app.applyingForClassId,
              position: count + 1,
              notes: reason ?? null,
            },
          });
        }
      }
      await this.events.publishInTx(tx, 'school.admission.decision' as any, { organizationId, applicationId, decision, reason });
      return decision_;
    });
  }

  // ---- Enrollment prerequisites (Phase 4) ----
  /** Returns READY or BLOCKED with the list of missing requirements. */
  async enrollmentEligibility(applicationId: string, target?: EnrollmentTarget) {
    return this.checkEligibility(this.prisma.client, applicationId, target);
  }

  /**
   * Everything the UI needs to render one application's controls, so the browser
   * never reconstructs business rules from raw stage modes.
   *
   * Workflow and eligibility are returned side by side but kept orthogonal: the client
   * renders buttons from the action lists and *enables* them from `eligibility`,
   * showing `missing[]` verbatim when blocked. These lists are guidance, never
   * authorization — every mutating endpoint independently re-runs permissions, FSM
   * legality, workflow and eligibility, and trusts nothing it told a client earlier.
   */
  async applicationWorkflow(applicationId: string) {
    const app = await this.prisma.client.admissionApplication.findFirst({
      where: { id: applicationId },
      include: { offerLetter: true, decision: true },
    });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

    const fsmLegal = ADMISSION_TRANSITIONS[app.status] ?? [];
    const resolution = this.workflow.resolve(app, fsmLegal);
    const snapshot: any = app.workflowSnapshot ?? null;

    return {
      applicationId,
      status: app.status,
      workflow: {
        name: snapshot?.workflowName ?? null,
        presetKey: snapshot?.presetKey ?? 'standard',
        version: snapshot?.version ?? null,
        /** True for applications created before workflows existed. */
        inherited: snapshot == null,
      },
      ...resolution,
      eligibility: await this.checkEligibility(this.prisma.client, applicationId),
    };
  }

  /**
   * The single enrollment gate, shared by the read-only eligibility endpoint and
   * by `enroll()` itself.
   *
   * Previously this lived only in the read-only endpoint, and `enroll()` never
   * called it — so the gate was advisory and nothing enforced it. It also filtered
   * documents on `d.required`, a column that did not exist, so the document check
   * matched an empty set; and it loaded the `fee` relation without ever looking at
   * it, so an applicant who never paid passed.
   */
  private async checkEligibility(client: any, applicationId: string, target?: EnrollmentTarget) {
    const app = await client.admissionApplication.findFirst({
      where: { id: applicationId },
      include: { documents: true, offerLetter: true, fee: true, decision: true },
    });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

    const missing: string[] = [];

    // Workflow half of the gate. The stages a school requires are configurable, so
    // "is this application ready?" is "has every REQUIRED stage before ENROLLMENT been
    // completed?" — not the old hardcoded `status === 'offer_accepted'`, which assumed
    // every school runs an offer round. An already-accepted applicant has cleared the
    // decision stage, so the OFFER stage (if any) is treated as satisfied and the
    // path straight to ENROLLMENT is allowed.
    const stages = this.workflow.stagesFor(app);
    const offerSkipped = stages.find((s) => s.stage === 'OFFER')?.mode === 'skip';
    const nextStage = this.workflow.nextRequiredStage(app, stages);
    // No exemption for `accepted`. See the note in
    // AdmissionsWorkflowService.validateProgress: a school that runs no offer
    // round configures OFFER as `skip` (the `simple` preset), and a school that
    // configured it as REQUIRED gets it enforced.
    const blockedByStage = nextStage !== 'ENROLLMENT';
    if (blockedByStage) {
      missing.push(
        nextStage
          ? `workflow stage ${nextStage} is not complete (status=${app.status})`
          : `application is ${app.status} and cannot be enrolled`,
      );
    }

    // Offer conditions apply only when this school's workflow actually routes through
    // an offer. Everything below — documents, fee, capacity — applies to every school
    // and is never skippable by configuration.
    if (!offerSkipped) {
      if (!app.offerLetter) missing.push('no offer on file');
      else if (app.offerLetter.status === 'withdrawn') missing.push('offer withdrawn');
      else if (app.offerLetter.expiresAt && app.offerLetter.expiresAt.getTime() < Date.now()) {
        missing.push(`offer expired on ${app.offerLetter.expiresAt.toISOString().slice(0, 10)}`);
      }
    }

    const unverified = app.documents.filter((d: any) => d.required && !d.verified);
    if (unverified.length) {
      missing.push(`required documents not verified: ${unverified.map((d: any) => d.type).join(', ')}`);
    }

    // The fee is only a blocker when one was actually charged. Schools that do
    // not charge an application fee must not be blocked by an absent record.
    // Settlement is read from the fee invoice, never from a flag.
    if (!(await this.admissionFees.isSettled(client, app))) missing.push('application fee outstanding');

    const classId = target?.classId ?? app.applyingForClassId ?? null;
    let capacity: Awaited<ReturnType<AdmissionsService['resolveCapacity']>> = null;
    if (classId) {
      capacity = await this.resolveCapacity(client, {
        admissionCycleId: app.admissionCycleId ?? null,
        academicYearId: app.academicYearId,
        classId,
        sectionId: target?.sectionId ?? null,
      });
      if (capacity && capacity.available <= 0) {
        missing.push(
          `no seats available for the requested class (capacity ${capacity.capacity}, reserved ${capacity.reservedCapacity}, claimed ${capacity.claimedSeats})`,
        );
      }
    }

    return {
      applicationId,
      status: missing.length === 0 ? 'READY' : 'BLOCKED',
      missing,
      capacity,
    };
  }

  /**
   * Declared capacity minus reserved seats minus DERIVED occupancy for one
   * class (and stream) in one admission cycle.
   *
   * Occupancy counts only enrollments whose term belongs to the cycle's academic
   * year. `capacityStatus` used to count every enrollment the class had ever had,
   * so from a school's second year onward the occupancy figure — and therefore
   * "available" — was simply wrong.
   *
   * Returns null when no capacity row is configured, which means "unconstrained":
   * a school that has not declared capacity must not be blocked by it.
   */
  private async resolveCapacity(
    client: any,
    key: {
      admissionCycleId: string | null;
      academicYearId: string;
      classId: string;
      sectionId: string | null;
    },
  ): Promise<
    | null
    | { id: string; classId: string; sectionId: string | null; capacity: number; reservedCapacity: number; claimedSeats: number; occupied: number; available: number }
  > {
    if (!key.admissionCycleId) return null;
    const SENT = '__none__';
    const where = {
      organizationId: this.tenant.organizationId,
      admissionCycleId: key.admissionCycleId,
      classId: key.classId,
    };
    // A section-level ledger wins; otherwise the class-level one governs every
    // section of the class. Without the fallback, naming a section silently
    // escaped a class capacity that was configured without per-section rows.
    const row =
      (await client.admissionCapacity.findFirst({ where: { ...where, sectionId: key.sectionId ?? SENT } })) ??
      (key.sectionId ? await client.admissionCapacity.findFirst({ where: { ...where, sectionId: SENT } }) : null);
    if (!row) return null;
    const occupied = await this.countOccupied(client, row, key.academicYearId);
    // `claimedSeats` is an atomic, transaction-level seat claim (see enroll()).
    // `available` is therefore capacity − reserved − claimed, which reflects seats
    // already committed inside in-flight enroll transactions, preventing
    // over-admission under concurrency (two enrolls racing on the last seat).
    return {
      id: row.id,
      classId: row.classId,
      sectionId: row.sectionId,
      capacity: row.capacity,
      reservedCapacity: row.reservedCapacity,
      claimedSeats: row.claimedSeats ?? 0,
      occupied,
      // Capacity state contract:
      //   capacity          declared seats for (cycle, class, stream)
      //   reservedCapacity  seats held back from admissions (siblings, staff, transfers)
      //   claimedSeats      THE SEAT LEDGER — every seat consumed by a committed or
      //                     in-flight enrollment. +1 atomically inside enroll(), −1 when
      //                     an enrolled application is withdrawn. Backfilled from existing
      //                     enrollments by 20260826120000_admissions_workflow.
      //   occupied          learners placed there in the cycle's academic year.
      //                     REPORTING AND RECONCILIATION ONLY — never an input to the
      //                     seat guard, because a committed seat appears in both counters.
      //   available         capacity − reservedCapacity − claimedSeats
      // Seats are consumed only at enrollment: acceptance, offer issue and offer
      // acceptance consume nothing, so an over-issued offer round is caught at the gate.
      available: Math.max(0, row.capacity - row.reservedCapacity - (row.claimedSeats ?? 0)),
    };
  }

  /** Learners placed in a capacity row's class (and stream), in one academic year. */
  private async countOccupied(client: any, cap: any, academicYearId: string): Promise<number> {
    const SENT = '__none__';
    // The capacity row keys "no stream" with the sentinel '__none__'; a class-wide
    // row counts the whole class, a stream row counts that stream.
    const sectionId = cap.sectionId && cap.sectionId !== SENT ? cap.sectionId : null;
    return client.enrollmentPlacement.count({
      where: {
        effectiveTo: null,
        classCohort: { classId: cap.classId, academicYearId },
        ...(sectionId ? { sectionId } : {}),
        enrollment: { status: 'ACTIVE' },
      },
    });
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
  async bulkEnrollPreview(items: Array<{ applicationId: string; classId: string; sectionId?: string; termId: string; rollNumber: string }>) {
    const ready: any[] = [];
    const invalid: Array<{ applicationId: string; reason: string }> = [];
    for (const item of items) {
      const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: item.applicationId } });
      if (!app) { invalid.push({ applicationId: item.applicationId, reason: 'not found' }); continue; }
      if (app.status !== 'offer_accepted') { invalid.push({ applicationId: item.applicationId, reason: `status=${app.status} (expected offer_accepted)` }); continue; }
      const dup = await this.prisma.client.studentEnrollment.findFirst({ where: { admissionApplicationId: item.applicationId } });
      if (dup) { invalid.push({ applicationId: item.applicationId, reason: 'already enrolled' }); continue; }
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
   * Paginated list, each row carrying its resolved workflow actions.
   *
   * The pipeline table renders one set of buttons per row. Resolving that per row
   * over HTTP would be an N+1; resolving it here costs ONE extra query for the whole
   * page (the offer/decision artifacts the completion predicates read), after which
   * resolution is pure computation.
   *
   * Eligibility is deliberately NOT included: it hits capacity and documents per
   * application and belongs on the detail view, where the Enroll dialog fetches it.
   */
  async listWithWorkflow(query: any) {
    const page = await this.list(query);
    const rows: any[] = page.data ?? [];
    if (!rows.length) return page;

    const ids = rows.map((r) => r.id);
    const [offers, decisions] = await Promise.all([
      this.prisma.client.offerLetter.findMany({ where: { applicationId: { in: ids } } }),
      this.prisma.client.admissionDecision.findMany({ where: { applicationId: { in: ids } } }),
    ]);
    const offerBy = new Map(offers.map((o: any) => [o.applicationId, o]));
    const decisionBy = new Map(decisions.map((d: any) => [d.applicationId, d]));

    return {
      ...page,
      data: rows.map((row) => {
        const app = {
          ...row,
          offerLetter: offerBy.get(row.id) ?? null,
          decision: decisionBy.get(row.id) ?? null,
        };
        const fsmLegal = ADMISSION_TRANSITIONS[row.status] ?? [];
        const { stages, ...resolution } = this.workflow.resolve(app, fsmLegal);
        return { ...row, workflow: resolution };
      }),
    };
  }

  /**
   * Enrollment Summary Report (P-enroll-summary): the per-class roll-up of the
   * current student body — male / female, boarding / day, and totals — matching
   * the school's printed enrollment return.
   *
   * Class membership comes from placement history (ADR-027). With `termId`, a
   * learner counts under the class they were placed in during that term, which
   * is the true historical head-count. Without it, under the class they hold
   * today.
   *
   * Compatibility window: a learner with no placement for the term still counts
   * through their legacy Enrollment row for that term (or, with no term, their
   * projection), so a school that has not been backfilled sees the same figures
   * it always did.
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

    // Who counts, and in which class.
    let classOf: Map<string, string>;
    if (termId) {
      const placedIds = await this.placements.studentIdsIn({ classIds }, { termId });
      const resolved = await this.placements.resolve(placedIds, { termId });
      classOf = new Map<string, string>();
      for (const [id, p] of resolved) classOf.set(id, p.classId);
    } else {
      const found = await this.prisma.client.studentProfile.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: 'active' as any,
          ...this.placements.studentWhere({ classIds }),
        },
        select: { id: true },
      });
      const placed = await this.placements.attach(found);
      classOf = new Map(
        placed.filter((p) => p.placement).map((p) => [p.id, p.placement!.classId] as [string, string]),
      );
    }

    const students = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: [...classOf.keys()] }, organizationId: orgId, deletedAt: null, status: 'active' as any },
      select: { id: true, gender: true, residenceType: true },
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
      const classId = classOf.get(s.id) ?? '';
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