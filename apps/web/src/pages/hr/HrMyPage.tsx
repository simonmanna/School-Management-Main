import { UserCircle, Users, FileText } from 'lucide-react';
import { useHrSelfProfile, useHrTeam, useHrPayslips } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function HrMyPage() {
  const { data: me } = useHrSelfProfile();
  const { data: team } = useHrTeam();
  const { data: payslips } = useHrPayslips({});
  const teamRows: any[] = (team as any[]) ?? [];
  const slipRows: any[] = (payslips as any)?.rows ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">My HR</h1>
        <p className="text-sm text-muted-foreground">Employee & manager self-service — your profile, payslips, and (for managers) your team.</p>
      </div>

      {!me && <p className="text-sm text-muted-foreground">You are not linked to an employee record. Ask HR to link your user account to an employee.</p>}

      {me && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm flex items-center gap-2"><UserCircle className="h-4 w-4" /> {me.firstName} {me.lastName ?? ''} ({me.employeeCode})</CardTitle></CardHeader>
          <CardContent className="grid gap-1 p-4 text-sm sm:grid-cols-2">
            <Line k="Department" v={me.department?.name ?? '—'} />
            <Line k="Position" v={me.position?.name ?? '—'} />
            <Line k="Employment type" v={me.employmentType ?? '—'} />
            <Line k="Pay frequency" v={me.payFrequency ?? '—'} />
            <Line k="Base salary" v={me.baseSalary ?? '—'} />
            <Line k="Joined" v={me.hireDate ? new Date(me.hireDate).toISOString().slice(0, 10) : '—'} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Recent payslips</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {slipRows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No payslips yet.</p>}
            {slipRows.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>{s.period?.periodCode ?? s.run?.period?.periodCode ?? '—'}</span>
                <span className="font-medium">{s.netPay}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {teamRows.length > 0 && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" /> My team ({teamRows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {teamRows.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{e.firstName} {e.lastName ?? ''} ({e.employeeCode})</span>
                  <Badge variant="outline">{e.position?.name ?? '—'}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v ?? '—'}</span>
    </div>
  );
}
