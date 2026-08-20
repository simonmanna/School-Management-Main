import { useState } from 'react';
import { DoorOpen, LogOut } from 'lucide-react';
import { notify } from '@/lib/notify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  useFrontDeskLogs, useCreateFrontDeskLog, useCheckoutFrontDeskLog,
  usePartners, type FrontDeskLog,
} from '@/features/school/api';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const timeOf = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const dateOf = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '');
const dur = (a?: string | null, b?: string | null) => {
  if (!a || !b) return '';
  const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const TimeCell = ({ d }: { d?: string | null }) => (
  <div className="leading-tight">
    <div className="font-medium">{timeOf(d)}</div>
    <div className="text-xs text-muted-foreground">{dateOf(d)}</div>
  </div>
);

export function FrontDeskPage() {
  const logs = useFrontDeskLogs();
  const create = useCreateFrontDeskLog();
  const checkout = useCheckoutFrontDeskLog();
  const partners = usePartners();
  const [partnerId, setPartnerId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [personVisited, setPersonVisited] = useState('');
  const checkIn = async () => {
    if (!visitorName) { notify.error('Visitor name required'); return; }
    try {
      await create.mutateAsync({ partnerId: partnerId || undefined, visitorName, phone: phone || undefined, purpose: purpose || undefined, personVisited: personVisited || undefined });
      notify.success('Visitor checked in'); setVisitorName(''); setPhone(''); setPurpose(''); setPersonVisited(''); setPartnerId('');
    } catch { notify.error('Check-in failed'); }
  };
  const onSite = (logs.data ?? []).filter((l) => l.status === 'in');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Front Desk</h1>
        <p className="text-sm text-muted-foreground">Log visitors and walk-ins, and check them out on departure.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Check in visitor</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <select className={sel} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Existing visitor (optional)…</option>
              {(partners.data?.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Input placeholder="Visitor name" value={visitorName} onChange={(e) => setVisitorName(e.target.value)} />
            <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input placeholder="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            <Input placeholder="Person visited" value={personVisited} onChange={(e) => setPersonVisited(e.target.value)} />
            <Button size="sm" className="w-full" onClick={checkIn}><DoorOpen className="mr-1 h-4 w-4" />Check in</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Visitor log</CardTitle>
            <span className="text-sm text-muted-foreground">{onSite.length} on site</span>
          </CardHeader>
          <CardContent className="text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visitor</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Check-out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs.data ?? []).map((l: FrontDeskLog) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.visitorName}{l.partner ? <span className="text-muted-foreground"> ({l.partner.name})</span> : ''}
                      {l.phone && <div className="text-xs font-normal text-muted-foreground">{l.phone}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.purpose ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{l.personVisited ?? '—'}</TableCell>
                    <TableCell><TimeCell d={l.checkInAt} /></TableCell>
                    <TableCell>
                      {l.checkOutAt ? <TimeCell d={l.checkOutAt} /> : <span className="text-muted-foreground">—</span>}
                      {l.checkOutAt && <div className="text-xs text-sky-600">{dur(l.checkInAt, l.checkOutAt)}</div>}
                    </TableCell>
                    <TableCell>
                      <span className={`rounded px-2 py-0.5 text-xs ${l.status === 'in' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {l.status === 'in' && (
                        <Button size="sm" variant="outline" onClick={() => checkout.mutate({ id: l.id })}>
                          <LogOut className="mr-1 h-3.5 w-3.5" />Out
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {logs.data && logs.data.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No visitors logged yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
