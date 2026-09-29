import { useState } from 'react';
import { BedDouble, BedSingle, DoorOpen, Home, LogOut, Plus, Wrench } from 'lucide-react';
import { useStudents } from '@/features/school/api';
import {
  useAllocateBed, useCheckoutBed, useCreateBed, useCreateDormitory, useCreateRoom, useHostelOccupancy, useSetBedStatus,
  type HostelBed, type HostelDorm,
} from '@/features/school/hostel-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { useHasPermission } from '@/features/school/rbac/use-has-permission';
import { PERMISSIONS } from '@erp/shared';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);
const msg = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/**
 * Wave 16 — the boarding house, as the matron sees it: every dormitory, room
 * and bed, who is in it, and the two things she does all day — put a pupil in
 * a bed and check them out. A bed checked out is free for the next pupil; the
 * allocation history stays.
 */
export function SchoolHostelPage() {
  const { data: dorms, isLoading } = useHostelOccupancy();
  const canManage = useHasPermission(PERMISSIONS.school.manageHostel);
  const total = (dorms ?? []).reduce((a, d) => ({ beds: a.beds + d.beds, occupied: a.occupied + d.occupied }), { beds: 0, occupied: 0 });

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Home className="h-5 w-5" /> Boarding</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${total.occupied} of ${total.beds} beds occupied across ${dorms?.length ?? 0} dormitories.`}
        </p>
      </div>
      {canManage && <NewDormitory />}
      {(dorms ?? []).map((d) => <DormCard key={d.id} dorm={d} canManage={canManage} />)}
      {!isLoading && (dorms ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">No dormitories yet. Add one to start allocating beds.</p>
      )}
    </div>
  );
}

function NewDormitory() {
  const create = useCreateDormitory();
  const [name, setName] = useState('');
  const [gender, setGender] = useState('girls');
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-2 p-4">
        <label className="space-y-1 text-sm"><span className="text-muted-foreground">New dormitory</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nile House" /></label>
        <select className={sel} value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Who it houses">
          <option value="girls">Girls</option><option value="boys">Boys</option><option value="mixed">Mixed</option>
        </select>
        <Button size="sm" disabled={!name.trim() || create.isPending} onClick={async () => {
          try { await create.mutateAsync({ name: name.trim(), gender }); setName(''); notify.success('Dormitory added'); }
          catch (e) { notify.error(msg(e, 'Could not add the dormitory')); }
        }}><Plus className="h-4 w-4" /> Add</Button>
      </CardContent>
    </Card>
  );
}

function DormCard({ dorm, canManage }: { dorm: HostelDorm; canManage: boolean }) {
  const createRoom = useCreateRoom();
  const [roomNo, setRoomNo] = useState('');
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{dorm.name} <span className="text-sm font-normal capitalize text-muted-foreground">· {dorm.gender}</span></CardTitle>
        <Badge variant="secondary">{dorm.occupied}/{dorm.beds} occupied</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {dorm.rooms.map((r) => (
          <div key={r.id} className="rounded border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium"><DoorOpen className="h-4 w-4" /> Room {r.number}</span>
              {canManage && <AddBed roomId={r.id} next={String.fromCharCode(65 + r.beds.length)} />}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {r.beds.map((b) => <BedTile key={b.id} bed={b} canManage={canManage} />)}
              {r.beds.length === 0 && <p className="text-xs text-muted-foreground">No beds in this room yet.</p>}
            </div>
          </div>
        ))}
        {canManage && (
          <div className="flex gap-2">
            <Input className="max-w-40" value={roomNo} onChange={(e) => setRoomNo(e.target.value)} placeholder="Room number" />
            <Button size="sm" variant="outline" disabled={!roomNo.trim() || createRoom.isPending} onClick={async () => {
              try { await createRoom.mutateAsync({ dormitoryId: dorm.id, number: roomNo.trim() }); setRoomNo(''); }
              catch (e) { notify.error(msg(e, 'Could not add the room')); }
            }}><Plus className="h-4 w-4" /> Room</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddBed({ roomId, next }: { roomId: string; next: string }) {
  const create = useCreateBed();
  return (
    <Button size="sm" variant="ghost" disabled={create.isPending} onClick={async () => {
      try { await create.mutateAsync({ roomId, number: next }); }
      catch (e) { notify.error(msg(e, 'Could not add the bed')); }
    }}><Plus className="h-3.5 w-3.5" /> Bed {next}</Button>
  );
}

function BedTile({ bed, canManage }: { bed: HostelBed; canManage: boolean }) {
  const allocate = useAllocateBed();
  const checkout = useCheckoutBed();
  const setStatus = useSetBedStatus();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const { data: students } = useStudents({ pageSize: 20, search: search || undefined });
  const Icon = bed.allocation ? BedDouble : BedSingle;

  return (
    <div className={`rounded border p-2 text-sm ${bed.allocation ? 'bg-muted/40' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium"><Icon className="h-4 w-4" /> Bed {bed.number}</span>
        {!bed.allocation && bed.status !== 'available' && <Badge variant="outline" className="capitalize">{bed.status}</Badge>}
      </div>
      {bed.allocation ? (
        <div className="pt-1">
          <div>{bed.allocation.name} <span className="text-xs text-muted-foreground">{bed.allocation.admissionNo}</span></div>
          <div className="text-xs text-muted-foreground">since {new Date(bed.allocation.startDate).toLocaleDateString()}</div>
          {canManage && (
            <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" disabled={checkout.isPending} onClick={async () => {
              if (!window.confirm(`Check ${bed.allocation!.name} out of bed ${bed.number}?`)) return;
              try { await checkout.mutateAsync({ id: bed.allocation!.id, checkOutDate: today() }); notify.success('Checked out — the bed is free'); }
              catch (e) { notify.error(msg(e, 'Could not check out')); }
            }}><LogOut className="h-3.5 w-3.5" /> Check out</Button>
          )}
        </div>
      ) : canManage && bed.status === 'available' ? (
        picking ? (
          <div className="space-y-1 pt-1">
            <Input className="h-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pupil…" autoFocus />
            <div className="max-h-40 overflow-y-auto">
              {(students?.data ?? []).map((s) => (
                <button key={s.id} type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={async () => {
                    try { await allocate.mutateAsync({ bedId: bed.id, studentProfileId: s.id, startDate: today() }); setPicking(false); notify.success(`${s.partner?.name} placed in bed ${bed.number}`); }
                    catch (e) { notify.error(msg(e, 'Could not allocate the bed')); }
                  }}>
                  {s.partner?.name} · {s.admissionNo}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPicking(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex gap-1 pt-1">
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPicking(true)}>Allocate</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Mark for maintenance" onClick={() => setStatus.mutate({ id: bed.id, status: 'maintenance' })}><Wrench className="h-3.5 w-3.5" /></Button>
          </div>
        )
      ) : canManage && bed.status === 'maintenance' ? (
        <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={() => setStatus.mutate({ id: bed.id, status: 'available' })}>Back in use</Button>
      ) : (
        <div className="pt-1 text-xs text-muted-foreground">Free</div>
      )}
    </div>
  );
}
