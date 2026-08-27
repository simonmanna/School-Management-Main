/**
 * Admission workflow stage registry — the single source of truth for which
 * business stages a school's admission process requires.
 *
 * Everything downstream is derived from this file:
 *   - validation   → `sanitizeStages` is the only way stage config enters the DB
 *   - persistence  → `AdmissionWorkflow.stages` (JSONB); six fixed ordered stages
 *                    are configuration, not queryable domain rows, so there is no
 *                    child table and new options need no migration
 *   - the settings UI → `GET /school/admissions/workflows/schema` ships this
 *                    registry to the browser, which renders the controls generically
 *   - the resolver → `admissions-workflow.service.ts` reads STAGE_ACTIONS and the
 *                    stage modes to answer "what may happen next?"
 *
 * The central separation this file exists to protect:
 *
 *   Workflow config  →  "Which business stages does this school require?"  CONFIGURABLE
 *   Eligibility      →  "What must be true before the operation can run?"  NEVER
 *
 * A school configured `Application → Enrollment` still has to satisfy verified
 * documents, the application fee, capacity, FSM legality and permissions. Skipping a
 * *stage* never skips a *condition*.
 */

export type StageKey =
  | 'APPLICATION'
  | 'EVALUATION'
  | 'DECISION'
  | 'OFFER'
  | 'APPLICANT_ACCEPTANCE'
  | 'ENROLLMENT';

/**
 * - `required` — part of this school's process; blocks progression until complete.
 * - `optional` — may be run at the operator's discretion; never blocks.
 * - `skip`     — not part of this school's process; hidden from the UI.
 *
 * `skip` means "not required", NEVER "forbidden". Workflow configuration only ever
 * *adds* an authorized shortcut and *hides* UI affordances — it never deletes an edge
 * from ADMISSION_TRANSITIONS. A Simple-workflow school that does want to reject an
 * applicant can still walk review → reject; the buttons are just not in the way.
 */
export type StageMode = 'required' | 'optional' | 'skip';

export type EvaluationStepKey = 'screening' | 'interview' | 'exam';

export interface EvaluationSteps {
  screening: StageMode;
  interview: StageMode;
  exam: StageMode;
}

export interface StageConfig {
  stage: StageKey;
  mode: StageMode;
  order: number;
  /** EVALUATION only; stripped from every other stage by `sanitizeStages`. */
  steps?: EvaluationSteps;
}

export interface StageDef {
  stage: StageKey;
  label: string;
  order: number;
  /**
   * Cannot be anything but `required`. An application must be submitted, and
   * enrollment is the terminus — neither is a matter of school policy.
   */
  locked?: boolean;
  /** Carries the screening/interview/exam sub-steps. */
  hasSteps?: boolean;
  help: string;
}

/** Ordered stage catalogue. `order` is owned here, never accepted from a client. */
export const STAGE_DEFS: readonly StageDef[] = [
  {
    stage: 'APPLICATION',
    label: 'Application',
    order: 1,
    locked: true,
    help: 'The applicant submits an application. Always required.',
  },
  {
    stage: 'EVALUATION',
    label: 'Evaluation',
    order: 2,
    hasSteps: true,
    help: 'Screening, interview and entrance examination. Each activity is configured separately.',
  },
  {
    stage: 'DECISION',
    label: 'Decision',
    order: 3,
    help: 'The school accepts, waitlists or rejects the applicant.',
  },
  {
    stage: 'OFFER',
    label: 'Offer',
    order: 4,
    help: 'A formal admission offer is issued to the applicant.',
  },
  {
    stage: 'APPLICANT_ACCEPTANCE',
    label: 'Applicant acceptance',
    order: 5,
    help: 'The applicant (or their guardian) accepts the offer.',
  },
  {
    stage: 'ENROLLMENT',
    label: 'Enrollment',
    order: 6,
    locked: true,
    help: 'The applicant becomes a student. Always required, and always subject to the eligibility gate.',
  },
] as const;

export const STAGE_KEYS: readonly StageKey[] = STAGE_DEFS.map((s) => s.stage);

const STAGE_DEF_BY_KEY = new Map<StageKey, StageDef>(STAGE_DEFS.map((d) => [d.stage, d]));

export const EVALUATION_STEP_KEYS: readonly EvaluationStepKey[] = ['screening', 'interview', 'exam'];

/**
 * Every action that legitimately belongs to a stage — a SET, not a single "entry
 * action". DECISION in particular is not a synonym for `accept`: accepting,
 * waitlisting and rejecting all satisfy it, and the resolver must offer all three
 * rather than arbitrarily picking one.
 *
 * Values are actions from ADMISSION_TRANSITIONS in admissions.service.ts.
 */
export const STAGE_ACTIONS: Readonly<Record<StageKey, readonly string[]>> = {
  APPLICATION: ['submit'],
  EVALUATION: [
    'review',
    'resolve_documents',
    'screen',
    'schedule_interview',
    'complete_interview',
    'reschedule',
    'schedule_exam',
    'exam_done',
    'score',
  ],
  DECISION: ['accept', 'waitlist', 'reject'],
  OFFER: ['issue_offer'],
  APPLICANT_ACCEPTANCE: ['accept_offer', 'decline_offer'],
  ENROLLMENT: ['enroll'],
} as const;

/**
 * Offered regardless of where the application sits in the workflow. Rendered apart
 * from the workflow flow, and never returned by the shortcut authorization.
 */
export const ALWAYS_AVAILABLE_ACTIONS: readonly string[] = [
  'withdraw',
  'reject',
  'request_documents',
];

/** Statuses from which no stage can advance. Checked BEFORE any completion predicate. */
export const TERMINAL_STATUSES: readonly string[] = ['rejected', 'withdrawn', 'offer_declined'];

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

const ALL_STEPS_OPTIONAL: EvaluationSteps = {
  screening: 'optional',
  interview: 'optional',
  exam: 'optional',
};

const ALL_STEPS_REQUIRED: EvaluationSteps = {
  screening: 'required',
  interview: 'required',
  exam: 'required',
};

const ALL_STEPS_SKIPPED: EvaluationSteps = {
  screening: 'skip',
  interview: 'skip',
  exam: 'skip',
};

function makeStage(key: StageKey, mode: StageMode, steps?: EvaluationSteps): StageConfig {
  const def = STAGE_DEF_BY_KEY.get(key)!;
  return {
    stage: key,
    mode,
    order: def.order,
    ...(def.hasSteps ? { steps: steps ?? ALL_STEPS_OPTIONAL } : {}),
  };
}

export type PresetKey = 'simple' | 'standard' | 'selective';

export interface PresetDef {
  label: string;
  description: string;
  stages: StageConfig[];
}

/**
 * Starting points an administrator picks from, then customises.
 *
 * `standard` is *intended* to reproduce the behaviour that existed before workflows —
 * including the long-legal `under_review → accept` with no evaluation at all, which is
 * exactly why EVALUATION is `optional` here and not `required`. That equivalence is
 * asserted by regression test, not assumed.
 */
export const PRESETS: Readonly<Record<PresetKey, PresetDef>> = {
  simple: {
    label: 'Simple',
    description: 'Application → Enrollment. No evaluation, decision, offer or acceptance step.',
    stages: [
      makeStage('APPLICATION', 'required'),
      makeStage('EVALUATION', 'skip', ALL_STEPS_SKIPPED),
      makeStage('DECISION', 'skip'),
      makeStage('OFFER', 'skip'),
      makeStage('APPLICANT_ACCEPTANCE', 'skip'),
      makeStage('ENROLLMENT', 'required'),
    ],
  },
  standard: {
    label: 'Standard',
    description:
      'Application → Decision → Offer → Acceptance → Enrollment, with evaluation available but not required.',
    stages: [
      makeStage('APPLICATION', 'required'),
      makeStage('EVALUATION', 'optional', ALL_STEPS_OPTIONAL),
      makeStage('DECISION', 'required'),
      makeStage('OFFER', 'required'),
      makeStage('APPLICANT_ACCEPTANCE', 'required'),
      makeStage('ENROLLMENT', 'required'),
    ],
  },
  selective: {
    label: 'Selective',
    description: 'Full process with screening, interview and entrance examination all required.',
    stages: [
      makeStage('APPLICATION', 'required'),
      makeStage('EVALUATION', 'required', ALL_STEPS_REQUIRED),
      makeStage('DECISION', 'required'),
      makeStage('OFFER', 'required'),
      makeStage('APPLICANT_ACCEPTANCE', 'required'),
      makeStage('ENROLLMENT', 'required'),
    ],
  },
} as const;

/**
 * The workflow an application resolves to when it carries no snapshot — every
 * application created before this feature existed.
 *
 * Deliberately a frozen constant in this registry and NOT the organization's
 * "Standard" database row: editing that row must never retroactively change the
 * behaviour of historical applications. The database row seeds *new* applications only.
 */
export const BUILTIN_STANDARD: readonly StageConfig[] = Object.freeze(
  PRESETS.standard.stages.map((s) =>
    Object.freeze({ ...s, ...(s.steps ? { steps: Object.freeze({ ...s.steps }) } : {}) }),
  ),
) as readonly StageConfig[];

/** Current `workflowSnapshot` JSON schema version. */
export const SNAPSHOT_VERSION = 1;

/**
 * The frozen workflow configuration carried by an application.
 *
 * `version` is the JSON SCHEMA version — how to interpret this structure — and is not
 * a workflow revision number. If per-workflow revisions are ever needed they get their
 * own field; do not overload this one.
 */
export interface WorkflowSnapshot {
  version: number;
  presetKey: string | null;
  workflowName: string | null;
  stages: StageConfig[];
}

/** Thrown by `sanitizeStages`; controllers surface it as a 400. */
export class WorkflowConfigError extends Error {}

function coerceMode(value: unknown, fallback: StageMode): StageMode {
  return value === 'required' || value === 'optional' || value === 'skip' ? value : fallback;
}

/**
 * The validation boundary. Stage configuration only ever enters the database through
 * here, so a client cannot invent stages, reorder them, disable a locked one, or
 * describe a stage that can never be completed.
 *
 * Invariants enforced (each throws WorkflowConfigError → 400):
 *   1. APPLICATION and ENROLLMENT are locked to `required`.
 *   2. `EVALUATION: required` with no `required` step is rejected — a required stage
 *      must have at least one required completion mechanism, otherwise it is a gate
 *      nothing can ever satisfy.
 *   3. `EVALUATION: skip` normalises every step to `skip`.
 *   4. `steps` on any stage other than EVALUATION is stripped.
 *   5. `order` comes from STAGE_DEFS, never from the caller.
 *
 * Unknown keys are dropped; a missing stage falls back to the Standard preset's mode.
 */
export function sanitizeStages(input: unknown): StageConfig[] {
  const incoming = new Map<StageKey, any>();
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') continue;
      const key = (raw as any).stage;
      if (STAGE_KEYS.includes(key)) incoming.set(key, raw);
    }
  }

  return STAGE_DEFS.map((def) => {
    const raw = incoming.get(def.stage);
    const fallback = PRESETS.standard.stages.find((s) => s.stage === def.stage)!;
    let mode = coerceMode(raw?.mode, fallback.mode);

    // Invariant 1 — locked stages are not a matter of school policy.
    if (def.locked) {
      if (raw && mode !== 'required') {
        throw new WorkflowConfigError(
          `The ${def.label} stage is always required and cannot be set to '${mode}'.`,
        );
      }
      mode = 'required';
    }

    // Invariant 4 — sub-steps only mean something inside EVALUATION.
    if (!def.hasSteps) {
      return { stage: def.stage, mode, order: def.order };
    }

    // Invariant 3 — a skipped stage has no activities.
    if (mode === 'skip') {
      return { stage: def.stage, mode, order: def.order, steps: { ...ALL_STEPS_SKIPPED } };
    }

    const steps: EvaluationSteps = {
      screening: coerceMode(raw?.steps?.screening, fallback.steps!.screening),
      interview: coerceMode(raw?.steps?.interview, fallback.steps!.interview),
      exam: coerceMode(raw?.steps?.exam, fallback.steps!.exam),
    };

    // Invariant 2 — a required stage needs at least one required way to complete it.
    if (mode === 'required' && !EVALUATION_STEP_KEYS.some((k) => steps[k] === 'required')) {
      throw new WorkflowConfigError(
        'A required Evaluation stage must have at least one required activity ' +
          '(screening, interview or entrance examination). Otherwise nothing can ever ' +
          'complete it — set Evaluation to Optional instead.',
      );
    }

    return { stage: def.stage, mode, order: def.order, steps };
  });
}

/** Build the snapshot frozen onto an application at creation. */
export function buildSnapshot(workflow: {
  name?: string | null;
  presetKey?: string | null;
  stages: unknown;
}): WorkflowSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    presetKey: workflow.presetKey ?? null,
    workflowName: workflow.name ?? null,
    stages: sanitizeStages(workflow.stages),
  };
}

/**
 * Resolve an application's stage configuration from its snapshot.
 *
 * A null or unreadable snapshot resolves to BUILTIN_STANDARD, so applications that
 * predate this feature behave exactly as they always did. Version-aware from day one:
 * when the structure changes, add a branch here rather than rewriting stored rows.
 */
export function resolveSnapshot(snapshot: unknown): StageConfig[] {
  if (!snapshot || typeof snapshot !== 'object') return BUILTIN_STANDARD.map((s) => ({ ...s }));
  const snap = snapshot as Partial<WorkflowSnapshot>;
  switch (snap.version) {
    case 1:
      try {
        return sanitizeStages(snap.stages);
      } catch {
        // A stored snapshot that no longer satisfies current invariants must not
        // strand the application; fall back rather than throw on a read path.
        return BUILTIN_STANDARD.map((s) => ({ ...s }));
      }
    default:
      return BUILTIN_STANDARD.map((s) => ({ ...s }));
  }
}

/** Registry payload for the settings UI (`GET .../workflows/schema`). */
export function workflowSchema() {
  return {
    stages: STAGE_DEFS,
    modes: [
      {
        value: 'required',
        label: 'Required',
        help: 'Must be completed before the process can continue.',
      },
      {
        value: 'optional',
        label: 'Optional',
        help: 'Available to staff, but never blocks progression.',
      },
      {
        value: 'skip',
        label: 'Skipped',
        help: 'Not part of this school’s process. Hidden from the pipeline.',
      },
    ],
    evaluationSteps: [
      { key: 'screening', label: 'Screening' },
      { key: 'interview', label: 'Interview' },
      { key: 'exam', label: 'Entrance examination' },
    ],
    presets: (Object.keys(PRESETS) as PresetKey[]).map((key) => ({
      key,
      label: PRESETS[key].label,
      description: PRESETS[key].description,
      stages: PRESETS[key].stages,
    })),
    snapshotVersion: SNAPSHOT_VERSION,
  };
}
