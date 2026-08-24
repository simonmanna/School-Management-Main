import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, CheckCircle2, ClipboardList, Lock, Plus, Send,
} from 'lucide-react';
import {
  useAcademicYears, useAssessmentBoard, useClasses, useClassSubjects, useSubmitAssessmentMarks,
  useTerms, ASSESSMENT_KINDS, BOARD_STAGES, KIND_LABEL, STAGE_LABEL,
  type BoardRow,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { EmptyState, Picker, Progress, fmtDate, useDefaulted, useStickyState } from './_components/exam-workflow';
import { CreateAssessmentDialog } from './_components/assessment-form';

/**
 * Assessments — where a teacher starts.
 *
 * The system used to ask a teacher which of three worlds they were in before it
 * would let them assess anybody: an exam wizard, a gradebook, or a homework
 * screen, each with its own create form and its own marking grid. But a teacher
 * does not think "I am going to use the exam subsystem" — they think "I need to
 * assess my class", and only then does it matter whether it is a CAT, a project
 * or an end-of-term paper.
 *
 * So kind is a FILTER here, not a fork in the road. Exams and homework still
 * have their own screens for the things only they do — scheduling a venue,
 * collecting a submission — but neither is where marking begins any more.
 */
export function SchoolAssessmentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [classId, setClassId] = useStickyState('classId');
  const [subjectId, setSubjectId] = useStickyState('subjectId');

  const kind = params.get('kind') ?? '';
  const stage = params.get('status') ?? '';
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const classList = classes?.data ?? [];
  useDefaulted(classId, setClassId, classList[0]?.id);
  const { data: subjects } = useClassSubjects(classId || undefined);

  const { data: board, isLoading } = useAssessmentBoard({
    termId: termId || undefined,
    classId: classId || undefined,
    subjectId: subjectId || undefined,
    kind: kind || undefined,
    status: stage || undefined,
  });
  const submit = useSubmitAssessmentMarks();
  const [creating, setCreating] = useState(false);

  const rows = board?.rows ?? [];
  const counts = board?.counts ?? {};
  const policy = board?.policy ?? null;

  async function onSubmit(row: BoardRow) {
    try {
      const res: any = await submit.mutateAsync(row.assessmentId);
      notify.success(`${row.title}: ${res?.updated ?? 0} mark(s) sent for approval.`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not submit these marks.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assessments</h1>
          <p className="text-sm text-muted-foreground">
            Everything you assess — CATs, homework, projects, practicals and exams — in one list.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New assessment
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-3">
          <Picker label="Year" value={yearId} onChange={setYearId}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} />
          <Picker label="Term" value={termId} onChange={setTermId}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} />
          <Picker label="Class" value={classId} onChange={setClassId}
            options={classList.map((c) => ({ value: c.id, label: c.name }))} />
          <Picker label="Subject" value={subjectId} onChange={setSubjectId} placeholder="All subjects"
            options={(subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </CardContent>
      </Card>

      {/* The weighting structure, in school language rather than table names. */}
      {policy && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              How this subject’s term mark is made up
              {!policy.valid && (
                <Badge variant="destructive" className="ml-1">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Weights total {policy.totalWeight}%, not 100%
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {policy.components.map((c) => (
                <span key={c.id} className="rounded-md border px-2 py-1 text-xs">
                  {c.name} <span className="font-semibold tabular-nums">{c.weight}%</span>
                </span>
              ))}
              {policy.components.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No weighting components yet — set them up under Assessment Structure.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage filter, then kind. Two rails, because they answer different questions. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={!stage} label={`All (${counts.all ?? 0})`} onClick={() => setFilter('status', '')} />
        {BOARD_STAGES.map((s) => (
          <FilterChip key={s} active={stage === s} label={`${STAGE_LABEL[s]} (${counts[s] ?? 0})`}
            onClick={() => setFilter('status', stage === s ? '' : s)} />
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <FilterChip active={!kind} label="Any kind" onClick={() => setFilter('kind', '')} />
        {ASSESSMENT_KINDS.map((k) => (
          <FilterChip key={k} active={kind === k} label={KIND_LABEL[k] ?? k}
            onClick={() => setFilter('kind', kind === k ? '' : k)} />
        ))}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="Nothing here yet"
          hint="Create a CAT, a homework, a project or an exam paper — they all live in this list."
          action={<Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" /> New assessment</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Assessment</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Kind</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Counts toward</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Due</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Marked</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.assessmentId} className="border-t hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <Link to={`/school/assessments/${r.assessmentId}/mark`} className="font-medium hover:underline">
                      {r.subject.name} — {r.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.class.name}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.component ? `${r.component.name} · ${r.component.weight}%` : <span className="text-amber-600">Not weighted</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.dueAt)}</td>
                  <td className="px-3 py-2"><Progress done={r.marked} total={r.total} /></td>
                  <td className="px-3 py-2">
                    <StageBadge row={r} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Homework also collects submissions, which the board does
                          not model — so the row offers the screen that does. */}
                      {r.kind === 'homework' && (
                        <Link to="/school/homework" className="text-xs text-muted-foreground hover:underline">
                          Submissions
                        </Link>
                      )}
                      <RowAction row={r} onMark={() => navigate(`/school/assessments/${r.assessmentId}/mark`)}
                        onSubmit={() => onSubmit(r)} submitting={submit.isPending} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateAssessmentDialog
          termId={termId}
          classId={classId}
          subjectId={subjectId}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-full border px-2.5 py-1 text-xs transition',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function stageOf(r: BoardRow): string {
  if (r.approvalStatus === 'approved') return 'approved';
  if (r.approvalStatus === 'submitted') return 'submitted';
  if (r.approvalStatus === 'rejected') return 'returned';
  if (r.marked > 0) return 'marking';
  if (r.status === 'draft') return 'draft';
  return 'open';
}

function StageBadge({ row }: { row: BoardRow }) {
  const s = stageOf(row);
  const tone =
    s === 'approved' ? 'border-emerald-600 text-emerald-700'
      : s === 'submitted' ? 'border-sky-600 text-sky-700'
        : s === 'returned' ? 'border-destructive text-destructive'
          : '';
  return (
    <span className="flex items-center gap-1">
      <Badge variant="outline" className={tone}>{STAGE_LABEL[s]}</Badge>
      {row.locked && <Lock className="h-3.5 w-3.5 text-amber-600" aria-label="Locked" />}
    </span>
  );
}

/**
 * One button, whose meaning follows the row's state — so the next thing to do
 * is never a guess. Approving is deliberately absent: the person who entered
 * the marks may not approve them, and offering the button would only produce a
 * 400 from the segregation-of-duty check.
 */
function RowAction({
  row, onMark, onSubmit, submitting,
}: { row: BoardRow; onMark: () => void; onSubmit: () => void; submitting: boolean }) {
  const s = stageOf(row);
  if (s === 'approved') {
    return <span className="flex items-center justify-end gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Approved</span>;
  }
  if (s === 'submitted') {
    return <span className="text-xs text-muted-foreground">Awaiting approval</span>;
  }
  if (row.marked > 0 && row.marked >= row.total) {
    return (
      <Button size="sm" variant="secondary" disabled={submitting} onClick={onSubmit}>
        <Send className="mr-1.5 h-3.5 w-3.5" /> Submit marks
      </Button>
    );
  }
  return <Button size="sm" variant="outline" onClick={onMark}>Mark</Button>;
}
