import { isDescriptorSystem, type RankOn } from './result-computation';

/**
 * How a programme's learners are reported — the grading profile for a level.
 *
 * Uganda nursery and primary are three different profiles, never one
 * school-wide setting (owner decisions 1, 2, 6 — 2026-10-14):
 *   - Nursery (PRE_PRIMARY): ECD descriptors, no ranking, no aggregate.
 *   - Lower primary (PRIMARY_LOWER): D1–F9 grades per subject; NO aggregate or
 *     division unless the school names the subjects that make one; position
 *     only when the school turns ranking on.
 *   - Upper primary (PRIMARY_UPPER / PRIMARY): D1–F9 grades; aggregate and
 *     division over the four subjects the programme names; ranked on the
 *     aggregate (or the mean when no aggregate subjects are named yet).
 * Any other stage falls back to the school profile's system.
 *
 * All of it is ordinary programme `config`, editable under Programmes & Classes:
 *   gradingSystem        'ECD' | 'PLE' | 'generic' | 'UCE' | 'UACE'
 *   rankOn               'none' | 'aggregate' | 'meanPercent' | 'gpa'
 *   aggregateSubjectIds  subject ids whose points make the PLE aggregate
 *   aggregateSubjectCodes the same by subject code (templates and seeds, where
 *                        ids are not known yet); `pleSubjects` is the legacy key
 *   rankingEnabled / ranksLearners  legacy template flags (false ⇒ not ranked)
 */
export interface ReportingPolicy {
  gradingSystem: string;
  rankOn: RankOn;
  /** PLE only. Ids named directly; codes still to be resolved by the caller. */
  aggregateSubjectIds: string[];
  aggregateSubjectCodes: string[];
}

const PRIMARY_STAGES = new Set(['PRIMARY', 'PRIMARY_LOWER', 'PRIMARY_UPPER']);
const RANKINGS: RankOn[] = ['none', 'aggregate', 'meanPercent', 'gpa'];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];

export function reportingPolicy(
  programme: { stage?: string | null; config?: unknown } | null | undefined,
  schoolSystem: string,
): ReportingPolicy {
  const config = (programme?.config ?? {}) as Record<string, unknown>;
  const stage = programme?.stage ?? null;
  const nursery = stage === 'PRE_PRIMARY';
  const lowerPrimary = stage === 'PRIMARY_LOWER';

  const gradingSystem =
    typeof config.gradingSystem === 'string' && config.gradingSystem
      ? config.gradingSystem
      : nursery
        ? 'ECD'
        : stage && PRIMARY_STAGES.has(stage)
          ? 'PLE'
          : schoolSystem;

  const aggregateSubjectIds = gradingSystem === 'PLE' ? strings(config.aggregateSubjectIds) : [];
  const aggregateSubjectCodes =
    gradingSystem === 'PLE' ? strings(config.aggregateSubjectCodes ?? config.pleSubjects) : [];
  const hasAggregate = aggregateSubjectIds.length + aggregateSubjectCodes.length > 0;

  const rankingOff = config.rankingEnabled === false || config.ranksLearners === false;
  const explicit = RANKINGS.includes(config.rankOn as RankOn) ? (config.rankOn as RankOn) : null;
  let rankOn: RankOn =
    explicit ??
    (nursery || isDescriptorSystem(gradingSystem) || rankingOff
      ? 'none'
      : lowerPrimary && config.rankingEnabled !== true && config.ranksLearners !== true
        ? 'none'
        : ['PLE', 'UCE', 'UACE'].includes(gradingSystem)
          ? 'aggregate'
          : 'gpa');
  // Nothing to rank on: a PLE cohort with no aggregate subjects is ranked on
  // its mean, never on an aggregate it does not have.
  if (rankOn === 'aggregate' && gradingSystem === 'PLE' && !hasAggregate) rankOn = 'meanPercent';

  return { gradingSystem, rankOn, aggregateSubjectIds, aggregateSubjectCodes };
}
