import type { AdmissionAction, AdmissionStatus } from '@/features/school/api';

/**
 * One description of the admission lifecycle for the whole UI.
 *
 * `admissions.tsx`, `applications.tsx` and `application-form.tsx` each carried
 * their own copy of this, all three listing 7 of the 15 backend states. Any
 * application the backend put into one of the other 8 rendered as a bare enum
 * string with no buttons, so the record was stranded — and the three copies had
 * already drifted apart from each other.
 *
 * Keep this in step with `ADMISSION_TRANSITIONS` in
 * apps/api/src/modules/school/admissions/admissions.service.ts. The backend is
 * the authority: it refuses an illegal transition regardless of what is shown
 * here, so a mismatch degrades to a clear error rather than a bad write.
 */
export const STATUS_META: Record<AdmissionStatus, { cls: string; label: string }> = {
  draft: { cls: 'bg-zinc-100 text-zinc-500', label: 'Draft' },
  submitted: { cls: 'bg-slate-100 text-slate-700', label: 'Submitted' },
  under_review: { cls: 'bg-amber-100 text-amber-700', label: 'Under review' },
  documents_pending: { cls: 'bg-yellow-100 text-yellow-800', label: 'Documents pending' },
  screening: { cls: 'bg-amber-100 text-amber-800', label: 'Screening' },
  interview_scheduled: { cls: 'bg-violet-100 text-violet-700', label: 'Interview scheduled' },
  // `exam_done` also lands here (STATUS_MAP in admissions.service.ts), so this state
  // means "evaluation outcome recorded" and not necessarily that an interview took
  // place. Labelling it 'Interviewed' misreported every exam-only applicant.
  interviewed: { cls: 'bg-violet-100 text-violet-800', label: 'Evaluation complete' },
  exam_scheduled: { cls: 'bg-sky-100 text-sky-700', label: 'Exam scheduled' },
  scored: { cls: 'bg-cyan-100 text-cyan-800', label: 'Scored' },
  accepted: { cls: 'bg-emerald-100 text-emerald-700', label: 'Accepted' },
  waitlisted: { cls: 'bg-orange-100 text-orange-700', label: 'Waitlisted' },
  offer_issued: { cls: 'bg-blue-100 text-blue-700', label: 'Offer issued' },
  offer_accepted: { cls: 'bg-teal-100 text-teal-800', label: 'Offer accepted' },
  offer_declined: { cls: 'bg-rose-100 text-rose-600', label: 'Offer declined' },
  offer_expired: { cls: 'bg-zinc-100 text-zinc-600', label: 'Offer expired' },
  enrolled: { cls: 'bg-indigo-100 text-indigo-700', label: 'Enrolled' },
  rejected: { cls: 'bg-rose-100 text-rose-700', label: 'Rejected' },
  withdrawn: { cls: 'bg-zinc-100 text-zinc-600', label: 'Withdrawn' },
};

export function statusMeta(status: AdmissionStatus | string) {
  return STATUS_META[status as AdmissionStatus] ?? { cls: 'bg-slate-100 text-slate-700', label: String(status) };
}

/**
 * Statuses whose application record is frozen — mirrors LOCKED_APPLICATION_STATUSES
 * in admissions.service.ts. An enrolled applicant is corrected on the pupil record.
 */
const LOCKED_STATUSES: ReadonlySet<string> = new Set(['enrolled', 'rejected', 'withdrawn', 'offer_declined']);
export function isApplicationLocked(status: AdmissionStatus | string | undefined | null) {
  return !!status && LOCKED_STATUSES.has(status);
}

export type ActionTone = 'default' | 'success' | 'danger';

export interface AdmissionActionSpec {
  action: AdmissionAction;
  label: string;
  tone: ActionTone;
  /** Prompt the operator for a reason before firing. Decisions must carry one. */
  needsNotes?: boolean;
}

/**
 * Actions offered from each state. Mirrors ADMISSION_TRANSITIONS; the offer
 * lifecycle (`issue_offer` → `accept_offer` / `decline_offer`) is routed through
 * the dedicated offer endpoints rather than `/review`, so those states are
 * handled by the offer controls on the page instead of appearing here.
 */
export const NEXT_ACTIONS: Record<AdmissionStatus, AdmissionActionSpec[]> = {
  // A draft is submitted from the application form, not the pipeline table.
  draft: [{ action: 'withdraw', label: 'Discard', tone: 'danger', needsNotes: true }],
  submitted: [
    { action: 'review', label: 'Start review', tone: 'default' },
    { action: 'request_documents', label: 'Request documents', tone: 'default' },
    { action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true },
  ],
  documents_pending: [
    { action: 'resolve_documents', label: 'Documents received', tone: 'success' },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
    { action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true },
  ],
  under_review: [
    { action: 'screen', label: 'Screen', tone: 'default' },
    { action: 'schedule_exam', label: 'Schedule exam', tone: 'default' },
    { action: 'accept', label: 'Accept', tone: 'success', needsNotes: true },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
    { action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true },
  ],
  screening: [
    { action: 'schedule_interview', label: 'Schedule interview', tone: 'default' },
    { action: 'schedule_exam', label: 'Schedule exam', tone: 'default' },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
    { action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true },
  ],
  interview_scheduled: [
    { action: 'complete_interview', label: 'Record outcome', tone: 'default' },
    { action: 'reschedule', label: 'Reschedule', tone: 'default' },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
    { action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true },
  ],
  interviewed: [
    { action: 'score', label: 'Score', tone: 'default' },
    { action: 'schedule_exam', label: 'Schedule exam', tone: 'default' },
    { action: 'accept', label: 'Accept', tone: 'success', needsNotes: true },
    { action: 'waitlist', label: 'Waitlist', tone: 'default', needsNotes: true },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
  ],
  exam_scheduled: [
    { action: 'exam_done', label: 'Exam complete', tone: 'default' },
    { action: 'score', label: 'Score', tone: 'default' },
    { action: 'accept', label: 'Accept', tone: 'success', needsNotes: true },
    { action: 'waitlist', label: 'Waitlist', tone: 'default', needsNotes: true },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
  ],
  scored: [
    { action: 'accept', label: 'Accept', tone: 'success', needsNotes: true },
    { action: 'waitlist', label: 'Waitlist', tone: 'default', needsNotes: true },
    { action: 'reject', label: 'Reject', tone: 'danger', needsNotes: true },
  ],
  // From here the offer controls take over — see `offerStage`.
  accepted: [{ action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true }],
  waitlisted: [{ action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true }],
  offer_issued: [],
  offer_accepted: [],
  offer_declined: [],
  offer_expired: [{ action: 'withdraw', label: 'Withdraw', tone: 'danger', needsNotes: true }],
  enrolled: [],
  rejected: [],
  withdrawn: [],
};

/**
 * Which offer control (if any) belongs on a row, and whether the applicant can
 * be enrolled yet.
 *
 * The Enroll button used to appear at `accepted`, but the backend requires
 * `offer_accepted` — so the primary conversion action on the admissions screen
 * failed every time it was clicked, and the UI offered no route to
 * `offer_accepted` in the first place.
 */
export function offerStage(status: AdmissionStatus | string): 'issue' | 'respond' | 'enroll' | null {
  if (status === 'accepted' || status === 'waitlisted' || status === 'offer_expired') return 'issue';
  if (status === 'offer_issued') return 'respond';
  if (status === 'offer_accepted') return 'enroll';
  return null;
}

/**
 * Button label for each FSM action.
 *
 * Which actions are OFFERED is decided by the backend workflow resolver
 * (`GET /school/admissions/:id/workflow`, and the `workflow` block on each list row) —
 * this map only says how to render one. `NEXT_ACTIONS` above is retained as a
 * fallback for older clients and for tests; it must not drive the pipeline table,
 * because a hardcoded table cannot know which stages a school configured away.
 */
export const ACTION_LABELS: Record<AdmissionAction, string> = {
  submit: 'Submit',
  review: 'Start review',
  request_documents: 'Request documents',
  resolve_documents: 'Documents received',
  screen: 'Screen',
  schedule_interview: 'Schedule interview',
  complete_interview: 'Record interview',
  reschedule: 'Reschedule',
  schedule_exam: 'Schedule exam',
  // `exam_done` lands on the `interviewed` status — see the note on STATUS_META.
  exam_done: 'Exam complete',
  score: 'Score',
  accept: 'Accept',
  reject: 'Reject',
  waitlist: 'Waitlist',
  issue_offer: 'Issue offer',
  accept_offer: 'Offer accepted',
  decline_offer: 'Offer declined',
  expire_offer: 'Expire offer',
  enroll: 'Enroll',
  withdraw: 'Withdraw',
};

/**
 * Decision-grade actions the backend refuses without a reason
 * (REQUIRED_REASON_ACTIONS in admissions.service.ts). The UI prompts for one first so
 * the operator gets a dialog rather than a 400.
 */
export const NEEDS_REASON: AdmissionAction[] = ['accept', 'reject', 'waitlist', 'withdraw'];

/** Human-readable names for the configurable workflow stages. */
export const STAGE_LABELS: Record<string, string> = {
  APPLICATION: 'Application',
  EVALUATION: 'Evaluation',
  DECISION: 'Decision',
  OFFER: 'Offer',
  APPLICANT_ACCEPTANCE: 'Applicant acceptance',
  ENROLLMENT: 'Enrollment',
};
