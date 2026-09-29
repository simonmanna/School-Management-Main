import { useState } from 'react';
import { Bus, Clock, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useActiveStudent } from '@/stores/auth.store';
import { usePickup, useRequestPickup, useTransport, useWithdrawPickup } from '@/lib/portal-api';
import { apiErrorMessage } from '@/lib/api';
import { notify } from '@/lib/notify';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, Input, PageTitle, Skeleton } from '@/components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Wave 16 — how my child gets home: who may collect them, and the school bus.
 *
 * A collector a parent adds here is a REQUEST. The school approves it before
 * anyone at the gate will release a child on it — the page says so plainly,
 * because a parent assuming "I added Auntie, so she can collect" is exactly the
 * misunderstanding that ends with a child waiting at the gate.
 */
export default function ParentGoingHome() {
  const active = useActiveStudent();
  const id = active?.studentProfileId;
  if (!id) return <Empty title="No pupil selected" />;
  return (
    <div className="space-y-4">
      <PageTitle sub="Who may collect your child, and the school bus.">Going home</PageTitle>
      <PickupCard studentProfileId={id} />
      <TransportCard studentProfileId={id} />
    </div>
  );
}

function PickupCard({ studentProfileId }: { studentProfileId: string }) {
  const { data, isLoading } = usePickup(studentProfileId);
  const request = useRequestPickup(studentProfileId);
  const withdraw = useWithdrawPickup(studentProfileId);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ personName: '', personPhone: '', relationship: '', idNumber: '', oneDay: '' });

  const submit = async () => {
    try {
      await request.mutateAsync({
        personName: f.personName,
        personPhone: f.personPhone.replace(/\s/g, ''),
        relationship: f.relationship,
        idType: f.idNumber ? 'National ID' : undefined,
        idNumber: f.idNumber || undefined,
        kind: f.oneDay ? 'ONE_OFF' : 'STANDING',
        validTo: f.oneDay || undefined,
      });
      notify.success('Sent to the school for approval');
      setF({ personName: '', personPhone: '', relationship: '', idNumber: '', oneDay: '' });
      setOpen(false);
    } catch (e) {
      notify.error(apiErrorMessage(e) || 'Could not send the request');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Who may collect</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {isLoading ? <Skeleton className="h-16" /> : (
          <>
            {(data?.guardians ?? []).map((g, i) => (
              <div key={`g${i}`} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div><div className="font-medium">{g.name}</div><div className="text-xs text-muted-foreground capitalize">{g.relationship}</div></div>
                <Badge variant="secondary">Guardian</Badge>
              </div>
            ))}
            {(data?.authorizations ?? []).map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[a.relationship, a.phone, a.kind === 'ONE_OFF' && a.validTo ? `only on ${new Date(a.validTo).toLocaleDateString()}` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Badge variant={a.status === 'approved' ? 'default' : 'outline'}>{a.status === 'approved' ? 'Approved' : 'Awaiting school'}</Badge>
                <Button size="sm" variant="ghost" aria-label={`Withdraw ${a.name}`} disabled={withdraw.isPending}
                  onClick={() => { if (window.confirm(`Stop ${a.name} collecting your child?`)) withdraw.mutate(a.id); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {(data?.guardians.length ?? 0) + (data?.authorizations.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No one is on the list yet. Contact the school.</p>
            )}
          </>
        )}

        {open ? (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Full name" value={f.personName} onChange={(e) => setF({ ...f, personName: e.target.value })} />
              <Input placeholder="Mobile, e.g. 0772 123456" type="tel" value={f.personPhone} onChange={(e) => setF({ ...f, personPhone: e.target.value })} />
              <Input placeholder="Relationship, e.g. aunt, driver" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} />
              <Input placeholder="National ID number (optional)" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} />
            </div>
            <label className="block space-y-1 text-xs text-muted-foreground">
              <span>Just one day? Pick the date (leave blank for every day)</span>
              <Input type="date" value={f.oneDay} onChange={(e) => setF({ ...f, oneDay: e.target.value })} />
            </label>
            <p className="text-xs text-muted-foreground">The school checks and approves each request. Until then the gate will not release your child to this person.</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={!f.personName || !f.personPhone || !f.relationship || request.isPending} onClick={submit}>Send request</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" /> Add someone</Button>
        )}
      </CardContent>
    </Card>
  );
}

function TransportCard({ studentProfileId }: { studentProfileId: string }) {
  const { data, isLoading } = useTransport(studentProfileId);
  if (isLoading) return <Skeleton className="h-24" />;
  if (!data || data.assignments.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bus className="h-4 w-4" /> School bus</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">Your child is not on a school bus route.</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bus className="h-4 w-4" /> School bus</CardTitle></CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        {data.assignments.map((a) => (
          <div key={a.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.route}{a.routeCode ? ` (${a.routeCode})` : ''}</span>
              {a.status !== 'active' && <Badge variant="outline" className="capitalize">{a.status}</Badge>}
            </div>
            {a.pickupStop && <div className="pt-1 text-xs text-muted-foreground">Picked up at <span className="text-foreground">{a.pickupStop.name}</span>{a.pickupStop.landmark ? ` — ${a.pickupStop.landmark}` : ''}</div>}
            {a.dropoffStop && a.dropoffStop.name !== a.pickupStop?.name && <div className="text-xs text-muted-foreground">Dropped at <span className="text-foreground">{a.dropoffStop.name}</span></div>}
            <div className="text-xs text-muted-foreground">{a.daysOfWeek.map((d) => DAYS[d]).join(', ')}</div>
          </div>
        ))}
        <div>
          <div className="flex items-center gap-2 pb-1 text-xs font-medium text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Today</div>
          {data.today.length === 0 ? (
            <p className="text-xs text-muted-foreground">No trips today.</p>
          ) : data.today.map((t, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <span className="capitalize">{t.direction === 'inbound' ? 'To school' : 'Home'}{t.delayMinutes > 0 ? ` · ${t.delayMinutes} min late` : ''}</span>
              <span className="capitalize">{t.lastEvent ? `${t.lastEvent.eventType.replace(/_/g, ' ')} ${new Date(t.lastEvent.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : t.passengerStatus}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
