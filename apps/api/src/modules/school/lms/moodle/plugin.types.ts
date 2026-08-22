import type { CourseModule } from '@prisma/client';

/**
 * The activity-plugin contract (ADR-014 §4). A new activity type is one class that
 * implements this — zero changes to the course spine. The spine owns capability
 * checks, availability, grading, completion persistence, event logging and file
 * ACL; a plugin owns only its instance row and its artefacts.
 */

export type CompletionState = 'incomplete' | 'complete' | 'complete_pass' | 'complete_fail';

/** Typed evidence a graded activity feeds into LearningObjectiveEvidence. */
export interface EvidenceRow {
  learningObjectiveId: string;
  sourceType: string; // 'ASSIGNMENT' | 'QUIZ' | 'LESSON_ACTIVITY' | …
  sourceId: string;
  normalizedScore?: number;
  proficiency?: string;
}

/** Request-scoped context handed to every plugin call. */
export interface PluginCtx {
  organizationId: string;
  userId?: string;
  studentProfileId?: string;
  /** The spine row, when the call is about a placed activity. */
  courseModule?: CourseModule;
  /** LmsContext.id of the activity (or its course), for capability + file ACL. */
  contextId?: string;
}

export interface GradeDefinition {
  maxScore: number;
  gradingMode: string; // 'points' | 'percentage' | 'scale'
}

/** Static description a plugin advertises to the spine and the registry. */
export interface PluginFeatures {
  gradable: boolean;
  hasSubmissions: boolean;
  supportsGroups: boolean;
  supportsCompletionAuto: boolean;
  /** Completion rule keys this plugin can auto-evaluate (e.g. ['view','submit','minGrade']). */
  completionRuleKeys: string[];
  icon: string;
  label: string;
}

export interface ActivityPlugin {
  /** Matches LmsActivityType.name and CourseModule.activityType, e.g. 'quiz'. */
  readonly type: string;
  readonly features: PluginFeatures;

  /** Create the per-type instance row; returns its id for CourseModule.instanceId. */
  createInstance(ctx: PluginCtx, dto: Record<string, unknown>): Promise<{ instanceId: string }>;
  updateInstance(ctx: PluginCtx, instanceId: string, dto: Record<string, unknown>): Promise<void>;
  deleteInstance(ctx: PluginCtx, instanceId: string): Promise<void>;

  /** Read the instance (used by course-page payload + duplication). */
  getInstance(ctx: PluginCtx, instanceId: string): Promise<unknown>;

  /** What a student sees; availability + capability already applied by the spine. */
  viewForStudent(ctx: PluginCtx, cm: CourseModule): Promise<unknown>;
  /** What a teacher sees (submission list, attempt list, …). */
  viewForTeacher(ctx: PluginCtx, cm: CourseModule): Promise<unknown>;

  /** Plugin-defined verbs (submit, start-attempt, post, choose, …). */
  action?(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>): Promise<unknown>;

  /** Grade shape for the Assessment the spine creates. Required iff features.gradable. */
  gradeDefinition?(ctx: PluginCtx, instanceId: string): Promise<GradeDefinition>;

  /** Fresh completion verdict for automatic completion. */
  evaluateCompletion?(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState>;

  /** Objective evidence produced by this student's work on this activity. */
  emitEvidence?(ctx: PluginCtx, cm: CourseModule): Promise<EvidenceRow[]>;

  /** Backup / restore / rollover. */
  exportInstance(ctx: PluginCtx, instanceId: string, opts: { includeUserData: boolean }): Promise<unknown>;
  importInstance(ctx: PluginCtx, payload: unknown): Promise<{ instanceId: string }>;
}
