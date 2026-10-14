import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { useSubjects } from '@/features/school/api';
import { errorMessage, type Programme, useUpdateProgramme } from '@/features/school/enrollment-api';

/**
 * How a level is graded and reported — its "grading profile" (review A1, A5,
 * A6; owner decisions 1, 2, 6).
 *
 * Mirrors `reportingPolicy` in the API (assessment/reporting-policy.ts): the
 * stage supplies the default, the programme's config overrides it.
 */
export type GradingKind = 'ECD' | 'PLE' | 'generic';
export type Ranking = 'none' | 'aggregate' | 'meanPercent';

export interface EffectiveReporting {
  gradingSystem: string;
  rankOn: string;
  aggregateSubjectIds: string[];
  aggregateSubjectCodes: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function effectiveReporting(p: Pick<Programme, 'stage' | 'config'>): EffectiveReporting {
  const c = (p.config ?? {}) as Record<string, unknown>;
  const nursery = p.stage === 'PRE_PRIMARY';
  const primary = ['PRIMARY', 'PRIMARY_LOWER', 'PRIMARY_UPPER'].includes(p.stage);
  const gradingSystem = typeof c.gradingSystem === 'string' && c.gradingSystem ? c.gradingSystem : nursery ? 'ECD' : primary ? 'PLE' : 'school';
  const aggregateSubjectIds = gradingSystem === 'PLE' ? strings(c.aggregateSubjectIds) : [];
  const aggregateSubjectCodes = gradingSystem === 'PLE' ? strings(c.aggregateSubjectCodes ?? c.pleSubjects) : [];
  const off = c.rankingEnabled === false || c.ranksLearners === false;
  const lowerOffByDefault = p.stage === 'PRIMARY_LOWER' && c.rankingEnabled !== true && c.ranksLearners !== true;
  let rankOn = typeof c.rankOn === 'string' ? c.rankOn
    : nursery || gradingSystem === 'ECD' || off || lowerOffByDefault ? 'none' : 'aggregate';
  if (rankOn === 'aggregate' && gradingSystem === 'PLE' && aggregateSubjectIds.length + aggregateSubjectCodes.length === 0) rankOn = 'meanPercent';
  return { gradingSystem, rankOn, aggregateSubjectIds, aggregateSubjectCodes };
}

const GRADING_LABEL: Record<string, string> = {
  ECD: 'Nursery descriptors',
  PLE: 'Grades D1–F9',
  generic: 'Marks and grades',
  school: 'School default',
};
const RANK_LABEL: Record<string, string> = {
  none: 'not ranked',
  aggregate: 'ranked by aggregate',
  meanPercent: 'ranked by average',
  gpa: 'ranked by GPA',
};

/** One line for the programmes table: "Grades D1–F9 · aggregate ENG/MTC/SCI/SST · ranked by aggregate". */
export function reportingSummary(p: Pick<Programme, 'stage' | 'config'>, subjectCode: (id: string) => string): string {
  const r = effectiveReporting(p);
  const agg = [...r.aggregateSubjectIds.map(subjectCode), ...r.aggregateSubjectCodes];
  return [
    GRADING_LABEL[r.gradingSystem] ?? r.gradingSystem,
    r.gradingSystem === 'PLE' ? (agg.length ? `aggregate ${agg.join('/')}` : 'no aggregate') : null,
    RANK_LABEL[r.rankOn] ?? r.rankOn,
  ].filter(Boolean).join(' · ');
}

export function ProgrammeReportingDialog({ programme, onOpenChange }: {
  programme: Programme | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: subjects } = useSubjects();
  const update = useUpdateProgramme();
  const subjectList = (subjects?.data ?? []) as Array<{ id: string; code: string; name: string }>;

  const [grading, setGrading] = useState<GradingKind>('PLE');
  const [ranking, setRanking] = useState<Ranking>('none');
  const [aggregateOn, setAggregateOn] = useState(false);
  const [picked, setPicked] = useState<string[]>(['', '', '', '']);

  useEffect(() => {
    if (!programme) return;
    const r = effectiveReporting(programme);
    setGrading((['ECD', 'PLE', 'generic'].includes(r.gradingSystem) ? r.gradingSystem : 'PLE') as GradingKind);
    setRanking((['none', 'aggregate', 'meanPercent'].includes(r.rankOn) ? r.rankOn : 'none') as Ranking);
    const ids = r.aggregateSubjectIds.length
      ? r.aggregateSubjectIds
      : r.aggregateSubjectCodes.map((code) => subjectList.find((s) => s.code === code)?.id ?? '');
    setAggregateOn(ids.length > 0);
    setPicked([0, 1, 2, 3].map((i) => ids[i] ?? ''));
    // Subjects arriving later re-resolve codes to ids.
  }, [programme, subjects]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = useMemo(() => {
    const out: string[] = [];
    if (grading === 'PLE' && aggregateOn) {
      const chosen = picked.filter(Boolean);
      if (chosen.length !== 4) out.push('Choose all four subjects that make the aggregate.');
      else if (new Set(chosen).size !== 4) out.push('The four aggregate subjects must all be different.');
    }
    if (ranking === 'aggregate' && !(grading === 'PLE' && aggregateOn)) out.push('Ranking by aggregate needs aggregate subjects.');
    return out;
  }, [grading, aggregateOn, picked, ranking]);

  const save = async () => {
    if (!programme || problems.length) return;
    const nextConfig: Record<string, unknown> = {
      ...(programme.config ?? {}),
      gradingSystem: grading,
      rankOn: grading === 'ECD' ? 'none' : ranking,
      aggregateSubjectIds: grading === 'PLE' && aggregateOn ? picked : [],
      // Ids are now authoritative; drop the template's code list so the two
      // can never disagree.
      aggregateSubjectCodes: [],
    };
    delete nextConfig.pleSubjects;
    try {
      await update.mutateAsync({ id: programme.id, config: nextConfig });
      notify.success(`${programme.name}: grading saved`, {
        description: 'It applies the next time a term’s results are worked out. Released results keep the rules they were worked out under.',
      });
      onOpenChange(false);
    } catch (e) {
      notify.error(errorMessage(e, 'Could not save the grading.'));
    }
  };

  const sel = 'h-9 w-full rounded-md border bg-card px-2.5 text-sm';
  return (
    <Dialog open={!!programme} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How {programme?.name} is graded</DialogTitle>
          <DialogDescription>
            What its report cards and results show. Nursery is described, not marked; lower primary shows grades;
            upper primary adds an aggregate and division over four subjects.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rep-grading">Grading</Label>
            <select id="rep-grading" className={sel} value={grading} onChange={(e) => setGrading(e.target.value as GradingKind)}>
              <option value="ECD">Nursery descriptors (Confident / Developing / Beginning / Support) — no marks</option>
              <option value="PLE">Grades D1–F9 per subject</option>
              <option value="generic">Marks and the school’s own grades</option>
            </select>
          </div>

          {grading === 'PLE' && (
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={aggregateOn} onChange={(e) => setAggregateOn(e.target.checked)} />
                Show an aggregate and division
              </label>
              {aggregateOn && (
                <>
                  <p className="text-xs text-muted-foreground">
                    The four subjects whose points add up to the aggregate (4 is best, 36 worst). For P4–P7 these are
                    usually English, Mathematics, Science and Social Studies.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {picked.map((value, i) => (
                      <select key={i} aria-label={`Aggregate subject ${i + 1}`} className={sel} value={value}
                        onChange={(e) => setPicked((p) => p.map((x, j) => (j === i ? e.target.value : x)))}>
                        <option value="">Subject {i + 1}…</option>
                        {subjectList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                      </select>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {grading !== 'ECD' && (
            <div className="space-y-1.5">
              <Label htmlFor="rep-ranking">Position in class</Label>
              <select id="rep-ranking" className={sel} value={ranking} onChange={(e) => setRanking(e.target.value as Ranking)}>
                <option value="none">Don’t rank pupils</option>
                <option value="aggregate" disabled={!(grading === 'PLE' && aggregateOn)}>Rank by aggregate (lowest first)</option>
                <option value="meanPercent">Rank by average mark</option>
              </select>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!!problems.length || update.isPending} onClick={() => void save()}>
            {update.isPending ? 'Saving…' : 'Save grading'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
