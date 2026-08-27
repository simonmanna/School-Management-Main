import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import {
  ALWAYS_AVAILABLE_ACTIONS,
  BUILTIN_STANDARD,
  PRESETS,
  PresetKey,
  StageConfig,
  StageKey,
  STAGE_ACTIONS,
  STAGE_DEFS,
  WorkflowConfigError,
  WorkflowSnapshot,
  buildSnapshot,
  isTerminalStatus,
  resolveSnapshot,
  sanitizeStages,
  workflowSchema,
} from './admission-workflow.schema';

/** The shape the resolver needs off an application. Everything is a plain read. */
export interface ResolvableApplication {
  id?: string;
  status: string;
  workflowSnapshot?: unknown;
  screenedAt?: Date | null;
  interviewedAt?: Date | null;
  scoredAt?: Date | null;
  acceptedAt?: Date | null;
  offerAcceptedAt?: Date | null;
  enrolledAt?: Date | null;
  decision?: { id: string } | null;
  offerLetter?: { status?: string | null; expiresAt?: Date | null } | null;
}

export interface StageState {
  stage: StageKey;
  label: string;
  mode: string;
  order: number;
  complete: boolean;
  steps?: Record<string, { mode: string; complete: boolean }>;
}

export interface WorkflowResolution {
  stages: StageState[];
  nextRequiredStage: StageKey | null;
  requiredActions: string[];
  optionalActions: string[];
  alwaysAvailable: string[];
  /** Stages an enrollment from the current status would legitimately bypass. */
  skippedStages: StageKey[];
}

const STAGE_LABEL = new Map(STAGE_DEFS.map((d) => [d.stage, d.label] as const));

/**
 * Resolver + CRUD for the configurable admission workflow.
 *
 * Two rules govern everything here:
 *
 *  1. **The snapshot is the only authority.** Progression reads
 *     `application.workflowSnapshot`, never `application.workflowId`. Loading the
 *     workflow row by id would re-expose an in-flight application to later edits of
 *     that row and destroy snapshot immutability. `workflowId` is provenance only.
 *
 *  2. **Nothing is synthesized.** A skipped stage produces no status row and no
 *     artifact, so `offer_issued` always means an offer really was issued. Skipping is
 *     expressed by authorizing a REAL transition and recording what it bypassed in
 *     `AdmissionStatusHistory.skippedStages`.
 */
@Injectable()
export class AdmissionsWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── Registry ─────────────────────────────

  schema() {
    return workflowSchema();
  }

  // ──────────────────────── Completion predicates ────────────────────────
  //
  // Explicit, artifact-based, one per stage. Deliberately NOT a numeric status rank:
  // admission statuses branch (under_review → screening | interview | exam | accept |
  // waitlist | reject; offer_issued → accept | decline | expire), and a rank hides
  // those branches. Each predicate reads the artifact or milestone that proves the
  // stage actually happened.

  isApplicationComplete(app: ResolvableApplication): boolean {
    return app.status !== 'draft';
  }

  /**
   * Completion is MONOTONIC: a stage stays complete once the application has
   * demonstrably moved past it. The evidence is still an artifact, never a status
   * rank — the implication chain is a fact about the domain, not an ordering trick:
   *
   *   enrolled           ⇒ every stage happened
   *   offerAcceptedAt    ⇒ an offer existed to accept  ⇒ a decision was taken
   *   an OfferLetter row ⇒ a decision was taken
   *
   * Without this, an application sitting at `offer_accepted` with no `AdmissionDecision`
   * row (the decision predates that table, or came through `waitlist` rather than
   * `accept`, so `acceptedAt` was never stamped) would report DECISION incomplete and
   * be blocked from enrolling — even though the offer it accepted could not exist
   * unless the school had decided.
   */
  private movedBeyondDecision(app: ResolvableApplication): boolean {
    return (
      this.isEnrollmentComplete(app) || app.offerAcceptedAt != null || app.offerLetter != null
    );
  }

  isEvaluationComplete(app: ResolvableApplication, cfg: StageConfig): boolean {
    // An enrolled application has, by definition, been through whatever its workflow
    // required; re-litigating it would strand historical records.
    if (this.isEnrollmentComplete(app)) return true;
    const steps = cfg.steps;
    if (!steps) return true;
    const evidence =
      app.screenedAt != null || app.interviewedAt != null || app.scoredAt != null;

    const required = (['screening', 'interview', 'exam'] as const).filter(
      (k) => steps[k] === 'required',
    );
    if (required.length === 0) {
      // Only reachable when the stage is optional or skipped — a `required` EVALUATION
      // is guaranteed at least one required activity by sanitizeStages. "Complete"
      // here means evidence that evaluation actually happened, NOT "nothing to do":
      // an optional stage with no activity performed is incomplete-but-non-blocking
      // (nextRequiredStage only consults required stages), which is what keeps its
      // actions on offer and lists a skipped stage as skipped in the audit trail.
      return evidence;
    }
    return required.every((k) => {
      if (k === 'screening') return app.screenedAt != null;
      if (k === 'interview') return app.interviewedAt != null;
      // `exam_done` maps onto the `interviewed` status, so the exam's own evidence is
      // the score: scoring is what records an exam outcome.
      return app.scoredAt != null;
    });
  }

  isDecisionComplete(app: ResolvableApplication): boolean {
    if (app.decision) return true;
    if (['accepted', 'waitlisted', 'rejected'].includes(app.status)) return true;
    if (app.acceptedAt != null) return true;
    return this.movedBeyondDecision(app);
  }

  /**
   * A LIVE offer. An expired or withdrawn offer leaves the stage incomplete —
   * `offer_expired → issue_offer` is a legal FSM edge, so an expired offer means
   * "reissue", not a dead end. (`offer_declined` is terminal and never reaches here.)
   *
   * An offer the applicant already ACCEPTED stays complete regardless of `expiresAt`:
   * the deadline governs how long they have to respond, and they responded. Letting a
   * date pass after acceptance must not retroactively un-accept it and block enrollment.
   */
  isOfferComplete(app: ResolvableApplication): boolean {
    if (this.isApplicantAcceptanceComplete(app)) return true;
    const offer = app.offerLetter;
    if (!offer) return false;
    if (String(offer.status) === 'accepted') return true;
    if (['expired', 'withdrawn', 'declined'].includes(String(offer.status))) return false;
    if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) return false;
    return true;
  }

  isApplicantAcceptanceComplete(app: ResolvableApplication): boolean {
    if (app.offerAcceptedAt != null) return true;
    if (String(app.offerLetter?.status) === 'accepted') return true;
    return this.isEnrollmentComplete(app);
  }

  isEnrollmentComplete(app: ResolvableApplication): boolean {
    return app.enrolledAt != null || app.status === 'enrolled';
  }

  /** Public entry point for the private dispatcher — used by analytics reporting. */
  isStageComplete(app: ResolvableApplication, cfg: StageConfig): boolean {
    return this.completeFor(app, cfg);
  }

  private completeFor(app: ResolvableApplication, cfg: StageConfig): boolean {
    switch (cfg.stage) {
      case 'APPLICATION':
        return this.isApplicationComplete(app);
      case 'EVALUATION':
        return this.isEvaluationComplete(app, cfg);
      case 'DECISION':
        return this.isDecisionComplete(app);
      case 'OFFER':
        return this.isOfferComplete(app);
      case 'APPLICANT_ACCEPTANCE':
        return this.isApplicantAcceptanceComplete(app);
      case 'ENROLLMENT':
        return this.isEnrollmentComplete(app);
    }
  }

  // ───────────────────────────── Resolver ─────────────────────────────

  /** The application's stage configuration. Snapshot only — see rule 1 above. */
  stagesFor(app: ResolvableApplication): StageConfig[] {
    return resolveSnapshot(app.workflowSnapshot);
  }

  /**
   * The first enabled+required stage that is not yet complete, or null when the
   * application is terminal or fully through the process.
   */
  nextRequiredStage(app: ResolvableApplication, stages?: StageConfig[]): StageKey | null {
    if (isTerminalStatus(app.status)) return null;
    const cfgs = stages ?? this.stagesFor(app);
    for (const cfg of cfgs) {
      if (cfg.mode !== 'required') continue;
      if (!this.completeFor(app, cfg)) return cfg.stage;
    }
    return null;
  }

  /**
   * Extra actions the workflow authorizes on top of the FSM — the entire skip
   * mechanism, and the only extension to ADMISSION_TRANSITIONS.
   *
   * Granted only when every stage between where the application actually is and the
   * next required stage is configured `skip`. `optional` stages are deliberately NOT
   * shortcut-eligible: allowing them would let a Standard school accept straight from
   * `submitted`, which is not how the system behaves today.
   *
   * Guard rails, relied on by the caller and asserted in unit tests:
   *   - returns only actions belonging to `nextRequiredStage`;
   *   - never returns a terminal/branch action (withdraw, decline_offer, expire_offer,
   *     request_documents) — those come from ALWAYS_AVAILABLE_ACTIONS;
   *   - never fires for an unsubmitted application, so `draft → enrolled` is
   *     unreachable by construction whatever the configuration says.
   */
  shortcutAllowed(app: ResolvableApplication, stages?: StageConfig[]): string[] {
    if (!this.isApplicationComplete(app)) return [];
    const cfgs = stages ?? this.stagesFor(app);
    const target = this.nextRequiredStage(app, cfgs);
    if (!target) return [];

    const targetCfg = cfgs.find((c) => c.stage === target)!;
    // Every incomplete stage before the target must be one this school skips...
    let skipping = 0;
    for (const cfg of cfgs) {
      if (cfg.order >= targetCfg.order) continue;
      if (this.completeFor(app, cfg)) continue;
      if (cfg.mode !== 'skip') return [];
      skipping += 1;
    }

    // ...and there must be at least one, or there is nothing to shortcut. When every
    // prior stage is already complete the ordinary FSM path applies, and if the FSM
    // still refuses the action the application is in an inconsistent state (say,
    // status `accepted` alongside an already-accepted offer) that must surface as an
    // error rather than be papered over by a grant.
    if (skipping === 0) return [];

    return STAGE_ACTIONS[target].filter((a) => !ALWAYS_AVAILABLE_ACTIONS.includes(a));
  }

  /**
   * Which stages an action taken now would legitimately bypass. Always derived here,
   * on the server, from the snapshot + current state — never accepted from a request
   * body, or the audit trail would be client-forgeable.
   */
  skippedStagesFor(app: ResolvableApplication, target: StageKey, stages?: StageConfig[]): StageKey[] {
    const cfgs = stages ?? this.stagesFor(app);
    const targetCfg = cfgs.find((c) => c.stage === target);
    if (!targetCfg) return [];
    return cfgs
      .filter((c) => c.order < targetCfg.order && c.mode === 'skip' && !this.completeFor(app, c))
      .map((c) => c.stage);
  }

  /**
   * Throws when a REQUIRED stage before `target` is still incomplete. The workflow half
   * of the enforcement chain: permissions → FSM legality → workflow → eligibility.
   */
  validateProgress(app: ResolvableApplication, target: StageKey, stages?: StageConfig[]): void {
    const cfgs = stages ?? this.stagesFor(app);
    if (isTerminalStatus(app.status)) {
      throw new ConflictException(
        `Application is ${app.status}; no further stage can be completed.`,
      );
    }
    const targetCfg = cfgs.find((c) => c.stage === target);
    if (!targetCfg) return;
    for (const cfg of cfgs) {
      if (cfg.order >= targetCfg.order) continue;
      if (cfg.mode !== 'required') continue;
      if (this.completeFor(app, cfg)) continue;
      throw new ConflictException(
        `Cannot proceed to ${STAGE_LABEL.get(target)}: the ${STAGE_LABEL.get(cfg.stage)} stage is ` +
          `required by this admission workflow and is not complete.`,
      );
    }
  }

  /**
   * Full resolution for the UI and for enforcement.
   *
   * `requiredActions` may legitimately be EMPTY while the application is not stuck:
   * under Standard at `submitted`, DECISION is the next required stage but `accept` is
   * not yet FSM-legal, so the operator proceeds through the optional `review`. That is
   * exactly why optional means "available but non-blocking" and not "ignored".
   */
  resolve(app: ResolvableApplication, fsmLegal: readonly string[]): WorkflowResolution {
    const cfgs = this.stagesFor(app);
    const terminal = isTerminalStatus(app.status);

    const stages: StageState[] = cfgs.map((cfg) => {
      const complete = this.completeFor(app, cfg);
      const state: StageState = {
        stage: cfg.stage,
        label: STAGE_LABEL.get(cfg.stage) ?? cfg.stage,
        mode: cfg.mode,
        order: cfg.order,
        complete,
      };
      if (cfg.steps) {
        state.steps = {
          screening: { mode: cfg.steps.screening, complete: app.screenedAt != null },
          interview: { mode: cfg.steps.interview, complete: app.interviewedAt != null },
          exam: { mode: cfg.steps.exam, complete: app.scoredAt != null },
        };
      }
      return state;
    });

    if (terminal) {
      return {
        stages,
        nextRequiredStage: null,
        requiredActions: [],
        optionalActions: [],
        alwaysAvailable: [],
        skippedStages: [],
      };
    }

    const target = this.nextRequiredStage(app, cfgs);
    const shortcut = this.shortcutAllowed(app, cfgs);
    const permitted = new Set([...fsmLegal, ...shortcut]);

    const requiredActions = target
      ? STAGE_ACTIONS[target].filter(
          (a) => permitted.has(a) && !ALWAYS_AVAILABLE_ACTIONS.includes(a),
        )
      : [];

    const targetOrder = target ? cfgs.find((c) => c.stage === target)!.order : Number.MAX_SAFE_INTEGER;
    const optional = new Set<string>();
    for (const cfg of cfgs) {
      if (cfg.mode !== 'optional') continue;
      if (cfg.order > targetOrder) continue;
      if (this.completeFor(app, cfg)) continue;
      for (const a of STAGE_ACTIONS[cfg.stage]) {
        if (!permitted.has(a)) continue;
        if (ALWAYS_AVAILABLE_ACTIONS.includes(a)) continue;
        if (requiredActions.includes(a)) continue;
        optional.add(a);
      }
    }

    return {
      stages,
      nextRequiredStage: target,
      requiredActions,
      optionalActions: [...optional],
      alwaysAvailable: ALWAYS_AVAILABLE_ACTIONS.filter((a) => fsmLegal.includes(a)),
      skippedStages: target ? this.skippedStagesFor(app, target, cfgs) : [],
    };
  }

  // ──────────────────────────── Snapshotting ────────────────────────────

  /**
   * The workflow a NEW application in this cycle should freeze: the cycle's workflow,
   * else the org default, else the built-in Standard. Resolved once, at creation.
   */
  async snapshotForCycle(
    client: any,
    admissionCycleId?: string | null,
  ): Promise<{ snapshot: WorkflowSnapshot; workflowId: string | null }> {
    const organizationId = this.tenant.organizationId;

    if (admissionCycleId) {
      const cycle = await client.admissionCycle.findFirst({
        where: { id: admissionCycleId, organizationId },
        select: { workflowId: true },
      });
      if (cycle?.workflowId) {
        const wf = await client.admissionWorkflow.findFirst({
          where: { id: cycle.workflowId, organizationId },
        });
        if (wf) return { snapshot: buildSnapshot(wf), workflowId: wf.id };
      }
    }

    const fallback = await client.admissionWorkflow.findFirst({
      where: { organizationId, isDefault: true, active: true },
    });
    if (fallback) return { snapshot: buildSnapshot(fallback), workflowId: fallback.id };

    // No workflow configured at all: fall back to the built-in Standard, which
    // reproduces the behaviour that existed before workflows. There is no row to point
    // `workflowId` at, and that is correct — the snapshot is what governs the application.
    return {
      snapshot: {
        version: 1,
        presetKey: 'standard',
        workflowName: null,
        stages: BUILTIN_STANDARD.map((s) => ({ ...s })),
      },
      workflowId: null,
    };
  }

  // ──────────────────────────────── CRUD ────────────────────────────────

  /**
   * List the org's workflows, lazily seeding a Standard default on first read.
   *
   * The seed is idempotent by construction: it upserts on the
   * `(organizationId, name)` unique key and swallows a concurrent P2002, so two
   * simultaneous first reads cannot produce two defaults.
   */
  async list() {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.admissionWorkflow.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    if (existing.length) return existing;

    await this.seedDefault();
    return this.prisma.client.admissionWorkflow.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  private async seedDefault() {
    const organizationId = this.tenant.organizationId;
    const preset = PRESETS.standard;
    try {
      await this.prisma.client.admissionWorkflow.upsert({
        where: { organizationId_name: { organizationId, name: preset.label } },
        create: {
          organizationId,
          name: preset.label,
          description: preset.description,
          presetKey: 'standard',
          isDefault: true,
          active: true,
          stages: preset.stages as any,
        },
        update: {},
      });
    } catch (err: any) {
      // A concurrent first read won the race and created it. Nothing to do.
      if (err?.code !== 'P2002') throw err;
    }
  }

  async get(id: string) {
    const workflow = await this.prisma.client.admissionWorkflow.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!workflow) throw new NotFoundException(`Admission workflow ${id} not found`);
    return workflow;
  }

  async create(dto: {
    name: string;
    description?: string | null;
    presetKey?: string | null;
    stages?: unknown;
    isDefault?: boolean;
  }) {
    const organizationId = this.tenant.organizationId;
    const preset = dto.presetKey ? PRESETS[dto.presetKey as PresetKey] : undefined;
    if (dto.presetKey && !preset) {
      throw new BadRequestException(`Unknown admission workflow preset '${dto.presetKey}'.`);
    }
    const stages = this.sanitize(dto.stages ?? preset?.stages ?? PRESETS.standard.stages);

    return this.prisma.client.$transaction(async (tx: any) => {
      if (dto.isDefault) await this.clearDefault(tx, organizationId);
      const created = await tx.admissionWorkflow.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description ?? preset?.description ?? null,
          presetKey: dto.presetKey ?? null,
          isDefault: dto.isDefault ?? false,
          stages: stages as any,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionWorkflow',
        entityId: created.id,
        action: 'create',
        newValues: { name: created.name, presetKey: created.presetKey, stages },
      });
      return created;
    });
  }

  /** Editing stages clears `presetKey` — the config is hand-tuned from now on. */
  async update(
    id: string,
    dto: { name?: string; description?: string | null; stages?: unknown; isDefault?: boolean },
  ) {
    const organizationId = this.tenant.organizationId;
    const before = await this.get(id);
    const stages = dto.stages !== undefined ? this.sanitize(dto.stages) : undefined;

    return this.prisma.client.$transaction(async (tx: any) => {
      if (dto.isDefault) await this.clearDefault(tx, organizationId);
      const updated = await tx.admissionWorkflow.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(stages ? { stages: stages as any, presetKey: null } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionWorkflow',
        entityId: id,
        action: 'update',
        oldValues: { name: before.name, stages: before.stages },
        newValues: { name: updated.name, stages: updated.stages },
      });
      return updated;
    });
  }

  async applyPreset(id: string, presetKey: string) {
    const preset = PRESETS[presetKey as PresetKey];
    if (!preset) throw new BadRequestException(`Unknown admission workflow preset '${presetKey}'.`);
    const before = await this.get(id);
    const updated = await this.prisma.client.admissionWorkflow.update({
      where: { id },
      data: { presetKey, stages: preset.stages as any, description: preset.description },
    });
    await this.audit.record({
      entity: 'AdmissionWorkflow',
      entityId: id,
      action: 'update',
      oldValues: { presetKey: before.presetKey, stages: before.stages },
      newValues: { presetKey, stages: preset.stages },
    });
    return updated;
  }

  /**
   * Archive, never hard-delete. A workflow is configuration history: rows that
   * reference it must never dangle, and `active = false` only means "cannot be
   * assigned to new cycles or applications" — historical reads still resolve.
   */
  async archive(id: string) {
    const organizationId = this.tenant.organizationId;
    await this.get(id);

    const [cycles, applications] = await Promise.all([
      this.prisma.client.admissionCycle.count({ where: { organizationId, workflowId: id } }),
      this.prisma.client.admissionApplication.count({ where: { organizationId, workflowId: id } }),
    ]);
    if (cycles > 0 || applications > 0) {
      throw new ConflictException(
        `This workflow is still in use (${cycles} cycle(s), ${applications} application(s)). ` +
          `Reassign the cycles first, or leave it archived rather than deleting it.`,
      );
    }

    const archived = await this.prisma.client.admissionWorkflow.update({
      where: { id },
      data: { active: false, isDefault: false },
    });
    await this.audit.record({
      entity: 'AdmissionWorkflow',
      entityId: id,
      action: 'delete',
      oldValues: { active: true },
      newValues: { active: false },
    });
    return archived;
  }

  /**
   * Assign a workflow to a cycle. Governs applications created FROM NOW ON: existing
   * applications keep the snapshot they were created with, always.
   */
  async assignToCycle(cycleId: string, workflowId: string | null) {
    const organizationId = this.tenant.organizationId;
    const cycle = await this.prisma.client.admissionCycle.findFirst({
      where: { id: cycleId, organizationId },
    });
    if (!cycle) throw new NotFoundException(`Admission cycle ${cycleId} not found`);

    if (workflowId) {
      const wf = await this.prisma.client.admissionWorkflow.findFirst({
        where: { id: workflowId, organizationId },
      });
      // findFirst is tenant-scoped, so a workflow from another organization simply is
      // not found — no cross-tenant assignment, and no cross-tenant read either.
      if (!wf) throw new NotFoundException(`Admission workflow ${workflowId} not found`);
      if (!wf.active) {
        throw new BadRequestException(`Workflow '${wf.name}' is archived and cannot be assigned.`);
      }
    }

    const updated = await this.prisma.client.admissionCycle.update({
      where: { id: cycleId },
      data: { workflowId },
    });
    await this.audit.record({
      entity: 'AdmissionCycle',
      entityId: cycleId,
      action: 'update',
      oldValues: { workflowId: cycle.workflowId },
      newValues: { workflowId },
    });
    return updated;
  }

  private async clearDefault(tx: any, organizationId: string) {
    await tx.admissionWorkflow.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private sanitize(stages: unknown): StageConfig[] {
    try {
      return sanitizeStages(stages);
    } catch (err) {
      if (err instanceof WorkflowConfigError) throw new BadRequestException(err.message);
      throw err;
    }
  }
}
