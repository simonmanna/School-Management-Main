import { useState } from 'react';
import { Plus, Armchair, UserCheck } from 'lucide-react';
import {
  useClasses, useExamVenues, useCreateExamVenue, useExamRegistrations,
  useRegisterClass, useAllocateSeats, useUpdateRegistration,
  useInvigilators, useCreateInvigilator, useAssignInvigilator, useUnassignInvigilator, useInvigilatorsBySchedule,
  useExamSchedules, useQuestionPapersBySchedule, useCreateQuestionPaper,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { apiMessage, selectClass as sel } from './exam-ops-shared';

/**
 * Exam-day logistics — venues and seating, invigilators, and the content of
 * each question paper. These used to be a separate "Exam Operations" page
 * (`/school/exam-ops`) beside "Examination operations": two near-identical
 * names for one exams-office job. They are now tabs of the one console, driven
 * by the examination chosen there.
 */

/** Venues, class registration, seat allocation and the hall plan. */
export function ExamVenuesPanel({ examId }: { examId: string }) {
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
    <SeatingTab
      examId={examId} venues={venues} createVenue={createVenue}
      setVName={setVName} vName={vName} setVCap={setVCap} vCap={vCap} venueId={venueId} setVenueId={setVenueId}
      allocate={allocate} classes={classes} registerClass={registerClass} regs={regs} updateReg={updateReg}
    />
  );
}

/* ── Seating (original) ── */
function SeatingTab(props: any) {
  const { examId, venues, createVenue, setVName, vName, setVCap, vCap, venueId, setVenueId, allocate, classes, registerClass, regs, updateReg } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader><CardTitle className="text-base">Venues</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(venues?.data ?? []).map((v: any) => <div key={v.id} className="rounded border p-2 text-sm">{v.name} {v.capacity ? <span className="text-muted-foreground">· cap {v.capacity}</span> : null} {v.isActive ? <Badge>active</Badge> : <Badge variant="secondary">off</Badge>}</div>)}
          <Input placeholder="Venue name" value={vName} onChange={(e) => setVName(e.target.value)} />
          <Input type="number" placeholder="Capacity" className="w-28" value={vCap} onChange={(e) => setVCap(e.target.value)} />
          <Button size="sm" disabled={!vName || createVenue.isPending} onClick={async () => { try { await createVenue.mutateAsync({ name: vName, capacity: vCap ? Number(vCap) : undefined }); setVName(''); setVCap(''); notify.success('Venue added'); } catch (e) { notify.error('Could not add the venue', { description: apiMessage(e, 'Try again.') }); } }}><Plus className="h-4 w-4" /> Add venue</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Register &amp; seat candidates</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {examId && (
            <div className="space-y-2">
              <select className={sel} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Venue for seating…</option>{(venues?.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <Button size="sm" className="w-full" disabled={allocate.isPending} onClick={async () => { try { await allocate.mutateAsync({ examId, venueId }); notify.success('Seats allocated (clash-checked)'); } catch (e) { notify.error('Could not allocate seats', { description: apiMessage(e, 'Check the venue capacity and for clashes.') }); } }}><Armchair className="h-4 w-4" /> Allocate seats</Button>
            </div>
          )}
          {classes?.data && (
            <select className={sel} onChange={async (e) => { if (e.target.value) { try { await registerClass.mutateAsync({ examId, classId: e.target.value }); notify.success('Class registered'); } catch (err) { notify.error('Could not register the class', { description: apiMessage(err, 'Try again.') }); } } }}>
              <option value="">Register whole class…</option>{(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Registrations & seats</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(regs ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded border p-1.5 text-xs">
              <span>{r.studentName ?? r.admissionNo ?? r.studentProfileId.slice(0, 6)}</span>
              <div className="flex items-center gap-1">
                <Badge variant="secondary">{r.status}</Badge>
                {r.seatNumber && <span className="font-mono text-muted-foreground">{r.seatNumber}</span>}
                <select className={sel + ' w-28 h-7 text-xs'} value={r.status} onChange={(e) => updateReg.mutate({ id: r.id, examId, status: e.target.value, venueId: r.venueId ?? undefined, seatNumber: r.seatNumber ?? undefined })}>
                  {['registered', 'sat', 'absent', 'withheld'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
          {(regs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No candidates yet — register a whole class here.</p>}
        </CardContent>
      </Card>
      {examId && <HallPlan regs={regs} venues={venues} />}
    </div>
  );
}

/* ── P2 Hall plan (visual seating) ── */
function HallPlan({ regs, venues }: { regs: any[]; venues: any }) {
  if (!regs || regs.length === 0) return null;
  const byVenue = new Map<string, any[]>();
  for (const r of regs) {
    const key = r.venueId ?? 'unassigned';
    if (!byVenue.has(key)) byVenue.set(key, []);
    byVenue.get(key)!.push(r);
  }
  const venueName = (id: string) => (venues?.data ?? []).find((v: any) => v.id === id)?.name ?? 'Unassigned';
  return (
    <div className="space-y-4">
      {[...byVenue.entries()].map(([vid, list]) => {
        const sorted = [...list].sort((a, b) => String(a.seatNumber ?? '').localeCompare(String(b.seatNumber ?? '')));
        return (
          <Card key={vid}>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Armchair className="h-4 w-4" /> {venueName(vid)} · {list.length} seats</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-8 gap-2 sm:grid-cols-10 md:grid-cols-12">
                {sorted.map((r) => {
                  const statusColor = r.status === 'sat' ? 'bg-emerald-50 border-emerald-300'
                    : r.status === 'absent' ? 'bg-rose-50 border-rose-300'
                    : r.status === 'withheld' ? 'bg-amber-50 border-amber-300'
                    : 'bg-card border-border';
                  return (
                    <div key={r.id} title={`${r.studentName ?? r.admissionNo ?? r.studentProfileId.slice(0,6)} · ${r.status}`}
                      className={`rounded border p-1.5 text-center text-[10px] leading-tight ${statusColor}`}>
                      <div className="font-mono text-muted-foreground">{r.seatNumber ?? '—'}</div>
                      <div className="truncate font-medium">{r.studentName ?? r.admissionNo ?? r.studentProfileId.slice(0,6)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── P0-B Invigilators ── */
export function ExamInvigilatorsPanel({ examId }: { examId: string }) {
  const { data: invigilators } = useInvigilators();
  const createInv = useCreateInvigilator();
  const { data: schedules } = useExamSchedules();
  const [scheduleId, setScheduleId] = useState('');
  const { data: assigned } = useInvigilatorsBySchedule(scheduleId || undefined);
  const assign = useAssignInvigilator();
  const unassign = useUnassignInvigilator();
  const [name, setName] = useState('');
  const [invId, setInvId] = useState('');

  const mySchedules = (schedules?.data ?? []).filter((s: any) => !examId || s.examId === examId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Invigilator pool</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(invigilators?.data ?? []).map((i: any) => <div key={i.id} className="rounded border p-2 text-sm">{i.name} {i.note ? <span className="text-muted-foreground">· {i.note}</span> : null} {i.isActive ? <Badge>active</Badge> : <Badge variant="secondary">off</Badge>}</div>)}
          <Input placeholder="Invigilator name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!name || createInv.isPending} onClick={async () => { await createInv.mutateAsync({ name }); setName(''); notify.success('Invigilator added'); }}><Plus className="h-4 w-4" /> Add invigilator</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Assign to a sitting</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <select className={sel} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">Choose a paper sitting…</option>{mySchedules.map((s: any) => <option key={s.id} value={s.id}>{s.subject?.name ?? s.subjectId?.slice(0, 6)} · {s.date} {s.startTime}</option>)}
          </select>
          {scheduleId && (
            <>
              <select className={sel} value={invId} onChange={(e) => setInvId(e.target.value)}>
                <option value="">Invigilator…</option>{(invigilators?.data ?? []).filter((i: any) => i.isActive).map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <Button size="sm" disabled={!invId || assign.isPending} onClick={async () => { try { await assign.mutateAsync({ examScheduleId: scheduleId, invigilatorId: invId }); setInvId(''); notify.success('Assigned (clash-checked)'); } catch (e) { notify.error('Could not assign the invigilator', { description: apiMessage(e, 'They may already be invigilating at that time.') }); } }}><UserCheck className="h-4 w-4" /> Assign</Button>
              <div className="space-y-1 pt-2">
                {(assigned ?? []).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between rounded border p-1.5 text-xs">
                    <span>{a.invigilator?.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => unassign.mutate({ examScheduleId: scheduleId, invigilatorId: a.invigilatorId })}>remove</Button>
                  </div>
                ))}
                {(assigned ?? []).length === 0 && <p className="text-sm text-muted-foreground">No invigilators assigned to this sitting yet.</p>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── P2-A Traditional question papers ── */
export function ExamPaperContentPanel({ examId }: { examId: string }) {
  const { data: schedules } = useExamSchedules();
  const [scheduleId, setScheduleId] = useState('');
  const { data: papers } = useQuestionPapersBySchedule(scheduleId || undefined);
  const createPaper = useCreateQuestionPaper();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('theory');
  const [qText, setQText] = useState('');

  const mySchedules = (schedules?.data ?? []).filter((s: any) => !examId || s.examId === examId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Question papers</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <select className={sel} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">Choose a paper sitting…</option>{mySchedules.map((s: any) => <option key={s.id} value={s.id}>{s.subject?.name ?? s.subjectId?.slice(0, 6)} · {s.date} {s.startTime}</option>)}
          </select>
          {scheduleId && (
            <>
              <Input placeholder="Paper title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
                {PAPER_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <textarea className={sel + ' h-20'} placeholder={"One question per line, marks in brackets, e.g.\nSolve 2x + 3 = 7 (5)"} value={qText} onChange={(e) => setQText(e.target.value)} />
              <Button size="sm" disabled={!title || createPaper.isPending} onClick={async () => {
                const questions = qText.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
                  // "Solve for x (5)" or "Solve for x (5 marks)" carries the question's marks.
                  const m = line.match(/\((\d+)\s*(?:marks?)?\)\s*$/i);
                  return { number: i + 1, text: m ? line.slice(0, m.index).trim() : line, marks: m ? Number(m[1]) : 0 };
                });
                try {
                  await createPaper.mutateAsync({ examScheduleId: scheduleId, title, paperKind: kind, questions });
                  setTitle(''); setQText(''); notify.success('Question paper saved');
                } catch (e) {
                  notify.error('Could not save the paper', { description: apiMessage(e, 'Try again.') });
                }
              }}><Plus className="h-4 w-4" /> Save paper</Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Saved papers</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(papers ?? []).map((p: any) => (
            <div key={p.id} className="rounded border p-2 text-sm">
              <div className="font-medium">{p.title} <Badge variant="secondary">{PAPER_KINDS.find(([k]) => k === p.paperKind)?.[1] ?? p.paperKind}</Badge></div>
              <div className="text-xs text-muted-foreground">{(p.questions ?? []).length} questions · {p.totalMarks} marks</div>
            </div>
          ))}
          {(papers ?? []).length === 0 && <p className="text-sm text-muted-foreground">Select a sitting to see its papers.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

const PAPER_KINDS: Array<[string, string]> = [
  ['theory', 'Theory'],
  ['practical', 'Practical'],
  ['alternative_to_practical', 'Alternative to practical'],
  ['oral', 'Oral'],
];
