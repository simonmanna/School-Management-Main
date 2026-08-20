import { useState } from 'react';
import { UserCog } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useTeacherDashboard } from '@/features/school/api';

export function SchoolLmsTeacherDashboardPage() {
  const [teacherPartnerId, setTeacherPartnerId] = useState('');
  const { data, isFetching } = useTeacherDashboard(teacherPartnerId);

  const counts = data?.counts ?? {};
  const items = [
    ['Draft plans', counts.draft],
    ['Submitted (awaiting review)', counts.submitted],
    ['Needs revision', counts.needsRevision],
    ['Approved', counts.approved],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><UserCog className="h-5 w-5" /><h1 className="text-xl font-semibold">My Teaching</h1></div>
      <Card><CardHeader><CardTitle className="text-base">Teacher</CardTitle></CardHeader>
        <CardContent><div><Label>Teacher Partner ID</Label><Input value={teacherPartnerId} onChange={(e) => setTeacherPartnerId(e.target.value)} placeholder="staff/partner uuid" /></div></CardContent></Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map(([label, val]) => (
          <Card key={label}><CardContent className="pt-4">
            <div className="text-2xl font-semibold">{isFetching ? '…' : (val ?? 0)}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </CardContent></Card>
        ))}
      </div>
      {data?.upcoming && data.upcoming.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Upcoming scheduled lessons</CardTitle></CardHeader>
          <CardContent className="space-y-2">{data.upcoming.map((u: any) => <div key={u.id} className="rounded-md border px-3 py-2 text-sm flex items-center justify-between"><span>{new Date(u.plannedDate).toLocaleString()}</span><Badge variant="outline">{u.status}</Badge></div>)}</CardContent></Card>
      )}
    </div>
  );
}
