import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bell,
  Check,
  Clock,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Send,
  Users,
} from 'lucide-react';
import { useClasses, useStudents } from '@/features/school/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * Messaging — parent/guardian/student broadcast console.
 *
 * DEMO management interface. Composing a message wires the Class + Student
 * pickers to the live school API (useClasses / useStudents), but "Send" is a
 * front-end simulation: it drops the message into the in-session History table
 * and fires a toast. No backend messaging endpoint is called yet — this exists
 * to show clients the messaging surface (channels, audiences, recipients).
 */

type ChannelId = 'sms' | 'email' | 'whatsapp' | 'inapp';
type AudienceScope = 'class' | 'students' | 'all';
type RecipientType = 'students' | 'guardians' | 'both';
type MsgStatus = 'sent' | 'scheduled' | 'draft';

const CHANNELS: { id: ChannelId; label: string; icon: typeof Mail; tone: string }[] = [
  { id: 'sms', label: 'SMS', icon: MessageSquare, tone: 'text-sky-600' },
  { id: 'email', label: 'Email', icon: Mail, tone: 'text-violet-600' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'text-emerald-600' },
  { id: 'inapp', label: 'In-App / Push', icon: Bell, tone: 'text-amber-600' },
];

const RECIPIENT_TYPES: { id: RecipientType; label: string }[] = [
  { id: 'guardians', label: 'Parents / Guardians' },
  { id: 'students', label: 'Students' },
  { id: 'both', label: 'Both' },
];

const TEMPLATES: { name: string; body: string }[] = [
  { name: 'Fee reminder', body: 'Dear Parent, this is a reminder that school fees for the current term are due. Kindly clear the outstanding balance at your earliest convenience. Thank you.' },
  { name: 'PTA meeting', body: 'Dear Parent/Guardian, you are invited to the termly PTA meeting this Saturday at 10:00 AM in the main hall. Your attendance is highly appreciated.' },
  { name: 'School closure', body: 'Dear Parents, please note that the school will be closed on Friday for a public holiday. Normal classes resume on Monday.' },
  { name: 'Exam schedule', body: 'Dear Parent, end-of-term examinations begin next week. Please ensure your child is well prepared and reports to school on time.' },
];

interface SentMessage {
  id: string;
  channels: ChannelId[];
  audienceLabel: string;
  recipientType: RecipientType;
  recipients: number;
  subject?: string;
  body: string;
  status: MsgStatus;
  at: string; // ISO
}

const SEED_HISTORY: SentMessage[] = [
  {
    id: 'seed-1', channels: ['sms', 'whatsapp'], audienceLabel: 'All Students', recipientType: 'guardians',
    recipients: 412, body: 'Term 2 opens Monday 2 Sep. Please ensure fees are cleared before reporting.',
    status: 'sent', at: '2026-08-19T08:12:00',
  },
  {
    id: 'seed-2', channels: ['email'], audienceLabel: 'Class: Senior 4', recipientType: 'both',
    recipients: 68, subject: 'Mock exam timetable', body: 'Find attached the mock examination timetable for Senior 4 candidates.',
    status: 'sent', at: '2026-08-18T14:40:00',
  },
  {
    id: 'seed-3', channels: ['inapp'], audienceLabel: 'Class: Primary 5', recipientType: 'guardians',
    recipients: 34, body: 'Swimming gala moved to next Thursday. Kindly send swimming kits.',
    status: 'scheduled', at: '2026-08-22T09:00:00',
  },
];

export function SchoolMessagingPage() {
  const { data: classes } = useClasses();
  const { data: studentsResp } = useStudents({ page: 1, pageSize: 500 });

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'compose';
  const setTab = (v: string) =>
    setSearchParams(v === 'history' ? { tab: 'history' } : {}, { replace: true });
  const [channels, setChannels] = useState<ChannelId[]>(['sms']);
  const [scope, setScope] = useState<AudienceScope>('class');
  const [recipientType, setRecipientType] = useState<RecipientType>('guardians');
  const [classId, setClassId] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [history, setHistory] = useState<SentMessage[]>(SEED_HISTORY);

  const allStudents = studentsResp?.data ?? [];
  const classStudents = useMemo(
    () => (classId ? allStudents.filter((s) => s.currentClassId === classId) : allStudents),
    [allStudents, classId],
  );

  const className = (id: string) => classes?.data.find((c) => c.id === id)?.name ?? id;

  const pickedIds = Object.keys(picked).filter((k) => picked[k]);

  // Estimated head-count for the chosen audience × recipient type.
  const baseCount = useMemo(() => {
    if (scope === 'all') return allStudents.length;
    if (scope === 'class') return classStudents.length;
    return pickedIds.length;
  }, [scope, allStudents.length, classStudents.length, pickedIds.length]);

  const recipientMultiplier = recipientType === 'both' ? 2 : 1;
  const estRecipients = baseCount * recipientMultiplier;

  const audienceLabel = useMemo(() => {
    if (scope === 'all') return 'All Students';
    if (scope === 'class') return classId ? `Class: ${className(classId)}` : 'Class: —';
    return `${pickedIds.length} selected student${pickedIds.length === 1 ? '' : 's'}`;
  }, [scope, classId, pickedIds.length, classes]);

  const toggleChannel = (id: ChannelId) =>
    setChannels((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const togglePick = (id: string) =>
    setPicked((prev) => ({ ...prev, [id]: !prev[id] }));

  const canSend =
    channels.length > 0 &&
    body.trim().length > 0 &&
    (scope === 'all' || (scope === 'class' && !!classId) || (scope === 'students' && pickedIds.length > 0));

  const reset = () => {
    setSubject('');
    setBody('');
    setPicked({});
  };

  const send = (status: MsgStatus) => {
    if (!canSend) {
      notify.error('Choose a channel, an audience and type a message first.');
      return;
    }
    const msg: SentMessage = {
      id: `m-${Date.now()}`,
      channels: [...channels],
      audienceLabel,
      recipientType,
      recipients: estRecipients,
      subject: subject.trim() || undefined,
      body: body.trim(),
      status,
      at: new Date().toISOString(),
    };
    setHistory((prev) => [msg, ...prev]);
    notify.success(
      status === 'scheduled'
        ? `Message scheduled to ~${estRecipients} recipient(s).`
        : `Message sent to ~${estRecipients} recipient(s) via ${channels.map((c) => CHANNELS.find((x) => x.id === c)?.label).join(', ')}.`,
    );
    reset();
    setTab('history');
  };

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Megaphone className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Messaging</h1>
          <p className="text-sm text-muted-foreground">
            Send announcements and alerts to parents, guardians and students across SMS, Email,
            WhatsApp and in-app push — by class or hand-picked recipients.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="compose">
            <Send className="mr-2 h-4 w-4" /> Compose
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="mr-2 h-4 w-4" /> History
            <Badge variant="secondary" className="ml-2">{history.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ─────────────── Compose ─────────────── */}
        <TabsContent value="compose">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Left: the composer */}
            <div className="space-y-4 lg:col-span-2">
              {/* Channels */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">1. Channel</CardTitle>
                  <CardDescription>Pick one or more delivery channels.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {CHANNELS.map((c) => {
                      const active = channels.includes(c.id);
                      const Icon = c.icon;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleChannel(c.id)}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                            active
                              ? 'border-primary bg-primary/10 font-medium text-foreground'
                              : 'border-border bg-background text-muted-foreground hover:bg-muted',
                          )}
                        >
                          <Icon className={cn('h-4 w-4', active && c.tone)} />
                          {c.label}
                          {active && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Audience */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">2. Audience</CardTitle>
                  <CardDescription>Who receives this message.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Send to</Label>
                      <Select value={scope} onValueChange={(v) => { setScope(v as AudienceScope); setPicked({}); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="class">A whole class</SelectItem>
                          <SelectItem value="students">Specific students</SelectItem>
                          <SelectItem value="all">All students (school-wide)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Recipient</Label>
                      <Select value={recipientType} onValueChange={(v) => setRecipientType(v as RecipientType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RECIPIENT_TYPES.map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(scope === 'class' || scope === 'students') && (
                    <div className="space-y-1">
                      <Label>Class</Label>
                      <Select value={classId} onValueChange={(v) => { setClassId(v); setPicked({}); }}>
                        <SelectTrigger className="sm:w-1/2"><SelectValue placeholder="Select a class" /></SelectTrigger>
                        <SelectContent>
                          {(classes?.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {scope === 'students' && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label>Students {classId && `in ${className(classId)}`}</Label>
                        <span className="text-xs text-muted-foreground">{pickedIds.length} selected</span>
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-md border">
                        {!classId ? (
                          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Choose a class to list students.</p>
                        ) : classStudents.length === 0 ? (
                          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No students in this class.</p>
                        ) : (
                          classStudents.map((s) => (
                            <label
                              key={s.id}
                              className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/50"
                            >
                              <input
                                type="checkbox"
                                checked={!!picked[s.id]}
                                onChange={() => togglePick(s.id)}
                                className="h-4 w-4 rounded border-border"
                              />
                              <span className="font-mono text-xs text-muted-foreground">{s.admissionNo}</span>
                              <span className="flex-1">{s.partner?.name ?? '—'}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Message */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">3. Message</CardTitle>
                  <CardDescription>Compose the content, or start from a template.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div className="space-y-1">
                      <Label>Template</Label>
                      <Select onValueChange={(name) => {
                        const t = TEMPLATES.find((x) => x.name === name);
                        if (t) setBody(t.body);
                      }}>
                        <SelectTrigger className="w-56"><SelectValue placeholder="Insert a template…" /></SelectTrigger>
                        <SelectContent>
                          {TEMPLATES.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {channels.includes('email') && (
                    <div className="space-y-1">
                      <Label>Subject</Label>
                      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line" />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label>Message body</Label>
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={6}
                      placeholder="Type your message…"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{channels.includes('sms') && `≈ ${Math.max(1, Math.ceil(body.length / 160))} SMS part(s)`}</span>
                      <span>{body.length} characters</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: summary + send */}
            <div className="lg:col-span-1">
              <Card className="sticky top-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-4 text-center">
                    <div className="flex items-center justify-center gap-2 text-3xl font-semibold">
                      <Users className="h-6 w-6 text-muted-foreground" />
                      ~{estRecipients}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">estimated recipients</p>
                  </div>

                  <dl className="space-y-2 text-sm">
                    <Row label="Channels">
                      {channels.length === 0 ? (
                        <span className="text-muted-foreground">none</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          {channels.map((c) => (
                            <Badge key={c} variant="secondary">{CHANNELS.find((x) => x.id === c)?.label}</Badge>
                          ))}
                        </div>
                      )}
                    </Row>
                    <Row label="Audience"><span className="text-right">{audienceLabel}</span></Row>
                    <Row label="Recipient">
                      {RECIPIENT_TYPES.find((r) => r.id === recipientType)?.label}
                    </Row>
                  </dl>

                  <div className="space-y-2 pt-2">
                    <Button className="w-full" disabled={!canSend} onClick={() => send('sent')}>
                      <Send className="mr-2 h-4 w-4" /> Send now
                    </Button>
                    <Button variant="outline" className="w-full" disabled={!canSend} onClick={() => send('scheduled')}>
                      <Clock className="mr-2 h-4 w-4" /> Schedule
                    </Button>
                  </div>
                  <p className="text-center text-[11px] text-muted-foreground">
                    Demo mode — messages are logged to History, not dispatched.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─────────────── History ─────────────── */}
        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Channels</th>
                      <th className="px-4 py-3">Audience</th>
                      <th className="px-4 py-3">Recipient</th>
                      <th className="px-4 py-3 text-right">Recipients</th>
                      <th className="px-4 py-3">Message</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((m) => (
                      <tr key={m.id} className="border-b last:border-0 align-top hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {new Date(m.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {m.channels.map((c) => (
                              <Badge key={c} variant="outline">{CHANNELS.find((x) => x.id === c)?.label}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{m.audienceLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {RECIPIENT_TYPES.find((r) => r.id === m.recipientType)?.label}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{m.recipients}</td>
                        <td className="max-w-sm px-4 py-3">
                          {m.subject && <div className="font-medium">{m.subject}</div>}
                          <div className="truncate text-muted-foreground">{m.body}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={m.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: MsgStatus }) {
  const map: Record<MsgStatus, string> = {
    sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    scheduled: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    draft: 'bg-muted text-muted-foreground',
  };
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', map[status])}>{status}</span>;
}
