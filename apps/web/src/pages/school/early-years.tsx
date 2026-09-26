import { useMemo, useState } from 'react';
import { AlertTriangle, Baby, CheckCircle2, ClipboardList, DoorOpen, Send, ShieldCheck, Syringe } from 'lucide-react';
import { useClasses } from '@/features/school/api';
import {
  CARE_MOODS,
  INCIDENT_KINDS,
  INCIDENT_SEVERITIES,
  MEAL_PORTIONS,
  MEAL_SLOTS,
  NOTIFY_CHANNELS,
  useCareDay,
  useCreateIncident,
  useCreatePickupAuthorization,
  useImmunisationDue,
  useNotifyIncidentGuardian,
  useOutstandingIncidents,
  usePickupReleases,
  useReleaseChild,
  useReviewIncident,
  useRevokePickupAuthorization,
  useSaveCareLog,
  useSaveImmunisation,
  useShareCareLog,
  useWhoMayCollect,
  type CareLog,
} from '@/features/school/early-years-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The nursery's day, in one place.
 *
 * Four things a nursery does that a primary school does not: account for the
 * day, control who collects a child, write down what happened, and chase
 * immunisation. They are tabs of one screen rather than four sidebar entries
 * because they are one person's morning.
 */
export function SchoolEarlyYearsPage() {
  const [classId, setClassId] = useState('');
  const [onDate, setOnDate] = useState(today());
  const { data: classes } = useClasses();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Baby className="h-5 w-5" />Nursery day</h1>
        <p className="text-sm text-muted-foreground">
          The day as the room saw it, who may collect each child, what happened, and which doses are due.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>Class</span>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Choose a class…</option>
            {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Day</span>
          <Input type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </label>
      </div>

      <Tabs defaultValue="day">
        <TabsList>
          <TabsTrigger value="day">The day</TabsTrigger>
          <TabsTrigger value="pickup">Collection</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="immunisation">Immunisation</TabsTrigger>
        </TabsList>

        <TabsContent value="day"><CareDayPanel classId={classId} onDate={onDate} /></TabsContent>
        <TabsContent value="pickup"><PickupPanel classId={classId} onDate={onDate} /></TabsContent>
        <TabsContent value="incidents"><IncidentsPanel classId={classId} /></TabsContent>
        <TabsContent value="immunisation"><ImmunisationPanel classId={classId} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── The day ───────────────────────────────────────────────────────────────── */

function CareDayPanel({ classId, onDate }: { classId: string; onDate: string }) {
  const { data, isLoading } = useCareDay(classId || undefined, onDate);
  const save = useSaveCareLog();
  const share = useShareCareLog();

  if (!classId) return <Empty>Choose a class to see its room.</Empty>;
  if (isLoading) return <Empty>Loading…</Empty>;
  if (!data?.children.length) return <Empty>No children are placed in this class on {onDate}.</Empty>;

  const set = async (studentProfileId: string, patch: Partial<CareLog>) => {
    try {
      await save.mutateAsync({ studentProfileId, onDate, ...patch });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not save the day');
    }
  };

  return (
    <div className="space-y-3">
      {data.children.map((child) => {
        const log = child.log;
        const shared = !!log?.sharedAt;
        return (
          <Card key={child.studentProfileId}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {child.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{child.admissionNo}{child.sectionName ? ` · ${child.sectionName}` : ''}</span>
                </CardTitle>
                {shared
                  ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Shared with the family</Badge>
                  : <Badge variant="secondary">Draft</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="space-y-1 text-sm">
                  <span>Arrived</span>
                  <select className={sel} disabled={shared} value={log?.arrivalMood ?? ''} onChange={(e) => void set(child.studentProfileId, { arrivalMood: (e.target.value || null) as any })}>
                    <option value="">—</option>
                    {CARE_MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>Left</span>
                  <select className={sel} disabled={shared} value={log?.departureMood ?? ''} onChange={(e) => void set(child.studentProfileId, { departureMood: (e.target.value || null) as any })}>
                    <option value="">—</option>
                    {CARE_MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>Nappy changes</span>
                  <Input type="number" min="0" max="20" disabled={shared} defaultValue={log?.nappyChanges ?? ''} onBlur={(e) => void set(child.studentProfileId, { nappyChanges: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
                <label className="flex items-end gap-2 text-sm">
                  <input type="checkbox" disabled={shared} checked={!!log?.usedToiletAlone} onChange={(e) => void set(child.studentProfileId, { usedToiletAlone: e.target.checked })} />
                  Used the toilet alone
                </label>
              </div>

              <MealsRow disabled={shared} meals={log?.meals ?? []} onChange={(meals) => void set(child.studentProfileId, { meals })} />
              <NapsRow disabled={shared} naps={log?.naps ?? []} onChange={(naps) => void set(child.studentProfileId, { naps })} />

              <label className="block space-y-1 text-sm">
                <span>What we did, and what the family should know</span>
                <textarea
                  className="min-h-20 w-full rounded border bg-card p-2 text-sm"
                  disabled={shared}
                  defaultValue={log?.teacherNote ?? ''}
                  placeholder="Settled after breakfast. Painted with the big brushes and did not want to stop."
                  onBlur={(e) => void set(child.studentProfileId, { teacherNote: e.target.value })}
                />
              </label>

              <div className="flex justify-end gap-2">
                {log && (shared
                  ? <Button variant="outline" size="sm" onClick={() => void share.mutateAsync({ id: log.id, shared: false })}>Take back to correct</Button>
                  : <Button size="sm" onClick={() => void share.mutateAsync({ id: log.id, shared: true })}><Send className="mr-1 h-3.5 w-3.5" />Share with the family</Button>)}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MealsRow({ meals, onChange, disabled }: { meals: CareLog['meals']; onChange: (m: CareLog['meals']) => void; disabled: boolean }) {
  const byMeal = useMemo(() => new Map(meals.map((m) => [m.meal, m])), [meals]);
  return (
    <div>
      <p className="mb-1 text-sm font-medium">Meals</p>
      <div className="grid gap-2 sm:grid-cols-4">
        {MEAL_SLOTS.map((slot) => (
          <label key={slot} className="space-y-1 text-sm">
            <span className="capitalize">{slot}</span>
            <select
              className={sel}
              disabled={disabled}
              value={byMeal.get(slot)?.portion ?? ''}
              onChange={(e) => {
                const rest = meals.filter((m) => m.meal !== slot);
                onChange(e.target.value ? [...rest, { meal: slot, portion: e.target.value as any }] : rest);
              }}
            >
              <option value="">not offered</option>
              {MEAL_PORTIONS.map((p) => <option key={p} value={p}>ate {p}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function NapsRow({ naps, onChange, disabled }: { naps: CareLog['naps']; onChange: (n: CareLog['naps']) => void; disabled: boolean }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <div>
      <p className="mb-1 text-sm font-medium">Sleep</p>
      <div className="flex flex-wrap items-end gap-2">
        {naps.map((n, i) => (
          <Badge key={`${n.from}-${i}`} variant="secondary" className="gap-2">
            {n.from}{n.to ? `–${n.to}` : ''}
            {!disabled && <button className="text-destructive" onClick={() => onChange(naps.filter((_, j) => j !== i))}>×</button>}
          </Badge>
        ))}
        {!disabled && (
          <>
            <Input className="w-28" type="time" aria-label="Slept from" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input className="w-28" type="time" aria-label="Slept until" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button variant="outline" size="sm" disabled={!from} onClick={() => { onChange([...naps, { from, to: to || undefined }]); setFrom(''); setTo(''); }}>Add sleep</Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Collection ────────────────────────────────────────────────────────────── */

function PickupPanel({ classId, onDate }: { classId: string; onDate: string }) {
  const { data: day } = useCareDay(classId || undefined, onDate);
  const [studentProfileId, setStudentProfileId] = useState('');
  const { data: may } = useWhoMayCollect(studentProfileId || undefined);
  const { data: releases } = usePickupReleases(onDate);
  const release = useReleaseChild();
  const add = useCreatePickupAuthorization();
  const revoke = useRevokePickupAuthorization();

  const [form, setForm] = useState({ personName: '', personPhone: '', relationship: '', idType: '', idNumber: '', kind: 'STANDING', validTo: '' });
  const [override, setOverride] = useState('');
  const [collectedByName, setCollectedByName] = useState('');

  if (!classId) return <Empty>Choose a class first.</Empty>;

  const doRelease = async (authorizationId?: string) => {
    try {
      await release.mutateAsync({ studentProfileId, authorizationId, collectedByName: collectedByName || undefined, overrideReason: override || undefined });
      notify.success('Collection recorded');
      setOverride('');
      setCollectedByName('');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not record the collection');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><DoorOpen className="h-4 w-4" />At the gate</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span>Child</span>
            <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
              <option value="">Choose a child…</option>
              {(day?.children ?? []).map((c) => <option key={c.studentProfileId} value={c.studentProfileId}>{c.name}</option>)}
            </select>
          </label>

          {studentProfileId && (
            <>
              <p className="text-sm font-medium">May collect today</p>
              <div className="space-y-1">
                {(may?.guardians ?? []).map((g) => (
                  <div key={g.studentGuardianId} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                    <span>{g.name} <span className="text-muted-foreground">· {g.relationship}{g.phone ? ` · ${g.phone}` : ''}</span></span>
                    <Button size="sm" variant="outline" onClick={() => { setCollectedByName(g.name); void doRelease(); }}>Released</Button>
                  </div>
                ))}
                {(may?.authorizations ?? []).map((a) => (
                  <div key={a.authorizationId} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                    <span>
                      {a.name} <span className="text-muted-foreground">· {a.relationship ?? 'authorized'}{a.idNumber ? ` · ${a.idType ?? 'ID'} ${a.idNumber}` : ''}{a.kind === 'ONE_OFF' ? ' · one-off' : ''}</span>
                    </span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => void doRelease(a.authorizationId)}>Released</Button>
                      <button className="px-1 text-xs text-destructive" onClick={() => {
                        const reason = window.prompt('Why is this being withdrawn?');
                        if (reason) void revoke.mutateAsync({ id: a.authorizationId, reason });
                      }}>Withdraw</button>
                    </div>
                  </div>
                ))}
                {!may?.guardians.length && !may?.authorizations.length && (
                  <p className="text-sm text-muted-foreground">Nobody is on this child's list. Add someone below before releasing them.</p>
                )}
              </div>

              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="flex items-center gap-1 font-medium text-amber-900"><AlertTriangle className="h-4 w-4" />Someone not on the list</p>
                <p className="mt-1 text-xs text-amber-900">A child can still be released in an emergency. The reason is part of the record.</p>
                <Input className="mt-2" placeholder="Who is collecting?" value={collectedByName} onChange={(e) => setCollectedByName(e.target.value)} />
                <Input className="mt-2" placeholder="Why are you releasing the child anyway?" value={override} onChange={(e) => setOverride(e.target.value)} />
                <Button className="mt-2" size="sm" variant="outline" disabled={!collectedByName || !override} onClick={() => void doRelease()}>Record the release</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Add to the pick-up list</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Name" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} />
              <Input placeholder="Phone" value={form.personPhone} onChange={(e) => setForm({ ...form, personPhone: e.target.value })} />
              <Input placeholder="Relationship to the child" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
              <select className={sel} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="STANDING">On the standing list</option>
                <option value="ONE_OFF">One day only</option>
              </select>
              <Input placeholder="ID type (national ID, licence)" value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })} />
              <Input placeholder="ID number" value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} />
              {form.kind === 'ONE_OFF' && (
                <label className="space-y-1 text-sm">
                  <span>Good for</span>
                  <Input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
                </label>
              )}
            </div>
            <Button
              size="sm"
              disabled={!studentProfileId || !form.personName || (form.kind === 'ONE_OFF' && !form.validTo)}
              onClick={async () => {
                try {
                  await add.mutateAsync({ studentProfileId, ...form, kind: form.kind as any, validTo: form.validTo || undefined });
                  notify.success('Added to the pick-up list');
                  setForm({ personName: '', personPhone: '', relationship: '', idType: '', idNumber: '', kind: 'STANDING', validTo: '' });
                } catch (e: any) {
                  notify.error(e?.response?.data?.message ?? 'Could not add them');
                }
              }}
            >
              Add
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Collected on {onDate}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(releases ?? []).map((r) => (
              <div key={r.id} className={`rounded border px-2 py-1.5 text-sm ${r.overrideReason ? 'border-amber-300 bg-amber-50' : ''}`}>
                <span className="font-medium">{r.studentProfile?.partner?.name ?? r.studentProfileId}</span>
                <span className="text-muted-foreground"> · {new Date(r.collectedAt).toLocaleTimeString()} · {r.collectedByName}</span>
                {r.overrideReason && <p className="text-xs text-amber-900">Released without authorization: {r.overrideReason}</p>}
              </div>
            ))}
            {!releases?.length && <p className="text-sm text-muted-foreground">Nobody has been collected yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Incidents ─────────────────────────────────────────────────────────────── */

function IncidentsPanel({ classId }: { classId: string }) {
  const { data: day } = useCareDay(classId || undefined, today());
  const { data: outstanding } = useOutstandingIncidents();
  const create = useCreateIncident();
  const notified = useNotifyIncidentGuardian();
  const review = useReviewIncident();
  const [form, setForm] = useState({
    studentProfileId: '', kind: 'INJURY', severity: 'MINOR',
    occurredAt: new Date().toISOString().slice(0, 16), location: '', description: '', actionTaken: '', bodyPart: '',
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" />Write it down now</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <select className={sel} value={form.studentProfileId} onChange={(e) => setForm({ ...form, studentProfileId: e.target.value })}>
            <option value="">Which child…</option>
            {(day?.children ?? []).map((c) => <option key={c.studentProfileId} value={c.studentProfileId}>{c.name}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className={sel} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {INCIDENT_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ').toLowerCase()}</option>)}
            </select>
            <select className={sel} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {INCIDENT_SEVERITIES.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
            </select>
            <Input type="datetime-local" aria-label="When it happened" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Where (the climbing frame, the corridor)" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Input placeholder="Where on the body" value={form.bodyPart} onChange={(e) => setForm({ ...form, bodyPart: e.target.value })} />
          </div>
          <textarea className="min-h-20 w-full rounded border bg-card p-2 text-sm" placeholder="What happened, in the order it happened." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="min-h-16 w-full rounded border bg-card p-2 text-sm" placeholder="What was done about it." value={form.actionTaken} onChange={(e) => setForm({ ...form, actionTaken: e.target.value })} />
          <Button
            size="sm"
            disabled={!form.studentProfileId || !form.description.trim()}
            onClick={async () => {
              try {
                await create.mutateAsync({ ...form, occurredAt: new Date(form.occurredAt).toISOString() });
                notify.success('Recorded. Tell the family, then it needs sign-off.');
                setForm({ ...form, description: '', actionTaken: '', bodyPart: '', location: '' });
              } catch (e: any) {
                notify.error(e?.response?.data?.message ?? 'Could not record the incident');
              }
            }}
          >
            Record
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Still open</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(outstanding ?? []).map((r) => (
            <div key={r.id} className="space-y-1 rounded border px-2 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.studentName ?? r.studentProfileId}</span>
                <Badge variant={r.severity === 'SERIOUS' ? 'destructive' : 'secondary'}>{r.severity.toLowerCase()}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{new Date(r.occurredAt).toLocaleString()} · {r.kind.replace('_', ' ').toLowerCase()}</p>
              <p>{r.description}</p>
              <p className="text-xs text-amber-900">Needs: {(r.needs ?? []).join(', ')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {!r.guardianNotifiedAt && NOTIFY_CHANNELS.map((how) => (
                  <Button key={how} size="sm" variant="outline" onClick={() => void notified.mutateAsync({ id: r.id, how })}>
                    Told by {how.replace('_', ' ')}
                  </Button>
                ))}
                {r.guardianNotifiedAt && !r.reviewedAt && (
                  <Button size="sm" onClick={() => void review.mutateAsync({ id: r.id, reviewNotes: window.prompt('Sign-off note (optional)') ?? undefined })}>
                    Sign off
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!outstanding?.length && <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Immunisation ──────────────────────────────────────────────────────────── */

function ImmunisationPanel({ classId }: { classId: string }) {
  const { data, isLoading } = useImmunisationDue(classId || undefined, 60);
  const save = useSaveImmunisation();
  const [form, setForm] = useState({ studentProfileId: '', vaccine: '', doseLabel: '', administeredOn: '', nextDueOn: '', exemptionReason: '' });

  if (!classId) return <Empty>Choose a class first.</Empty>;
  if (isLoading) return <Empty>Loading…</Empty>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Syringe className="h-4 w-4" />Due or overdue</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(data?.due ?? []).map((d) => (
            <div key={d.id} className={`rounded border px-2 py-1.5 text-sm ${d.overdue ? 'border-destructive/40 bg-destructive/5' : ''}`}>
              <span className="font-medium">{d.studentName}</span>
              <span className="text-muted-foreground"> · {d.vaccine}{d.doseLabel ? ` (${d.doseLabel})` : ''} · due {d.nextDueOn?.slice(0, 10)}</span>
              {d.overdue && <Badge variant="destructive" className="ml-2">overdue</Badge>}
            </div>
          ))}
          {!data?.due.length && <p className="text-sm text-muted-foreground">Nothing due in the next 60 days.</p>}

          <p className="pt-3 text-sm font-medium">No record at all</p>
          <p className="text-xs text-muted-foreground">
            A child nobody has asked about is invisible in a report built only from the rows that exist. This is that list.
          </p>
          {(data?.noRecord ?? []).map((n) => (
            <div key={n.studentProfileId} className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm text-amber-900">
              {n.studentName} <span className="text-xs">· {n.admissionNo}</span>
            </div>
          ))}
          {!data?.noRecord.length && <p className="text-sm text-muted-foreground">Every child in this class has a record.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Record a dose or an exemption</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <select className={sel} value={form.studentProfileId} onChange={(e) => setForm({ ...form, studentProfileId: e.target.value })}>
            <option value="">Which child…</option>
            {[...(data?.noRecord ?? []).map((n) => ({ id: n.studentProfileId, name: n.studentName ?? n.admissionNo })),
              ...(data?.due ?? []).map((d) => ({ id: d.studentProfileId, name: d.studentName ?? d.studentProfileId }))]
              .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
              .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Vaccine (Measles-Rubella)" value={form.vaccine} onChange={(e) => setForm({ ...form, vaccine: e.target.value })} />
            <Input placeholder="Dose (dose 1, booster)" value={form.doseLabel} onChange={(e) => setForm({ ...form, doseLabel: e.target.value })} />
            <label className="space-y-1 text-sm"><span>Given on</span><Input type="date" value={form.administeredOn} onChange={(e) => setForm({ ...form, administeredOn: e.target.value })} /></label>
            <label className="space-y-1 text-sm"><span>Next due</span><Input type="date" value={form.nextDueOn} onChange={(e) => setForm({ ...form, nextDueOn: e.target.value })} /></label>
          </div>
          <Input placeholder="Or the reason the child is exempt" value={form.exemptionReason} onChange={(e) => setForm({ ...form, exemptionReason: e.target.value })} />
          <p className="text-xs text-muted-foreground">
            One or the other: a dose with its date, or an exemption with its reason. “We never asked” is not a record and must stay visible above.
          </p>
          <Button
            size="sm"
            disabled={!form.studentProfileId || !form.vaccine.trim() || (!form.administeredOn && !form.exemptionReason.trim())}
            onClick={async () => {
              try {
                await save.mutateAsync({
                  studentProfileId: form.studentProfileId,
                  vaccine: form.vaccine,
                  doseLabel: form.doseLabel || undefined,
                  administeredOn: form.administeredOn || undefined,
                  nextDueOn: form.nextDueOn || undefined,
                  exemptionReason: form.exemptionReason || undefined,
                });
                notify.success('Recorded');
                setForm({ studentProfileId: '', vaccine: '', doseLabel: '', administeredOn: '', nextDueOn: '', exemptionReason: '' });
              } catch (e: any) {
                notify.error(e?.response?.data?.message ?? 'Could not record it');
              }
            }}
          >
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{children}</CardContent></Card>;
}
