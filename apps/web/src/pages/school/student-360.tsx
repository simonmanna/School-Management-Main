import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStudent, useStudentPortal, useGuardians, useStudentStatement, useStudentAttendance,
  useStudentDocuments, useStudentMedical, useUpsertStudentMedical,
  useStudentLibrary, useStudentMeals, useStudentTransport, useStudentActivities,
  useCreateGuardian, useUpdateGuardian, useDeleteGuardian, useUpdateStudent,
  type FeeStatement, type Guardian,
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
import { Trash2, Pencil, Plus, Camera, User, GraduationCap, Wallet, HeartPulse, Activity, Archive, Users, CalendarCheck } from 'lucide-react';
import { notify } from '@/lib/notify';

const money = (n: number | string | null | undefined) => `UGX ${Number(n ?? 0).toLocaleString()}`;
const initials = (name?: string) => (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

const STATUS_META: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-amber-100 text-amber-700',
  transferred: 'bg-sky-100 text-sky-700',
  withdrawn: 'bg-rose-100 text-rose-700',
  alumni: 'bg-slate-100 text-slate-700',
};

export function SchoolStudent360Page() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: student, isLoading } = useStudent(id);
  const { data: portal } = useStudentPortal(id);
  const { data: statement } = useStudentStatement(id);
  const { data: attendance } = useStudentAttendance(id);
  const { data: documents } = useStudentDocuments(id);
  const { data: medical } = useStudentMedical(id);
  const { data: library } = useStudentLibrary(id);
  const { data: meals } = useStudentMeals(id);
  const { data: transport } = useStudentTransport(id);
  const { data: activities } = useStudentActivities(id);
  const updateStudent = useUpdateStudent();
  const updatePartner = useUpdatePartner();

  const [tab, setTab] = useState('profile');
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Bio-edit local state
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [nationality, setNationality] = useState('');
  const [religion, setReligion] = useState('');
  const [house, setHouse] = useState('');
  const [residenceType, setResidenceType] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bioBusy, setBioBusy] = useState(false);

  const cf = ((student as any)?.customFields ?? {}) as any;
  const photo = (student?.partner as any)?.customFields?.photoUrl as string | undefined;

  const openBio = () => {
    setName(student?.partner?.name ?? '');
    setDateOfBirth((cf.dateOfBirth ?? student?.dateOfBirth ?? '').toString().slice(0, 10));
    setGender(student?.gender ?? '');
    setNationality((student as any)?.nationality ?? '');
    setReligion((student as any)?.religion ?? '');
    setHouse(cf.house ?? '');
    setResidenceType(student?.residenceType ?? '');
    setEmail(student?.partner?.email ?? '');
    setPhone(student?.partner?.phone ?? '');
    setBioOpen(true);
  };

  const onPhotoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const savePhoto = async () => {
    if (!photoPreview || !student?.partnerId) return;
    setPhotoBusy(true);
    try {
      const existing = (student.partner as any)?.customFields ?? {};
      await updatePartner.mutateAsync({
        id: student.partnerId,
        data: { customFields: { ...existing, photoUrl: photoPreview } } as any,
      });
      qc.invalidateQueries({ queryKey: ['school', 'student', id] });
      notify.success('Profile photo updated');
      setPhotoOpen(false);
      setPhotoPreview('');
    } catch {
      notify.error('Photo update failed');
    } finally {
      setPhotoBusy(false);
    }
  };

  const saveBio = async () => {
    if (!student) return;
    setBioBusy(true);
    try {
      await updateStudent.mutateAsync({
        id: student.id,
        dto: { dateOfBirth, gender, nationality, religion, house, residenceType } as any,
      });
      if (student.partnerId) {
        await updatePartner.mutateAsync({
          id: student.partnerId,
          data: { name, email: email || undefined, phone: phone || undefined },
        });
      }
      qc.invalidateQueries({ queryKey: ['school', 'student', id] });
      notify.success('Bio data updated');
      setBioOpen(false);
    } catch {
      notify.error('Update failed');
    } finally {
      setBioBusy(false);
    }
  };

  const archive = async () => {
    if (!student) return;
    if (!confirm(`Archive ${student.partner?.name}? This sets the student to withdrawn.`)) return;
    setArchiving(true);
    try {
      await updateStudent.mutateAsync({ id: student.id, dto: { status: 'withdrawn', reason: 'Archived from profile' } });
      qc.invalidateQueries({ queryKey: ['school', 'student', id] });
      notify.success('Student archived');
    } catch {
      notify.error('Archive failed');
    } finally {
      setArchiving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading student…</div>;
  if (!student) return <div className="p-6 text-sm text-muted-foreground">Student not found. <Link className="text-primary underline" to="/school/students">Back to students</Link></div>;

  const TABS = [
    { value: 'profile', label: 'Profile', icon: User },
    { value: 'guardians', label: 'Guardians', icon: Users },
    { value: 'academic', label: 'Academic', icon: GraduationCap },
    { value: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { value: 'financial', label: 'Financial', icon: Wallet },
    { value: 'wellbeing', label: 'Wellbeing', icon: HeartPulse },
    { value: 'engagement', label: 'Engagement', icon: Activity },
  ] as const;

  return (
    <div className="space-y-4 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/school/students')}>← Students</Button>

      {/* Identity header */}
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:text-left">
          <div className="relative">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-semibold">
              {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(student.partner?.name)}
            </div>
            <button
              onClick={() => setPhotoOpen(true)}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground shadow flex items-center gap-1"
            >
              <Camera className="h-3 w-3" /> Change Photo
            </button>
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold">{student.partner?.name}</h1>
            <p className="font-mono text-xs text-muted-foreground">{student.admissionNo} · ID {student.id.slice(0, 8)}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs sm:justify-start">
              <Badge className={STATUS_META[student.status] ?? 'bg-slate-100'}>{student.status}</Badge>
              {student.currentClass?.name && <Badge variant="secondary">Class {student.currentClass.name}</Badge>}
              {cf.house && <Badge variant="outline">House {cf.house}</Badge>}
              {student.residenceType && <Badge variant="outline" className="capitalize">{student.residenceType}</Badge>}
              {student.gender && <Badge variant="outline" className="capitalize">{student.gender}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab strip — icon + text, blue underline on active */}
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
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Left column — Academic information */}
            <SectionCard title="Academic Information">
              <Field label="Registration no." value={student.partner?.code ?? '—'} />
              <Field label="Admission no." value={student.admissionNo} />
              <Field label="Class" value={student.currentClass?.name ?? '—'} />
              <Field label="Section" value={student.currentSectionId ? student.currentSectionId.slice(0, 6) : '—'} />
              <Field label="House" value={cf.house ?? '—'} />
              <Field label="Residential status" value={student.residenceType ?? '—'} />
              <Field label="Entry status" value={student.status} />
              <Field label="Admission date" value={fmtDate(student.enrollmentDate)} />
              <Field label="School payment code" value={student.partner?.code ?? '—'} />
            </SectionCard>

            {/* Right column — Bio data + guardians */}
            <div className="space-y-4">
              <SectionCard
                title="Student Bio Data"
                actions={
                  <>
                    <Button size="sm" variant="ghost" className="text-emerald-600" onClick={openBio}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={archive} disabled={archiving}><Archive className="mr-1 h-4 w-4" />Archive</Button>
                  </>
                }
              >
                <Field label="Full name" value={student.partner?.name} />
                <Field label="Date of birth" value={cf.dateOfBirth ?? student.dateOfBirth ?? '—'} />
                <Field label="Gender" value={student.gender ?? '—'} />
                <Field label="Religion" value={(student as any).religion ?? '—'} />
                <Field label="Nationality" value={(student as any).nationality ?? '—'} />
                <Field label="Email" value={student.partner?.email ?? '—'} />
                <Field label="Phone" value={student.partner?.phone ?? '—'} />
              </SectionCard>
            </div>
          </div>
        </TabsContent>

        {/* ───────────────────────── Guardians ───────────────────────── */}
        <TabsContent value="guardians" className="pt-4">
          <SectionCard title="Guardian Details">
            <GuardianManager studentProfileId={student.id} />
            {cf.emergencyContact && <p className="mt-2 text-xs text-muted-foreground">Emergency contact: {cf.emergencyContact}</p>}
            {cf.siblings && <p className="mt-1 text-xs text-muted-foreground">Siblings on roll: {cf.siblings}</p>}
          </SectionCard>
        </TabsContent>

        {/* ───────────────────────── Academic ───────────────────────── */}
        <TabsContent value="academic" className="space-y-4 pt-4">
          <AcademicsTab portal={portal} />
          <AssessmentsTab portal={portal} />
          <LibraryTab rows={library} />
        </TabsContent>

        {/* ───────────────────────── Attendance ───────────────────────── */}
        <TabsContent value="attendance" className="space-y-4 pt-4">
          <AttendanceTab summary={attendance} />
        </TabsContent>

        {/* ───────────────────────── Financial ───────────────────────── */}
        <TabsContent value="financial" className="space-y-4 pt-4">
          <FinancialTab statement={statement} />
        </TabsContent>

        {/* ───────────────────────── Wellbeing ───────────────────────── */}
        <TabsContent value="wellbeing" className="space-y-4 pt-4">
          <HealthTab medical={medical} studentProfileId={id} />
          <TransportTab rows={transport} />
          <MealsTab wallet={meals} />
        </TabsContent>

        {/* ───────────────────────── Engagement ───────────────────────── */}
        <TabsContent value="engagement" className="space-y-4 pt-4">
          <BehaviorTab activities={activities} />
          <CommunicationTab activities={activities} />
          <ActivitiesTab activities={activities} />
          <DocumentsTab docs={documents} />
        </TabsContent>
      </Tabs>

      {/* Change Photo dialog */}
      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change profile photo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="h-24 w-24 overflow-hidden rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold">
                {photoPreview ? <img src={photoPreview} alt="" className="h-full w-full object-cover" /> : (photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(student.partner?.name))}
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

      {/* Edit Bio Data dialog */}
      <Dialog open={bioOpen} onOpenChange={setBioOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit student bio data</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date of birth</Label><Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} /></div>
              <div><Label>Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nationality</Label><Input value={nationality} onChange={(e) => setNationality(e.target.value)} /></div>
              <div><Label>Religion</Label><Input value={religion} onChange={(e) => setReligion(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>House</Label><Input value={house} onChange={(e) => setHouse(e.target.value)} /></div>
              <div><Label>Residence</Label>
                <Select value={residenceType} onValueChange={setResidenceType}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="boarder">Boarder</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={saveBio} disabled={bioBusy || !name.trim()}>{bioBusy ? 'Saving…' : 'Save changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────── Shared blocks ───────────────────────── */

function SectionCard({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base text-primary">{title}</CardTitle>
        {actions && <div className="flex gap-1">{actions}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize">{value ?? '—'}</span>
    </div>
  );
}

/* ───────────────────────── Guardians ───────────────────────── */

const RELATIONSHIPS = ['father', 'mother', 'uncle', 'aunt', 'sibling', 'grandparent', 'guardian', 'other'] as const;

function GuardianManager({ studentProfileId }: { studentProfileId: string }) {
  const { data: guardians, isLoading } = useGuardians(studentProfileId);
  const createG = useCreateGuardian();
  const updateG = useUpdateGuardian();
  const deleteG = useDeleteGuardian();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Guardian | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState<string>('father');
  const [isPrimary, setIsPrimary] = useState(false);
  const [canPickup, setCanPickup] = useState(true);
  const [receivesStatements, setReceivesStatements] = useState(true);
  const [busy, setBusy] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setFirstName(''); setLastName(''); setEmail(''); setPhone('');
    setRelationship('father'); setIsPrimary(false); setCanPickup(true); setReceivesStatements(true);
    setOpen(true);
  };
  const openEdit = (g: Guardian) => {
    setEditing(g);
    setFirstName(g.contact?.firstName ?? '');
    setLastName(g.contact?.lastName ?? '');
    setEmail(g.contact?.email ?? '');
    setPhone(g.contact?.phone ?? '');
    setRelationship(g.relationship);
    setIsPrimary(g.isPrimary);
    setCanPickup(g.canPickup);
    setReceivesStatements(g.receivesStatements);
    setOpen(true);
  };

  const save = async () => {
    if (!firstName.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await updateG.mutateAsync({
          id: editing.id, studentProfileId,
          relationship, isPrimary, canPickup, receivesStatements,
          guardian: { firstName: firstName.trim(), lastName: lastName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined },
        });
      } else {
        await createG.mutateAsync({
          studentProfileId, relationship, isPrimary, canPickup, receivesStatements,
          guardian: { firstName: firstName.trim(), lastName: lastName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined },
        });
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g: Guardian) => {
    if (!confirm(`Remove ${g.contact?.firstName} ${g.contact?.lastName ?? ''} as guardian?`)) return;
    await deleteG.mutateAsync({ id: g.id, studentProfileId });
  };

  return (
    <div className="space-y-2">
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      <ul className="space-y-2 text-sm">
        {(guardians ?? []).length === 0 && !isLoading && <li className="text-muted-foreground">No parents/guardians linked yet.</li>}
        {(guardians ?? []).map((g) => (
          <li key={g.id} className="rounded-md border p-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{g.contact?.firstName} {g.contact?.lastName ?? ''}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {g.relationship}{g.isPrimary ? ' · primary' : ''}{g.canPickup ? ' · pickup' : ''}{g.receivesStatements ? ' · statements' : ''}
                </div>
                <div className="text-xs text-muted-foreground">{g.contact?.phone ?? 'no phone'}{g.contact?.email ? ` · ${g.contact.email}` : ''}</div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" onClick={() => remove(g)} title="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={openAdd}><Plus className="mr-1 h-4 w-4" />Add parent / guardian</Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit parent / guardian' : 'Add parent / guardian'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. John" /></div>
              <div><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="e.g. Okello" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256…" /></div>
              <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" /></div>
            </div>
            <div><Label>Relationship</Label>
              <Select value={relationship} onValueChange={setRelationship}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={canPickup} onChange={(e) => setCanPickup(e.target.checked)} /> Can pick up</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={receivesStatements} onChange={(e) => setReceivesStatements(e.target.checked)} /> Receives statements</label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={save} disabled={busy || !firstName.trim()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add guardian'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────── Academic / Attendance / etc ───────────────────────── */

function AcademicsTab({ portal }: { portal?: any }) {
  if (!portal?.publishedResults) return <Card><CardContent className="p-6"><Empty label="No published results yet — compute & publish a result set first." /></CardContent></Card>;
  const r = portal.publishedResults;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Published results — Term {r.termId?.slice(0, 6)}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Mean %" value={r.meanPercent != null ? Number(r.meanPercent).toFixed(1) : '—'} />
        <Stat label="Class rank" value={r.classRank != null ? `#${r.classRank}` : '—'} />
        <Stat label="Recommendation" value={r.promotionRecommendation ?? '—'} />
      </CardContent>
    </Card>
  );
}

function AssessmentsTab({ portal }: { portal?: any }) {
  const list = portal?.assignments ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Assignments</CardTitle></CardHeader>
      <CardContent>
        {list.length === 0 && <Empty label="No assignments fanned out to this student yet." />}
        <ul className="space-y-2 text-sm">
          {list.map((a: any) => <li key={a.id} className="rounded-md border p-2 flex justify-between"><span>{a.title}</span><Badge variant="outline">{a.status}</Badge></li>)}
        </ul>
      </CardContent>
    </Card>
  );
}

function AttendanceTab({ summary }: { summary?: any }) {
  if (!summary) return <Card><CardContent className="p-6"><Empty label="No attendance records in range." /></CardContent></Card>;
  const total = summary.total ?? 0;
  const present = summary.present ?? 0;
  const late = summary.late ?? 0;
  const absent = summary.absent ?? 0;
  const rate = typeof summary.attendanceRate === 'number' ? summary.attendanceRate : (total ? ((present + late * 0.5) / total) * 100 : 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Attendance · last 90 days</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-4 gap-3 text-center">
        <Stat label="Present" value={String(present)} />
        <Stat label="Late" value={String(late)} />
        <Stat label="Absent" value={String(absent)} />
        <Stat label="Rate" value={`${Number(rate).toFixed(1)}%`} tone={rate >= 75 ? 'emerald' : 'rose'} />
      </CardContent>
      <CardContent className="text-xs text-muted-foreground">Total marked days: {total}. Rate weights late as half-present.</CardContent>
    </Card>
  );
}

function FinancialTab({ statement }: { statement?: FeeStatement }) {
  if (!statement) return <Card><CardContent className="p-6"><Empty label="No fee statement." /></CardContent></Card>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Fees summary</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Billed" value={money(statement.totalBilled)} />
          <Stat label="Paid" value={money(statement.totalPaid)} />
          <Stat label="Balance" value={money(statement.balance)} tone={statement.balance > 0 ? 'rose' : 'emerald'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoices</CardTitle></CardHeader>
        <CardContent>
          {statement.invoices.length === 0 && <Empty label="No invoices issued." />}
          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Document</th><th className="px-2 py-1">Issue date</th><th className="px-2 py-1">Amount</th><th className="px-2 py-1">Balance</th><th className="px-2 py-1">Status</th></tr></thead>
              <tbody>
                {statement.invoices.map((inv: any) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="px-2 py-1">{inv.documentNumber}</td>
                    <td className="px-2 py-1">{fmtDate(inv.issueDate)}</td>
                    <td className="px-2 py-1">{money(inv.totalAmount)}</td>
                    <td className="px-2 py-1">{money(inv.amountResidual)}</td>
                    <td className="px-2 py-1 capitalize">{inv.paymentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent>
          {statement.payments.length === 0 && <Empty label="No payments recorded." />}
          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Payment</th><th className="px-2 py-1">Date</th><th className="px-2 py-1">Method</th><th className="px-2 py-1">Amount</th></tr></thead>
              <tbody>
                {statement.payments.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-2 py-1">{p.paymentNumber}</td>
                    <td className="px-2 py-1">{fmtDate(p.paymentDate)}</td>
                    <td className="px-2 py-1 capitalize">{p.paymentMethod}</td>
                    <td className="px-2 py-1">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentsTab({ docs }: { docs?: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
      <CardContent>
        {!docs || docs.length === 0 ? <Empty label="No documents uploaded." /> :
          <ul className="space-y-2 text-sm">{docs.map((d) => (
            <li key={d.id} className="rounded-md border p-2 flex justify-between"><span>{d.name ?? d.type ?? 'Document'}</span>{d.verified ? <Badge>verified</Badge> : <Badge variant="secondary">pending</Badge>}</li>
          ))}</ul>}
      </CardContent>
    </Card>
  );
}

function HealthTab({ medical, studentProfileId }: { medical?: any; studentProfileId?: string }) {
  const upsert = useUpsertStudentMedical();
  const [allergies, setAllergies] = useState('');
  const [dietary, setDietary] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (medical) { setAllergies((medical.allergies ?? []).join(', ')); setDietary((medical.dietaryRequirements ?? []).join(', ')); }
  }, [medical]);
  if (!medical) return <Card><CardContent className="p-6"><Empty label="No medical record." /></CardContent></Card>;
  const save = async () => {
    try {
      await upsert.mutateAsync({
        studentProfileId: studentProfileId!,
        allergies: allergies.split(',').map((s) => s.trim()).filter(Boolean),
        dietaryRequirements: dietary.split(',').map((s) => s.trim()).filter(Boolean),
        conditions: medical.conditions ?? [],
        medications: medical.medications ?? [],
        bloodGroup: medical.bloodGroup ?? undefined,
        emergencyNotes: medical.emergencyNotes ?? undefined,
      });
      notify.success('Health info updated'); setEditing(false);
    } catch { notify.error('Update failed'); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Health</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>{editing ? 'Cancel' : 'Edit'}</Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Field label="Blood group" value={medical.bloodGroup ?? '—'} />
        {editing ? (
          <>
            <div className="space-y-1"><Label className="text-xs">Allergies (comma-separated)</Label><Input value={allergies} onChange={(e) => setAllergies(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Dietary requirements (comma-separated)</Label><Input value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder="vegetarian, halal, no-pork, diabetic" /></div>
            <Button size="sm" onClick={save} disabled={upsert.isPending}>Save</Button>
          </>
        ) : (
          <>
            <Field label="Allergies" value={(medical.allergies ?? []).join(', ') || '—'} />
            <Field label="Dietary requirements" value={(medical.dietaryRequirements ?? []).join(', ') || '—'} />
          </>
        )}
        <Field label="Conditions" value={(medical.conditions ?? []).join(', ') || '—'} />
        <Field label="Notes" value={medical.notes ?? '—'} />
      </CardContent>
    </Card>
  );
}

function BehaviorTab({ activities }: { activities?: any[] }) {
  const rows = (activities ?? []).filter((a) => a.type === 'note');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Behaviour & conduct</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 && <Empty label="No behaviour records." />}
        <ul className="space-y-2 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="rounded-md border p-2">
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.body}</div>
              <div className="mt-1 text-xs text-muted-foreground">{new Date(a.occurredAt).toLocaleDateString()}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CommunicationTab({ activities }: { activities?: any[] }) {
  const rows = (activities ?? []).filter((a) => a.type === 'email' || a.type === 'call');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Communication with guardians</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 && <Empty label="No communication logs." />}
        <ul className="space-y-2 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="rounded-md border p-2 flex justify-between">
              <div>
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-muted-foreground">{a.body}{a.duration ? ` · ${a.duration} min` : ''}</div>
              </div>
              <Badge variant="outline" className="capitalize">{a.type}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActivitiesTab({ activities }: { activities?: any[] }) {
  const rows = (activities ?? []).filter((a) => a.type === 'task');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Clubs & co-curricular</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 && <Empty label="No co-curricular activities recorded." />}
        <ul className="space-y-2 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="rounded-md border p-2 flex justify-between">
              <div>
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-muted-foreground">{a.body}</div>
              </div>
              {a.completed && <Badge>active</Badge>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TransportTab({ rows }: { rows?: any[] }) {
  if (!rows || rows.length === 0) return <Card><CardContent className="p-6"><Empty label="No transport assignment for this student." /></CardContent></Card>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Transport</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-md border p-3">
            <div className="font-medium">{t.route?.name ?? 'Route'}</div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>Stop: {t.stop?.name ?? '—'}</span>
              <span>Pickup: {t.stop?.pickupTime ?? '—'}</span>
              <span>Monthly fee: {money(t.monthlyFee)}</span>
              <span>From: {fmtDate(t.startDate)}</span>
            </div>
            <div className="mt-2"><Badge variant={t.isActive ? 'default' : 'secondary'}>{t.isActive ? 'active' : 'ended'}</Badge></div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MealsTab({ wallet }: { wallet?: any }) {
  if (!wallet || !wallet.exists) return <Card><CardContent className="p-6"><Empty label="No meal account for this student." /></CardContent></Card>;
  const txns = wallet.transactions ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Meals — {wallet.mealPlan?.name ?? 'Wallet'}</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-3"><Stat label="Wallet balance" value={money(wallet.balance)} /></div>
        <div className="max-h-80 overflow-y-auto scroll-thin">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Date</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Amount</th><th className="px-2 py-1">Balance</th></tr></thead>
            <tbody>
              {txns.map((t: any) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-2 py-1">{fmtDate(t.createdAt)}</td>
                  <td className="px-2 py-1 capitalize">{t.type}</td>
                  <td className="px-2 py-1">{money(t.amount)}</td>
                  <td className="px-2 py-1">{money(t.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function LibraryTab({ rows }: { rows?: any[] }) {
  if (!rows || rows.length === 0) return <Card><CardContent className="p-6"><Empty label="No borrowings for this student." /></CardContent></Card>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Library — {rows.length} borrowing(s)</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((b) => (
          <div key={b.id} className="rounded-md border p-3">
            <div className="font-medium">{b.bookMetadata?.title ?? 'Book'}</div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>Borrowed: {fmtDate(b.borrowedAt)}</span>
              <span>Due: {fmtDate(b.dueAt)}</span>
              {b.returnedAt && <span>Returned: {fmtDate(b.returnedAt)}</span>}
              {Number(b.fineAmount) > 0 && <span className="text-rose-600">Fine: {money(b.fineAmount)}</span>}
            </div>
            <div className="mt-2"><Badge variant={b.status === 'returned' ? 'secondary' : b.status === 'overdue' ? 'destructive' : 'default'} className="capitalize">{b.status}</Badge></div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-muted-foreground">{label}</p>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{label}</div><div className={`font-semibold ${tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : ''}`}>{value}</div></div>;
}
