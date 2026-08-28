import { useState } from 'react';
import { PencilLine, Lock } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useTeacherOverview, useMarkSheet, useRecordMark } from '@/lib/portal-api';
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
 */
export default function TeacherMarking() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const { data, isLoading } = useTeacherOverview(teacher?.staffProfileId);
  const [openAssessmentId, setOpenAssessmentId] = useState<string | null>(null);

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

      <Card>
        <CardHeader><CardTitle className="text-base">Enter marks</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Assessment ID</span>
            <Input
              placeholder="Paste an assessment id"
              value={openAssessmentId ?? ''}
              onChange={(e) => setOpenAssessmentId(e.target.value.trim() || null)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The mark sheet loads below. You can only open assessments that are yours — the
            server refuses anybody else&apos;s.
          </p>
        </CardContent>
      </Card>

      {openAssessmentId && <MarkSheet assessmentId={openAssessmentId} />}

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

function MarkSheet({ assessmentId }: { assessmentId: string }) {
  const { data, isLoading, isError } = useMarkSheet(assessmentId);
  const record = useRecordMark();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <Empty
        title="That assessment is not yours"
        hint="You can only enter marks for assessments you are the teacher of."
      />
    );
  }
  if (!data || data.length === 0) return <Empty title="No pupils on this assessment" />;

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
      <CardHeader><CardTitle className="text-base">Mark sheet</CardTitle></CardHeader>
      <CardContent className="space-y-2 pt-0">
        {data.map((row) => {
          const approved = row.approvalStatus === 'approved';
          const current = drafts[row.id] ?? (row.effectiveScore != null ? String(row.effectiveScore) : '');
          return (
            <div key={row.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {row.studentProfileId.slice(0, 8)}
                </div>
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
          );
        })}
        <p className="pt-1 text-xs text-muted-foreground">
          Approved marks are locked. Ask the head of department to reopen them.
        </p>
      </CardContent>
    </Card>
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
