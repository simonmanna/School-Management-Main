import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStaffById, useDepartments, usePositions, useCampuses,
  useUpdateStaff,
} from '@/features/school/api';
import { useUpdatePartner } from '@/features/partners/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Camera, User, Briefcase, Save, Shield } from 'lucide-react';
import { notify } from '@/lib/notify';

const initials = (name?: string) => (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

const STATUS_META: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  on_leave: 'bg-amber-100 text-amber-700',
  suspended: 'bg-rose-100 text-rose-700',
  terminated: 'bg-slate-100 text-slate-700',
  retired: 'bg-slate-100 text-slate-700',
};

const CAT_META: Record<string, string> = {
  teaching: 'bg-emerald-100 text-emerald-700',
  non_teaching: 'bg-sky-100 text-sky-700',
  support: 'bg-amber-100 text-amber-700',
  admin: 'bg-violet-100 text-violet-700',
};

export function SchoolStaff360Page() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: staff, isLoading } = useStaffById(id);
  const updateStaff = useUpdateStaff();
  const updatePartner = useUpdatePartner();

  const { data: departments } = useDepartments();
  const { data: positions } = usePositions();
  const { data: campuses } = useCampuses();

  const [tab, setTab] = useState('profile');
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  // Editable form fields
  const [employeeNo, setEmployeeNo] = useState('');
  const [staffCategory, setStaffCategory] = useState('teaching');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [joinDate, setJoinDate] = useState('');
  const [contractType, setContractType] = useState('');
  const [status, setStatus] = useState('active');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bioBusy, setBioBusy] = useState(false);

  // Populate the form from the loaded staff record.
  useEffect(() => {
    if (!staff) return;
    const s = staff as any;
    const p = staff.partner ?? ({} as any);
    const fullName = p.name ?? '';
    const idx = fullName.lastIndexOf(' ');
    setFirstName(idx >= 0 ? fullName.slice(0, idx) : fullName);
    setLastName(idx >= 0 ? fullName.slice(idx + 1) : '');
    setEmployeeNo(s.employeeNo);
    setStaffCategory(s.staffCategory ?? 'teaching');
    setDepartmentId(s.department?.id ?? '');
    setPositionId(s.position?.id ?? '');
    setCampusId(s.campus?.id ?? '');
    setJoinDate((s.joinDate ?? '').toString().slice(0, 10));
    setContractType(s.contractType ?? '');
    setStatus(s.status ?? 'active');
    setEmail(p.email ?? '');
    setPhone(p.phone ?? '');
  }, [staff]);

  const onPhotoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const savePhoto = async () => {
    if (!photoPreview || !staff?.partnerId) return;
    setPhotoBusy(true);
    try {
      const existing = (staff.partner as any)?.customFields ?? {};
      await updatePartner.mutateAsync({
        id: staff.partnerId,
        data: { customFields: { ...existing, photoUrl: photoPreview } } as any,
      });
      qc.invalidateQueries({ queryKey: ['school', 'staff', id] });
      notify.success('Profile photo updated');
      setPhotoOpen(false);
      setPhotoPreview('');
    } catch {
      notify.error('Photo update failed');
    } finally {
      setPhotoBusy(false);
    }
  };

  const saveInfo = async () => {
    if (!staff) return;
    if (!firstName.trim() || !lastName.trim()) {
      notify.error('First name and last name are required');
      return;
    }
    setBioBusy(true);
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      await updateStaff.mutateAsync({
        id: staff.id,
        dto: {
          employeeNo: employeeNo || undefined,
          staffCategory: staffCategory as any,
          departmentId: departmentId || undefined,
          positionId: positionId || undefined,
          campusId: campusId || undefined,
          joinDate: joinDate || undefined,
          contractType: contractType || undefined,
          status: status as any,
        } as any,
      });
      if (staff.partnerId) {
        await updatePartner.mutateAsync({
          id: staff.partnerId,
          data: { name, email: email || undefined, phone: phone || undefined },
        });
      }
      qc.invalidateQueries({ queryKey: ['school', 'staff', id] });
      qc.invalidateQueries({ queryKey: ['school', 'staff'] });
      notify.success('Staff information updated');
    } catch {
      notify.error('Update failed');
    } finally {
      setBioBusy(false);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading staff…</div>;
  if (!staff) return <div className="p-6 text-sm text-muted-foreground">Staff not found. <Link className="text-primary underline" to="/school/staff">Back to staff</Link></div>;

  const photo = (staff.partner as any)?.customFields?.photoUrl as string | undefined;

  const TABS = [
    { value: 'profile', label: 'Profile', icon: User },
    { value: 'employment', label: 'Employment', icon: Briefcase },
    { value: 'hr', label: 'HR Record', icon: Shield },
  ] as const;

  return (
    <div className="space-y-4 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/school/staff')}>← Staff</Button>

      {/* Identity header */}
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:text-left">
          <div className="relative">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-semibold">
              {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(staff.partner?.name)}
            </div>
            <button
              onClick={() => setPhotoOpen(true)}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground shadow flex items-center gap-1"
            >
              <Camera className="h-3 w-3" /> Change Photo
            </button>
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold">{staff.partner?.name}</h1>
            <p className="font-mono text-xs text-muted-foreground">{staff.employeeNo} · ID {staff.id.slice(0, 8)}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs sm:justify-start">
              <Badge className={STATUS_META[(staff.status ?? 'active')] ?? 'bg-slate-100'}>{(staff.status ?? 'active').replace('_', ' ')}</Badge>
              <Badge className={CAT_META[(staff.staffCategory ?? 'teaching')] ?? 'bg-slate-100'}>{(staff.staffCategory ?? 'teaching').replace('_', ' ')}</Badge>
              {staff.department && <Badge variant="secondary">Dept: {staff.department.name}</Badge>}
              {staff.position && <Badge variant="outline">Pos: {staff.position.name}</Badge>}
              {staff.campus && <Badge variant="outline" className="capitalize">{staff.campus.name}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        {/* ───────────────────────── Profile ───────────────────────── */}
        <TabsContent value="profile" className="pt-4">
          <div className="space-y-4">
            {/* Staff Information — editable */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base text-primary"><User className="h-4 w-4" /> Staff Information</CardTitle>
                <Button size="sm" onClick={saveInfo} disabled={bioBusy || !firstName.trim() || !lastName.trim()}>
                  <Save className="mr-1 h-4 w-4" /> {bioBusy ? 'Saving…' : 'Save changes'}
                </Button>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Employee No.</Label>
                    <Input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="E.g. EMP-001" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category <span className="text-rose-500">*</span></Label>
                    <Select value={staffCategory} onValueChange={(v) => setStaffCategory(v as any)}>
                      <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="teaching">Teaching</SelectItem>
                        <SelectItem value="non_teaching">Non-Teaching</SelectItem>
                        <SelectItem value="support">Support</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">First name <span className="text-rose-500">*</span></Label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="E.g. John" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Last name <span className="text-rose-500">*</span></Label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="E.g. Okello" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Department</Label>
                    <Select value={departmentId} onValueChange={setDepartmentId}>
                      <SelectTrigger><SelectValue placeholder="Choose department" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No department</SelectItem>
                        {(departments?.data ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Position</Label>
                    <Select value={positionId} onValueChange={setPositionId}>
                      <SelectTrigger><SelectValue placeholder="Choose position" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No position</SelectItem>
                        {(positions?.data ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Campus</Label>
                    <Select value={campusId} onValueChange={setCampusId}>
                      <SelectTrigger><SelectValue placeholder="Choose campus" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No campus</SelectItem>
                        {(campuses?.data ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Join date</Label>
                    <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Contract type</Label>
                    <Input value={contractType} onChange={(e) => setContractType(e.target.value)} placeholder="E.g. Permanent, Contract" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                      <SelectTrigger><SelectValue placeholder="Choose status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_leave">On Leave</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="terminated">Terminated</SelectItem>
                        <SelectItem value="retired">Retired</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256…" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Read-only identities / status */}
            <Card>
              <CardHeader><CardTitle className="text-base text-primary">System Information</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Partner ID</span><span className="font-medium ml-4">{staff.partnerId ?? '—'}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Employee No.</span><span className="font-medium ml-4">{staff.employeeNo}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Category</span><span className="font-medium ml-4">{staff.staffCategory?.replace('_', ' ')}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Join date</span><span className="font-medium ml-4">{fmtDate(staff.joinDate)}</span></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ───────────────────────── Employment ───────────────────────── */}
        <TabsContent value="employment" className="pt-4">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base text-primary">Employment Details</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Department</span><span className="font-medium ml-4">{staff.department?.name ?? '—'}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Position</span><span className="font-medium ml-4">{staff.position?.name ?? '—'}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Campus</span><span className="font-medium ml-4">{staff.campus?.name ?? '—'}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Contract type</span><span className="font-medium ml-4">{staff.contractType ?? '—'}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Status</span><span className="font-medium ml-4">{staff.status?.replace('_', ' ')}</span></div>
                <div className="border-b border-border/60 py-1.5"><span className="text-muted-foreground">Joined</span><span className="font-medium ml-4">{fmtDate(staff.joinDate)}</span></div>
              </CardContent>
            </Card>

            {/* Teaching assignments could go here */}
            <Card>
              <CardHeader><CardTitle className="text-base text-primary">Teaching Assignments</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Teaching assignment details would be shown here (linked to timetable/course offerings).</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ───────────────────────── HR Record ───────────────────────── */}
        <TabsContent value="hr" className="pt-4">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base text-primary">HR Employee Record</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  This staff member's HR record (payroll, leave, attendance, timesheets, reviews, advances, loans, etc.)
                  is managed in the HR module. <Link to="/hr/reconciliation" className="text-primary underline">Open HR reconciliation</Link>
                  to view or link the HR employee record.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" asChild><Link to="/hr/reconciliation">Open HR Reconciliation</Link></Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base text-primary">HR Summary</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">HR data (leave balances, payslips, attendance, reviews) is available in the HR module once the staff is bridged to an HR employee.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Change Photo dialog */}
      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change profile photo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="h-24 w-24 overflow-hidden rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold">
                {photoPreview ? <img src={photoPreview} alt="" className="h-full w-full object-cover" /> : (photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(staff.partner?.name))}
              </div>
            </div>
            <Input type="file" accept="image/*" onChange={onPhotoFile} />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={savePhoto} disabled={photoBusy || !photoPreview}>{photoBusy ? 'Saving…' : 'Save photo'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}