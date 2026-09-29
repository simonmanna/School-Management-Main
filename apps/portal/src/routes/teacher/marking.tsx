import { useState } from 'react';
import { PencilLine, Lock, ChevronLeft, Send } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import {
  useTeacherOverview,
  useMarkSheet,
  useRecordMark,
  useAssignmentInbox,
  useEvidence,
  useGradeRubric,
  type RubricCriterion,
  useMyAssessments,
  useSubmitMarks,
  type MyAssessment,
} from '@/lib/portal-api';
import { apiErrorMessage } from '@/lib/api';
import { notify } from '@/lib/notify';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';

/**
 * Marking, from home.
 *
 * Entry only. `school:grades:own` lets a teacher mark THEIR assessments —
 * `MarkingService` resolves the assessment's `teacherPartnerId` against the
 * caller's StaffProfile — and approval is a separate grant on a separate route
 * that no teacher role holds. Whoever enters a mark does not approve it.
 *
 * An approved mark is read-only here: reopening it is an act for the department,
 * not something to do accidentally on a phone.
 *
 * The teacher picks from their own assessments (audit 2026-09-29 A07) — the
 * page used to ask them to paste an assessment id they had no way to find.
 */
export default function TeacherMarking() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const { data, isLoading } = useTeacherOverview(teacher?.staffProfileId);
  const { data: mine, isLoading: mineLoading } = useMyAssessments();
  const [openAssessmentId, setOpenAssessmentId] = useState<string | null>(null);
  const open = mine?.find((a) => a.id === openAssessmentId) ?? null;

  if (!teacher) return <Empty title="No teaching record linked" />;
  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const papers = data?.examPapers ?? [];
  const plans = data?.lessonPlans;

  return (
    <div className="space-y-4">
      <PageTitle sub={teacher.name}>Marking</PageTitle>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PencilLine className="h-4 w-4" /> Papers to enter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {papers.length === 0 && <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}
          {papers.map((p) => {
            const done = p.total > 0 && p.entered >= p.total;
            return (
              <div key={p.examScheduleId} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.subject}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.examName}</div>
                  </div>
                  <Badge variant={done ? 'success' : 'warning'}>{p.entered}/{p.total}</Badge>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${p.total > 0 ? Math.round((p.entered / p.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {open ? (
        <MarkSheet assessment={open} onBack={() => setOpenAssessmentId(null)} />
      ) : (
        <AssessmentPicker assessments={mine ?? []} loading={mineLoading} onOpen={setOpenAssessmentId} />
      )}

      {plans && (
        <Card>
          <CardHeader><CardTitle className="text-base">Lesson plans</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 pt-0 text-center">
            <Tally label="Draft" value={plans.draft} />
            <Tally label="Submitted" value={plans.submitted} />
            <Tally label="Approved" value={plans.approved} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** The teacher's own assessments, grouped by class and stream. */
function AssessmentPicker({
  assessments,
  loading,
  onOpen,
}: {
  assessments: MyAssessment[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  const groups = new Map<string, MyAssessment[]>();
  for (const a of assessments) {
    const key = [a.className ?? 'No class', a.sectionName].filter(Boolean).join(' · ');
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Enter marks</CardTitle></CardHeader>
      <CardContent className="space-y-4 pt-0">
        {assessments.length === 0 && (
          <p className="text-sm text-muted-foreground">No assessments to mark in the current term.</p>
        )}
        {[...groups.entries()].map(([klass, rows]) => (
          <div key={klass} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{klass}</div>
            {rows.map((a) => {
              const approved = a.total > 0 && a.approved === a.total;
              const complete = a.total > 0 && a.entered >= a.total;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{a.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[a.subjectName, a.termName, a.kind].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <Badge variant={approved ? 'success' : complete ? 'secondary' : 'warning'}>
                      {a.entered}/{a.total}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MarkSheet({ assessment, onBack }: { assessment: MyAssessment; onBack: () => void }) {
  const assessmentId = assessment.id;
  const { data, isLoading, isError } = useMarkSheet(assessmentId);
  const record = useRecordMark();
  const submit = useSubmitMarks();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Wave 16: an assignment marked against a rubric is scored criterion by criterion.
  const { data: inbox } = useAssignmentInbox(assessmentId);
  const rubric = inbox?.assignment?.gradingMode === 'rubric' ? inbox.rubric : null;
  const [openRubric, setOpenRubric] = useState<string | null>(null);

  const header = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to assessments">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0">
        <div className="truncate font-medium">{assessment.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[assessment.className, assessment.subjectName, assessment.termName].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );

  if (isLoading) return <div className="space-y-2">{header}<Skeleton className="h-40 w-full" /></div>;
  if (isError) {
    return (
      <div className="space-y-2">
        {header}
        <Empty title="That assessment is not yours" hint="You can only enter marks for assessments you are the teacher of." />
      </div>
    );
  }
  if (!data || data.length === 0) return <div className="space-y-2">{header}<Empty title="No pupils on this assessment" /></div>;

  const openRows = data.filter((r) => r.approvalStatus === 'draft' || r.approvalStatus === 'rejected');
  const unmarked = openRows.filter((r) => r.effectiveScore == null && r.participation === 'present').length;
  const submitAll = async () => {
    try {
      await submit.mutateAsync(assessmentId);
      notify.success('Marks submitted for approval');
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Could not submit these marks.'));
    }
  };

  const saveOne = async (row: { id: string; maxScore: number | string }) => {
    const raw = drafts[row.id];
    const score = Number(raw);
    const max = Number(row.maxScore);
    if (!Number.isFinite(score) || score < 0 || score > max) {
      notify.error(`Enter a mark between 0 and ${max}.`);
      return;
    }
    try {
      await record.mutateAsync({ assessmentId, studentAssessmentId: row.id, score });
      setDrafts((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
      notify.success('Mark saved');
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Could not save that mark.'));
    }
  };

  return (
    <Card>
      <CardHeader>{header}</CardHeader>
      <CardContent className="space-y-2 pt-0">
        {data.map((row) => {
          const approved = row.approvalStatus === 'approved';
          const current = drafts[row.id] ?? (row.effectiveScore != null ? String(row.effectiveScore) : '');
          return (
            <div key={row.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{row.studentName ?? 'Unnamed pupil'}</div>
                {row.admissionNo && <div className="truncate text-xs text-muted-foreground">{row.admissionNo}</div>}
                <div className="flex items-center gap-1 pt-1">
                  <Badge variant={approved ? 'success' : 'secondary'}>{row.approvalStatus}</Badge>
                  {row.participation !== 'present' && <Badge variant="outline">{row.participation}</Badge>}
                </div>
              </div>
              {approved ? (
                <div className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  {row.effectiveScore ?? '—'} / {row.maxScore}
                </div>
              ) : rubric && inbox?.assignment ? (
                <Button size="sm" variant="outline" onClick={() => setOpenRubric(openRubric === row.id ? null : row.id)}>
                  {row.effectiveScore != null ? `${row.effectiveScore} / ${row.maxScore}` : 'Score'}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={Number(row.maxScore)}
                    className="h-10 w-20 text-center"
                    value={current}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  />
                  <span className="text-sm text-muted-foreground">/ {row.maxScore}</span>
                  <Button
                    size="sm"
                    disabled={record.isPending || drafts[row.id] === undefined}
                    onClick={() => saveOne(row)}
                  >
                    Save
                  </Button>
                </div>
              )}
            </div>
            {rubric && inbox?.assignment && openRubric === row.id && !approved && (
              <RubricGrid
                assessmentId={assessmentId}
                assignmentId={inbox.assignment.id}
                studentProfileId={row.studentProfileId}
                version={row.version}
                criteria={rubric.criteria}
                onSaved={() => setOpenRubric(null)}
              />
            )}
            </div>
          );
        })}
        {openRows.length > 0 && (
          <Button className="w-full" disabled={submit.isPending || unmarked > 0} onClick={submitAll}>
            <Send className="h-4 w-4" />
            {unmarked > 0 ? `${unmarked} still to mark` : 'Submit for approval'}
          </Button>
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          Approved marks are locked. Ask the head of department to reopen them.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Wave 16: score one pupil against each rubric criterion. The server works out
 * the mark from the levels, checks the paper is yours, and keeps it a draft
 * until the whole sheet is submitted for approval.
 */
function RubricGrid({ assessmentId, assignmentId, studentProfileId, version, criteria, onSaved }: {
  assessmentId: string;
  assignmentId: string;
  studentProfileId: string;
  version?: number;
  criteria: RubricCriterion[];
  onSaved: () => void;
}) {
  const grade = useGradeRubric(assessmentId);
  const { data: evidence } = useEvidence(assessmentId, studentProfileId);
  const initial = Object.fromEntries((evidence?.rubricScores ?? []).map((r) => [r.criterionId, String(r.score)]));
  const [scores, setScores] = useState<Record<string, string>>({});
  const value = (id: string) => scores[id] ?? initial[id] ?? '';
  const complete = criteria.every((c) => value(c.id) !== '');
  const save = async () => {
    try {
      await grade.mutateAsync({
        assignmentId,
        studentProfileId,
        expectedVersion: version,
        rubricScores: criteria.map((c) => ({ criterionId: c.id, score: Number(value(c.id)) })),
      });
      notify.success('Rubric saved as a draft');
      onSaved();
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Could not save the rubric.'));
    }
  };
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      {criteria.map((c) => (
        <label key={c.id} className="block space-y-1 text-sm">
          <span className="font-medium">{c.name}</span>
          {c.description && <span className="block text-xs text-muted-foreground">{c.description}</span>}
          {c.levels.length ? (
            <select
              className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              value={value(c.id)}
              onChange={(e) => setScores((s) => ({ ...s, [c.id]: e.target.value }))}
            >
              <option value="">Choose a level…</option>
              {c.levels.map((l) => <option key={l.id} value={String(l.score)}>{l.label} ({l.score})</option>)}
            </select>
          ) : (
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={c.maxScore}
              className="h-10 w-24"
              value={value(c.id)}
              onChange={(e) => setScores((s) => ({ ...s, [c.id]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <Button size="sm" className="w-full" disabled={!complete || grade.isPending} onClick={save}>
        {complete ? 'Save rubric' : 'Score every criterion'}
      </Button>
    </div>
  );
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="pt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
