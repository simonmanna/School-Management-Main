import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bus, Route as RouteIcon, MapPin, Users, Plus } from 'lucide-react';
import { notify } from '@/lib/notify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useVehicles,
  useCreateVehicle,
  useRoutes,
  useCreateRoute,
  useStops,
  useCreateStop,
  useStudentTransportAssignments,
  useAssignStudentTransport,
  useStudents,
  useTerms,
  type Vehicle,
  type Route,
  type Stop,
  type StudentTransportAssignment,
} from '@/features/school/api';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const money = (n: number | string) => `UGX ${Number(n).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

export function SchoolTransportPage() {
  const [params] = useSearchParams();
  const tab = params.get('tab') || 'vehicles';
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transport Management</h1>
        <p className="text-sm text-muted-foreground">
          Fleet, routes, stops and student transport assignments.
        </p>
      </div>
      <Tabs defaultValue="vehicles" value={tab}>
        <TabsList>
          <TabsTrigger value="vehicles"><Bus className="mr-1.5 h-4 w-4" />Vehicles</TabsTrigger>
          <TabsTrigger value="routes"><RouteIcon className="mr-1.5 h-4 w-4" />Routes</TabsTrigger>
          <TabsTrigger value="stops"><MapPin className="mr-1.5 h-4 w-4" />Stops</TabsTrigger>
          <TabsTrigger value="students"><Users className="mr-1.5 h-4 w-4" />Student Assignments</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles" className="pt-4"><VehiclesTab /></TabsContent>
        <TabsContent value="routes" className="pt-4"><RoutesTab /></TabsContent>
        <TabsContent value="stops" className="pt-4"><StopsTab /></TabsContent>
        <TabsContent value="students" className="pt-4"><StudentAssignTab /></TabsContent>
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
          <Input className="w-24" type="number" placeholder="Capacity" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Input className="w-40" placeholder="Type" value={type} onChange={(e) => setType(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(vehicles.data ?? []).map((v: Vehicle) => (
            <li key={v.id} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium">{v.code}</span>
              <span className="text-muted-foreground">{v.plateNumber} · {v.type ?? '—'} · cap {v.seatedCapacity ?? '—'}</span>
            </li>
          ))}
          {vehicles.data && vehicles.data.length === 0 && <li className="text-muted-foreground">No vehicles yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function RoutesTab() {
  const routes = useRoutes();
  const create = useCreateRoute();
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const add = async () => {
    if (!name) { notify.error('Name required'); return; }
    try { await create.mutateAsync({ name, monthlyFee: fee ? Number(fee) : undefined }); notify.success('Route added'); setName(''); setFee(''); }
    catch { notify.error('Failed to add route'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Routes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="w-48" placeholder="Route name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="w-36" type="number" placeholder="Monthly fee" value={fee} onChange={(e) => setFee(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(routes.data ?? []).map((r: Route) => (
            <li key={r.id} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium">{r.name}</span>
              <span className="text-muted-foreground">{r.monthlyFee ? `${money(r.monthlyFee)}/mo` : '—'}</span>
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
  const routes = useRoutes();
  const create = useCreateStop();
  const [routeId, setRouteId] = useState('');
  const [name, setName] = useState('');
  const [order, setOrder] = useState('');
  const add = async () => {
    if (!routeId || !name) { notify.error('Route and name required'); return; }
    try { await create.mutateAsync({ routeId, name, order: order ? Number(order) : undefined }); notify.success('Stop added'); setName(''); setOrder(''); }
    catch { notify.error('Failed to add stop'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Stops</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select className={sel + ' w-48'} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">Route…</option>
            {(routes.data ?? []).map((r: Route) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Input className="w-48" placeholder="Stop name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="w-20" type="number" placeholder="Order" value={order} onChange={(e) => setOrder(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(stops.data ?? [])
            .slice()
            .sort((a: Stop, b: Stop) => (a.order ?? 0) - (b.order ?? 0))
            .map((s: Stop) => (
              <li key={s.id} className="flex items-center justify-between rounded border p-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">#{s.order ?? '—'}{s.pickupTime ? ` · ${s.pickupTime}` : ''}</span>
              </li>
            ))}
          {stops.data && stops.data.length === 0 && <li className="text-muted-foreground">No stops yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function StudentAssignTab() {
  const assignments = useStudentTransportAssignments();
  const routes = useRoutes();
  const stops = useStops();
  const students = useStudents({ pageSize: 200 });
  const terms = useTerms();
  const assign = useAssignStudentTransport();
  const [studentProfileId, setStudentProfileId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [termId, setTermId] = useState('');
  const [fee, setFee] = useState('');
  const add = async () => {
    if (!studentProfileId || !routeId || !stopId || !termId) { notify.error('Student, route, stop and term required'); return; }
    try {
      await assign.mutateAsync({ studentProfileId, routeId, stopId, termId, startDate: today(), monthlyFee: fee ? Number(fee) : undefined });
      notify.success('Student assigned'); setStudentProfileId(''); setRouteId(''); setStopId(''); setTermId(''); setFee('');
    } catch { notify.error('Failed to assign'); }
  };
  const routeStops = (stops.data ?? []).filter((s: Stop) => s.routeId === routeId);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Student Transport Assignments</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
            <option value="">Student…</option>
            {(students.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.partner?.name ?? s.admissionNo} ({s.admissionNo})</option>
            ))}
          </select>
          <select className={sel} value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(''); }}>
            <option value="">Route…</option>
            {(routes.data ?? []).map((r: Route) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className={sel} value={stopId} onChange={(e) => setStopId(e.target.value)}>
            <option value="">Stop…</option>
            {routeStops.map((s: Stop) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Term…</option>
            {(terms.data?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Input type="number" placeholder="Monthly fee" value={fee} onChange={(e) => setFee(e.target.value)} />
          <Button size="sm" className="w-full md:w-auto" onClick={add}><Plus className="mr-1 h-4 w-4" />Assign student</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(assignments.data ?? []).map((a: StudentTransportAssignment) => (
            <li key={a.id} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium">{a.student?.partner?.name ?? a.studentProfileId.slice(0, 8)}</span>
              <span className="text-muted-foreground">{a.route?.name ?? a.routeId} · {a.stop?.name ?? a.stopId} · {a.monthlyFee ? `${money(a.monthlyFee)}/mo` : '—'}</span>
            </li>
          ))}
          {assignments.data && assignments.data.length === 0 && <li className="text-muted-foreground">No student assignments yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
