import { Link } from 'react-router-dom';
import { UserCheck, UserX, Users } from 'lucide-react';
import { useIdentityMatches, useReviewIdentityMatch, type IdentityMatch } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';

const STATUS_LABEL: Record<IdentityMatch['status'], string> = {
  open: 'Needs a decision',
  confirmed_same: 'Same child',
  dismissed: 'Different child',
};

/**
 * "Is this applicant already one of our pupils?"
 *
 * Submitting an application flags possible matches (same name and date of
 * birth, a shared guardian). Enrolment refuses while any is open, but nothing in
 * the UI listed them, so a sibling or a returning pupil could never be enrolled
 * (E2E audit AD3). Confirming "same child" makes enrolment reuse the existing
 * pupil record instead of creating a duplicate.
 */
export function IdentityMatchesPanel({ applicationId }: { applicationId: string }) {
  const { data: matches } = useIdentityMatches(applicationId);
  const review = useReviewIdentityMatch(applicationId);

  if (!matches || matches.length === 0) return null;
  const open = matches.filter((m) => m.status === 'open').length;

  const decide = async (m: IdentityMatch, decision: 'confirmed_same' | 'dismissed') => {
    try {
      await review.mutateAsync({ id: m.id, decision });
      notify.success(decision === 'confirmed_same' ? `Linked to ${m.candidateName}` : 'Marked as a different child');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not record the decision');
    }
  };

  return (
    <Card className={open ? 'border-amber-300' : undefined}>
      <CardContent className="p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" /> Possible existing pupil
          {open > 0 && <Badge variant="outline" className="border-amber-400 text-amber-700">{open} open</Badge>}
        </h3>
        {open > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            This applicant looks like someone already on the school&apos;s records. Decide each match before enrolling.
          </p>
        )}
        <div className="space-y-2">
          {matches.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div>
                {m.candidateType === 'student' ? (
                  <Link to={`/school/students/${m.candidateId}`} className="font-medium hover:underline">
                    {m.candidateName}
                  </Link>
                ) : (
                  <span className="font-medium">{m.candidateName}</span>
                )}
                <p className="text-xs text-muted-foreground">
                  {m.candidateType} · matched on {m.matchMethod.replace(/_/g, ' ')} · {STATUS_LABEL[m.status]}
                </p>
              </div>
              {m.status === 'open' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => decide(m, 'confirmed_same')}>
                    <UserCheck className="mr-1 h-3.5 w-3.5" /> Same child
                  </Button>
                  <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => decide(m, 'dismissed')}>
                    <UserX className="mr-1 h-3.5 w-3.5" /> Different child
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
