import { useState } from 'react';
import { Plus, Armchair } from 'lucide-react';
import {
  useClasses, useExams, useExamVenues, useCreateExamVenue, useExamRegistrations,
  useRegisterClass, useAllocateSeats, useUpdateRegistration,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolExamOpsPage() {
  const { data: exams } = useExams();
  const [examId, setExamId] = useState('');
  const { data: venues } = useExamVenues();
  const createVenue = useCreateExamVenue();
  const { data: regs } = useExamRegistrations(examId || undefined);
  const registerClass = useRegisterClass();
  const allocate = useAllocateSeats();
  const updateReg = useUpdateRegistration();
  const { data: classes } = useClasses();
  const [vName, setVName] = useState('');
  const [vCap, setVCap] = useState('');
  const [venueId, setVenueId] = useState('');

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Exam Operations</h1>
        <p className="text-sm text-muted-foreground">A4: venues, candidate registration (replacing the untyped Exam.classes JSON), seat allocation & clash detection.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Venues</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(venues?.data ?? []).map((v) => <div key={v.id} className="rounded border p-2 text-sm">{v.name} {v.capacity ? <span className="text-muted-foreground">· cap {v.capacity}</span> : null} {v.isActive ? <Badge>active</Badge> : <Badge variant="secondary">off</Badge>}</div>)}
            <Input placeholder="Venue name" value={vName} onChange={(e) => setVName(e.target.value)} />
            <Input type="number" placeholder="Capacity" className="w-28" value={vCap} onChange={(e) => setVCap(e.target.value)} />
            <Button size="sm" disabled={!vName || createVenue.isPending} onClick={async () => { await createVenue.mutateAsync({ name: vName, capacity: vCap ? Number(vCap) : undefined }); setVName(''); setVCap(''); notify.success('Venue added'); }}><Plus className="h-4 w-4" /> Add venue</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Select exam</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <select className={sel} value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">Exam…</option>{(exams?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} · {e.status}</option>)}
            </select>
            {examId && (
              <div className="space-y-2">
                <select className={sel} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                  <option value="">Venue for seating…</option>{(venues?.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <Button size="sm" className="w-full" disabled={allocate.isPending} onClick={async () => { try { await allocate.mutateAsync({ examId, venueId }); notify.success('Seats allocated (clash-checked)'); } catch { notify.error('Allocation failed — venue clash?'); } }}><Armchair className="h-4 w-4" /> Allocate seats</Button>
              </div>
            )}
            {classes?.data && (
              <select className={sel} onChange={async (e) => { if (e.target.value) { try { await registerClass.mutateAsync({ examId, classId: e.target.value }); notify.success('Class registered'); } catch { notify.error('Register failed'); } } }}>
                <option value="">Register whole class…</option>{(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Registrations & seats</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(regs ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded border p-1.5 text-xs">
                <span>{r.studentName ?? r.admissionNo ?? r.studentProfileId.slice(0,6)}</span>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary">{r.status}</Badge>
                  {r.seatNumber && <span className="font-mono text-muted-foreground">{r.seatNumber}</span>}
                  <select className={sel + ' w-28 h-7 text-xs'} value={r.status} onChange={(e) => updateReg.mutate({ id: r.id, examId, status: e.target.value, venueId: r.venueId ?? undefined, seatNumber: r.seatNumber ?? undefined })}>
                    {['registered','sat','absent','withheld'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            ))}
            {(regs ?? []).length === 0 && <p className="text-sm text-muted-foreground">Select an exam to see candidates.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
