import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import {
  useAcademicYears,
  useAdmissionCycles,
  useAdmissions,
  useClasses,
  useSections,
  useTerms,
  useStudents, currentTerminology } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

/*
 * Admissions set-up screens (E2E audit Wave 5). The API has had cycles,
 * capacity, criteria sets, waitlist ranking, bulk enrolment, transfer-in and
 * re-enrolment since phase 3–5; none had a screen, so a school could only
 * configure admissions through the database.
 */

const S = '/school/admissions';
const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const msg = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : (m ?? fallback);
};

/* ───────────────────────── Cycles · capacity · criteria · waitlist ───────────────────────── */

export function CyclesCapacityTab() {
  const qc = useQueryClient();
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const [yearId, setYearId] = useState('');
  const { data: cycles } = useAdmissionCycles(yearId || undefined);
  const [cycleId, setCycleId] = useState('');
  const [newCycle, setNewCycle] = useState({ name: '', opensAt: '', closesAt: '' });
  const [cap, setCap] = useState({ classId: '', sectionId: '', capacity: '', reservedCapacity: '' });
  const [criteria, setCriteria] = useState<Array<{ name: string; weight: string; maxScore: string }>>([
    { name: 'Interview', weight: '50', maxScore: '100' },
    { name: 'Entrance test', weight: '50', maxScore: '100' },
  ]);
  const [criteriaName, setCriteriaName] = useState('');
  const [waitClass, setWaitClass] = useState('');

  const status = useQuery({
    queryKey: ['school', 'admissions', 'capacity', cycleId],
    enabled: !!cycleId,
    queryFn: async () => (await api.get<any>(`${S}/capacity/${cycleId}/status`)).data,
  });

  const createCycle = useMutation({
    mutationFn: async () =>
      (await api.post(`${S}/cycles`, {
        academicYearId: yearId,
        name: newCycle.name.trim(),
        opensAt: newCycle.opensAt || undefined,
        closesAt: newCycle.closesAt || undefined,
      })).data,
    onSuccess: (c: any) => {
      notify.success('Admission cycle created');
      setNewCycle({ name: '', opensAt: '', closesAt: '' });
      setCycleId(c?.id ?? '');
      qc.invalidateQueries({ queryKey: ['school', 'admissions', 'cycles'] });
    },
    onError: (e) => notify.error(msg(e, 'Could not create the cycle')),
  });

  const setCapacity = useMutation({
    mutationFn: async () =>
      (await api.post(`${S}/capacity`, {
        admissionCycleId: cycleId,
        classId: cap.classId,
        sectionId: cap.sectionId || undefined,
        capacity: Number(cap.capacity),
        reservedCapacity: cap.reservedCapacity ? Number(cap.reservedCapacity) : undefined,
      })).data,
    onSuccess: () => {
      notify.success('Seats saved');
      qc.invalidateQueries({ queryKey: ['school', 'admissions', 'capacity', cycleId] });
    },
    onError: (e) => notify.error(msg(e, 'Could not save the seats')),
  });

  const createCriteria = useMutation({
    mutationFn: async () =>
      (await api.post(`${S}/criteria-sets`, {
        admissionCycleId: cycleId,
        name: criteriaName.trim(),
        isDefault: true,
        criteria: criteria
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), weight: Number(c.weight), maxScore: Number(c.maxScore) || undefined })),
      })).data,
    onSuccess: () => {
      notify.success('Selection criteria saved');
      setCriteriaName('');
    },
    onError: (e) => notify.error(msg(e, 'Could not save the criteria')),
  });

  const rank = useMutation({
    mutationFn: async () => (await api.post(`${S}/waitlist/${waitClass}/rank`)).data,
    onSuccess: (r: any) => notify.success(`Waiting list re-ranked (${Array.isArray(r) ? r.length : r?.ranked ?? 0} applicant(s))`),
    onError: (e) => notify.error(msg(e, 'Could not rank the waiting list')),
  });

  const classSections = (sections?.data ?? []).filter((s: any) => s.classId === cap.classId);
  const weightTotal = criteria.reduce((t, c) => t + (Number(c.weight) || 0), 0);
  const rows: any[] = Array.isArray(status.data) ? status.data : (status.data?.rows ?? status.data?.classes ?? []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Admission cycles</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label>Academic year</Label>
              <select className={sel} value={yearId} onChange={(e) => { setYearId(e.target.value); setCycleId(''); }}>
                <option value="">Choose a year</option>
                {(years?.data ?? []).map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>New cycle name</Label>
              <Input value={newCycle.name} onChange={(e) => setNewCycle({ ...newCycle, name: e.target.value })} placeholder="2027 intake" />
            </div>
            <div className="space-y-1">
              <Label>Opens</Label>
              <Input type="date" value={newCycle.opensAt} onChange={(e) => setNewCycle({ ...newCycle, opensAt: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Closes</Label>
              <Input type="date" value={newCycle.closesAt} onChange={(e) => setNewCycle({ ...newCycle, closesAt: e.target.value })} />
            </div>
          </div>
          <Button size="sm" disabled={!yearId || !newCycle.name.trim() || createCycle.isPending} onClick={() => createCycle.mutate()}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Create cycle
          </Button>
          <div className="flex flex-wrap gap-2">
            {(cycles ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => setCycleId(c.id)}
                className={`rounded-md border px-3 py-1 text-sm ${cycleId === c.id ? 'border-indigo-500 bg-indigo-50 font-medium' : ''}`}
              >
                {c.name} <Badge variant="outline" className="ml-1">{c.status}</Badge>
              </button>
            ))}
            {yearId && (cycles ?? []).length === 0 && <p className="text-sm text-muted-foreground">No cycles for this year yet.</p>}
          </div>
        </CardContent>
      </Card>

      {cycleId && (
        <>
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-sm font-semibold">Seats per class</h3>
              <div className="grid gap-3 sm:grid-cols-5">
                <select className={sel} value={cap.classId} onChange={(e) => setCap({ ...cap, classId: e.target.value, sectionId: '' })}>
                  <option value="">Class</option>
                  {(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className={sel} value={cap.sectionId} disabled={classSections.length === 0} onChange={(e) => setCap({ ...cap, sectionId: e.target.value })}>
                  <option value="">Whole class</option>
                  {classSections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <Input type="number" min={0} placeholder="Seats" value={cap.capacity} onChange={(e) => setCap({ ...cap, capacity: e.target.value })} />
                <Input type="number" min={0} placeholder="Reserved" value={cap.reservedCapacity} onChange={(e) => setCap({ ...cap, reservedCapacity: e.target.value })} />
                <Button size="sm" disabled={!cap.classId || cap.capacity === '' || Number(cap.capacity) < 0 || setCapacity.isPending} onClick={() => setCapacity.mutate()}>
                  Save seats
                </Button>
              </div>
              {status.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {rows.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-1">Class</th><th>Seats</th><th>Reserved</th><th>Taken</th><th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={r.id ?? i} className="border-b last:border-0">
                        <td className="py-1">{r.className ?? r.class?.name ?? r.classId}{r.sectionName ? ` · ${r.sectionName}` : ''}</td>
                        <td>{r.capacity}</td>
                        <td>{r.reservedCapacity ?? 0}</td>
                        <td>{r.claimedSeats ?? r.occupied ?? 0}</td>
                        <td className={Number(r.available) <= 0 ? 'font-medium text-destructive' : ''}>{r.available}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-sm font-semibold">Selection criteria</h3>
              <Input placeholder="Criteria set name, e.g. P1 selection" value={criteriaName} onChange={(e) => setCriteriaName(e.target.value)} />
              {criteria.map((c, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <Input placeholder="Criterion" value={c.name} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input type="number" placeholder="Weight %" value={c.weight} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
                  <Input type="number" placeholder="Max score" value={c.maxScore} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, maxScore: e.target.value } : x)))} />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setCriteria([...criteria, { name: '', weight: '0', maxScore: '100' }])}>Add criterion</Button>
                <span className={weightTotal === 100 ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>Weights total {weightTotal}%</span>
                <Button size="sm" disabled={!criteriaName.trim() || weightTotal !== 100 || createCriteria.isPending} onClick={() => createCriteria.mutate()}>
                  Save criteria
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="w-64 space-y-1">
                <Label>Re-rank the waiting list for</Label>
                <select className={sel} value={waitClass} onChange={(e) => setWaitClass(e.target.value)}>
                  <option value="">Class</option>
                  {(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Button size="sm" disabled={!waitClass || rank.isPending} onClick={() => rank.mutate()}>Rank by score</Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Intake: bulk enrol · transfer-in · re-enrol ───────────────────────── */

export function IntakeTab() {
  const qc = useQueryClient();
  const { data: apps } = useAdmissions({ pageSize: 200 });
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: terms } = useTerms();
  const [target, setTarget] = useState({ classId: '', sectionId: '', termId: '' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<any[] | null>(null);
  const [transfer, setTransfer] = useState({ name: '', dateOfBirth: '', transferredFrom: '', classId: '', sectionId: '', termId: '', rollNumber: '' });
  const [studentSearch, setStudentSearch] = useState('');
  const { data: students } = useStudents({ search: studentSearch || undefined, pageSize: 20 });
  const [re, setRe] = useState({ studentId: '', classId: '', sectionId: '', termId: '', rollNumber: '' });

  const ready = useMemo(
    () => ((apps?.data ?? []) as any[]).filter((a) => ['offer_accepted', 'accepted', 'submitted', 'under_review'].includes(a.status)),
    [apps],
  );
  const sectionsOf = (classId: string) => (sections?.data ?? []).filter((s: any) => s.classId === classId);
  const items = () =>
    ready
      .filter((a) => picked[a.id])
      .map((a, i) => ({
        applicationId: a.id,
        classId: target.classId,
        sectionId: target.sectionId || undefined,
        termId: target.termId,
        rollNumber: String(i + 1),
        student: { name: `${a.applicantFirstName} ${a.applicantLastName}` },
      }));

  const doPreview = useMutation({
    mutationFn: async () => (await api.post(`${S}/enroll/bulk/preview`, { items: items().map(({ student: _s, ...rest }) => rest) })).data,
    onSuccess: (r: any) => setPreview(Array.isArray(r) ? r : (r?.items ?? [])),
    onError: (e) => notify.error(msg(e, 'Could not preview')),
  });
  const doEnroll = useMutation({
    mutationFn: async () => (await api.post(`${S}/enroll/bulk`, { items: items() })).data,
    onSuccess: (r: any) => {
      notify.success(`Enrolled ${r?.enrolled?.length ?? 0}; skipped ${r?.skipped?.length ?? 0}`, {
        description: (r?.skipped ?? []).slice(0, 3).map((s: any) => s.reason).join(' · ') || undefined,
      });
      setPicked({});
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['school', 'admissions'] });
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
    },
    onError: (e) => notify.error(msg(e, 'Could not enrol')),
  });
  const doTransfer = useMutation({
    mutationFn: async () =>
      (await api.post(`${S}/students/transfer-in`, {
        name: transfer.name.trim(),
        dateOfBirth: transfer.dateOfBirth || undefined,
        transferredFrom: transfer.transferredFrom || undefined,
        classId: transfer.classId,
        sectionId: transfer.sectionId || undefined,
        termId: transfer.termId,
        rollNumber: transfer.rollNumber || undefined,
      })).data,
    onSuccess: () => {
      notify.success('Transfer-in pupil admitted and placed');
      setTransfer({ name: '', dateOfBirth: '', transferredFrom: '', classId: '', sectionId: '', termId: '', rollNumber: '' });
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
    },
    onError: (e) => notify.error(msg(e, 'Could not admit the transfer')),
  });
  const doReEnroll = useMutation({
    mutationFn: async () =>
      (await api.post(`${S}/students/${re.studentId}/re-enroll`, {
        classId: re.classId,
        sectionId: re.sectionId || undefined,
        termId: re.termId,
        rollNumber: re.rollNumber,
      })).data,
    onSuccess: () => {
      notify.success('Pupil re-enrolled');
      setRe({ studentId: '', classId: '', sectionId: '', termId: '', rollNumber: '' });
      qc.invalidateQueries({ queryKey: ['school', 'students'] });
    },
    onError: (e) => notify.error(msg(e, 'Could not re-enrol')),
  });

  const placement = (v: { classId: string; sectionId: string; termId: string }, set: (p: any) => void) => (
    <>
      <select className={sel} value={v.termId} onChange={(e) => set({ termId: e.target.value })}>
        <option value="">Term</option>
        {(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select className={sel} value={v.classId} onChange={(e) => set({ classId: e.target.value, sectionId: '' })}>
        <option value="">Class</option>
        {(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className={sel} value={v.sectionId} disabled={sectionsOf(v.classId).length === 0} onChange={(e) => set({ sectionId: e.target.value })}>
        <option value="">{sectionsOf(v.classId).length ? currentTerminology().section : 'Not divided'}</option>
        {sectionsOf(v.classId).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </>
  );

  const pickedCount = Object.values(picked).filter(Boolean).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Enrol several applicants at once</h3>
          <div className="grid gap-3 sm:grid-cols-3">{placement(target, (p) => setTarget({ ...target, ...p }))}</div>
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {ready.length === 0 && <p className="p-3 text-sm text-muted-foreground">No applications are ready to enrol.</p>}
            {ready.map((a) => (
              <label key={a.id} className="flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0">
                <input type="checkbox" checked={!!picked[a.id]} onChange={(e) => setPicked({ ...picked, [a.id]: e.target.checked })} />
                {a.applicantFirstName} {a.applicantLastName}
                <Badge variant="outline" className="ml-auto">{a.status.replace(/_/g, ' ')}</Badge>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!pickedCount || !target.classId || !target.termId || doPreview.isPending} onClick={() => doPreview.mutate()}>
              Check {pickedCount || ''}
            </Button>
            <Button size="sm" disabled={!pickedCount || !target.classId || !target.termId || doEnroll.isPending} onClick={() => doEnroll.mutate()}>
              Enrol {pickedCount || ''}
            </Button>
          </div>
          {preview && (
            <ul className="space-y-1 text-xs">
              {preview.map((p: any, i: number) => (
                <li key={p.applicationId ?? i} className={p.status === 'READY' || p.ready ? 'text-emerald-700' : 'text-destructive'}>
                  {p.applicationId?.slice(0, 8)} — {p.status ?? (p.ready ? 'READY' : 'NOT READY')} {(p.missing ?? []).join('; ')}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Admit a transfer from another school</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="Pupil's full name" value={transfer.name} onChange={(e) => setTransfer({ ...transfer, name: e.target.value })} />
            <Input type="date" value={transfer.dateOfBirth} onChange={(e) => setTransfer({ ...transfer, dateOfBirth: e.target.value })} />
            <Input placeholder="Previous school" value={transfer.transferredFrom} onChange={(e) => setTransfer({ ...transfer, transferredFrom: e.target.value })} />
            {placement(transfer, (p) => setTransfer({ ...transfer, ...p }))}
            <Input placeholder="Roll number" value={transfer.rollNumber} onChange={(e) => setTransfer({ ...transfer, rollNumber: e.target.value })} />
          </div>
          <Button size="sm" disabled={!transfer.name.trim() || !transfer.classId || !transfer.termId || doTransfer.isPending} onClick={() => doTransfer.mutate()}>
            Admit transfer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Re-enrol a returning pupil</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="Search name or admission no." value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
            <select className={sel} value={re.studentId} onChange={(e) => setRe({ ...re, studentId: e.target.value })}>
              <option value="">Pupil</option>
              {(students?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.partner?.name ?? s.admissionNo} · {s.admissionNo}</option>)}
            </select>
            <Input placeholder="Roll number" value={re.rollNumber} onChange={(e) => setRe({ ...re, rollNumber: e.target.value })} />
            {placement(re, (p) => setRe({ ...re, ...p }))}
          </div>
          <Button size="sm" disabled={!re.studentId || !re.classId || !re.termId || !re.rollNumber.trim() || doReEnroll.isPending} onClick={() => doReEnroll.mutate()}>
            Re-enrol
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
