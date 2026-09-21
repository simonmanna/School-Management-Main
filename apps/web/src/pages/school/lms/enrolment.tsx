import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, Check, Plus, RefreshCw, Search, UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useLmsCoursePage, useLmsEnrol, useLmsEnrolmentMethods, useLmsEnrolments,
  useLmsSetEnrolStatus, useLmsSyncRoster, useStudents,
} from '@/features/school/api';
import { can, CAP, type CoursePageView } from '@/features/school/lms/types';
import { notify } from '@/lib/notify';

const ROLES = [
  { value: 'student', label: 'Student' },
  { value: 'editingteacher', label: 'Teacher (editing)' },
  { value: 'teacher', label: 'Teacher (non-editing)' },
];

/**
 * Enrolment manager (ADR-014 §3.3).
 *
 * Enrolment separates HOW someone joined (roster sync, manual, self) from WHAT
 * role they hold, which is why this screen is not the class register: a pupil can
 * be on the register and suspended here, or manually added without being on it.
 *
 * Suspension is the removal control on purpose — it keeps the history, marks and
 * submissions the pupil already has, where a delete would strand them.
 */
export function SchoolLmsEnrolmentPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();

  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const { data: page } = useLmsCoursePage(id);
  const { data: methods } = useLmsEnrolmentMethods(id);
  const { data: enrolments, isLoading } = useLmsEnrolments(id, status === 'all' ? undefined : status);
  const setEnrolStatus = useLmsSetEnrolStatus();
  const syncRoster = useLmsSyncRoster();

  const course = page as CoursePageView | undefined;
  const mayManage = can(course?.capabilities, CAP.courseManage);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = enrolments ?? [];
    if (!needle) return list;
    return list.filter(
      (e) =>
        (e.studentName ?? '').toLowerCase().includes(needle) ||
        (e.admissionNo ?? '').toLowerCase().includes(needle),
    );
  }, [enrolments, q]);

  const activeCount = (enrolments ?? []).filter((e) => e.status === 'active').length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/courses/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">Enrolment</h1>
          <p className="truncate text-sm text-muted-foreground">{course?.course.name}</p>
        </div>
        {mayManage && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={syncRoster.isPending}
              onClick={async () => {
                try {
                  const r: any = await syncRoster.mutateAsync(id);
                  notify.success(`Roster synced — ${r?.enrolled ?? 0} pupil(s)`);
                } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Sync failed'); }
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" />Sync from register
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <UserPlus className="mr-1 h-4 w-4" />Enrol someone
            </Button>
          </>
        )}
      </div>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Enrolment methods</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(methods ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">None configured — the roster sync default is created on first use.</p>
          )}
          {(methods ?? []).map((m) => (
            <Badge key={m.id} variant={m.enabled ? 'default' : 'secondary'}>
              {m.method.replace('_', ' ')}{m.enabled ? '' : ' (off)'}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Find a pupil…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All enrolments</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="suspended">Suspended only</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="tabular-nums">{activeCount} active</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nobody enrolled yet. Sync from the class register, or enrol someone manually.
            </p>
          )}
          <ul className="divide-y">
            {rows.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.studentName ?? (e.userId ? 'Staff member' : 'Unknown')}
                  </p>
                  {e.admissionNo && <p className="text-xs text-muted-foreground">{e.admissionNo}</p>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {e.startedAt ? new Date(e.startedAt).toLocaleDateString() : '—'}
                </span>
                <Badge variant={e.status === 'active' ? 'secondary' : 'outline'}>{e.status}</Badge>
                {mayManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setEnrolStatus.isPending}
                    onClick={async () => {
                      const next = e.status === 'active' ? 'suspended' : 'active';
                      try {
                        await setEnrolStatus.mutateAsync({ id: e.id, status: next });
                        notify.success(next === 'active' ? 'Reactivated' : 'Suspended');
                      } catch (err: any) { notify.error(err?.response?.data?.message ?? 'Failed'); }
                    }}
                  >
                    {e.status === 'active'
                      ? <><Ban className="mr-1 h-3.5 w-3.5" />Suspend</>
                      : <><Check className="mr-1 h-3.5 w-3.5" />Reactivate</>}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {adding && <EnrolDialog courseId={id} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Manual enrolment. Search the pupil register, pick a role, enrol. */
function EnrolDialog({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState('student');
  const { data: students, isFetching } = useStudents({ search: search.trim() || undefined, pageSize: 20 });
  const enrol = useLmsEnrol();

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Enrol someone</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Find a pupil</Label>
            <Input
              autoFocus
              placeholder="Name or admission number"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPicked(null); }}
            />
          </div>

          <div className="max-h-56 overflow-y-auto rounded-md border">
            {isFetching && <p className="p-3 text-xs text-muted-foreground">Searching…</p>}
            {!isFetching && (students?.data ?? []).length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">No pupil matches that.</p>
            )}
            <ul className="divide-y">
              {(students?.data ?? []).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setPicked({ id: s.id, name: s.partner?.name ?? s.admissionNo })}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      picked?.id === s.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.partner?.name ?? 'Unnamed'}</span>
                    <span className="text-xs text-muted-foreground">{s.admissionNo}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Role in this course</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!picked || enrol.isPending}
            onClick={async () => {
              if (!picked) return;
              try {
                await enrol.mutateAsync({ courseId, studentProfileId: picked.id, roleShortname: role });
                notify.success(`Enrolled ${picked.name}`);
                onClose();
              } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Enrolment failed'); }
            }}
          >
            <Plus className="mr-1 h-4 w-4" />Enrol
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
