import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLmsParticipants } from '@/features/school/api';

/** Participants (ADR-014 §5) — role assignments at the course context (P0 × P4). */
export function SchoolLmsParticipantsPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, isLoading } = useLmsParticipants(id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/courses/${id}`)}><ArrowLeft className="h-4 w-4" /></Button>
        <Users className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Participants</h1>
        <Badge variant="outline">{data?.length ?? 0}</Badge>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <Card><CardContent className="py-4">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-4">Principal</th><th className="py-2 pr-4">Kind</th><th className="py-2 pr-4">Role</th><th className="py-2">Source</th></tr></thead>
          <tbody>
            {(data ?? []).map((a: any) => (
              <tr key={a.id} className="border-b">
                <td className="py-2 pr-4 font-mono text-xs">{(a.userId ?? a.studentProfileId ?? '—').slice(0, 12)}</td>
                <td className="py-2 pr-4">{a.userId ? 'staff' : 'student'}</td>
                <td className="py-2 pr-4"><Badge variant="outline">{a.role?.name ?? a.role?.shortname ?? '—'}</Badge></td>
                <td className="py-2 text-xs text-muted-foreground">{a.sourceComponent ?? '—'}</td>
              </tr>
            ))}
            {(data?.length ?? 0) === 0 && !isLoading && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No participants. Sync the roster from the course page.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
