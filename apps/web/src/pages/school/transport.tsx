import { schoolTodayNow, date as fmtDate, dateTime } from '@/lib/format';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bus, Route as RouteIcon, MapPin, Users, Plus, CalendarClock, ShieldAlert } from 'lucide-react';
import { notify } from '@/lib/notify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useVehicles,
  useCreateVehicle,
  useRoutes,
  useRoute,
  useCreateRoute,
  useStops,
  useCreateStop,
  useTransportZones,
  useStudentTransportAssignments,
  useAssignStudentTransport,
  useTransportTrips,
  useTransportIncidents,
  useStudents,
  useTerms,
  type Vehicle,
  type Route,
  type Stop,
  type StudentTransportAssignment,
} from '@/features/school/api';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const today = () => schoolTodayNow();
const time = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' }) : '—');

function StatusBadge({ value }: { value?: string | null }) {
  const v = value ?? '—';
  const variant = ['active', 'completed', 'assigned', 'available', 'resolved', 'pass'].includes(v)
    ? 'default'
    : ['maintenance', 'open', 'en_route', 'dispatched', 'scheduled', 'pending'].includes(v)
      ? 'secondary'
      : ['out_of_service', 'accident', 'cancelled', 'aborted', 'high', 'critical'].includes(v)
        ? 'destructive'
        : 'outline';
  return <Badge variant={variant as any}>{v.replace(/_/g, ' ')}</Badge>;
}

export function SchoolTransportPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'vehicles';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transport</h1>
        <p className="text-sm text-muted-foreground">
          Fleet, routes, stops, the pupils on each bus, daily trips and incidents.
        </p>
      </div>
      <Tabs defaultValue="vehicles" value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="vehicles"><Bus className="mr-1.5 h-4 w-4" />Vehicles</TabsTrigger>
          <TabsTrigger value="routes"><RouteIcon className="mr-1.5 h-4 w-4" />Routes</TabsTrigger>
          <TabsTrigger value="stops"><MapPin className="mr-1.5 h-4 w-4" />Stops</TabsTrigger>
          <TabsTrigger value="students"><Users className="mr-1.5 h-4 w-4" />Pupils</TabsTrigger>
          <TabsTrigger value="trips"><CalendarClock className="mr-1.5 h-4 w-4" />Trips</TabsTrigger>
          <TabsTrigger value="incidents"><ShieldAlert className="mr-1.5 h-4 w-4" />Incidents</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles" className="pt-4"><VehiclesTab /></TabsContent>
        <TabsContent value="routes" className="pt-4"><RoutesTab /></TabsContent>
        <TabsContent value="stops" className="pt-4"><StopsTab /></TabsContent>
        <TabsContent value="students" className="pt-4"><StudentAssignTab /></TabsContent>
        <TabsContent value="trips" className="pt-4"><TripsTab /></TabsContent>
        <TabsContent value="incidents" className="pt-4"><IncidentsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function VehiclesTab() {
  const vehicles = useVehicles();
  const create = useCreateVehicle();
  const [code, setCode] = useState('');
  const [plate, setPlate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [type, setType] = useState('');
  const add = async () => {
    if (!code || !plate) { notify.error('Code and plate required'); return; }
    try {
      await create.mutateAsync({ code, plateNumber: plate, seatedCapacity: capacity ? Number(capacity) : undefined, type: type || undefined });
      notify.success('Vehicle added'); setCode(''); setPlate(''); setCapacity(''); setType('');
    } catch { notify.error('Failed to add vehicle'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Vehicles</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="w-32" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input className="w-40" placeholder="Plate" value={plate} onChange={(e) => setPlate(e.target.value)} />
          <Input className="w-24" type="number" placeholder="Seats" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Input className="w-40" placeholder="Type (bus, van)" value={type} onChange={(e) => setType(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Plate</TableHead><TableHead>Fleet no.</TableHead><TableHead>Vehicle</TableHead><TableHead className="text-right">Seats</TableHead><TableHead className="text-right">Odometer</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(vehicles.data ?? []).map((v: Vehicle) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.plateNumber}</TableCell>
                  <TableCell>{v.fleetNumber ?? v.code}</TableCell>
                  <TableCell>{[v.make, v.model].filter(Boolean).join(' ') || v.type || '—'}{v.year ? ` (${v.year})` : ''}</TableCell>
                  <TableCell className="text-right">{v.seatedCapacity ?? '—'}</TableCell>
                  <TableCell className="text-right">{v.odometerKm != null ? `${Number(v.odometerKm).toLocaleString()} km` : '—'}</TableCell>
                  <TableCell><StatusBadge value={v.status} /></TableCell>
                </TableRow>
              ))}
              {vehicles.data && vehicles.data.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No vehicles yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function RouteStops({ routeId }: { routeId: string }) {
  const route = useRoute(routeId);
  const version = route.data?.versions?.find((v) => v.id === route.data?.currentVersionId) ?? route.data?.versions?.[0];
  if (route.isLoading) return <p className="text-xs text-muted-foreground">Loading stops…</p>;
  if (!version?.routeStops?.length) return <p className="text-xs text-muted-foreground">No stops on this route yet.</p>;
  return (
    <ol className="mt-2 space-y-1 text-xs">
      {version.routeStops.map((rs) => (
        <li key={rs.id} className="flex items-center justify-between gap-2">
          <span>{rs.sequence}. {rs.stop?.name ?? rs.stopId}{rs.stop?.zone ? ` · ${rs.stop.zone.code}` : ''}</span>
          <span className="text-muted-foreground">{rs.plannedArrival ?? '—'}</span>
        </li>
      ))}
    </ol>
  );
}

function RoutesTab() {
  const routes = useRoutes();
  const create = useCreateRoute();
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const add = async () => {
    if (!name) { notify.error('Name required'); return; }
    try { await create.mutateAsync({ name }); notify.success('Route added'); setName(''); }
    catch { notify.error('Failed to add route'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Routes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="w-64" placeholder="Route name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(routes.data ?? []).map((r: Route) => (
            <li key={r.id} className="rounded border p-3">
              <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="font-medium">{r.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {r.distanceKm ? `${Number(r.distanceKm)} km` : ''}{r.estimatedDurationMin ? ` · ${r.estimatedDurationMin} min` : ''}
                  <StatusBadge value={r.status} />
                </span>
              </button>
              {r.description && <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>}
              {open === r.id && <RouteStops routeId={r.id} />}
            </li>
          ))}
          {routes.data && routes.data.length === 0 && <li className="text-muted-foreground">No routes yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function StopsTab() {
  const stops = useStops();
  const zones = useTransportZones();
  const create = useCreateStop();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [zoneId, setZoneId] = useState('');
  const add = async () => {
    if (!code || !name) { notify.error('Code and name required'); return; }
    try { await create.mutateAsync({ code, name, zoneId: zoneId || undefined }); notify.success('Stop added'); setCode(''); setName(''); }
    catch { notify.error('Failed to add stop'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Stops</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="w-24" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input className="w-56" placeholder="Stop name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={sel + ' w-56'} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">Fee zone…</option>
            {(zones.data ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Stop</TableHead><TableHead>Landmark</TableHead><TableHead>Zone</TableHead></TableRow></TableHeader>
            <TableBody>
              {(stops.data ?? []).map((s: Stop) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.landmark ?? '—'}</TableCell>
                  <TableCell>{s.zone?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
              {stops.data && stops.data.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No stops yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function StudentAssignTab() {
  const assignments = useStudentTransportAssignments();
  const routes = useRoutes();
  const students = useStudents({ pageSize: 200 });
  const terms = useTerms();
  const assign = useAssignStudentTransport();
  const [studentProfileId, setStudentProfileId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [termId, setTermId] = useState('');
  const [filterTerm, setFilterTerm] = useState('');
  const [filterRoute, setFilterRoute] = useState('');
  const route = useRoute(routeId || undefined);
  const routeStops = useMemo(() => {
    const v = route.data?.versions?.find((x) => x.id === route.data?.currentVersionId) ?? route.data?.versions?.[0];
    return (v?.routeStops ?? []).map((rs) => rs.stop).filter((s): s is Stop => !!s);
  }, [route.data]);
  const termName = (id?: string | null) => (terms.data?.data ?? []).find((t: any) => t.id === id)?.name ?? '—';
  const currentTerm = (terms.data?.data ?? []).find((t: any) => t.isCurrent)?.id;
  const activeTerm = filterTerm || currentTerm || '';
  const rows = (assignments.data ?? []).filter(
    (a: StudentTransportAssignment) => (!activeTerm || a.termId === activeTerm) && (!filterRoute || a.routeId === filterRoute),
  );
  const add = async () => {
    if (!studentProfileId || !routeId || !stopId || !termId) { notify.error('Pupil, route, stop and term required'); return; }
    try {
      await assign.mutateAsync({ studentProfileId, routeId, stopId, termId, startDate: today() });
      notify.success('Pupil assigned'); setStudentProfileId(''); setRouteId(''); setStopId(''); setTermId('');
    } catch { notify.error('Failed to assign'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Pupils on transport</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
          <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
            <option value="">Pupil…</option>
            {(students.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.partner?.name ?? s.admissionNo} ({s.admissionNo})</option>
            ))}
          </select>
          <select className={sel} value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(''); }}>
            <option value="">Route…</option>
            {(routes.data ?? []).map((r: Route) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className={sel} value={stopId} onChange={(e) => setStopId(e.target.value)} disabled={!routeId}>
            <option value="">Stop…</option>
            {routeStops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Term…</option>
            {(terms.data?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Button size="sm" className="w-full" onClick={add}><Plus className="mr-1 h-4 w-4" />Assign pupil</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className={sel + ' w-48'} value={activeTerm} onChange={(e) => setFilterTerm(e.target.value)}>
            <option value="">All terms</option>
            {(terms.data?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className={sel + ' w-72'} value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)}>
            <option value="">All routes</option>
            {(routes.data ?? []).map((r: Route) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="text-muted-foreground">{rows.length} pupil(s)</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Pupil</TableHead><TableHead>Route</TableHead><TableHead>Stop</TableHead><TableHead>Zone</TableHead><TableHead>Term</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((a: StudentTransportAssignment) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.student?.partner?.name ?? '—'} <span className="text-xs text-muted-foreground">{a.student?.admissionNo}</span></TableCell>
                  <TableCell>{a.route?.name ?? '—'}</TableCell>
                  <TableCell>{a.stop?.name ?? '—'}</TableCell>
                  <TableCell>{a.stop?.zone?.code ?? '—'}</TableCell>
                  <TableCell>{termName(a.termId)}</TableCell>
                  <TableCell><StatusBadge value={a.status} /></TableCell>
                </TableRow>
              ))}
              {assignments.data && rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No pupils match.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TripsTab() {
  const [day, setDay] = useState(today());
  const trips = useTransportTrips(day);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Trips</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Input type="date" className="w-48" value={day} onChange={(e) => setDay(e.target.value)} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Route</TableHead><TableHead>Run</TableHead><TableHead>Bus</TableHead><TableHead>Driver / attendant</TableHead><TableHead>Planned</TableHead><TableHead>Departed</TableHead><TableHead>Arrived</TableHead><TableHead className="text-right">Pupils</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {(trips.data ?? []).map((t) => {
                const pax = t.passengers ?? [];
                const rode = pax.filter((p) => ['boarded', 'dropped_off'].includes(p.status)).length;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.routeVersion?.route?.name ?? '—'}</TableCell>
                    <TableCell>{t.direction === 'inbound' ? 'Morning' : 'Afternoon'}</TableCell>
                    <TableCell>{t.vehicle?.plateNumber ?? '—'}</TableCell>
                    <TableCell className="text-xs">{t.driver?.name ?? '—'}<br /><span className="text-muted-foreground">{t.attendant?.name ?? ''}</span></TableCell>
                    <TableCell>{time(t.plannedDeparture)}</TableCell>
                    <TableCell>{time(t.actualDeparture)}{t.delayMinutes ? <span className="ml-1 text-xs text-amber-600">+{t.delayMinutes}′</span> : null}</TableCell>
                    <TableCell>{time(t.actualArrival)}</TableCell>
                    <TableCell className="text-right">{rode}/{pax.length}</TableCell>
                    <TableCell><StatusBadge value={t.status} /></TableCell>
                  </TableRow>
                );
              })}
              {trips.data && trips.data.length === 0 && <TableRow><TableCell colSpan={9} className="text-muted-foreground">No trips on {fmtDate(day)}.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentsTab() {
  const incidents = useTransportIncidents();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Incidents</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(incidents.data ?? []).map((i) => (
          <div key={i.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium capitalize">{i.type.replace(/_/g, ' ')}{i.vehicle?.plateNumber ? ` · ${i.vehicle.plateNumber}` : ''}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">{dateTime(i.occurredAt)} <StatusBadge value={i.severity} /> <StatusBadge value={i.status} /></span>
            </div>
            {i.description && <p className="mt-1">{i.description}</p>}
            {(i.actions ?? []).map((a) => <p key={a.id} className="mt-1 text-xs text-muted-foreground">Action: {a.action}</p>)}
            {i.resolutionNotes && <p className="mt-1 text-xs text-emerald-700">Resolved: {i.resolutionNotes}</p>}
          </div>
        ))}
        {incidents.data && incidents.data.length === 0 && <p className="text-sm text-muted-foreground">No incidents recorded.</p>}
      </CardContent>
    </Card>
  );
}
