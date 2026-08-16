import { useState } from 'react';
import { Plus, Armchair, UserCheck } from 'lucide-react';
import {
  useClasses, useExams, useExamVenues, useCreateExamVenue, useExamRegistrations,
  useRegisterClass, useAllocateSeats, useUpdateRegistration,
  useInvigilators, useCreateInvigilator, useAssignInvigilator, useUnassignInvigilator, useInvigilatorsBySchedule,
  useExamSchedules, useQuestionPapersBySchedule, useCreateQuestionPaper,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
        <p className="text-sm text-muted-foreground">A4: venues, candidate registration, seat allocation & clash detection, invigilators, and question papers.</p>
      </div>
      <Tabs defaultValue="seating">
        <TabsList>
          <TabsTrigger value="seating">Venues &amp; seating</TabsTrigger>
          <TabsTrigger value="invigilators">Invigilators</TabsTrigger>
          <TabsTrigger value="papers">Question papers</TabsTrigger>
        </TabsList>
        <TabsContent value="seating" className="pt-4"><SeatingTab
          exams={exams} examId={examId} setExamId={setExamId} venues={venues} createVenue={createVenue}
          setVName={setVName} vName={vName} setVCap={setVCap} vCap={vCap} venueId={venueId} setVenueId={setVenueId}
          allocate={allocate} classes={classes} registerClass={registerClass} regs={regs} updateReg={updateReg}
        /></TabsContent>
        <TabsContent value="invigilators" className="pt-4"><InvigilatorTab examId={examId} /></TabsContent>
        <TabsContent value="papers" className="pt-4"><QuestionPaperTab examId={examId} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Seating (original) ── */
function SeatingTab(props: any) {
  const { exams, examId, setExamId, venues, createVenue, setVName, vName, setVCap, vCap, venueId, setVenueId, allocate, classes, registerClass, regs, updateReg } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader><CardTitle className="text-base">Venues</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(venues?.data ?? []).map((v: any) => <div key={v.id} className="rounded border p-2 text-sm">{v.name} {v.capacity ? <span className="text-muted-foreground">· cap {v.capacity}</span> : null} {v.isActive ? <Badge>active</Badge> : <Badge variant="secondary">off</Badge>}</div>)}
          <Input placeholder="Venue name" value={vName} onChange={(e) => setVName(e.target.value)} />
          <Input type="number" placeholder="Capacity" className="w-28" value={vCap} onChange={(e) => setVCap(e.target.value)} />
          <Button size="sm" disabled={!vName || createVenue.isPending} onClick={async () => { await createVenue.mutateAsync({ name: vName, capacity: vCap ? Number(vCap) : undefined }); setVName(''); setVCap(''); notify.success('Venue added'); }}><Plus className="h-4 w-4" /> Add venue</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Select exam</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <select className={sel} value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Exam…</option>{(exams?.data ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.name} · {e.status}</option>)}
          </select>
          {examId && (
            <div className="space-y-2">
              <select className={sel} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Venue for seating…</option>{(venues?.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
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
          {(regs ?? []).length === 0 && <p className="text-sm text-muted-foreground">Select an exam to see candidates.</p>}
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
function InvigilatorTab({ examId }: { examId: string }) {
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
            <option value="">Exam schedule sitting…</option>{mySchedules.map((s: any) => <option key={s.id} value={s.id}>{s.subject?.name ?? s.subjectId?.slice(0, 6)} · {s.date} {s.startTime}</option>)}
          </select>
          {scheduleId && (
            <>
              <select className={sel} value={invId} onChange={(e) => setInvId(e.target.value)}>
                <option value="">Invigilator…</option>{(invigilators?.data ?? []).filter((i: any) => i.isActive).map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <Button size="sm" disabled={!invId || assign.isPending} onClick={async () => { try { await assign.mutateAsync({ examScheduleId: scheduleId, invigilatorId: invId }); setInvId(''); notify.success('Assigned (clash-checked)'); } catch { notify.error('Assign failed — invigilator clash?'); } }}><UserCheck className="h-4 w-4" /> Assign</Button>
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
function QuestionPaperTab({ examId }: { examId: string }) {
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
            <option value="">Exam schedule sitting…</option>{mySchedules.map((s: any) => <option key={s.id} value={s.id}>{s.subject?.name ?? s.subjectId?.slice(0, 6)} · {s.date} {s.startTime}</option>)}
          </select>
          {scheduleId && (
            <>
              <Input placeholder="Paper title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
                {['theory', 'practical', 'alternative_to_practical', 'oral'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <textarea className={sel + ' h-20'} placeholder={"Questions, one per line, e.g. 1. Solve the equation"} value={qText} onChange={(e) => setQText(e.target.value)} />
              <Button size="sm" disabled={!title || createPaper.isPending} onClick={async () => {
                const questions = qText.split('\n').map((line, i) => ({ number: i + 1, text: line.trim(), marks: 0 })).filter((q) => q.text);
                await createPaper.mutateAsync({ examScheduleId: scheduleId, title, paperKind: kind, questions });
                setTitle(''); setQText(''); notify.success('Question paper saved');
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
              <div className="font-medium">{p.title} <Badge variant="secondary">{p.paperKind}</Badge></div>
              <div className="text-xs text-muted-foreground">{(p.questions ?? []).length} questions · {p.totalMarks} marks</div>
            </div>
          ))}
          {(papers ?? []).length === 0 && <p className="text-sm text-muted-foreground">Select a sitting to see its papers.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
