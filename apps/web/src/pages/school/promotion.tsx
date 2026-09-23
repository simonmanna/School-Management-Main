import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCheck,
  GraduationCap,
  Loader2,
  RotateCcw,
  Save,
  Search,
  SkipForward,
  Users,
} from 'lucide-react';
import {
  useTerms,
  useClasses,
  useSections,
  useAcademicYears,
  useStudents,
  usePromoteStudent,
  useRollover,
} from '@/features/school/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { WorkflowSteps } from './_components/exam-workflow';
import { cn } from '@/lib/utils';

/**
 * Promotion & Rollover — per-student decision grid.
 *
 * Two layers, both wired to real backend endpoints:
 *   1. The grid: a list of students in the chosen Term + Class. Each row carries
 *      a per-student Promotion Status (Promoted / Repeated / Graduated / Skipped)
 *      plus an optional target class. Changes are staged locally (nothing is
 *      written until you click "Apply promotions").
 *   2. The whole-cohort rollover: a one-click PREVIEW → EXECUTE that computes the
 *      server plan for From-term → To-term and commits it.
 *
 * Local staging is "easy & flexible": flip any row's status any time, bulk-fill
 * via Select-All, then commit in a single batched request. Promoting without a
 * target class lets the server's grade-ladder pick the next class (or graduate
 * the top grade) — so a teacher can promote a whole form in two clicks.
 */

type Status = 'promoted' | 'repeated' | 'graduated' | 'skipped';

const STATUSES: { value: Status; label: string; tone: string }[] = [
  { value: 'promoted', label: 'Promoted', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { value: 'repeated', label: 'Repeated', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'graduated', label: 'Graduated', tone: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  { value: 'skipped', label: 'Skipped', tone: 'bg-muted text-muted-foreground' },
];

interface RowState {
  status: Status | '';
  toClassId: string; // '' = let the server decide
}

export function SchoolPromotionPage() {
  const navigate = useNavigate();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: years } = useAcademicYears();

  const promoteMut = usePromoteStudent();
  const rolloverMut = useRollover();

  // ── Filters ──
  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [search, setSearch] = useState('');

  // ── Per-student staged decisions: studentProfileId → RowState ──
  const [rows, setRows] = useState<Record<string, RowState>>({});

  // ── Rollover (whole cohort) ──
  const [fromTermId, setFromTermId] = useState('');
  const [toTermId, setToTermId] = useState('');
  const [rolloverPlan, setRolloverPlan] = useState<{
    total: number; promoted: number; graduated: number; skipped: number;
    rows: Array<{ studentProfileId: string; admissionNo: string; outcome: string; toClassId?: string | null; reason?: string }>;
    dryRun: boolean; committed: boolean;
  } | null>(null);

  // Only fetch students once a term + class is chosen (the decision surface).
  // The API resolves "in this class" from placement history; the profile no
  // longer carries a class of its own.
  const { data: studentsResp, isLoading } = useStudents(
    termId && classId ? { classId, search: search || undefined, page: 1, pageSize: 500 } : {},
  );
  const students = useMemo(() => {
    const list = (studentsResp?.data ?? []) as Array<{
      id: string; admissionNo: string; partner?: { name: string; code?: string | null } | null;
      gender?: string | null; currentClassId?: string | null; currentSectionId?: string | null; currentClass?: { name: string } | null;
    }>;
    const q = search.trim().toLowerCase();
    return list
      .filter((s) => {
        if (!q) return true;
        const name = s.partner?.name?.toLowerCase() ?? '';
        const no = s.admissionNo?.toLowerCase() ?? '';
        return name.includes(q) || no.includes(q);
      });
  }, [studentsResp, classId, search]);

  const nameOf = (s: { partner?: { name: string } | null }) =>
    (s.partner?.name ?? '').trim() || '—';
  const surnameFirst = (name: string) => {
    const parts = name.split(' ');
    return { surname: parts[0] ?? name, other: parts.slice(1).join(' ') };
  };
  const classNameOf = (id?: string | null) =>
    id ? ((classes?.data ?? []).find((c) => c.id === id)?.name ?? id) : '—';
  const sectionNameOf = (id?: string | null) =>
    id ? ((sections?.data ?? []).find((s) => s.id === id)?.name ?? id) : '';

  // Classes ranked by grade so "next class" is intuitive in the target picker.
  const orderedClasses = useMemo(
    () => [...(classes?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [classes],
  );

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], status: '', toClassId: '', ...patch } }));

  const selectedIds = students.filter((s) => rows[s.id]?.status).map((s) => s.id);

  const selectAll = (status: Status) => {
    setRows((prev) => {
      const next = { ...prev };
      for (const s of students) next[s.id] = { status, toClassId: '' };
      return next;
    });
    notify.success(`Marked all ${students.length} student(s) as ${status}`);
  };
  const clearAll = () => { setRows({}); notify.info('Cleared all staged decisions'); };

  const apply = async () => {
    const staged = students.filter((s) => rows[s.id]?.status);
    if (staged.length === 0) { notify.error('Mark at least one student first.'); return; }
    if (!toTermId && !termId) { notify.error('Choose a target term (filters or rollover To term).'); return; }
    const targetTerm = toTermId || termId;
    let ok = 0, fail = 0;
    for (const s of staged) {
      const r = rows[s.id];
      try {
        await promoteMut.mutateAsync({
          studentProfileId: s.id,
          toTermId: targetTerm,
          toClassId: r.toClassId || undefined,
          outcome: r.status as 'promoted' | 'repeated' | 'graduated',
          reason: r.status === 'skipped' ? 'Skipped by admin' : undefined,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    if (fail === 0) {
      notify.success(`${ok} pupil${ok === 1 ? '' : 's'} moved up.`, {
        description: 'Their new class list is ready.',
        action: { label: 'View class lists', onClick: () => navigate('/school/students') },
      });
      setRows({});
    } else {
      notify.error(`Moved ${ok}, could not move ${fail}.`, {
        description: 'Check that the target class and stream exist for the new term.',
      });
    }
  };

  // ── Whole-cohort rollover ──
  const rolloverValid = fromTermId && toTermId && fromTermId !== toTermId;
  const previewRollover = async () => {
    try {
      const res = await rolloverMut.mutateAsync({ fromTermId, toTermId, dryRun: true });
      setRolloverPlan({
        total: res.counts.total, promoted: res.counts.promoted, graduated: res.counts.graduated,
        skipped: res.counts.skipped, dryRun: true, committed: false,
        rows: [...(res.promote ?? []), ...(res.graduate ?? []), ...(res.skip ?? [])],
      });
    } catch { notify.error('Could not compute the rollover plan'); }
  };
  const executeRollover = async () => {
    try {
      const res = await rolloverMut.mutateAsync({ fromTermId, toTermId, dryRun: false });
      setRolloverPlan({
        total: res.counts.total, promoted: res.counts.promoted, graduated: res.counts.graduated,
        skipped: res.counts.skipped, dryRun: false, committed: true,
        rows: [...(res.promote ?? []), ...(res.graduate ?? []), ...(res.skip ?? [])],
      });
      notify.success(
        `Whole school moved up — ${res.counts.promoted} promoted, ${res.counts.graduated} graduated`,
        {
          description: 'Everyone now sits in their new class for the new term.',
          action: { label: 'View class lists', onClick: () => navigate('/school/students') },
        },
      );
    } catch (e: any) {
      notify.error(
        'Could not move the school up',
        { description: e?.response?.data?.message ?? 'Nothing was changed. Check the two terms and try again.' },
      );
    }
  };

  const filtersChosen = !!(yearId || termId || classId);
  const busy = promoteMut.isPending || rolloverMut.isPending;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold">Move pupils up a class</h1>
          <p className="text-sm text-muted-foreground">
            Decide each pupil’s next step, then commit. Leaving the target class blank moves them to
            the next class up. For a whole class or the whole school, use the bulk actions below.
          </p>
        </div>
        <WorkflowSteps current={7} />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4">
        <div className="space-y-1">
          <Label>Year</Label>
          <Select value={yearId} onValueChange={setYearId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All years" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All years</SelectItem>
              {(years?.data ?? []).map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Term</Label>
          <Select value={termId} onValueChange={(v) => { setTermId(v); setRows({}); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select term" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All terms</SelectItem>
              {(terms?.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Class</Label>
          <Select value={classId} onValueChange={(v) => { setClassId(v); setRows({}); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All classes</SelectItem>
              {orderedClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search for student"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* ── Decision grid ── */}
      <div className="rounded-md border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {classId ? `Students in ${classNameOf(classId)}` : 'A list of students you can promote.'}
            {students.length > 0 && <span className="ml-1 text-foreground">({students.length})</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={clearAll} disabled={busy || selectedIds.length === 0}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
            <Select onValueChange={(v) => selectAll(v as Status)}>
              <Button size="sm" variant="outline" asChild>
                <SelectTrigger className="gap-1"><CheckCheck className="mr-1 h-3.5 w-3.5" /> Select All…</SelectTrigger>
              </Button>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>Mark all as {s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={apply} disabled={busy || selectedIds.length === 0}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Apply promotions{selectedIds.length ? ` (${selectedIds.length})` : ''}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {!filtersChosen ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              Choose a Year, Term or Class to load the promotion grid.
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading students…
            </div>
          ) : students.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              No students found for the selected class.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 py-2 pl-4">#</th>
                  <th className="py-2 pr-4">RegNo.</th>
                  <th className="py-2 pr-4">Surname</th>
                  <th className="py-2 pr-4">Othernames</th>
                  <th className="py-2 pr-4">Gender</th>
                  <th className="py-2 pr-4">Current Class</th>
                  <th className="py-2 pr-4">Current Stream</th>
                  <th className="py-2 pr-4">Promotion Status</th>
                  <th className="py-2 pr-4">Target Class</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => {
                  const st = rows[s.id]?.status ?? '';
                  const tone = STATUSES.find((x) => x.value === st)?.tone;
                  return (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pl-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{s.admissionNo}</td>
                      <td className="py-2 pr-4 font-medium">{surnameFirst(nameOf(s)).surname}</td>
                      <td className="py-2 pr-4">{surnameFirst(nameOf(s)).other || '—'}</td>
                      <td className="py-2 pr-4">{s.gender ?? '—'}</td>
                      <td className="py-2 pr-4">{classNameOf(s.currentClassId)}</td>
                      <td className="py-2 pr-4">{sectionNameOf(s.currentSectionId) || '—'}</td>
                      <td className="py-2 pr-4">
                        <Select
                          value={st}
                          onValueChange={(v) => setRow(s.id, { status: v as Status })}
                        >
                          <SelectTrigger className={cn('w-40', tone && 'border-transparent', tone)}>
                            <SelectValue placeholder="Choose a status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Choose a status</SelectItem>
                            {STATUSES.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pr-4">
                        <Select
                          value={rows[s.id]?.toClassId ?? '__auto'}
                          onValueChange={(v) => setRow(s.id, { toClassId: v === '__auto' ? '' : v })}
                          disabled={!st || st === 'graduated' || st === 'skipped'}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue placeholder="Auto (next)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__auto">Auto (next grade)</SelectItem>
                            {orderedClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Whole-cohort rollover ── */}
      <div className="rounded-md border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Cohort rollover (whole form → next term)</h2>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>From term</Label>
            <Select value={fromTermId} onValueChange={(v) => { setFromTermId(v); setRolloverPlan(null); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Closing term" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Select…</SelectItem>
                {(terms?.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
          <div className="space-y-1">
            <Label>To term</Label>
            <Select value={toTermId} onValueChange={(v) => { setToTermId(v); setRolloverPlan(null); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Opening term" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Select…</SelectItem>
                {(terms?.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={!rolloverValid || busy} onClick={previewRollover}>
            Preview
          </Button>
          <Button
            disabled={!rolloverPlan || rolloverPlan.committed || busy}
            onClick={executeRollover}
          >
            Execute rollover
          </Button>
          {fromTermId && toTermId && fromTermId === toTermId && (
            <span className="text-sm text-destructive">From and To term must differ.</span>
          )}
        </div>

        {rolloverPlan && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini icon={<Users className="h-4 w-4" />} label="Students" value={rolloverPlan.total} />
              <Mini icon={<ArrowRight className="h-4 w-4" />} label="To promote" value={rolloverPlan.promoted} />
              <Mini icon={<GraduationCap className="h-4 w-4" />} label="To graduate" value={rolloverPlan.graduated} />
              <Mini icon={<SkipForward className="h-4 w-4" />} label="Skipped" value={rolloverPlan.skipped} />
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pl-4">RegNo.</th>
                    <th className="py-2 pr-4">Outcome</th>
                    <th className="py-2 pr-4">Target class</th>
                    <th className="py-2 pr-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rolloverPlan.rows.slice(0, 50).map((r) => (
                    <tr key={r.studentProfileId} className="border-b last:border-0">
                      <td className="py-2 pl-4 font-mono text-xs">{r.admissionNo}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{r.outcome}</Badge>
                      </td>
                      <td className="py-2 pr-4">{r.toClassId ? classNameOf(r.toClassId) : '—'}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rolloverPlan.rows.length > 50 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">
                  Showing first 50 of {rolloverPlan.rows.length} rows.
                </div>
              )}
            </div>
            {rolloverPlan.committed && (
              <p className="text-xs text-emerald-600">✓ Committed — enrollments created, history untouched.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background p-3">
      <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
      <div>
        <div className="text-xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
