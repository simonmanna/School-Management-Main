import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import { useCourseLearners, useCreateFollowUp, useFollowUps, useUpdateFollowUp } from '@/features/school/teaching-api';
import { EmptyState, fmtDate } from '../_components/exam-workflow';

/**
 * The Learners tab — who is on this course, whether they are turning up, and
 * what was promised for them.
 *
 * Roster membership comes from the Phase 2 course enrollment, attendance from
 * the attendance module; neither is re-derived here.
 */
export function LearnersTab({ offeringId }: { offeringId: string }) {
  const navigate = useNavigate();
  const { data: learners = [], isLoading } = useCourseLearners(offeringId);
  const { data: followUps = [] } = useFollowUps({ courseOfferingId: offeringId });
  const createFollowUp = useCreateFollowUp(offeringId);
  const updateFollowUp = useUpdateFollowUp(offeringId);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const filtered = learners.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the roster…</p>;
  if (learners.length === 0) {
    return <EmptyState title="No learners on this course" hint="Sync the roster from the course offering screen to bring the class in." />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> {learners.length} learners</CardTitle>
          <Input className="w-56" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.map((learner) => {
          const theirs = followUps.filter((f) => f.studentProfileId === learner.studentProfileId && f.status !== 'done' && f.status !== 'cancelled');
          return (
            <div key={learner.courseEnrollmentId} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <button className="truncate font-medium hover:underline" onClick={() => navigate(`/school/students/${learner.studentProfileId}`)}>
                    {learner.name}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {[learner.admissionNumber, learner.section, learner.stream].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {learner.status !== 'ENROLLED' && <Badge variant="outline">{learner.status}</Badge>}
                  <Badge variant="secondary">{learner.source.toLowerCase()}</Badge>
                  <Badge variant={learner.attendancePct !== null && learner.attendancePct < 75 ? 'destructive' : 'outline'}>
                    {learner.attendancePct === null ? 'No register' : `${learner.attendancePct}% attendance`}
                  </Badge>
                </div>
              </div>

              {theirs.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {theirs.map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded border-l-2 border-amber-400 bg-muted/40 px-2 py-1 text-xs">
                      <span>{f.action}{f.dueDate ? ` · due ${fmtDate(f.dueDate)}` : ''}</span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => updateFollowUp.mutate({ id: f.id, status: 'done' })}>
                        Done
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 flex gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Add remedial follow-up for this learner"
                  value={drafts[learner.studentProfileId] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [learner.studentProfileId]: e.target.value }))}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!(drafts[learner.studentProfileId] ?? '').trim()}
                  onClick={() =>
                    createFollowUp.mutate(
                      { courseOfferingId: offeringId, action: drafts[learner.studentProfileId].trim(), studentProfileId: learner.studentProfileId },
                      {
                        onSuccess: () => { setDrafts((d) => ({ ...d, [learner.studentProfileId]: '' })); notify.success('Follow-up raised'); },
                        onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not raise the follow-up'),
                      },
                    )
                  }
                >
                  Add
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
