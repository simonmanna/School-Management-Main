import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, CheckCircle2, XCircle, CalendarClock } from 'lucide-react';
import {
  useAdmissions,
  useAdmissionAction,
  useAcademicYears,
  useClasses,
  type AdmissionApplication,
  type AdmissionStatus,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';

const STATUS_META: Record<AdmissionStatus, { cls: string; label: string }> = {
  submitted: { cls: 'bg-slate-100 text-slate-700', label: 'Submitted' },
  under_review: { cls: 'bg-amber-100 text-amber-700', label: 'Under review' },
  exam_scheduled: { cls: 'bg-sky-100 text-sky-700', label: 'Exam scheduled' },
  accepted: { cls: 'bg-emerald-100 text-emerald-700', label: 'Accepted' },
  enrolled: { cls: 'bg-indigo-100 text-indigo-700', label: 'Enrolled' },
  rejected: { cls: 'bg-rose-100 text-rose-700', label: 'Rejected' },
  withdrawn: { cls: 'bg-zinc-100 text-zinc-600', label: 'Withdrawn' },
};

const NEXT_ACTIONS: Record<AdmissionStatus, Array<{ action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw'; label: string; tone: 'default' | 'success' | 'danger' }>> = {
  submitted: [{ action: 'review', label: 'Start review', tone: 'default' }],
  under_review: [
    { action: 'accept', label: 'Accept', tone: 'success' },
    { action: 'reject', label: 'Reject', tone: 'danger' },
    { action: 'schedule_exam', label: 'Schedule exam', tone: 'default' },
  ],
  exam_scheduled: [
    { action: 'accept', label: 'Accept', tone: 'success' },
    { action: 'reject', label: 'Reject', tone: 'danger' },
  ],
  accepted: [],
  enrolled: [],
  rejected: [],
  withdrawn: [],
};

export function SchoolApplicationsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useAdmissions({ pageSize: 50 });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const act = useAdmissionAction();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const yearNameById = useMemo(() => Object.fromEntries((years?.data ?? []).map((y) => [y.id, y.name])), [years]);
  const classNameById = useMemo(() => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])), [classes]);

  const runAction = async (app: AdmissionApplication, action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw') => {
    try {
      await act.mutateAsync({ id: app.id, action });
      notify.success(`Application ${action.replace('_', ' ')}`);
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
                    <Badge className={STATUS_META[a.status]?.cls ?? 'bg-slate-100 text-slate-700'}>
                      {STATUS_META[a.status]?.label ?? a.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {NEXT_ACTIONS[a.status]?.map((n) => (
                        <Button
                          key={n.action}
                          variant={n.tone === 'success' ? 'default' : n.tone === 'danger' ? 'destructive' : 'secondary'}
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => runAction(a, n.action)}
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
