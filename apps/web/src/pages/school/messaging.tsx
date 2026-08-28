import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  MessageSquare,
  Megaphone,
  Send,
  ShieldOff,
  Users,
} from 'lucide-react';
import { useClasses, useSections } from '@/features/school/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import {
  isBroadcastLive,
  useAudiencePreview,
  useBroadcastRecipients,
  useBroadcastReport,
  useBroadcasts,
  useCancelBroadcast,
  useCreateBroadcast,
  useSubmitBroadcast,
  type AudienceScope,
  type AudienceSelector,
  type ChannelPolicy,
  type RecipientKind,
} from '@/features/communication/broadcast-api';

/**
 * Messaging — the parent/guardian/staff broadcast console.
 *
 * This replaces the earlier front-end simulation. Everything here is live:
 * the audience is counted by the server against the current roster, the segment
 * count is the one the biller will use, and Send hands the broadcast to the
 * worker.
 *
 * The composer is deliberately count-first. The screen shows how many people
 * will be reached, how many cannot be, and what it will cost BEFORE the send
 * button becomes interesting — because the expensive mistakes in school
 * messaging are not typos, they are sending to the wrong 400 people or
 * discovering afterwards that 60 of them had no phone number on file.
 */

/** Transport chains offered in the composer, in plain language. */
const POLICIES: { id: string; label: string; hint: string; policy: ChannelPolicy; icon: typeof Send }[] = [
  {
    id: 'wa-sms',
    label: 'WhatsApp, then SMS',
    hint: 'Cheapest reliable reach. Falls back to SMS only for parents WhatsApp could not reach.',
    icon: MessageCircle,
    policy: {
      steps: [
        { providerId: 'whatsapp', transport: 'cloud' },
        { providerId: 'whatsapp', transport: 'baileys' },
        { providerId: 'sms' },
        { providerId: 'internal' },
      ],
      fallbackOnFailure: true,
    },
  },
  {
    id: 'sms',
    label: 'SMS only',
    hint: 'Reaches any handset. Costs money per segment — check the estimate below.',
    icon: MessageSquare,
    policy: { steps: [{ providerId: 'sms' }], fallbackOnFailure: false },
  },
  {
    id: 'wa',
    label: 'WhatsApp only',
    hint: 'Free, but silently misses parents who are not on WhatsApp.',
    icon: MessageCircle,
    policy: {
      steps: [
        { providerId: 'whatsapp', transport: 'cloud' },
        { providerId: 'whatsapp', transport: 'baileys' },
      ],
      fallbackOnFailure: true,
    },
  },
  {
    id: 'portal',
    label: 'Portal / in-app only',
    hint: 'No cost, but a parent who does not open the portal has not been told.',
    icon: Bell,
    policy: { steps: [{ providerId: 'internal' }], fallbackOnFailure: false },
  },
];

const TEMPLATES: { name: string; body: string }[] = [
  {
    name: 'Fee reminder',
    body: 'Dear {{recipient.name}}, this is a reminder that school fees for {{student.name}} ({{student.className}}) are due. Kindly clear the outstanding balance at your earliest convenience. Thank you.',
  },
  {
    name: 'PTA meeting',
    body: 'Dear Parent/Guardian, you are invited to the termly PTA meeting this Saturday at 10:00 AM in the main hall. Your attendance is highly appreciated.',
  },
  {
    name: 'School closure',
    body: 'Dear Parents, please note that the school will be closed on Friday for a public holiday. Normal classes resume on Monday.',
  },
  {
    name: 'Absence notice',
    body: 'Dear {{recipient.name}}, {{student.name}} was marked absent today. Please contact the class teacher if this was unexpected.',
  },
];

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  scheduled: 'bg-amber-100 text-amber-800',
  materializing: 'bg-sky-100 text-sky-800',
  sending: 'bg-sky-100 text-sky-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-600',
  failed: 'bg-rose-100 text-rose-800',
};

const RECIPIENT_STATUS_TONE: Record<string, string> = {
  delivered: 'text-emerald-600',
  sent: 'text-sky-600',
  queued: 'text-slate-500',
  pending: 'text-slate-400',
  failed: 'text-rose-600',
  suppressed: 'text-amber-600',
  unreachable: 'text-amber-600',
  cancelled: 'text-slate-400',
};

/** Debounce a value so typing does not re-resolve the whole roster per keystroke. */
function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SchoolMessagingPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'compose');

  /* ── Composer state ────────────────────────────────────────────────────── */
  const [scope, setScope] = useState<AudienceScope>('class');
  const [ids, setIds] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<RecipientKind>('guardians');
  const [primaryOnly, setPrimaryOnly] = useState(true);
  const [perStudent, setPerStudent] = useState(false);
  const [policyId, setPolicyId] = useState('wa-sms');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [reportId, setReportId] = useState<string | null>(null);

  const classes = useClasses();
  const sections = useSections();

  const policy = useMemo(
    () => POLICIES.find((p) => p.id === policyId)?.policy ?? POLICIES[0].policy,
    [policyId],
  );

  const audience = useMemo<AudienceSelector | null>(() => {
    const needsIds = scope !== 'all' && scope !== 'staff';
    if (needsIds && ids.length === 0) return null;
    return {
      scope,
      ...(needsIds ? { ids } : {}),
      recipients,
      primaryGuardianOnly: primaryOnly,
      dedupe: perStudent ? 'per_student' : 'per_recipient',
    };
  }, [scope, ids, recipients, primaryOnly, perStudent]);

  const debouncedBody = useDebounced(body);
  const preview = useAudiencePreview(audience, debouncedBody, policy, !!audience);

  const createBroadcast = useCreateBroadcast();
  const submitBroadcast = useSubmitBroadcast();
  const cancelBroadcast = useCancelBroadcast();
  const broadcasts = useBroadcasts();

  const sending = createBroadcast.isPending || submitBroadcast.isPending;

  const classOptions = classes.data?.data ?? [];
  const sectionOptions = sections.data?.data ?? [];

  async function handleSend() {
    if (!audience) {
      notify.error('Pick an audience first.');
      return;
    }
    if (!body.trim()) {
      notify.error('The message body is empty.');
      return;
    }
    try {
      const draft = await createBroadcast.mutateAsync({
        title: title.trim() || undefined,
        body,
        audience,
        channelPolicy: policy,
        scheduledAt: scheduledAt || undefined,
      });
      await submitBroadcast.mutateAsync({ id: draft.id, scheduledAt: scheduledAt || undefined });
      notify.success(
        scheduledAt ? 'Broadcast scheduled.' : 'Broadcast started.',
        scheduledAt
          ? `Queued for ${new Date(scheduledAt).toLocaleString()}.`
          : `${preview.data?.counts.members ?? 0} recipients. Track it under History.`,
      );
      setBody('');
      setTitle('');
      setScheduledAt('');
      setTab('history');
    } catch (err) {
      notify.error('Could not start the broadcast.', (err as Error).message);
    }
  }

  const seg = preview.data?.segments;
  const counts = preview.data?.counts;
  const smsInChain = policy.steps.some((s) => s.providerId === 'sms');

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Megaphone className="h-6 w-6 text-primary" /> Messaging
          </h1>
          <p className="text-sm text-muted-foreground">
            Send to guardians, students or staff over WhatsApp, SMS and the parent portal.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="compose">
            <Send className="mr-2 h-4 w-4" /> Compose
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="mr-2 h-4 w-4" /> History
            {broadcasts.data && broadcasts.data.length > 0 && (
              <Badge variant="secondary" className="ml-2">{broadcasts.data.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─────────────── Compose ─────────────── */}
        <TabsContent value="compose">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {/* 1. Audience */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">1. Audience</CardTitle>
                  <CardDescription>
                    Resolved against the roster when the message is actually sent, not now — so a
                    student who enrols tomorrow morning is still included.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Send to</Label>
                      <Select
                        value={scope}
                        onValueChange={(v) => {
                          setScope(v as AudienceScope);
                          setIds([]);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="class">A class</SelectItem>
                          <SelectItem value="section">A section</SelectItem>
                          <SelectItem value="all">Every student (school-wide)</SelectItem>
                          <SelectItem value="staff">All staff</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {scope !== 'staff' && (
                      <div className="space-y-1">
                        <Label>Recipient</Label>
                        <Select value={recipients} onValueChange={(v) => setRecipients(v as RecipientKind)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="guardians">Parents / Guardians</SelectItem>
                            <SelectItem value="students">Students</SelectItem>
                            <SelectItem value="both">Both</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {(scope === 'class' || scope === 'section') && (
                    <div className="space-y-1">
                      <Label>{scope === 'class' ? 'Class' : 'Section'}</Label>
                      <Select value={ids[0] ?? ''} onValueChange={(v) => setIds([v])}>
                        <SelectTrigger className="sm:w-2/3">
                          <SelectValue placeholder={`Select a ${scope}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {(scope === 'class' ? classOptions : sectionOptions).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {scope !== 'staff' && recipients !== 'students' && (
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={primaryOnly}
                          onChange={(e) => setPrimaryOnly(e.target.checked)}
                        />
                        <span>
                          <span className="font-medium">Primary guardian only</span>
                          <span className="block text-xs text-muted-foreground">
                            Off means every guardian on file is messaged — a family with three
                            contacts receives three copies, and pays for three.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={perStudent}
                          onChange={(e) => setPerStudent(e.target.checked)}
                        />
                        <span>
                          <span className="font-medium">One message per child</span>
                          <span className="block text-xs text-muted-foreground">
                            Needed when the body uses {'{{student.name}}'}. A parent of three then
                            receives three messages, on purpose.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 2. Transport */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">2. How to reach them</CardTitle>
                  <CardDescription>
                    A chain, not a channel: each parent is reached over the first transport that
                    works for them.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POLICIES.map((p) => {
                      const Icon = p.icon;
                      const active = p.id === policyId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPolicyId(p.id)}
                          className={cn(
                            'flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors',
                            active
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-background hover:bg-muted',
                          )}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Icon className={cn('h-4 w-4', active && 'text-primary')} />
                            {p.label}
                          </span>
                          <span className="text-xs text-muted-foreground">{p.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 3. Message */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">3. Message</CardTitle>
                  <CardDescription>
                    {'{{recipient.name}}'}, {'{{student.name}}'} and {'{{student.className}}'} are
                    filled in per recipient.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATES.map((t) => (
                      <Button key={t.name} variant="outline" size="sm" onClick={() => setBody(t.body)}>
                        {t.name}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bc-title">Internal label (optional)</Label>
                    <Input
                      id="bc-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Term 2 fee reminder — P5"
                    />
                    <p className="text-xs text-muted-foreground">Shown in History only. Never sent.</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bc-body">Body</Label>
                    <Textarea
                      id="bc-body"
                      rows={6}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Dear Parent, …"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bc-when">Send at (optional)</Label>
                    <Input
                      id="bc-when"
                      type="datetime-local"
                      className="sm:w-64"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave empty to send immediately.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: the count-first summary */}
            <div className="space-y-4">
              <Card className="lg:sticky lg:top-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Before you send</CardTitle>
                  <CardDescription>{preview.data?.description ?? 'Pick an audience.'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!audience && (
                    <p className="text-sm text-muted-foreground">
                      Choose who this is going to and the numbers will appear here.
                    </p>
                  )}

                  {audience && preview.isLoading && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Counting recipients…
                    </p>
                  )}

                  {audience && preview.isError && (
                    <p className="text-sm text-rose-600">
                      {(preview.error as Error).message}
                    </p>
                  )}

                  {counts && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Stat label="Will be reached" value={counts.members} tone="text-emerald-600" icon={Users} />
                        <Stat
                          label="Cannot be reached"
                          value={counts.unreachable}
                          tone={counts.unreachable > 0 ? 'text-amber-600' : 'text-muted-foreground'}
                          icon={AlertTriangle}
                        />
                      </div>

                      {counts.unreachable > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          <p className="font-medium">
                            {counts.unreachable} {counts.unreachable === 1 ? 'person has' : 'people have'} no
                            usable phone number or portal account.
                          </p>
                          <p className="mt-1">
                            They are recorded in the delivery report so the registrar can chase the
                            missing numbers — they are not silently dropped.
                          </p>
                          {preview.data && preview.data.unreachableSample.length > 0 && (
                            <p className="mt-2 text-amber-800">
                              e.g. {preview.data.unreachableSample.slice(0, 3).map((u) => u.displayName).join(', ')}
                              {counts.unreachable > 3 ? ` and ${counts.unreachable - 3} more` : ''}
                            </p>
                          )}
                        </div>
                      )}

                      {seg && body.trim() && (
                        <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Encoding</span>
                            <span className={cn('font-medium', seg.encoding === 'UCS-2' && 'text-amber-600')}>
                              {seg.encoding}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">SMS segments each</span>
                            <span className="font-medium">{seg.segments}</span>
                          </div>
                          {smsInChain && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Worst-case total segments</span>
                              <span className="font-medium">{preview.data?.estimatedSmsSegments ?? 0}</span>
                            </div>
                          )}
                          {seg.encoding === 'UCS-2' && (
                            <p className="pt-1 text-amber-700">
                              A non-GSM character (often a curly quote pasted from Word) cut the
                              per-segment capacity from 160 to 70. Retyping the quotes roughly halves
                              the cost.
                            </p>
                          )}
                        </div>
                      )}

                      {preview.data && preview.data.sample.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">First recipients</p>
                          <ul className="space-y-1 text-xs">
                            {preview.data.sample.slice(0, 5).map((s, i) => (
                              <li key={i} className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  {s.displayName}
                                  {s.studentName && (
                                    <span className="text-muted-foreground"> · {s.studentName}</span>
                                  )}
                                </span>
                                <span className="shrink-0 font-mono text-muted-foreground">{s.address}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}

                  <Button
                    className="w-full"
                    disabled={!audience || !body.trim() || sending || (counts?.members ?? 0) === 0}
                    onClick={handleSend}
                  >
                    {sending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</>
                    ) : scheduledAt ? (
                      <><CalendarClock className="mr-2 h-4 w-4" /> Schedule for {counts?.members ?? 0}</>
                    ) : (
                      <><Send className="mr-2 h-4 w-4" /> Send to {counts?.members ?? 0}</>
                    )}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    A broadcast can be stopped mid-send from History.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─────────────── History ─────────────── */}
        <TabsContent value="history">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Broadcasts</CardTitle>
              <CardDescription>Click a row for the full delivery report.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Suppressed</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(broadcasts.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing sent yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {(broadcasts.data ?? []).map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer"
                      onClick={() => setReportId(b.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{b.title ?? b.body.slice(0, 60)}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(b.createdAt).toLocaleString()}
                          {b.scheduledAt && b.status === 'scheduled' && (
                            <> · scheduled {new Date(b.scheduledAt).toLocaleString()}</>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                            STATUS_TONE[b.status] ?? 'bg-slate-100 text-slate-700',
                          )}
                        >
                          {isBroadcastLive(b.status) && <Loader2 className="h-3 w-3 animate-spin" />}
                          {b.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{b.totalRecipients}</TableCell>
                      <TableCell className="text-right text-emerald-600">{b.deliveredCount + b.sentCount}</TableCell>
                      <TableCell className="text-right text-rose-600">{b.failedCount || ''}</TableCell>
                      <TableCell className="text-right text-amber-600">
                        {b.suppressedCount + b.unreachableCount || ''}
                      </TableCell>
                      <TableCell className="text-right">
                        {isBroadcastLive(b.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelBroadcast.mutate(
                                { id: b.id, reason: 'Stopped from the console' },
                                {
                                  onSuccess: (r) =>
                                    notify.success(
                                      'Broadcast stopped.',
                                      `${(r as { cancelledDeliveries: number }).cancelledDeliveries} queued messages were cancelled.`,
                                    ),
                                  onError: (err) => notify.error('Could not stop it.', (err as Error).message),
                                },
                              );
                            }}
                          >
                            <Ban className="mr-1 h-3.5 w-3.5" /> Stop
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BroadcastReportDialog id={reportId} onClose={() => setReportId(null)} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: typeof Users;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold', tone)}>{value}</div>
    </div>
  );
}

/**
 * The delivery report.
 *
 * Rows come from the broadcast's recipient list rather than from delivery
 * records, so a parent with no phone number is visible as `unreachable` instead
 * of being absent from the report entirely.
 */
function BroadcastReportDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const report = useBroadcastReport(id ?? undefined);
  const recipients = useBroadcastRecipients(
    id ?? undefined,
    statusFilter === 'all' ? undefined : statusFilter,
  );

  useEffect(() => {
    if (!id) setStatusFilter('all');
  }, [id]);

  const b = report.data?.broadcast;

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{b?.title ?? 'Delivery report'}</DialogTitle>
          <DialogDescription>
            {b?.policyDescription && <>Transport chain: {b.policyDescription}. </>}
            {b?.completedAt
              ? `Completed ${new Date(b.completedAt).toLocaleString()}.`
              : b && isBroadcastLive(b.status)
                ? 'Still sending — this refreshes automatically.'
                : ''}
          </DialogDescription>
        </DialogHeader>

        {report.isLoading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}

        {b && (
          <>
            <p className="rounded-lg border bg-muted/30 p-3 text-sm">{b.body}</p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReportStat label="Delivered" value={report.data?.byStatus.delivered ?? 0} icon={CheckCircle2} tone="text-emerald-600" />
              <ReportStat label="Sent" value={report.data?.byStatus.sent ?? 0} icon={Send} tone="text-sky-600" />
              <ReportStat label="Failed" value={report.data?.byStatus.failed ?? 0} icon={AlertTriangle} tone="text-rose-600" />
              <ReportStat
                label="Opted out"
                value={report.data?.byStatus.suppressed ?? 0}
                icon={ShieldOff}
                tone="text-amber-600"
              />
            </div>

            {(report.data?.byStatus.unreachable ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <span className="font-medium">
                  {report.data?.byStatus.unreachable} recipients had no phone number or portal account.
                </span>{' '}
                Filter by <em>unreachable</em> below for the list to hand to the registrar.
              </div>
            )}

            {report.data && report.data.byProvider.length > 0 && (
              <div className="text-xs text-muted-foreground">
                By transport:{' '}
                {report.data.byProvider
                  .map((p) => `${p.providerId} ${p.status} ${p.count}`)
                  .join(' · ')}
                {report.data.totals.segments > 0 && <> · {report.data.totals.segments} SMS segments</>}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {['all', 'delivered', 'sent', 'queued', 'failed', 'suppressed', 'unreachable'].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                  {s !== 'all' && report.data?.byStatus[s] ? ` (${report.data.byStatus[s]})` : ''}
                </Button>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recipients.data?.rows ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      No recipients with this status.
                    </TableCell>
                  </TableRow>
                )}
                {(recipients.data?.rows ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.displayName}</div>
                      {r.relationship && (
                        <div className="text-xs text-muted-foreground">{r.relationship}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.studentName ?? '—'}
                      {r.className && <span className="text-muted-foreground"> · {r.className}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.address ?? '—'}</TableCell>
                    <TableCell className="text-sm">{r.providerId ?? '—'}</TableCell>
                    <TableCell>
                      <span className={cn('text-sm font-medium', RECIPIENT_STATUS_TONE[r.status])}>
                        {r.status}
                      </span>
                      {(r.lastError || r.suppressionReason) && (
                        <div className="text-xs text-muted-foreground">
                          {r.suppressionReason ?? r.lastError}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Send;
  tone: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={cn('mt-1 text-xl font-semibold', tone)}>{value}</div>
    </div>
  );
}

export default SchoolMessagingPage;
