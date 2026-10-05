/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Admissions & enrollment for the demo school: the configuration a registrar
 * sets up once, and then a year of real admissions traffic replayed through the
 * application's own services.
 *
 *   1  configuration   nationalities, two admission workflows, offer templates
 *   2  cycles          a closed mid-year intake and two open intakes for next year
 *   3  capacity        declared seats per class, per cycle
 *   4  requirements    the paperwork the school asks for, per gate
 *   5  criteria        weighted scoring sets (readiness chat; exam + interview)
 *   6  enquiries       the top of the funnel, some converted, some gone cold
 *   7  applications    ~130 applicants, every pipeline status represented
 *   8  journeys        each applicant driven through the FSM on its own dates
 *
 * Why it goes through the services rather than writing rows: an admission is a
 * status machine with a workflow snapshot, a seat ledger, an application-fee
 * invoice with its own journal entry, identity matching against the existing
 * roll, and — at the end — a Partner, a StudentProfile, an enrollment and a
 * placement. A seed that inserted those by hand would be a second, drifting copy
 * of the admission rules, and the first thing a client clicks is the thing that
 * would be wrong.
 *
 * Idempotent: every configuration row is keyed on a stable name or code, and an
 * applicant is matched on (cycle, first name, last name, date of birth) before
 * anything is created. Re-running refreshes the demo without duplicating it.
 *
 * Deterministic: every choice comes from `rng()` seeded on the applicant's own
 * key, so a screenshot taken last week still matches the screen today.
 */
import type { PrismaClient } from '@prisma/client';
import {
  SCHOOL,
  rng,
  pick,
  int,
  ok,
  warn,
  log,
  NURSERY_GRADES,
  type School,
} from '../shared';
import { addDaysIso, clock, eat, iso, momoTxnId, Timeline, type Ctx } from '../ops/kit';
import * as D from './data';

/* ─────────────────────────────── The shape ───────────────────────────────── */

type Outcome =
  | 'draft'
  | 'submitted'
  | 'documents_pending'
  | 'under_review'
  | 'screening'
  | 'interview_scheduled'
  | 'interviewed'
  | 'exam_scheduled'
  | 'scored'
  | 'accepted'
  | 'waitlisted'
  | 'rejected'
  | 'offer_issued'
  | 'offer_expired'
  | 'offer_declined'
  | 'offer_accepted'
  | 'enrolled'
  | 'withdrawn';

interface CycleSpec {
  key: string;
  name: string;
  yearName: string;
  opens: string;
  closes: string;
  /** A cycle whose window has passed is closed; the live ones stay open. */
  closeAfterSeeding: boolean;
  workflow: 'intake' | 'selective';
  /** Grade codes this cycle admits into. */
  grades: readonly string[];
  /** The term a successful applicant is placed in. */
  term: string;
  /** How many applicants end in each status. */
  plan: Partial<Record<Outcome, number>>;
}

/**
 * Three cycles, which is how a school this size actually runs admissions: the
 * current year's late intake (now closed), next year's main intake for the
 * classes that take anyone, and next year's selective entry for upper primary,
 * where there is an entrance assessment.
 */
const CYCLES: CycleSpec[] = [
  {
    key: 'mid2026',
    name: '2026 Mid-Year Intake',
    yearName: '2026',
    opens: '2026-01-12',
    closes: '2026-06-05',
    closeAfterSeeding: true,
    workflow: 'intake',
    grades: ['BABY', 'MIDDLE', 'TOP', 'P1', 'P2', 'P3', 'P4', 'P5'],
    term: '2026:Term 2',
    plan: { enrolled: 10, rejected: 5, waitlisted: 3, offer_declined: 2, withdrawn: 2 },
  },
  {
    key: 'main2027',
    name: '2027 Intake',
    yearName: '2027',
    opens: '2026-08-03',
    closes: '2026-12-11',
    closeAfterSeeding: false,
    workflow: 'intake',
    grades: ['BABY', 'MIDDLE', 'TOP', 'P1', 'P2', 'P3'],
    term: '2027:Term 1',
    plan: {
      draft: 6,
      submitted: 10,
      documents_pending: 5,
      under_review: 7,
      screening: 5,
      interview_scheduled: 6,
      interviewed: 4,
      scored: 5,
      accepted: 3,
      waitlisted: 5,
      rejected: 4,
      offer_issued: 6,
      offer_expired: 2,
      offer_declined: 2,
      offer_accepted: 4,
      enrolled: 5,
      withdrawn: 2,
    },
  },
  {
    key: 'upper2027',
    name: '2027 Upper Primary Entry (P.4–P.7)',
    yearName: '2027',
    opens: '2026-08-03',
    closes: '2026-10-30',
    closeAfterSeeding: false,
    workflow: 'selective',
    grades: ['P4', 'P5', 'P6', 'P7'],
    term: '2027:Term 1',
    plan: {
      submitted: 3,
      under_review: 3,
      screening: 3,
      exam_scheduled: 4,
      interviewed: 2,
      scored: 4,
      accepted: 2,
      waitlisted: 2,
      rejected: 3,
      offer_issued: 3,
      offer_accepted: 2,
      enrolled: 2,
    },
  },
];

/** One dated step of an applicant's journey. */
type Step =
  | 'review'
  | 'request_documents'
  | 'screen'
  | 'schedule_interview'
  | 'complete_interview'
  | 'schedule_exam'
  | 'exam_marks'
  | 'exam_done'
  | 'score'
  | 'decide_accept'
  | 'decide_waitlist'
  | 'decide_reject'
  | 'issue_offer'
  | 'issue_lapsing_offer'
  | 'accept_offer'
  | 'decline_offer'
  | 'enroll'
  | 'withdraw';

/**
 * The ordered, dated path to each outcome. The day is an offset from the day the
 * application was received; the FSM, not this table, decides what is legal — a
 * path that the workflow refuses would fail loudly rather than quietly skip.
 */
const INTAKE_PATH: Array<{ day: number; step: Step }> = [
  { day: 2, step: 'review' },
  { day: 4, step: 'screen' },
  { day: 6, step: 'schedule_interview' },
  { day: 9, step: 'complete_interview' },
  { day: 11, step: 'score' },
  { day: 13, step: 'decide_accept' },
  { day: 15, step: 'issue_offer' },
  { day: 18, step: 'accept_offer' },
  { day: 20, step: 'enroll' },
];

/** Upper primary adds the entrance examination, which its workflow requires. */
const SELECTIVE_PATH: Array<{ day: number; step: Step }> = [
  { day: 2, step: 'review' },
  { day: 4, step: 'screen' },
  { day: 6, step: 'schedule_interview' },
  { day: 9, step: 'complete_interview' },
  { day: 11, step: 'schedule_exam' },
  { day: 14, step: 'exam_marks' },
  { day: 14, step: 'exam_done' },
  { day: 16, step: 'score' },
  { day: 18, step: 'decide_accept' },
  { day: 20, step: 'issue_offer' },
  { day: 23, step: 'accept_offer' },
  { day: 25, step: 'enroll' },
];

/** Where each outcome stops on its path, and what it does instead at the end. */
const STOP_AFTER: Record<Outcome, Step | null> = {
  draft: null,
  submitted: null,
  documents_pending: 'review',
  under_review: 'review',
  screening: 'screen',
  interview_scheduled: 'schedule_interview',
  interviewed: 'complete_interview',
  exam_scheduled: 'schedule_exam',
  scored: 'score',
  accepted: 'decide_accept',
  waitlisted: 'score',
  rejected: 'score',
  withdrawn: 'review',
  offer_issued: 'issue_offer',
  offer_expired: 'decide_accept',
  offer_declined: 'issue_offer',
  offer_accepted: 'accept_offer',
  enrolled: 'enroll',
};

/** The extra step an outcome takes after leaving the common path. */
const TAIL: Partial<Record<Outcome, { day: number; step: Step }[]>> = {
  documents_pending: [{ day: 3, step: 'request_documents' }],
  waitlisted: [{ day: 13, step: 'decide_waitlist' }],
  rejected: [{ day: 13, step: 'decide_reject' }],
  withdrawn: [{ day: 5, step: 'withdraw' }],
  offer_expired: [{ day: 15, step: 'issue_lapsing_offer' }],
  offer_declined: [{ day: 19, step: 'decline_offer' }],
};

/* ─────────────────────────── The generated applicant ──────────────────────── */

interface Applicant {
  key: string;
  cycle: CycleSpec;
  outcome: Outcome;
  first: string;
  last: string;
  gender: 'male' | 'female';
  dob: string;
  gradeCode: string;
  classId: string;
  sectionId: string | null;
  sectionName: string;
  nationality: string;
  religion: string;
  address: string;
  source: string;
  /** The pupil this applicant is a younger sibling of, when there is one. */
  siblingOfStudentId: string | null;
  previousSchool: { name: string; location: string; lastClass: string; lastYear: string } | null;
  guardians: Array<{
    firstName: string;
    lastName: string;
    relationship: string;
    phone: string;
    altPhone?: string;
    email?: string;
    occupation: string;
    address: string;
    isPrimary: boolean;
    isEmergency: boolean;
    financiallyResponsible: boolean;
  }>;
  /** Day the application was received, as an ISO date. */
  received: string;
  /** How the application fee was handled. */
  fee: 'paid_cash' | 'paid_momo' | 'invoiced' | 'waived' | 'none';
  /** Documents on file, and whether the registrar has verified them. */
  documents: Array<{ code: D.DocumentCode; verified: boolean; required: boolean }>;
  /** Marks for the entrance assessment, when the cycle runs one. */
  marks: Record<string, number>;
  interview: { rating: number; recommendation: 'strong' | 'borderline' | 'weak'; notes: string };
  /** A deliberate showcase: this one is flagged as possibly an existing pupil. */
  leaveIdentityMatchOpen: boolean;
  /** Filled in as the seed runs. */
  id?: string;
  applicationNumber?: string;
}

/* ──────────────────────────────── The stage ───────────────────────────────── */

export async function seedAdmissions(ctx: Ctx): Promise<void> {
  const { prisma, school, O, asOf } = ctx;
  const admissions = ctx.svc('modules/school/admissions/admissions.service', 'AdmissionsService');
  const config = ctx.svc('modules/school/admissions/admissions-config.service', 'AdmissionsConfigService');
  const workflows = ctx.svc('modules/school/admissions/admissions-workflow.service', 'AdmissionsWorkflowService');
  const committee = ctx.svc('modules/school/admissions/admissions-committee.service', 'AdmissionsCommitteeService');
  const fees = ctx.svc('modules/school/admissions/admission-fee.service', 'AdmissionFeeService');
  const portal = ctx.svc('modules/school/admissions/admissions-portal.service', 'AdmissionsPortalService');

  /* ── 1. Configuration ─────────────────────────────────────────────────── */

  console.log('\n── 1. Registrar configuration ──');
  const nationalities = await ctx.as('registrar', () => admissions.listNationalities());
  const haveNationality = new Set(nationalities.map((n: any) => n.name));
  let addedNationalities = 0;
  for (const name of D.NATIONALITIES) {
    if (haveNationality.has(name)) continue;
    await ctx.as('registrar', () => admissions.createNationality({ name }));
    addedNationalities += 1;
  }
  log(`nationalities: ${D.NATIONALITIES.length} on file (${addedNationalities} added this run)`);

  const workflowRows: any[] = await ctx.as('head', () => workflows.list());
  const workflowByName = new Map(workflowRows.map((w: any) => [w.name, w]));
  const ensureWorkflow = async (name: string, presetKey: string, isDefault: boolean) => {
    const existing = workflowByName.get(name);
    if (existing) return existing;
    const created = await ctx.as('head', () => workflows.create({ name, presetKey, isDefault }));
    workflowByName.set(name, created);
    return created;
  };
  const WF = {
    intake: await ensureWorkflow('Nursery & Lower Primary Intake', 'standard', true),
    selective: await ensureWorkflow('Upper Primary Selective Entry', 'selective', false),
  };
  log(`workflows: "${WF.intake.name}" (default, standard) and "${WF.selective.name}" (selective)`);

  const templateRows: any[] = await ctx.as('registrar', async () => await config.listOfferTemplates());
  const templateByName = new Map(templateRows.filter((t: any) => !t.deletedAt).map((t: any) => [t.name, t]));
  const offerTemplates: Record<string, any> = {};
  for (const spec of D.OFFER_TEMPLATES) {
    const body = spec.body.replace(/\{\{school\}\}/g, SCHOOL.profile.name);
    const existing = templateByName.get(spec.name);
    offerTemplates[spec.name] = await ctx.as('registrar', () =>
      config.upsertOfferTemplate({
        id: existing?.id,
        name: spec.name,
        body,
        validityDays: spec.validityDays,
        isDefault: spec.isDefault,
      }),
    );
  }
  log(`offer templates: ${D.OFFER_TEMPLATES.map((t) => t.name).join(', ')}`);

  /* ── 2. Cycles ────────────────────────────────────────────────────────── */

  console.log('\n── 2. Admission cycles ──');
  const cycleRows = new Map<string, any>();
  for (const spec of CYCLES) {
    const year = school.years.get(spec.yearName);
    if (!year) throw new Error(`Academic year ${spec.yearName} not found — run the structure seed first.`);
    const existing = await prisma.admissionCycle.findFirst({
      where: { organizationId: O, academicYearId: year.id, name: spec.name },
    });
    const row =
      existing ??
      (await ctx.as('registrar', () =>
        admissions.createCycle({
          academicYearId: year.id,
          name: spec.name,
          opensAt: spec.opens,
          closesAt: spec.closes,
        }),
      ));
    // The window and the workflow are configuration: refreshed every run so an
    // edited spec takes effect without a reset.
    await prisma.admissionCycle.update({
      where: { id: row.id },
      data: { opensAt: new Date(`${spec.opens}T00:00:00+03:00`), closesAt: new Date(`${spec.closes}T23:59:59+03:00`), status: 'open' },
    });
    await ctx.as('head', () => workflows.assignToCycle(row.id, WF[spec.workflow].id));
    cycleRows.set(spec.key, row);
    log(`${spec.name}: ${spec.opens} → ${spec.closes}, ${WF[spec.workflow].name}`);
  }

  /* ── 3. Capacity ──────────────────────────────────────────────────────── */

  console.log('\n── 3. Declared capacity ──');
  let capacityRows = 0;
  let declaredSeats = 0;
  for (const spec of CYCLES) {
    const cycle = cycleRows.get(spec.key)!;
    for (const gradeCode of spec.grades) {
      const cls = school.classes.get(gradeCode);
      if (!cls) continue;
      const streams = school.sectionsByClassCode(gradeCode);
      const perStream = seatsPerStream(gradeCode);
      // A mid-year intake only fills what leavers left behind; a main intake
      // declares the whole class.
      const capacity = spec.key === 'mid2026' ? Math.max(2, Math.round(perStream * 0.15) * Math.max(1, streams.length)) : perStream * Math.max(1, streams.length);
      const reserved = spec.key === 'main2027' && (NURSERY_GRADES as readonly string[]).includes(gradeCode) ? 2 : 0;
      await ctx.as('registrar', () =>
        admissions.setCapacity({ admissionCycleId: cycle.id, classId: cls.id, capacity, reservedCapacity: reserved }),
      );
      capacityRows += 1;
      declaredSeats += capacity;
    }
  }
  log(`${capacityRows} capacity rows, ${declaredSeats} seats declared in total (staff-child seats reserved in nursery)`);

  /* ── 4. Requirements ──────────────────────────────────────────────────── */

  console.log('\n── 4. Requirements the school asks for ──');
  const existingReqs: any[] = await ctx.as('registrar', async () => await config.listRequirements());
  const reqByKey = new Map(existingReqs.map((r: any) => [`${r.admissionCycleId ?? '-'}:${r.classId ?? '-'}:${r.code}`, r]));
  let reqCount = 0;
  for (const spec of CYCLES) {
    const cycle = cycleRows.get(spec.key)!;
    const nurseryOnly = spec.grades.filter((g) => (NURSERY_GRADES as readonly string[]).includes(g));
    const items: Array<{ code: D.DocumentCode | string; label: string; kind: string; gate: string; required: boolean; classId?: string | null; sortOrder: number }> = [
      { code: 'birth_cert', label: 'Birth certificate (NIRA)', kind: 'document', gate: 'submit', required: true, sortOrder: 1 },
      { code: 'photo', label: 'Passport photograph', kind: 'document', gate: 'submit', required: true, sortOrder: 2 },
      { code: 'lc_letter', label: 'LC1 letter of residence', kind: 'document', gate: 'submit', required: false, sortOrder: 3 },
      { code: 'medical_form', label: 'Completed medical form', kind: 'document', gate: 'enroll', required: false, sortOrder: 4 },
      { code: 'transfer_letter', label: 'Transfer / school leaving letter', kind: 'document', gate: 'enroll', required: false, sortOrder: 5 },
      { code: 'applicantDob', label: 'Date of birth', kind: 'field', gate: 'submit', required: true, sortOrder: 6 },
      { code: 'address', label: 'Home address', kind: 'field', gate: 'submit', required: true, sortOrder: 7 },
    ];
    // Immunisation is asked of nursery entrants only; a report card of everyone
    // joining a primary class, who by definition comes from somewhere.
    for (const gradeCode of nurseryOnly) {
      const cls = school.classes.get(gradeCode);
      if (cls) items.push({ code: 'immunisation_card', label: 'Immunisation card', kind: 'document', gate: 'submit', required: true, classId: cls.id, sortOrder: 8 });
    }
    for (const gradeCode of spec.grades.filter((g) => !(NURSERY_GRADES as readonly string[]).includes(g))) {
      const cls = school.classes.get(gradeCode);
      if (cls) items.push({ code: 'report_card', label: 'Last report card from the previous school', kind: 'document', gate: 'submit', required: true, classId: cls.id, sortOrder: 9 });
    }
    for (const item of items) {
      const key = `${cycle.id}:${item.classId ?? '-'}:${item.code}`;
      await ctx.as('registrar', () =>
        config.upsertRequirement({
          id: reqByKey.get(key)?.id,
          admissionCycleId: cycle.id,
          classId: item.classId ?? null,
          kind: item.kind,
          code: item.code,
          label: item.label,
          required: item.required,
          gate: item.gate,
          sortOrder: item.sortOrder,
        }),
      );
      reqCount += 1;
    }
  }
  log(`${reqCount} requirements across the three cycles (submit gate and enrollment gate)`);

  /* ── 5. Scoring criteria ──────────────────────────────────────────────── */

  console.log('\n── 5. Scoring criteria ──');
  for (const spec of CYCLES) {
    const cycle = cycleRows.get(spec.key)!;
    const already = await prisma.admissionCriteriaSet.findFirst({ where: { organizationId: O, admissionCycleId: cycle.id } });
    if (already) {
      log(`${spec.name}: criteria already configured`);
      continue;
    }
    const criteria =
      spec.workflow === 'selective'
        ? [
            { name: 'Entrance examination', weight: 0.5, maxScore: 100, required: true, passMark: 50 },
            { name: 'Interview', weight: 0.3, maxScore: 100, required: true, passMark: 40 },
            { name: 'Previous report card', weight: 0.2, maxScore: 100, required: false, passMark: 0 },
          ]
        : [
            { name: 'Readiness conversation', weight: 0.6, maxScore: 100, required: true, passMark: 40 },
            { name: 'Age appropriateness', weight: 0.4, maxScore: 100, required: false, passMark: 0 },
          ];
    await ctx.as('dos', () =>
      admissions.createCriteriaSet({
        admissionCycleId: cycle.id,
        name: spec.workflow === 'selective' ? 'Upper primary entry assessment' : 'Nursery & lower primary readiness',
        isDefault: true,
        criteria,
      }),
    );
    log(`${spec.name}: ${criteria.map((c) => `${c.name} ${Math.round(c.weight * 100)}%`).join(', ')}`);
  }

  /* ── 6. Applicants, generated ─────────────────────────────────────────── */

  const roll = await loadRoll(prisma, O);
  const applicants = buildApplicants(school, roll, asOf);
  const examSubjects = await entranceSubjects(prisma, O);

  /* ── 7. Applications ──────────────────────────────────────────────────── */

  console.log(`\n── 7. Applications (${applicants.length}) ──`);
  let reused = 0;
  for (const a of applicants) {
    const cycle = cycleRows.get(a.cycle.key)!;
    const year = school.years.get(a.cycle.yearName)!;
    const existing = await prisma.admissionApplication.findFirst({
      where: {
        organizationId: O,
        admissionCycleId: cycle.id,
        applicantFirstName: a.first,
        applicantLastName: a.last,
        applicantDob: new Date(`${a.dob}T00:00:00Z`),
      },
      select: { id: true, applicationNumber: true, status: true },
    });
    if (existing) {
      a.id = existing.id;
      a.applicationNumber = existing.applicationNumber;
      reused += 1;
      continue;
    }
    // Dated: the clock makes `submittedAt` and the application number's year the
    // day the family actually walked in.
    clock.set(eat(a.received, '09:20'));
    const created = await ctx.as('registrar', () =>
      admissions.create({
        academicYearId: year.id,
        admissionCycleId: cycle.id,
        applicantFirstName: a.first,
        applicantLastName: a.last,
        applicantDob: a.dob,
        applicantGender: a.gender,
        applyingForClassId: a.classId,
        nationality: a.nationality,
        residenceType: 'day',
        entryStatus: a.previousSchool ? 'TRANSFER_IN' : 'NEW',
        address: a.address,
        sourceOfEnquiry: a.source,
        siblingOfStudentId: a.siblingOfStudentId ?? undefined,
        asDraft: a.outcome === 'draft',
        guardians: a.guardians,
        customFields: {
          religion: a.religion,
          ...(a.previousSchool
            ? {
                previousSchoolName: a.previousSchool.name,
                previousSchoolLocation: a.previousSchool.location,
                previousClass: a.previousSchool.lastClass,
                previousYear: a.previousSchool.lastYear,
              }
            : {}),
        },
      }),
    );
    a.id = created.id;
    a.applicationNumber = created.applicationNumber;
    // `submittedAt` and `createdAt` are database defaults, so they carry the real
    // "now" however the clock is set. The day the family walked in is written here.
    await prisma.$executeRawUnsafe(
      `UPDATE "AdmissionApplication" SET "submittedAt" = $2, "createdAt" = $2 WHERE id = $1`,
      created.id,
      eat(a.received, '09:20'),
    );
  }
  clock.reset();
  ok(`${applicants.length} applications (${reused} reused from an earlier run)`);

  // Identity matching: the front desk resolves every flag before the applicant
  // can be admitted. One is deliberately left open so the duplicate guard is
  // visible in the UI.
  let dismissed = 0;
  let leftOpen = 0;
  for (const a of applicants) {
    if (!a.id) continue;
    const matches = await prisma.applicantIdentityMatch.findMany({ where: { applicationId: a.id, status: 'open' } });
    if (matches.length === 0) continue;
    if (a.leaveIdentityMatchOpen) {
      leftOpen += matches.length;
      continue;
    }
    for (const m of matches) {
      await ctx.as('registrar', () => admissions.reviewIdentityMatch(m.id, 'dismissed'));
      dismissed += 1;
    }
  }
  if (dismissed || leftOpen) log(`identity matches: ${dismissed} reviewed and dismissed, ${leftOpen} left open for the registrar`);

  /* Enquiries come after the applications, not before: one that became an
     application has to point at it, and the funnel report is what measures the
     conversion. */

  console.log('\n── 8. Enquiries ──');
  const enquiries = await seedEnquiries(ctx, config, school, applicants);
  log(`${enquiries.created} enquiries on the board (${enquiries.converted} already converted to applications)`);

  /* ── 9. Paperwork, fees and the journey ───────────────────────────────── */

  console.log('\n── 9. Paperwork and application fees ──');
  const files = await ensureDemoFiles(prisma, O, ctx.users.registrar);
  let docRows = 0;
  for (const a of applicants) {
    if (!a.id || a.documents.length === 0) continue;
    const have = new Set(
      (await prisma.applicationDocument.findMany({ where: { applicationId: a.id }, select: { type: true } })).map((d) => d.type),
    );
    for (const doc of a.documents) {
      if (have.has(doc.code)) continue;
      clock.set(eat(addDaysIso(a.received, 1), '11:00'));
      const row = await ctx.as('registrar', () => admissions.addDocument(a.id!, doc.code, files[doc.code], doc.required));
      if (doc.verified) {
        clock.set(eat(addDaysIso(a.received, 2), '14:30'));
        await ctx.as('registrar', () => admissions.verifyDocument(row.id, true));
      }
      docRows += 1;
    }
  }
  clock.reset();
  log(`${docRows} documents attached, the required ones verified by the registrar`);

  const tl = new Timeline();
  let feeEvents = 0;
  for (const a of applicants) {
    if (!a.id || a.fee === 'none') continue;
    const amount = applicationFee(a.gradeCode);
    const r = rng(`fee:${a.key}`);
    tl.add({
      at: eat(addDaysIso(a.received, 1), '10:15'),
      priority: 10,
      label: `fee charge ${a.applicationNumber}`,
      run: async () => {
        const state = await prisma.admissionApplication.findFirst({ where: { id: a.id! }, select: { feeStatus: true, feeInvoiceId: true } });
        if (state?.feeInvoiceId) return;
        await ctx.as('bursar', () => fees.charge(a.id!, { amount, currency: 'UGX' }));
      },
    });
    feeEvents += 1;
    if (a.fee === 'paid_cash' || a.fee === 'paid_momo') {
      const momo = a.fee === 'paid_momo';
      tl.add({
        at: eat(addDaysIso(a.received, 2), momo ? '08:40' : '12:05'),
        priority: 20,
        label: `fee receipt ${a.applicationNumber}`,
        run: async () => {
          const state = await prisma.admissionApplication.findFirst({ where: { id: a.id! }, select: { feeStatus: true } });
          if (state?.feeStatus === 'paid' || state?.feeStatus === 'waived') return;
          await ctx.as(momo ? 'accounts' : 'bursar', () =>
            fees.pay(a.id!, {
              paymentMethod: momo ? 'mobile_money' : 'cash',
              paymentDate: eat(addDaysIso(a.received, 2), momo ? '08:40' : '12:05').toISOString(),
              reference: `Application fee ${a.applicationNumber}`,
              ...(momo
                ? { externalReference: momoTxnId(r, pick(['MTN', 'AIRTEL'] as const, r)), externalReferenceType: 'mobile_money_txn' as const }
                : {}),
            }),
          );
        },
      });
      feeEvents += 1;
    }
    if (a.fee === 'waived') {
      tl.add({
        at: eat(addDaysIso(a.received, 3), '15:40'),
        priority: 20,
        label: `fee waiver ${a.applicationNumber}`,
        run: async () => {
          const state = await prisma.admissionApplication.findFirst({ where: { id: a.id! }, select: { feeStatus: true } });
          if (state?.feeStatus === 'waived') return;
          await ctx.as('head', () =>
            fees.waive(a.id!, pick(
              [
                'Staff child — application fee waived by the Head Teacher.',
                'Orphan support programme; fee waived on the Board bursary.',
                'Hardship case verified by the LC1; fee waived.',
              ] as const,
              r,
            )),
          );
        },
      });
      feeEvents += 1;
    }
  }
  log(`${feeEvents} application-fee events planned (UGX ${applicationFee('TOP').toLocaleString()} nursery, UGX ${applicationFee('P5').toLocaleString()} primary)`);

  console.log('\n── 10. Driving each applicant through the pipeline ──');
  let journeyEvents = 0;
  for (const a of applicants) {
    if (!a.id) continue;
    const steps = journeyFor(a);
    const byDay = new Map<number, Step[]>();
    for (const s of steps) {
      const list = byDay.get(s.day) ?? [];
      list.push(s.step);
      byDay.set(s.day, list);
    }
    for (const [day, group] of [...byDay.entries()].sort((x, y) => x[0] - y[0])) {
      tl.add({
        at: eat(workday(addDaysIso(a.received, day)), `${String(9 + (day % 7)).padStart(2, '0')}:${String((day * 7) % 60).padStart(2, '0')}`),
        priority: 30 + day,
        label: `${a.applicationNumber} ${group.join('+')}`,
        run: () => runSteps(ctx, { admissions, committee, portal }, a, group, school, examSubjects, offerTemplates),
      });
      journeyEvents += 1;
    }
  }
  log(`${journeyEvents} pipeline events planned across ${applicants.filter((a) => a.id).length} applications`);

  console.log(`\n── Replaying admissions (${tl.size} events) ──`);
  await tl.run({ asOf, concurrency: 4, log: (m) => console.log(`  - ${m}`) });
  tl.report();

  // Offers whose deadline passed without an answer lapse, exactly as the
  // offer-expiry worker does it in a running system.
  const expired = await ctx.as('registrar', () => admissions.expireLapsedOffers(new Date(`${asOf}T23:59:59+03:00`)));
  log(`offers lapsed unaccepted: ${Array.isArray(expired) ? expired.length : (expired?.expired ?? 0)}`);

  // A cycle whose window has passed is closed. Done last: a closed cycle must
  // still have been open while its applications were being taken.
  for (const spec of CYCLES) {
    if (!spec.closeAfterSeeding) continue;
    await prisma.admissionCycle.update({ where: { id: cycleRows.get(spec.key)!.id }, data: { status: 'closed' } });
    log(`${spec.name}: closed`);
  }

  console.log('\n── Re-dating what the database stamped "now" ──');
  await restamp(prisma, O);

  await summary(prisma, O, cycleRows);
}

/* ─────────────────────────── Journey construction ─────────────────────────── */

function journeyFor(a: Applicant): Array<{ day: number; step: Step }> {
  if (a.outcome === 'draft' || a.outcome === 'submitted') return [];
  const path = a.cycle.workflow === 'selective' ? SELECTIVE_PATH : INTAKE_PATH;
  const stop = STOP_AFTER[a.outcome];
  const steps: Array<{ day: number; step: Step }> = [];
  for (const s of path) {
    steps.push(s);
    if (stop && s.step === stop) break;
  }
  // `withdrawn` and `documents_pending` leave the path early; their tail replaces
  // everything after the step they stop on.
  const tail = TAIL[a.outcome] ?? [];
  const lastDay = steps.length ? steps[steps.length - 1].day : 0;
  const shift = a.cycle.workflow === 'selective' ? 5 : 0;
  return [...steps, ...tail.map((t) => ({ day: Math.max(t.day + shift, lastDay + 1), step: t.step }))].sort((x, y) => x.day - y.day);
}

/** One day's worth of actions for one applicant, in order. */
async function runSteps(
  ctx: Ctx,
  svc: { admissions: any; committee: any; portal: any },
  a: Applicant,
  group: Step[],
  school: School,
  examSubjects: Array<{ id: string; name: string }>,
  offerTemplates: Record<string, any>,
): Promise<void> {
  const { admissions, committee, portal } = svc;
  const r = rng(`journey:${a.key}`);
  const nursery = (NURSERY_GRADES as readonly string[]).includes(a.gradeCode);
  const id = a.id!;
  const current = async () => (await ctx.prisma.admissionApplication.findFirst({ where: { id }, select: { status: true } }))!.status;

  for (const step of group) {
    const status = await current();
    switch (step) {
      case 'review':
        if (status !== 'submitted') break;
        await ctx.as('registrar', () => admissions.review(id, 'review', 'Application checked in at the front desk.'));
        break;

      case 'request_documents':
        if (status !== 'under_review') break;
        await ctx.as('registrar', () =>
          admissions.review(id, 'request_documents', 'Birth certificate still outstanding; parent telephoned and sent an SMS.'),
        );
        break;

      case 'screen':
        if (status !== 'under_review') break;
        await ctx.as('dos', () =>
          admissions.review(id, 'screen', nursery ? 'Age and immunisation checked against the class range.' : 'Report card and transfer letter checked.'),
        );
        break;

      case 'schedule_interview': {
        if (!['under_review', 'screening'].includes(status)) break;
        const at = eat(workday(addDaysIso(a.received, a.cycle.workflow === 'selective' ? 12 : 8)), int(r, 0, 1) ? '09:00' : '11:30');
        await ctx.as('registrar', () =>
          admissions.scheduleInterview(id, {
            interviewerId: ctx.users[nursery ? 'deputy' : 'dos'],
            scheduledAt: at.toISOString(),
          }),
        );
        break;
      }

      case 'complete_interview': {
        if (status !== 'interview_scheduled') break;
        const rating = a.interview.rating;
        await ctx.as(nursery ? 'deputy' : 'dos', () =>
          admissions.completeInterview(id, {
            rating,
            recommendation: a.interview.recommendation,
            panelNotes: a.interview.notes,
          }),
        );
        break;
      }

      case 'schedule_exam': {
        if (!['under_review', 'screening', 'interviewed'].includes(status)) break;
        await ctx.as('dos', () => admissions.review(id, 'schedule_exam', 'Entrance assessment set for the Saturday sitting.'));
        break;
      }

      case 'exam_marks': {
        for (const subject of examSubjects) {
          const mark = a.marks[subject.name] ?? int(r, 40, 88);
          await ctx.as('dos', () =>
            admissions.addExamScore({
              applicationId: id,
              subjectId: subject.id,
              score: mark,
              maxScore: 100,
              grade: mark >= 80 ? 'D1' : mark >= 70 ? 'D2' : mark >= 60 ? 'C3' : mark >= 50 ? 'C4' : 'P7',
              notes: 'Entrance assessment, Saturday sitting.',
            }),
          );
        }
        break;
      }

      case 'exam_done':
        if ((await current()) !== 'exam_scheduled') break;
        await ctx.as('dos', () => admissions.review(id, 'exam_done', 'Sat the entrance assessment; scripts marked the same day.'));
        break;

      case 'score': {
        if (!['interviewed', 'exam_scheduled', 'under_review', 'scored'].includes(await current())) break;
        // The upper-primary panel records its recommendation before the score is
        // struck — a committee decision, not one person's.
        if (a.cycle.workflow === 'selective') {
          const existing = await ctx.prisma.admissionReviewerAssignment.count({ where: { applicationId: id } });
          if (existing === 0) {
            const assignments = await ctx.as('head', () =>
              committee.assignReviewers(id, [ctx.users.dos, ctx.users.deputy, ctx.users.head], 'reviewer'),
            );
            for (const [i, as_] of (assignments as any[]).entries()) {
              const who = ([ 'dos', 'deputy', 'head' ] as const)[i] ?? 'head';
              await ctx.as(who, () =>
                committee.submitReview(as_.id, {
                  recommendation: a.interview.recommendation === 'weak' ? 'reject' : a.interview.recommendation === 'strong' ? 'accept' : 'waitlist',
                  score: Math.round(average(Object.values(a.marks)) + int(r, -4, 4)),
                  comments: pick(D.PRIMARY_PANEL_NOTES, r),
                }),
              );
            }
          }
        }
        const scores = a.cycle.workflow === 'selective'
          ? {
              'Entrance examination': Math.round(average(Object.values(a.marks))),
              Interview: a.interview.rating * 20,
              'Previous report card': int(r, 50, 90),
            }
          : {
              'Readiness conversation': a.interview.rating * 20,
              'Age appropriateness': ageAppropriateness(a),
            };
        await ctx.as('dos', () => admissions.scoreApplicationWeighted(id, scores));
        break;
      }

      case 'decide_accept':
        await ctx.as('head', () => admissions.recordDecision(id, 'accepted', pick(D.ACCEPT_REASONS, r)));
        break;

      case 'decide_waitlist':
        await ctx.as('head', () => admissions.recordDecision(id, 'waitlisted', pick(D.WAITLIST_REASONS, r)));
        break;

      case 'decide_reject':
        await ctx.as('head', () => admissions.recordDecision(id, 'rejected', pick(D.REJECTION_REASONS, r)));
        break;

      case 'issue_offer':
      case 'issue_lapsing_offer': {
        const st = await current();
        if (!['accepted', 'waitlisted', 'offer_expired'].includes(st)) break;
        const templateName = st === 'waitlisted' ? 'Waiting list letter' : nursery ? 'Admission offer — Nursery' : 'Admission offer — Primary';
        const template = offerTemplates[templateName];
        // A lapsing offer is dated so its deadline has already passed; the expiry
        // worker is what moves it, not this seed.
        const validity = step === 'issue_lapsing_offer' ? -4 : (template?.validityDays ?? 14);
        const expires = eat(addDaysIso(iso(new Date()), validity), '17:00');
        await ctx.as('registrar', () =>
          admissions.issueOffer(id, {
            templateId: template?.id,
            body: renderOffer(template?.body ?? '', a, school),
            expiresAt: expires.toISOString(),
          }),
        );
        // The parent gets a tracking link rather than a telephone call.
        if (a.guardians[0]?.email) {
          try {
            await ctx.as('registrar', () => portal.issueAccessLink(id, a.guardians[0].email!));
          } catch {
            /* the portal link is a convenience; a mail failure must not stop the admission */
          }
        }
        break;
      }

      case 'accept_offer':
        if ((await current()) !== 'offer_issued') break;
        await ctx.as('registrar', () => admissions.acceptOffer(id));
        break;

      case 'decline_offer':
        if ((await current()) !== 'offer_issued') break;
        await ctx.as('registrar', () => admissions.review(id, 'decline_offer', pick(D.DECLINE_NOTES, r)));
        break;

      case 'withdraw':
        await ctx.as('registrar', () => admissions.review(id, 'withdraw', pick(D.WITHDRAW_REASONS, r)));
        break;

      case 'enroll': {
        const st = await current();
        if (!['offer_accepted', 'accepted'].includes(st)) break;
        const term = school.terms.get(a.cycle.term);
        if (!term) {
          warn(`no ${a.cycle.term} — ${a.applicationNumber} cannot be enrolled`);
          break;
        }
        const effective = iso(term.startDate) > iso(new Date()) ? iso(term.startDate) : iso(new Date());
        await ctx.as('registrar', () =>
          admissions.enroll({
            applicationId: id,
            classId: a.classId,
            sectionId: a.sectionId ?? undefined,
            termId: term.id,
            rollNumber: rollNumber(a),
            enrollmentType: a.previousSchool ? 'TRANSFER_IN' : 'NEW',
            enrollmentDate: effective,
            // Next year's intake is confirmed but not yet in class; this year's is.
            enrollmentStatus: a.cycle.yearName === '2026' ? 'ACTIVE' : 'PENDING',
            notes:
              a.cycle.yearName === '2026'
                ? 'Mid-year admission; joined in Term 2.'
                : 'Place confirmed for Term 1 next year; reports on the opening day.',
            ...(a.previousSchool
              ? {
                  previousSchool: {
                    name: a.previousSchool.name,
                    location: a.previousSchool.location,
                    lastClass: a.previousSchool.lastClass,
                    lastYear: a.previousSchool.lastYear,
                  },
                }
              : {}),
          }),
        );
        break;
      }
    }
  }
}

/* ───────────────────────────── Applicant building ─────────────────────────── */

interface RollEntry {
  id: string;
  name: string;
  gradeCode: string;
  dateOfBirth: Date | null;
}

async function loadRoll(prisma: PrismaClient, O: string): Promise<RollEntry[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; code: string | null; dateOfBirth: Date | null }>>(
    `SELECT sp.id, p.name, sc.code, sp."dateOfBirth"
       FROM "StudentProfile" sp
       JOIN "Partner" p ON p.id = sp."partnerId"
       JOIN "StudentEnrollment" se ON se."studentProfileId" = sp.id
       JOIN "EnrollmentPlacement" ep ON ep."enrollmentId" = se.id AND ep."effectiveTo" IS NULL
       JOIN "ClassCohort" cc ON cc.id = ep."classCohortId"
       JOIN "SchoolClass" sc ON sc.id = cc."classId"
      WHERE sp."organizationId" = $1 AND sp."deletedAt" IS NULL
      ORDER BY p.name`,
    O,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, gradeCode: r.code ?? '?', dateOfBirth: r.dateOfBirth }));
}

function buildApplicants(school: School, roll: RollEntry[], asOf: string): Applicant[] {
  const out: Applicant[] = [];
  // Siblings come from the current roll, so the "elder sibling" link points at a
  // pupil the client can actually open.
  const siblingPool = roll.filter((p) => ['P3', 'P4', 'P5', 'P6', 'P7'].includes(p.gradeCode));
  let siblingCursor = 0;

  for (const cycle of CYCLES) {
    // Deepest journeys are the oldest applications: an applicant who is already
    // enrolled applied months ago, one still sitting at `submitted` came in last
    // week. Ordering by depth is what makes the worklist read like a real one.
    const outcomes: Outcome[] = [];
    for (const [outcome, n] of Object.entries(cycle.plan) as Array<[Outcome, number]>) {
      for (let i = 0; i < n; i += 1) outcomes.push(outcome);
    }
    outcomes.sort((x, y) => journeyLength(cycle, y) - journeyLength(cycle, x));

    const anchor = cycle.closeAfterSeeding ? cycle.closes : asOf;
    outcomes.forEach((outcome, i) => {
      const key = `${cycle.key}:${i}`;
      const r = rng(`applicant:${key}`);
      const gradeCode = pick(cycle.grades, r);
      const cls = school.classes.get(gradeCode);
      if (!cls) return;
      const streams = school.sectionsByClassCode(gradeCode);
      const section = streams.length ? streams[i % streams.length] : null;
      const gender: 'male' | 'female' = r() < 0.5 ? 'male' : 'female';
      const first = pick(gender === 'male' ? D.BOY_NAMES : D.GIRL_NAMES, r);
      const last = pick(D.SURNAMES, r);

      // Received date: far enough back that the journey finishes by `anchor`,
      // with the oldest applications spread across the opening weeks.
      const span = journeyLength(cycle, outcome);
      const age = span + 2 + Math.floor(i / 3) * 2;
      let received = addDaysIso(anchor, -age);
      if (received < cycle.opens) received = addDaysIso(cycle.opens, (i % 9) + 1);
      received = workday(received);

      // Every fourth applicant is a younger sibling of somebody on the roll —
      // which is also where most of a Ugandan day school's intake comes from.
      const sibling = i % 4 === 1 && siblingPool.length ? siblingPool[siblingCursor++ % siblingPool.length] : null;
      const surname = sibling ? sibling.name.trim().split(/\s+/).slice(-1)[0] : last;
      const source = sibling ? 'sibling' : pick(['website', 'walk_in', 'referral', 'agent', 'other'] as const, r);

      const motherFirst = pick(D.MOTHER_NAMES, r);
      const fatherFirst = pick(D.FATHER_NAMES, r);
      const area = pick(D.NEIGHBOURHOODS, r);
      const address = `${pick(['Plot', 'House', 'Block'] as const, r)} ${int(r, 2, 240)}, ${area}, ${area === 'Mukono' || area === 'Seeta' ? 'Mukono' : r() < 0.5 ? 'Kampala' : 'Wakiso'}`;
      const motherLed = r() < 0.45;
      const emailHolder = r() < 0.55;
      const guardians: Applicant['guardians'] = [
        {
          firstName: motherLed ? motherFirst : fatherFirst,
          lastName: surname,
          relationship: motherLed ? 'mother' : 'father',
          phone: D.phone(r, 'mtn'),
          altPhone: r() < 0.4 ? D.phone(r, 'airtel') : undefined,
          email: emailHolder ? `${(motherLed ? motherFirst : fatherFirst).toLowerCase()}.${surname.toLowerCase()}@example.ug` : undefined,
          occupation: pick(D.OCCUPATIONS, r),
          address,
          isPrimary: true,
          isEmergency: true,
          financiallyResponsible: true,
        },
      ];
      // Most households give a second contact; a few are single-parent or a
      // guardian raising a relative's child, which is also true to life.
      if (r() < 0.78) {
        guardians.push({
          firstName: motherLed ? fatherFirst : motherFirst,
          lastName: surname,
          relationship: motherLed ? 'father' : 'mother',
          phone: D.phone(r, r() < 0.5 ? 'mtn' : 'airtel'),
          occupation: pick(D.OCCUPATIONS, r),
          address,
          isPrimary: false,
          isEmergency: true,
          financiallyResponsible: r() < 0.3,
        });
      } else if (r() < 0.5) {
        guardians.push({
          firstName: pick(D.MOTHER_NAMES, r),
          lastName: pick(D.SURNAMES, r),
          relationship: 'guardian',
          phone: D.phone(r, 'airtel'),
          occupation: pick(D.OCCUPATIONS, r),
          address,
          isPrimary: false,
          isEmergency: true,
          financiallyResponsible: false,
        });
      }

      const transfer = !(NURSERY_GRADES as readonly string[]).includes(gradeCode) || gradeCode !== 'BABY';
      const prev = transfer && gradeCode !== 'BABY' ? pick(D.PREVIOUS_SCHOOLS, r) : null;
      const interviewRating = ratingFor(outcome, r);

      out.push({
        key,
        cycle,
        outcome,
        first,
        last: surname,
        gender,
        dob: dobFor(gradeCode, cycle.yearName, r),
        gradeCode,
        classId: cls.id,
        sectionId: section?.id ?? null,
        sectionName: section?.name ?? '',
        nationality: r() < 0.9 ? 'Ugandan' : pick(D.NATIONALITIES.slice(1), r),
        religion: pick(D.RELIGIONS, r),
        address,
        source,
        siblingOfStudentId: sibling?.id ?? null,
        previousSchool: prev
          ? {
              name: prev.name,
              location: prev.location,
              lastClass: previousClassOf(gradeCode),
              lastYear: String(Number(cycle.yearName) - 1),
            }
          : null,
        guardians,
        received,
        fee: feePlanFor(outcome, i, r),
        documents: documentsFor(outcome, gradeCode, prev != null),
        marks: Object.fromEntries(['English', 'Mathematics'].map((s) => [s, markFor(outcome, r)])),
        interview: {
          rating: interviewRating,
          recommendation: interviewRating >= 4 ? 'strong' : interviewRating === 3 ? 'borderline' : 'weak',
          notes: pick((NURSERY_GRADES as readonly string[]).includes(gradeCode) ? D.NURSERY_PANEL_NOTES : D.PRIMARY_PANEL_NOTES, r),
        },
        // Set below, on exactly one applicant.
        leaveIdentityMatchOpen: false,
      });
    });
  }

  // One applicant in the live intake carries the name and birthday of a pupil
  // already on the roll — a family re-applying for a child the school already
  // has, which is how duplicate learner records get created. It is left flagged
  // rather than resolved, so the duplicate guard has something to show and the
  // registrar has something to decide.
  const twin = roll.find((p) => p.dateOfBirth != null);
  const candidate = out.find((a) => a.cycle.key === 'main2027' && a.outcome === 'under_review');
  if (twin && candidate) {
    const parts = twin.name.trim().split(/\s+/);
    candidate.first = parts[0];
    candidate.last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    candidate.dob = twin.dateOfBirth!.toISOString().slice(0, 10);
    candidate.leaveIdentityMatchOpen = true;
  }

  return out;
}

function journeyLength(cycle: CycleSpec, outcome: Outcome): number {
  const path = cycle.workflow === 'selective' ? SELECTIVE_PATH : INTAKE_PATH;
  const stop = STOP_AFTER[outcome];
  if (!stop) return 0;
  const idx = path.findIndex((s) => s.step === stop);
  const base = idx >= 0 ? path[idx].day : 0;
  const tail = TAIL[outcome]?.reduce((m, t) => Math.max(m, t.day), 0) ?? 0;
  return Math.max(base, tail) + 2;
}

/** Marks that justify the outcome: a rejected candidate did not pass. */
function markFor(outcome: Outcome, r: () => number): number {
  if (outcome === 'rejected') return int(r, 22, 45);
  if (outcome === 'waitlisted') return int(r, 48, 59);
  if (['accepted', 'offer_issued', 'offer_accepted', 'enrolled', 'offer_declined', 'offer_expired'].includes(outcome)) return int(r, 62, 93);
  return int(r, 45, 82);
}

function ratingFor(outcome: Outcome, r: () => number): number {
  if (outcome === 'rejected') return int(r, 1, 2);
  if (outcome === 'waitlisted') return 3;
  if (['accepted', 'offer_issued', 'offer_accepted', 'enrolled'].includes(outcome)) return int(r, 4, 5);
  return int(r, 2, 5);
}

/** Age in the class range reads as 100; a year out loses points, as it should. */
function ageAppropriateness(a: Applicant): number {
  const expected = expectedAge(a.gradeCode);
  const yearStart = new Date(`${a.cycle.yearName}-02-01T00:00:00Z`).getTime();
  const years = (yearStart - new Date(`${a.dob}T00:00:00Z`).getTime()) / (365.25 * 86_400_000);
  const off = Math.abs(years - expected);
  return Math.max(40, Math.round(100 - off * 25));
}

function expectedAge(gradeCode: string): number {
  const ages: Record<string, number> = { BABY: 3, MIDDLE: 4, TOP: 5, P1: 6, P2: 7, P3: 8, P4: 9, P5: 10, P6: 11, P7: 12 };
  return ages[gradeCode] ?? 6;
}

/** A birthday that puts the child in the class they are applying for. */
function dobFor(gradeCode: string, yearName: string, r: () => number): string {
  const birthYear = Number(yearName) - expectedAge(gradeCode);
  const month = int(r, 1, 12);
  const day = int(r, 1, 28);
  return `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function previousClassOf(gradeCode: string): string {
  const order = ['BABY', 'MIDDLE', 'TOP', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
  const names: Record<string, string> = {
    BABY: 'Baby Class', MIDDLE: 'Middle Class', TOP: 'Top Class',
    P1: 'P.1', P2: 'P.2', P3: 'P.3', P4: 'P.4', P5: 'P.5', P6: 'P.6', P7: 'P.7',
  };
  const i = order.indexOf(gradeCode);
  return i > 0 ? names[order[i - 1]] : 'Home';
}

/** UGX 30,000 for nursery, UGX 50,000 for primary — what the offer letter says. */
function applicationFee(gradeCode: string): number {
  return (NURSERY_GRADES as readonly string[]).includes(gradeCode) ? 30_000 : 50_000;
}

function feePlanFor(outcome: Outcome, i: number, r: () => number): Applicant['fee'] {
  if (outcome === 'draft') return 'none';
  // Anything that reaches a decision has a settled fee — the enrollment gate
  // enforces it, and a demo that cannot enrol is no demo at all.
  const settled = ['accepted', 'offer_issued', 'offer_accepted', 'offer_expired', 'offer_declined', 'enrolled', 'waitlisted', 'scored'];
  if (settled.includes(outcome)) {
    if (i % 11 === 3) return 'waived';
    return r() < 0.45 ? 'paid_momo' : 'paid_cash';
  }
  if (outcome === 'submitted' || outcome === 'documents_pending') return r() < 0.5 ? 'invoiced' : 'paid_momo';
  return r() < 0.7 ? 'paid_cash' : 'invoiced';
}

/**
 * Paperwork on file. An applicant that got past screening has verified
 * documents (the enrollment gate demands it); one sitting in
 * `documents_pending` is missing the birth certificate, which is why it is
 * sitting there.
 */
function documentsFor(outcome: Outcome, gradeCode: string, transfer: boolean): Applicant['documents'] {
  if (outcome === 'draft') return [{ code: 'photo', verified: false, required: false }];
  const nursery = (NURSERY_GRADES as readonly string[]).includes(gradeCode);
  const verified = !['submitted', 'documents_pending', 'under_review'].includes(outcome);
  const docs: Applicant['documents'] = [
    { code: 'photo', verified, required: true },
    { code: 'birth_cert', verified, required: true },
  ];
  if (nursery) docs.push({ code: 'immunisation_card', verified, required: true });
  else docs.push({ code: 'report_card', verified, required: true });
  if (transfer && ['enrolled', 'offer_accepted'].includes(outcome)) docs.push({ code: 'transfer_letter', verified, required: false });
  if (outcome === 'enrolled') docs.push({ code: 'medical_form', verified: true, required: false });
  if (outcome === 'documents_pending') return docs.filter((d) => d.code === 'photo');
  return docs;
}

function rollNumber(a: Applicant): string {
  // Numbered in a band of their own so a mid-year admission never collides with
  // the roll the class started the year with.
  const n = 80 + (Math.abs(hash(a.key)) % 60);
  return `${a.cycle.yearName}/${String(n).padStart(3, '0')}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function average(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Nobody is interviewed, admitted or enrolled on a Sunday. */
function workday(isoDate: string): string {
  let d = isoDate;
  for (let i = 0; i < 3; i += 1) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0) break;
    d = addDaysIso(d, 1);
  }
  return d;
}

function renderOffer(body: string, a: Applicant, school: School): string {
  const cls = school.classes.get(a.gradeCode);
  const className = `${cls?.name ?? a.gradeCode}${a.sectionName ? ` ${a.sectionName}` : ''}`;
  return body
    .replace(/\{\{class\}\}/g, className)
    .replace(/\{\{year\}\}/g, a.cycle.yearName)
    .replace(/\{\{school\}\}/g, SCHOOL.profile.name)
    .replace(/\{\{expiry\}\}/g, 'the date on this letter');
}

/* ──────────────────────────────── Enquiries ───────────────────────────────── */

/**
 * The top of the funnel. Some enquiries became the applications above (so
 * enquiry → application conversion can be measured), some are still being
 * chased, and some went cold — which is the honest shape of any enquiry book.
 */
async function seedEnquiries(
  ctx: Ctx,
  config: any,
  school: School,
  applicants: Applicant[],
): Promise<{ created: number; converted: number }> {
  const existing: any[] = await ctx.as('registrar', async () => await config.listEnquiries());
  const haveNames = new Set(existing.map((e: any) => e.applicantName));
  const year2027 = school.years.get('2027');
  const live = applicants.filter((a) => a.cycle.key === 'main2027' && a.id);
  let created = 0;
  let converted = 0;

  // Twelve enquiries that turned into applications, linked to them.
  for (const [i, a] of live.slice(0, 12).entries()) {
    const name = `${a.first} ${a.last}`;
    if (haveNames.has(name)) continue;
    const r = rng(`enq:${a.key}`);
    const channel = D.ENQUIRY_CHANNELS[i % D.ENQUIRY_CHANNELS.length];
    clock.set(eat(workday(addDaysIso(a.received, -int(r, 4, 25))), '10:40'));
    const row = await ctx.as('registrar', () =>
      config.createEnquiry({
        applicantName: name,
        guardianName: `${a.guardians[0].firstName} ${a.guardians[0].lastName}`,
        phone: a.guardians[0].phone,
        email: a.guardians[0].email,
        academicYearId: year2027?.id,
        interestedClassId: a.classId,
        source: a.source,
        notes: channel.note,
      }),
    );
    await ctx.as('registrar', () => config.markEnquiryConverted(row.id, a.id!));
    created += 1;
    converted += 1;
  }

  // Eighteen that have not (yet) become applications.
  const open: Array<{ name: string; guardian: string; grade: string; status: string; note: string }> = [];
  for (let i = 0; i < 18; i += 1) {
    const r = rng(`enq:open:${i}`);
    const gender = r() < 0.5 ? 'male' : 'female';
    const grade = pick(['BABY', 'MIDDLE', 'TOP', 'P1', 'P2', 'P4', 'P6'] as const, r);
    const channel = pick(D.ENQUIRY_CHANNELS, r);
    open.push({
      name: `${pick(gender === 'male' ? D.BOY_NAMES : D.GIRL_NAMES, r)} ${pick(D.SURNAMES, r)}`,
      guardian: `${pick(r() < 0.5 ? D.MOTHER_NAMES : D.FATHER_NAMES, r)} ${pick(D.SURNAMES, r)}`,
      grade,
      status: i % 5 === 0 ? 'closed' : i % 3 === 0 ? 'contacted' : 'new',
      note: channel.note,
    });
  }
  for (const [i, e] of open.entries()) {
    if (haveNames.has(e.name)) continue;
    const r = rng(`enq:open:row:${i}`);
    const cls = school.classes.get(e.grade);
    clock.set(eat(workday(addDaysIso(ctx.asOf, -int(r, 1, 60))), '15:10'));
    const row = await ctx.as('registrar', () =>
      config.createEnquiry({
        applicantName: e.name,
        guardianName: e.guardian,
        phone: D.phone(r, r() < 0.6 ? 'mtn' : 'airtel'),
        academicYearId: year2027?.id,
        interestedClassId: cls?.id,
        source: pick(['website', 'walk_in', 'referral', 'other'] as const, r),
        notes: e.note,
      }),
    );
    if (e.status !== 'new') {
      await ctx.as('registrar', () =>
        config.updateEnquiry(row.id, {
          status: e.status,
          notes:
            e.status === 'closed'
              ? `${e.note} Called twice; the family has taken a place elsewhere.`
              : `${e.note} Called back and sent the requirements list and fees structure.`,
        }),
      );
    }
    created += 1;
  }
  clock.reset();
  return { created, converted };
}

/* ──────────────────────────── Supporting records ──────────────────────────── */

/**
 * One File row per document type, shared by every application that files that
 * kind of paperwork. The vault holds a reference, not a scanned child's birth
 * certificate: demo data must not pretend to carry real identity documents.
 */
async function ensureDemoFiles(prisma: PrismaClient, O: string, uploadedById: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const doc of D.DOCUMENT_TYPES) {
    const storageKey = `demo/${O}/admissions/${doc.code}`;
    const existing = await prisma.file.findFirst({ where: { storageKey } });
    if (existing) {
      out[doc.code] = existing.id;
      continue;
    }
    const row = await prisma.file.create({
      data: {
        organizationId: O,
        uploadedById,
        filename: doc.filename,
        contentType: doc.filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        byteSize: 148_000,
        storageKey,
        visibility: 'private',
        ownerType: 'AdmissionDemo',
        ownerId: O,
      },
    });
    out[doc.code] = row.id;
  }
  return out;
}

/** English and Mathematics — the two papers an upper-primary entrant sits. */
async function entranceSubjects(prisma: PrismaClient, O: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT id, name FROM "Subject"
      WHERE "organizationId" = $1 AND "deletedAt" IS NULL
        AND (name ILIKE 'English%' OR name ILIKE 'Mathematic%')
      ORDER BY name LIMIT 2`,
    O,
  );
  if (rows.length === 0) warn('no English/Mathematics subject found — entrance marks will be skipped');
  return rows;
}

/**
 * Rows the services wrote carry the business date in their own columns, but
 * `createdAt` is the database's real "now". A worklist sorted by creation would
 * put August's applications beside this morning's, so re-date what this run
 * wrote from the dates the business already recorded.
 */
async function restamp(prisma: PrismaClient, O: string): Promise<void> {
  const statements: Array<[string, string]> = [
    // Every timestamp below is a `@default(now())` column, which PostgreSQL fills
    // with the real clock whatever the seed clock says. Each one is rewritten from
    // a date the business actually recorded.
    [
      'status history',
      `WITH ranked AS (
         SELECT h.id,
                row_number() OVER (PARTITION BY h."applicationId" ORDER BY h."changedAt") rn,
                count(*)     OVER (PARTITION BY h."applicationId") cnt,
                a."submittedAt" t0,
                GREATEST(a."submittedAt", COALESCE(a."enrolledAt", a."offerAcceptedAt", a."offerIssuedAt",
                         a."acceptedAt", a."scoredAt", a."interviewedAt", a."screenedAt", a."submittedAt")) t1
           FROM "AdmissionStatusHistory" h
           JOIN "AdmissionApplication" a ON a.id = h."applicationId"
          WHERE h."organizationId" = $1)
       UPDATE "AdmissionStatusHistory" h
          SET "changedAt" = r.t0 + (r.t1 - r.t0) * ((r.rn - 1)::numeric / GREATEST(r.cnt - 1, 1))
         FROM ranked r WHERE r.id = h.id`,
    ],
    ['documents', `UPDATE "ApplicationDocument" d SET "uploadedAt" = a."submittedAt" + interval '1 day' FROM "AdmissionApplication" a WHERE a.id = d."applicationId" AND d."organizationId" = $1`],
    ['scores', `UPDATE "ApplicantScore" s SET "computedAt" = COALESCE(a."scoredAt", a."submittedAt") FROM "AdmissionApplication" a WHERE a.id = s."applicationId" AND s."organizationId" = $1`],
    ['decisions', `UPDATE "AdmissionDecision" d SET "decidedAt" = COALESCE(a."acceptedAt", a."scoredAt" + interval '2 days', a."submittedAt") FROM "AdmissionApplication" a WHERE a.id = d."applicationId" AND d."organizationId" = $1`],
    ['offer letters', `UPDATE "OfferLetter" o SET "issuedAt" = COALESCE(a."offerIssuedAt", a."acceptedAt", a."submittedAt") FROM "AdmissionApplication" a WHERE a.id = o."applicationId" AND o."organizationId" = $1`],
    ['waiting list', `UPDATE "WaitingList" w SET "addedAt" = COALESCE(a."scoredAt", a."submittedAt") FROM "AdmissionApplication" a WHERE a.id = w."applicationId" AND w."organizationId" = $1`],
    ['reviewer assignments', `UPDATE "AdmissionReviewerAssignment" r SET "assignedAt" = COALESCE(a."scoredAt", a."submittedAt") FROM "AdmissionApplication" a WHERE a.id = r."applicationId" AND r."organizationId" = $1`],
    ['guardians', `UPDATE "AdmissionGuardian" g SET "createdAt" = a."submittedAt" FROM "AdmissionApplication" a WHERE a.id = g."applicationId" AND g."organizationId" = $1`],
    ['enquiries that converted', `UPDATE "AdmissionEnquiry" e SET "createdAt" = a."submittedAt" - interval '12 days' FROM "AdmissionApplication" a WHERE a.id = e."convertedApplicationId" AND e."organizationId" = $1`],
    ['fee invoices', `UPDATE "Document" SET "createdAt" = "issueDate" WHERE "organizationId" = $1 AND "sourceType" = 'school_admission_fee'`],
    ['journal entries', `UPDATE "JournalEntry" SET "createdAt" = COALESCE("postedAt", "postingDate") WHERE "organizationId" = $1 AND "sourceType" LIKE 'school_admission_fee%'`],
    ['enrollments', `UPDATE "StudentEnrollment" SET "createdAt" = "admissionDate" WHERE "organizationId" = $1 AND "admissionApplicationId" IS NOT NULL`],
  ];

  const done: string[] = [];
  for (const [label, sql] of statements) {
    try {
      const n = await prisma.$executeRawUnsafe(sql, O);
      if (n > 0) done.push(`${label} ${n}`);
    } catch (err: any) {
      warn(`re-dating ${label} skipped: ${String(err?.message ?? err).split('\n').pop()?.slice(0, 140)}`);
    }
  }
  log(done.join(', ') || 'nothing to re-date');
}

/** Seats per stream, from the school's own declared class capacity. */
function seatsPerStream(gradeCode: string): number {
  for (const level of SCHOOL.structure) {
    const grade = level.grades.find((g) => g.code === gradeCode);
    if (grade) return grade.capacity ?? 35;
  }
  return 35;
}

async function summary(prisma: PrismaClient, O: string, cycles: Map<string, any>): Promise<void> {
  console.log('\n── Where the pipeline stands ──');
  for (const spec of CYCLES) {
    const cycle = cycles.get(spec.key);
    if (!cycle) continue;
    const rows = await prisma.$queryRawUnsafe<Array<{ status: string; n: number }>>(
      `SELECT status::text, count(*)::int n FROM "AdmissionApplication"
        WHERE "organizationId" = $1 AND "admissionCycleId" = $2 AND "deletedAt" IS NULL
        GROUP BY status ORDER BY n DESC, status`,
      O,
      cycle.id,
    );
    const total = rows.reduce((s, r) => s + r.n, 0);
    console.log(`\n  ${spec.name} — ${total} applications`);
    for (const r of rows) console.log(`    ${r.status.padEnd(20)} ${String(r.n).padStart(3)}`);
  }

  const counts = {
    enquiries: await prisma.admissionEnquiry.count({ where: { organizationId: O, deletedAt: null } }),
    applications: await prisma.admissionApplication.count({ where: { organizationId: O, deletedAt: null } }),
    guardians: await prisma.admissionGuardian.count({ where: { organizationId: O } }),
    documents: await prisma.applicationDocument.count({ where: { organizationId: O } }),
    statusTransitions: await prisma.admissionStatusHistory.count({ where: { organizationId: O } }),
    interviews: await prisma.interview.count({ where: { organizationId: O } }),
    entranceExams: await prisma.entranceExam.count({ where: { organizationId: O } }),
    scores: await prisma.applicantScore.count({ where: { organizationId: O } }),
    decisions: await prisma.admissionDecision.count({ where: { organizationId: O } }),
    committeeReviews: await prisma.admissionReviewerAssignment.count({ where: { organizationId: O } }),
    offerLetters: await prisma.offerLetter.count({ where: { organizationId: O } }),
    waitingList: await prisma.waitingList.count({ where: { organizationId: O } }),
    applicationFees: await prisma.admissionFee.count({ where: { organizationId: O } }),
    identityMatchesOpen: await prisma.applicantIdentityMatch.count({ where: { organizationId: O, status: 'open' } }),
    enrolledFromAdmission: await prisma.studentEnrollment.count({ where: { organizationId: O, admissionApplicationId: { not: null } } }),
  };
  console.log('\n' + JSON.stringify(counts, null, 2));
  ok('admissions & enrollment demo in place');
}
