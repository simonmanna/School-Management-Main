import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** A server publish-gate conflict. `runPublishGate` is the only authority. */
export type Conflict = { code: string; studentProfileId?: string; subjectId?: string; detail: string };

export interface ReadinessSummary {
  rosterFrozen: boolean;
  studentsCovered: number;
  studentsExpected: number;
  marksApproved: number;
  marksTotal: number;
  sodViolations: number;
  hasChecksums: boolean;
  /** Phase 5 additions. Older responses omit them; the rows fall back cleanly. */
  participationUnresolved?: number;
  weightingValid?: boolean;
  examPapersLocked?: boolean;
}

export interface Readiness {
  ready: boolean;
  conflicts: Conflict[];
  summary: ReadinessSummary;
}

/**
 * Turn the publish gate's codes into something a deputy head can act on.
 *
 * The gate stays the single authority for WHETHER results may be released —
 * this only translates its answer. Every rule lives in `runPublishGate`; nothing
 * here re-decides anything, it just says who and offers the screen that fixes it.
 */
export function summarise(conflicts: Conflict[], nameById: Map<string, string>) {
  const code = conflicts[0]?.code ?? '';
  const pupils = [...new Set(conflicts.map((c) => c.studentProfileId).filter(Boolean) as string[])]
    .map((id) => nameById.get(id) || 'a pupil');
  const n = pupils.length;
  const who = n === 0 ? '' : n <= 3 ? pupils.join(', ') : `${pupils.slice(0, 3).join(', ')} and ${n - 3} more`;

  switch (code) {
    case 'MARKS_NOT_APPROVED':
      return {
        title: n === 1 ? '1 pupil has marks waiting for approval' : `${n} pupils have marks waiting for approval`,
        blurb: who ? `Waiting on: ${who}.` : 'Some marks have not been signed off yet.',
        cta: { label: 'Review approvals', to: '/school/approvals' },
      };
    case 'STUDENT_NOT_COVERED':
      return {
        title: n === 1 ? '1 pupil has no result' : `${n} pupils have no result`,
        blurb: who ? `No marks were found for: ${who}.` : 'Some pupils on the class list have no marks at all.',
        cta: { label: 'Enter marks', to: '/school/enter-marks' },
      };
    case 'SOD_VIOLATION':
      return {
        title: 'Someone approved their own marks',
        blurb: who ? `Affects: ${who}. Marks must be approved by someone other than whoever entered them.` : 'Marks must be approved by someone other than whoever entered them.',
        cta: { label: 'Review approvals', to: '/school/approvals' },
      };
    case 'ROSTER_NOT_FROZEN':
      return {
        title: 'The class list is not locked yet',
        blurb: 'Lock the class list so the results cannot change underneath you.',
        cta: { label: 'Open class lists', to: '/school/assessment-ops' },
      };
    case 'NO_ROSTER':
      return {
        title: 'No class list attached',
        blurb: 'These results were worked out without a class list, so there is nothing to check them against.',
        cta: { label: 'Open class lists', to: '/school/assessment-ops' },
      };
    case 'MISSING_CHECKSUM':
      return {
        title: 'These results are incomplete',
        blurb: 'Work the results out again — the last run did not finish properly.',
        cta: null,
      };
    // ── Phase 5 gate additions ──
    case 'PARTICIPATION_UNRESOLVED':
      return {
        title: n === 1 ? '1 pupil has an unanswered piece of work' : `${n} pupils have unanswered work`,
        blurb: who
          ? `${who} have work with no mark and no recorded absence. A blank is not a zero — record the mark, or record why there is none.`
          : 'Some work has neither a mark nor a recorded absence or exemption.',
        cta: { label: 'Open the assessment board', to: '/school/assessments' },
      };
    case 'COMPONENT_WEIGHTS_INVALID':
      return {
        title: 'The weighting does not add up to 100%',
        blurb: `${conflicts[0]?.detail ?? ''} Fix the weighting before these results are released.`,
        cta: { label: 'Assessment structure', to: '/school/assessment' },
      };
    case 'NO_ASSESSMENT_POLICY':
      return {
        title: 'A subject has no weighting policy',
        blurb: 'Coursework and exam cannot be combined without a policy saying how.',
        cta: { label: 'Assessment structure', to: '/school/assessment' },
      };
    case 'POLICY_NOT_PUBLISHED':
      return {
        title: 'A subject is scored under a draft policy',
        blurb: 'Publish the weighting policy so the rules the marks were combined under are fixed.',
        cta: { label: 'Assessment structure', to: '/school/assessment' },
      };
    case 'EXAM_PAPER_UNLOCKED':
      return {
        title: 'An exam paper is still open for marking',
        blurb: `${conflicts[0]?.detail ?? ''} Close the examination, or lock the paper, first.`,
        cta: { label: 'Examination operations', to: '/school/exam-operations' },
      };
    default:
      return { title: 'Something is blocking release', blurb: conflicts[0]?.detail ?? '', cta: null };
  }
}

export function ReadinessChecklist({
  readiness,
  nameById,
}: {
  readiness: Readiness;
  nameById: Map<string, string>;
}) {
  const s = readiness.summary ?? ({} as ReadinessSummary);
  const rows: { label: string; ok: boolean }[] = [
    { label: 'Class list locked', ok: !!s.rosterFrozen },
    {
      label: `Every pupil has a result (${Number(s.studentsCovered ?? 0)}/${Number(s.studentsExpected ?? 0)})`,
      ok: Number(s.studentsCovered ?? 0) === Number(s.studentsExpected ?? 0) && Number(s.studentsExpected ?? 0) > 0,
    },
    {
      label: `Marks approved (${Number(s.marksApproved ?? 0)}/${Number(s.marksTotal ?? 0)})`,
      ok: Number(s.marksApproved ?? 0) === Number(s.marksTotal ?? 0) && Number(s.marksTotal ?? 0) > 0,
    },
    { label: 'Nobody approved their own marks', ok: Number(s.sodViolations ?? 0) === 0 },
  ];
  // Phase 5 rows only appear when the server actually reports them, so an older
  // API response never renders a permanently unlit checkbox.
  if (s.participationUnresolved !== undefined) {
    rows.push({
      label: s.participationUnresolved === 0
        ? 'Every piece of work has a mark or a recorded absence'
        : `${s.participationUnresolved} piece(s) of work have neither a mark nor a recorded absence`,
      ok: s.participationUnresolved === 0,
    });
  }
  if (s.weightingValid !== undefined) {
    rows.push({ label: 'Weighting adds up to 100% under a published policy', ok: s.weightingValid });
  }
  if (s.examPapersLocked !== undefined) {
    rows.push({ label: 'Exam papers are closed to further marking', ok: s.examPapersLocked });
  }
  rows.push({ label: 'Results worked out in full', ok: !!s.hasChecksums });

  const groups = new Map<string, Conflict[]>();
  for (const c of readiness.conflicts ?? []) {
    const list = groups.get(c.code) ?? [];
    list.push(c);
    groups.set(c.code, list);
  }

  return (
    <div className={`rounded-md border p-3 text-sm ${readiness.ready ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
      <div className="mb-2 flex items-center gap-2 font-medium">
        {readiness.ready
          ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ready to release</>
          : <><AlertTriangle className="h-4 w-4 text-amber-600" /> Not ready to release yet</>}
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            {r.ok
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
            <span className={r.ok ? 'text-muted-foreground' : ''}>{r.label}</span>
          </li>
        ))}
      </ul>

      {groups.size > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {[...groups.values()].map((list, i) => {
            const g = summarise(list, nameById);
            return (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{g.title}</p>
                  {g.blurb && <p className="text-xs text-muted-foreground">{g.blurb}</p>}
                </div>
                {g.cta && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={g.cta.to}><Users className="h-3.5 w-3.5" /> {g.cta.label}</Link>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function rosterLabel(r: { name?: string | null; scopeType?: string; className?: string | null; classId?: string | null }) {
  if (r.name) return r.name;
  if (r.className) return r.className;
  return r.scopeType === 'class' ? 'Whole class' : (r.scopeType ?? 'Class list');
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'Draft',
    computing: 'Working out',
    computed: 'Ready to check',
    approved: 'Approved',
    published: 'Released',
    locked: 'Final',
    archived: 'Superseded',
  };
  return map[status] ?? status;
}

export function recommendationLabel(v?: string | null) {
  const map: Record<string, string> = { promote: 'Promote', repeat: 'Repeat', graduate: 'Graduate', review: 'Review' };
  return v ? (map[v] ?? v) : '—';
}
