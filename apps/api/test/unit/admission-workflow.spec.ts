/**
 * Unit tests for the configurable admission workflow: the stage registry
 * (admission-workflow.schema.ts) and the resolver (AdmissionsWorkflowService).
 *
 * Pure logic — no database. Two properties matter most here and are asserted
 * exhaustively rather than by example:
 *
 *  1. **The shortcut can never become a back door.** Workflow configuration may only
 *     ADD an action belonging to the next required stage, and only when a stage is
 *     genuinely being skipped. It must never grant a terminal action, never grant one
 *     from an unsubmitted application, and never grant one for a stage the workflow
 *     still requires.
 *  2. **Nothing is synthesized.** Skipping is expressed as authorization for a real
 *     transition, so the resolver's job is to say what is permitted — never to invent
 *     intermediate statuses.
 */
import {
  ALWAYS_AVAILABLE_ACTIONS,
  BUILTIN_STANDARD,
  PRESETS,
  SNAPSHOT_VERSION,
  STAGE_ACTIONS,
  STAGE_DEFS,
  StageConfig,
  StageKey,
  WorkflowConfigError,
  buildSnapshot,
  resolveSnapshot,
  sanitizeStages,
  workflowSchema,
} from '../../src/modules/school/admissions/admission-workflow.schema';
import { AdmissionsWorkflowService } from '../../src/modules/school/admissions/admissions-workflow.service';

/** The base FSM, mirrored from admissions.service.ts. */
const ADMISSION_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['submit', 'withdraw'],
  submitted: ['review', 'request_documents', 'withdraw'],
  documents_pending: ['resolve_documents', 'reject', 'withdraw'],
  under_review: ['review', 'screen', 'request_documents', 'schedule_interview', 'schedule_exam', 'accept', 'reject', 'waitlist', 'withdraw'],
  screening: ['schedule_interview', 'schedule_exam', 'reject', 'withdraw'],
  interview_scheduled: ['schedule_interview', 'complete_interview', 'reschedule', 'reject', 'withdraw'],
  interviewed: ['schedule_exam', 'exam_done', 'score', 'accept', 'reject', 'waitlist', 'withdraw'],
  scored: ['score', 'accept', 'reject', 'waitlist', 'withdraw'],
  exam_scheduled: ['exam_done', 'score', 'accept', 'reject', 'waitlist', 'withdraw'],
  accepted: ['waitlist', 'issue_offer', 'withdraw'],
  waitlisted: ['issue_offer', 'reject', 'withdraw'],
  offer_issued: ['accept_offer', 'decline_offer', 'expire_offer', 'withdraw'],
  offer_accepted: ['enroll', 'withdraw'],
  offer_expired: ['issue_offer', 'withdraw'],
  offer_declined: [],
  rejected: [],
  withdrawn: [],
  enrolled: [],
};

const ALL_STATUSES = Object.keys(ADMISSION_TRANSITIONS);

function makeService() {
  return new AdmissionsWorkflowService(
    { client: {} } as any,
    { organizationId: 'org_test', userId: 'user_1' } as any,
    { record: jest.fn(), recordInTx: jest.fn() } as any,
  );
}

function app(status: string, overrides: Record<string, unknown> = {}, stages?: StageConfig[]) {
  return {
    id: 'app_1',
    status,
    screenedAt: null,
    interviewedAt: null,
    scoredAt: null,
    acceptedAt: null,
    offerAcceptedAt: null,
    enrolledAt: null,
    decision: null,
    offerLetter: null,
    workflowSnapshot: stages
      ? { version: SNAPSHOT_VERSION, presetKey: null, workflowName: 't', stages }
      : null,
    ...overrides,
  } as any;
}

const preset = (key: keyof typeof PRESETS) => PRESETS[key].stages;

describe('sanitizeStages — the configuration validation boundary', () => {
  it('returns all six stages in registry order regardless of input order', () => {
    const shuffled = [...preset('standard')].reverse();
    const out = sanitizeStages(shuffled);
    expect(out.map((s) => s.stage)).toEqual(STAGE_DEFS.map((d) => d.stage));
    expect(out.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ignores a client-supplied order and takes it from the registry', () => {
    const out = sanitizeStages([{ stage: 'DECISION', mode: 'required', order: 99 }]);
    expect(out.find((s) => s.stage === 'DECISION')!.order).toBe(3);
  });

  it('drops unknown stages and closes the mode enum', () => {
    const out = sanitizeStages([
      { stage: 'NOT_A_STAGE', mode: 'required' },
      { stage: 'DECISION', mode: 'sometimes' },
    ]);
    expect(out.map((s) => s.stage)).not.toContain('NOT_A_STAGE');
    // An unrecognised mode falls back to the Standard preset's value, never through.
    expect(out.find((s) => s.stage === 'DECISION')!.mode).toBe('required');
  });

  it('refuses to disable a locked stage', () => {
    expect(() => sanitizeStages([{ stage: 'APPLICATION', mode: 'skip' }])).toThrow(WorkflowConfigError);
    expect(() => sanitizeStages([{ stage: 'ENROLLMENT', mode: 'optional' }])).toThrow(WorkflowConfigError);
  });

  it('rejects a required Evaluation with no required activity', () => {
    // Otherwise the stage is a gate nothing can ever satisfy, and every application
    // under that workflow would be permanently stuck before Decision.
    expect(() =>
      sanitizeStages([
        { stage: 'EVALUATION', mode: 'required', steps: { screening: 'optional', interview: 'optional', exam: 'skip' } },
      ]),
    ).toThrow(/at least one required activity/);
  });

  it('accepts a required Evaluation with one required activity', () => {
    const out = sanitizeStages([
      { stage: 'EVALUATION', mode: 'required', steps: { screening: 'required', interview: 'skip', exam: 'skip' } },
    ]);
    expect(out.find((s) => s.stage === 'EVALUATION')!.steps).toEqual({
      screening: 'required',
      interview: 'skip',
      exam: 'skip',
    });
  });

  it('allows an optional Evaluation with every activity optional', () => {
    expect(() =>
      sanitizeStages([
        { stage: 'EVALUATION', mode: 'optional', steps: { screening: 'optional', interview: 'optional', exam: 'optional' } },
      ]),
    ).not.toThrow();
  });

  it('normalises every activity to skip when Evaluation is skipped', () => {
    const out = sanitizeStages([
      { stage: 'EVALUATION', mode: 'skip', steps: { screening: 'required', interview: 'required', exam: 'required' } },
    ]);
    expect(out.find((s) => s.stage === 'EVALUATION')!.steps).toEqual({
      screening: 'skip',
      interview: 'skip',
      exam: 'skip',
    });
  });

  it('strips steps from stages that do not have them', () => {
    const out = sanitizeStages([{ stage: 'DECISION', mode: 'required', steps: { screening: 'required' } }]);
    expect(out.find((s) => s.stage === 'DECISION')!.steps).toBeUndefined();
  });

  it('round-trips every preset through its own coercion unchanged', () => {
    for (const key of Object.keys(PRESETS) as Array<keyof typeof PRESETS>) {
      expect(sanitizeStages(PRESETS[key].stages)).toEqual(PRESETS[key].stages);
    }
  });
});

describe('resolveSnapshot — version awareness and the built-in fallback', () => {
  it('falls back to the built-in Standard for a null snapshot', () => {
    // Applications that predate the feature must behave exactly as they always did.
    expect(resolveSnapshot(null)).toEqual(BUILTIN_STANDARD.map((s) => ({ ...s })));
  });

  it('falls back for an unknown future version rather than misreading it', () => {
    expect(resolveSnapshot({ version: 999, stages: preset('simple') })).toEqual(
      BUILTIN_STANDARD.map((s) => ({ ...s })),
    );
  });

  it('reads a v1 snapshot', () => {
    const snap = buildSnapshot({ name: 'Direct', presetKey: 'simple', stages: preset('simple') });
    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(resolveSnapshot(snap)).toEqual(preset('simple'));
  });

  it('does not throw on a stored snapshot that violates current invariants', () => {
    // A read path must never strand an application because the rules tightened later.
    const bad = {
      version: 1,
      stages: [{ stage: 'EVALUATION', mode: 'required', steps: { screening: 'skip', interview: 'skip', exam: 'skip' } }],
    };
    expect(() => resolveSnapshot(bad)).not.toThrow();
  });

  it('the built-in Standard is frozen', () => {
    expect(Object.isFrozen(BUILTIN_STANDARD)).toBe(true);
  });
});

describe('completion predicates', () => {
  const svc = makeService();

  it('APPLICATION is complete once the application leaves draft', () => {
    expect(svc.isApplicationComplete(app('draft'))).toBe(false);
    expect(svc.isApplicationComplete(app('submitted'))).toBe(true);
  });

  it('EVALUATION requires evidence only for activities marked required', () => {
    const cfg = sanitizeStages([
      { stage: 'EVALUATION', mode: 'required', steps: { screening: 'required', interview: 'skip', exam: 'skip' } },
    ]).find((s) => s.stage === 'EVALUATION')!;
    expect(svc.isEvaluationComplete(app('under_review'), cfg)).toBe(false);
    expect(svc.isEvaluationComplete(app('screening', { screenedAt: new Date() }), cfg)).toBe(true);
  });

  it('an optional EVALUATION never blocks, in any combination of activities', () => {
    // "Not complete" and "blocking" are different things: nextRequiredStage consults
    // only required stages, so an untouched optional Evaluation leaves the application
    // free to move on while its actions stay on offer.
    const cfg = preset('standard').find((s) => s.stage === 'EVALUATION')!;
    expect(svc.isEvaluationComplete(app('submitted'), cfg)).toBe(false);
    expect(svc.isEvaluationComplete(app('screening', { screenedAt: new Date() }), cfg)).toBe(true);
    expect(svc.nextRequiredStage(app('submitted', {}, preset('standard')))).toBe('DECISION');
    expect(() =>
      svc.validateProgress(app('under_review', {}, preset('standard')), 'DECISION'),
    ).not.toThrow();
  });

  it('DECISION is complete when an offer exists even with no decision row', () => {
    // An OfferLetter cannot exist unless the school decided, and a `waitlist` decision
    // never stamps acceptedAt. Without this an accepted applicant could not enroll.
    expect(svc.isDecisionComplete(app('offer_accepted', { offerLetter: { status: 'accepted' } }))).toBe(true);
    expect(svc.isDecisionComplete(app('under_review'))).toBe(false);
  });

  it('OFFER is incomplete while the offer is expired, so it can be reissued', () => {
    const expired = app('offer_expired', {
      offerLetter: { status: 'expired', expiresAt: new Date(Date.now() - 86400_000) },
    });
    expect(svc.isOfferComplete(expired)).toBe(false);
  });

  it('OFFER stays complete once accepted, even past the response deadline', () => {
    // The deadline governs how long the applicant has to reply. They replied.
    const accepted = app('offer_accepted', {
      offerLetter: { status: 'accepted', expiresAt: new Date(Date.now() - 86400_000) },
      offerAcceptedAt: new Date(Date.now() - 172800_000),
    });
    expect(svc.isOfferComplete(accepted)).toBe(true);
  });
});

describe('nextRequiredStage', () => {
  const svc = makeService();

  it('is null for every terminal status, before any predicate runs', () => {
    for (const status of ['rejected', 'withdrawn', 'offer_declined']) {
      expect(svc.nextRequiredStage(app(status, {}, preset('selective')))).toBeNull();
    }
  });

  it('simple: a submitted application needs only enrollment', () => {
    expect(svc.nextRequiredStage(app('submitted', {}, preset('simple')))).toBe('ENROLLMENT');
  });

  it('selective: a submitted application needs evaluation first', () => {
    expect(svc.nextRequiredStage(app('submitted', {}, preset('selective')))).toBe('EVALUATION');
  });

  it('standard: evaluation is optional, so decision is next', () => {
    expect(svc.nextRequiredStage(app('submitted', {}, preset('standard')))).toBe('DECISION');
  });

  it('an expired offer sends the application back to the OFFER stage', () => {
    const a = app('offer_expired', { offerLetter: { status: 'expired' }, acceptedAt: new Date() }, preset('standard'));
    expect(svc.nextRequiredStage(a)).toBe('OFFER');
  });
});

describe('shortcutAllowed — the skip mechanism, and its guard rails', () => {
  const svc = makeService();

  it('grants enroll from submitted under the simple workflow', () => {
    expect(svc.shortcutAllowed(app('submitted', {}, preset('simple')))).toEqual(['enroll']);
  });

  it('grants nothing under selective, which skips no stage', () => {
    expect(svc.shortcutAllowed(app('submitted', {}, preset('selective')))).toEqual([]);
  });

  it('grants nothing under standard, where evaluation is optional rather than skipped', () => {
    // Optional is deliberately not shortcut-eligible: granting it would let a Standard
    // school accept straight from `submitted`, which is not how the system behaves.
    expect(svc.shortcutAllowed(app('submitted', {}, preset('standard')))).toEqual([]);
  });

  it('never grants anything from draft, whatever the configuration says', () => {
    // ENROLLMENT can never be entered from an unsubmitted application.
    expect(svc.shortcutAllowed(app('draft', {}, preset('simple')))).toEqual([]);
  });

  it('grants nothing when there is no stage left to skip', () => {
    const a = app('accepted', { offerLetter: { status: 'accepted' } }, preset('standard'));
    expect(svc.shortcutAllowed(a)).toEqual([]);
  });

  it('grants the whole decision action set, not an arbitrary single decision', () => {
    // DECISION is not a synonym for `accept`.
    const stages = sanitizeStages([
      { stage: 'EVALUATION', mode: 'skip' },
      { stage: 'DECISION', mode: 'required' },
    ]);
    const granted = svc.shortcutAllowed(app('submitted', {}, stages));
    // `reject` satisfies the decision stage too, but it is surfaced through
    // alwaysAvailable rather than as a workflow step, so it is not in this set.
    expect(granted.sort()).toEqual(['accept', 'waitlist'].sort());
  });

  it('never grants a terminal or branch action, for any status under any preset', () => {
    const forbidden = ['withdraw', 'decline_offer', 'expire_offer', 'request_documents'];
    for (const key of Object.keys(PRESETS) as Array<keyof typeof PRESETS>) {
      for (const status of ALL_STATUSES) {
        const granted = svc.shortcutAllowed(app(status, {}, preset(key)));
        for (const bad of forbidden) {
          expect(granted).not.toContain(bad);
        }
      }
    }
  });

  it('only ever grants actions belonging to the next required stage', () => {
    for (const key of Object.keys(PRESETS) as Array<keyof typeof PRESETS>) {
      for (const status of ALL_STATUSES) {
        const a = app(status, {}, preset(key));
        const granted = svc.shortcutAllowed(a);
        if (!granted.length) continue;
        const target = svc.nextRequiredStage(a) as StageKey;
        expect(target).not.toBeNull();
        for (const action of granted) {
          expect(STAGE_ACTIONS[target]).toContain(action);
        }
      }
    }
  });
});

describe('validateProgress', () => {
  const svc = makeService();

  it('lets a simple workflow enroll straight from submitted', () => {
    expect(() => svc.validateProgress(app('submitted', {}, preset('simple')), 'ENROLLMENT')).not.toThrow();
  });

  it('names the first incomplete required stage under selective', () => {
    expect(() => svc.validateProgress(app('submitted', {}, preset('selective')), 'ENROLLMENT')).toThrow(
      /Evaluation stage is required/,
    );
  });

  it('refuses to advance a terminal application', () => {
    expect(() => svc.validateProgress(app('rejected', {}, preset('simple')), 'ENROLLMENT')).toThrow(
      /rejected/,
    );
  });
});

describe('skippedStagesFor — server-derived audit provenance', () => {
  const svc = makeService();

  it('lists exactly the stages a simple enrollment bypasses', () => {
    expect(svc.skippedStagesFor(app('submitted', {}, preset('simple')), 'ENROLLMENT')).toEqual([
      'EVALUATION',
      'DECISION',
      'OFFER',
      'APPLICANT_ACCEPTANCE',
    ]);
  });

  it('is empty for a workflow that skips nothing', () => {
    expect(svc.skippedStagesFor(app('offer_accepted', {}, preset('selective')), 'ENROLLMENT')).toEqual([]);
  });
});

describe('resolve — the transition matrix the UI renders', () => {
  const svc = makeService();
  const resolve = (status: string, presetKey: keyof typeof PRESETS, overrides = {}) =>
    svc.resolve(app(status, overrides, preset(presetKey)), ADMISSION_TRANSITIONS[status] ?? []);

  it('simple: Enroll is the required action straight from submitted', () => {
    const r = resolve('submitted', 'simple');
    expect(r.nextRequiredStage).toBe('ENROLLMENT');
    expect(r.requiredActions).toEqual(['enroll']);
    expect(r.skippedStages).toEqual(['EVALUATION', 'DECISION', 'OFFER', 'APPLICANT_ACCEPTANCE']);
  });

  it('standard at submitted: no required action yet, but review is offered as optional', () => {
    // requiredActions being empty does NOT mean the application is stuck — this is
    // exactly why optional means "available but non-blocking".
    const r = resolve('submitted', 'standard');
    expect(r.nextRequiredStage).toBe('DECISION');
    expect(r.requiredActions).toEqual([]);
    expect(r.optionalActions).toContain('review');
  });

  it('standard at under_review: the full decision set is required', () => {
    const r = resolve('under_review', 'standard');
    expect(r.requiredActions.sort()).toEqual(['accept', 'waitlist'].sort());
  });

  it('selective at under_review: evaluation activities are the required actions', () => {
    const r = resolve('under_review', 'selective');
    expect(r.nextRequiredStage).toBe('EVALUATION');
    expect(r.requiredActions).toEqual(
      expect.arrayContaining(['screen', 'schedule_interview', 'schedule_exam']),
    );
    expect(r.requiredActions).not.toContain('accept');
  });

  it('offers no workflow action at all on a terminal application', () => {
    const r = resolve('rejected', 'standard');
    expect(r.nextRequiredStage).toBeNull();
    expect(r.requiredActions).toEqual([]);
    expect(r.optionalActions).toEqual([]);
    expect(r.alwaysAvailable).toEqual([]);
  });

  it('reports per-stage and per-activity state for the settings UI', () => {
    const r = resolve('screening', 'selective', { screenedAt: new Date() });
    const evaluation = r.stages.find((s) => s.stage === 'EVALUATION')!;
    expect(evaluation.mode).toBe('required');
    expect(evaluation.steps!.screening).toEqual({ mode: 'required', complete: true });
    expect(evaluation.steps!.interview).toEqual({ mode: 'required', complete: false });
  });

  it('never returns an action the FSM rejects unless the workflow granted it', () => {
    for (const key of Object.keys(PRESETS) as Array<keyof typeof PRESETS>) {
      for (const status of ALL_STATUSES) {
        const a = app(status, {}, preset(key));
        const legal = ADMISSION_TRANSITIONS[status] ?? [];
        const r = svc.resolve(a, legal);
        const granted = svc.shortcutAllowed(a);
        for (const action of [...r.requiredActions, ...r.optionalActions]) {
          expect(legal.includes(action) || granted.includes(action)).toBe(true);
        }
        for (const action of r.alwaysAvailable) {
          expect(legal).toContain(action);
          expect(ALWAYS_AVAILABLE_ACTIONS).toContain(action);
        }
      }
    }
  });
});

describe('workflowSchema — the payload that drives the settings UI', () => {
  it('ships every stage, mode and preset', () => {
    const schema = workflowSchema();
    expect(schema.stages.map((s) => s.stage)).toEqual(STAGE_DEFS.map((d) => d.stage));
    expect(schema.modes.map((m) => m.value)).toEqual(['required', 'optional', 'skip']);
    expect(schema.presets.map((p) => p.key).sort()).toEqual(['selective', 'simple', 'standard']);
    expect(schema.snapshotVersion).toBe(SNAPSHOT_VERSION);
  });

  it('marks Application and Enrollment as locked so the UI cannot offer to disable them', () => {
    const schema = workflowSchema();
    const locked = schema.stages.filter((s) => s.locked).map((s) => s.stage);
    expect(locked).toEqual(['APPLICATION', 'ENROLLMENT']);
  });
});
