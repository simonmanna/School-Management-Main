import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, CheckCircle2, XCircle, CalendarClock } from 'lucide-react';
import {
  useAdmissions,
  useAdmissionAction,
  useAcademicYears,
  useClasses,
  type AdmissionApplication,
  type AdmissionAction,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
// Single source of truth for the lifecycle. This page previously carried its own
// copy of STATUS_META/NEXT_ACTIONS, identical to admissions.tsx and covering only
// 7 of the 15 backend states.
import { NEXT_ACTIONS, statusMeta } from './_components/admission-status';

export function SchoolApplicationsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useAdmissions({ pageSize: 50 });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const act = useAdmissionAction();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const yearNameById = useMemo(() => Object.fromEntries((years?.data ?? []).map((y) => [y.id, y.name])), [years]);
  const classNameById = useMemo(() => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])), [classes]);

  const runAction = async (app: AdmissionApplication, action: AdmissionAction, needsNotes?: boolean) => {
    let notes: string | undefined;
    if (needsNotes) {
      const entered = window.prompt(`Reason for "${action.replace(/_/g, ' ')}"?`);
      if (entered === null) return;
      if (!entered.trim()) {
        notify.error('A reason is required for this action');
        return;
      }
      notes = entered.trim();
    }
    try {
      await act.mutateAsync({ id: app.id, action, notes });
      notify.success(`Application ${action.replace(/_/g, ' ')}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Action failed');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Applications</h1>
          <p className="text-sm text-muted-foreground">Front-desk student applications linked to Admissions.</p>
        </div>
        <Button onClick={() => navigate('/school/applications/new')}>
          <Plus className="h-4 w-4" /> New application
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Application no.</th>
                <th className="px-4 py-2 font-medium">Applicant</th>
                <th className="px-4 py-2 font-medium">Applying for</th>
                <th className="px-4 py-2 font-medium">Academic year</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No applications yet. Create the first one.</td></tr>
              )}
              {rows.map((a) => (
                <tr
                  key={a.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                  onClick={() => navigate(`/school/applications/${a.id}`)}
                >
                  <td className="px-4 py-2 font-mono text-xs">{a.applicationNumber}</td>
                  <td className="px-4 py-2 font-medium">{a.applicantFirstName} {a.applicantLastName}</td>
                  <td className="px-4 py-2">{a.applyingForClassId ? classNameByIdExists(classNameById, a.applyingForClassId) : '—'}</td>
                  <td className="px-4 py-2">{yearNameById[a.academicYearId] ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge className={statusMeta(a.status).cls}>{statusMeta(a.status).label}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {(NEXT_ACTIONS[a.status] ?? []).map((n) => (
                        <Button
                          key={n.action}
                          variant={n.tone === 'success' ? 'default' : n.tone === 'danger' ? 'destructive' : 'secondary'}
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => runAction(a, n.action, n.needsNotes)}
                        >
                          {n.action === 'accept' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {n.action === 'reject' && <XCircle className="h-3.5 w-3.5" />}
                          {n.action === 'schedule_exam' && <CalendarClock className="h-3.5 w-3.5" />}
                          {n.action === 'review' && <Send className="h-3.5 w-3.5" />}
                          {n.label}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function classNameByIdExists(map: Record<string, string>, id?: string | null) {
  if (!id) return '—';
  return map[id] ?? '—';
}
