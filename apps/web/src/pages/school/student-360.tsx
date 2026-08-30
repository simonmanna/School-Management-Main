import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStudent, useStudentPortal, useGuardians, useStudentStatement, useStudentAttendance,
  useStudentDocuments, useStudentMedical, useUpsertStudentMedical,
  useStudentLibrary, useStudentMeals, useStudentTransport, useStudentActivities,
  useCreateGuardian, useUpdateGuardian, useDeleteGuardian, useUpdateStudent,
  useEnrollStudent, useSections, useSectionsForClass, useStudentEnrollments,
  useAcademicYears, useClasses, useAdmissionCycles, useNationalities, useStudentCategories,
  useTerms, useStudentResultSet,
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
import { Trash2, Pencil, Plus, Camera, User, GraduationCap, Wallet, HeartPulse, Activity, Users, CalendarCheck, Save } from 'lucide-react';
import { notify } from '@/lib/notify';
import { formatClass } from '@/lib/utils';

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

const RELIGIONS = ['Christian', 'Muslim', 'Hindu', 'Traditional', 'Other'];
const ENTRY_STATUSES = ['New entrant', 'Transfer', 'Re-admission', 'Returning'];

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
  const { data: terms } = useTerms();
  const { data: enrollments } = useStudentEnrollments(id);
  const updatePartner = useUpdatePartner();

  const [tab, setTab] = useState('profile');
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);

  // Editable "Student Information" form — mirrors the application form.
  const { data: years } = useAcademicYears();
  const { data: cycles } = useAdmissionCycles();
  const { data: nationalities } = useNationalities();
  const { data: studentCategories } = useStudentCategories();
  const { data: classes } = useClasses();

  const [fName, setFName] = useState('');
  const [lName, setLName] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [admissionCycleId, setAdmissionCycleId] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [nationality, setNationality] = useState('');
  const [entryStatus, setEntryStatus] = useState('');
  const [residenceType, setResidenceType] = useState('');
  const [studentCategoryId, setStudentCategoryId] = useState('');
  const [address, setAddress] = useState('');
  const [religion, setReligion] = useState('');
  const [nin, setNin] = useState('');
  const [learnerId, setLearnerId] = useState('');
  const [schoolPayCode, setSchoolPayCode] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);

  const cf = ((student as any)?.customFields ?? {}) as any;
  const photo = (student?.partner as any)?.customFields?.photoUrl as string | undefined;

  // Populate the form from the loaded student record.
  useEffect(() => {
    if (!student) return;
    const s = student as any;
    const p = student.partner ?? ({} as any);
    const fullName = p.name ?? '';
    const idx = fullName.lastIndexOf(' ');
    setFName(idx >= 0 ? fullName.slice(0, idx) : fullName);
    setLName(idx >= 0 ? fullName.slice(idx + 1) : '');
    setAcademicYearId(cf.academicYearId ?? '');
    setAdmissionCycleId(cf.admissionCycleId ?? '');
    setDateOfBirth((student.dateOfBirth ?? '').toString().slice(0, 10));
    setGender(student.gender ?? '');
    setNationality(s.nationality ?? '');
    setEntryStatus(cf.entryStatus ?? '');
    setResidenceType(student.residenceType ?? '');
    setStudentCategoryId(s.studentCategoryId ?? '');
    setAddress(cf.address ?? '');
    setReligion(s.religion ?? '');

    setNin(cf.nin ?? '');
    setLearnerId(cf.learnerId ?? '');
    setSchoolPayCode(cf.schoolPayCode ?? '');
    setEmail(p.email ?? '');
    setPhone(p.phone ?? '');
  }, [student]);

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

  // Names, not ids. The pupil record used to print a six-character slice of the
  // section UUID here, which told a head teacher nothing.
  const allSections = useSections();
  const sectionName = (sectionId?: string | null) =>
    sectionId ? (allSections.data?.data ?? []).find((x: any) => x.id === sectionId)?.name ?? null : null;
  const className = (classId?: string | null) =>
    classId ? (classes?.data ?? []).find((c: any) => c.id === classId)?.name ?? null : null;
  const placementLabel = student?.currentClassId
    ? [className(student.currentClassId), sectionName(student.currentSectionId)].filter(Boolean).join(' — ')
    : 'Not placed';

  const saveInfo = async () => {
    if (!student) return;
    if (!fName.trim() || !lName.trim()) {
      notify.error('First name and last name are required');
      return;
    }
    setBioBusy(true);
    try {
      const name = `${fName.trim()} ${lName.trim()}`.trim();
      const mergedCf = {
        ...cf,
        academicYearId: academicYearId || undefined,
        admissionCycleId: admissionCycleId || undefined,
        entryStatus: entryStatus || undefined,
        address: address || undefined,
        nin: nin || undefined,
        learnerId: learnerId || undefined,
        schoolPayCode: schoolPayCode || undefined,
      };
      await updateStudent.mutateAsync({
        id: student.id,
        dto: {
          name,
          dateOfBirth: dateOfBirth || undefined,
          gender: (gender || undefined) as any,
          nationality: nationality || undefined,
          religion: religion || undefined,
          residenceType: (residenceType || undefined) as any,
          studentCategoryId: studentCategoryId || undefined,
          // Placement is deliberately absent: it moves through the placement
          // dialog below, which writes an Enrollment. Sending it here is a 400.
          customFields: mergedCf,
        } as any,
      });
      if (student.partnerId) {
        await updatePartner.mutateAsync({
          id: student.partnerId,
          data: { name, email: email || undefined, phone: phone || undefined },
        });
      }
      qc.invalidateQueries({ queryKey: ['school', 'student', id] });
      notify.success('Student information updated');
    } catch {
      notify.error('Update failed');
    } finally {
      setBioBusy(false);
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
        {/* ───────────────────────── Profile (editable Student Information) ───────────────────────── */}
        <TabsContent value="profile" className="pt-4">
          <div className="space-y-4">
            {/* Student Information — editable, mirrors the application form */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base text-primary"><User className="h-4 w-4" /> Student Information</CardTitle>
                <Button size="sm" onClick={saveInfo} disabled={bioBusy || !fName.trim() || !lName.trim()}>
                  <Save className="mr-1 h-4 w-4" /> {bioBusy ? 'Saving…' : 'Save changes'}
                </Button>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <EditField label="Academic year" required full>
                    <Select value={academicYearId} onValueChange={setAcademicYearId}>
                      <SelectTrigger><SelectValue placeholder="Choose a year" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No year / choose later</SelectItem>
                        {(years?.data ?? []).map((y: any) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Admission cycle" full>
                    <Select value={admissionCycleId} onValueChange={setAdmissionCycleId}>
                      <SelectTrigger><SelectValue placeholder="No cycle / choose later" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No cycle / choose later</SelectItem>
                        {(cycles ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}{c.status === 'closed' ? ' (closed)' : ''}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="First name" required>
                    <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="E.g. Isabelle" />
                  </EditField>
                  <EditField label="Last name" required>
                    <Input value={lName} onChange={(e) => setLName(e.target.value)} placeholder="E.g. Atweoki" />
                  </EditField>
                  <EditField label="Admission date" required>
                    <Input type="date" value={(student?.enrollmentDate ?? '').toString().slice(0, 10)} readOnly disabled />
                  </EditField>
                  <EditField label="Date of birth" required>
                    <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                  </EditField>
                  <EditField label="Gender" required>
                    <Select value={gender} onValueChange={setGender}>
                      <SelectTrigger><SelectValue placeholder="Choose a gender" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Choose a gender</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Nationality" required>
                    <Select value={nationality} onValueChange={setNationality}>
                      <SelectTrigger><SelectValue placeholder="Choose a nationality" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{nationalities?.length ? 'Choose a nationality' : 'No nationalities configured'}</SelectItem>
                        {(nationalities ?? []).filter((n: any) => n.isActive).map((n: any) => <SelectItem key={n.name} value={n.name}>{n.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Entry status" required>
                    <Select value={entryStatus} onValueChange={setEntryStatus}>
                      <SelectTrigger><SelectValue placeholder="Choose entry status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Choose entry status</SelectItem>
                        {ENTRY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Residential status" required>
                    <Select value={residenceType} onValueChange={setResidenceType}>
                      <SelectTrigger><SelectValue placeholder="Choose residential status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Choose residential status</SelectItem>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="boarder">Boarder</SelectItem>
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Student category">
                    <Select value={studentCategoryId} onValueChange={setStudentCategoryId}>
                      <SelectTrigger><SelectValue placeholder={studentCategories?.length ? 'Choose a category' : 'No categories configured'} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No category</SelectItem>
                        {(studentCategories ?? []).filter((c: any) => c.isActive).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        {studentCategoryId && !(studentCategories ?? []).some((c: any) => c.id === studentCategoryId) && (
                          <SelectItem value={studentCategoryId}>Previously selected</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Home address" full>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="E.g. Plot 5, Kampala Road" />
                  </EditField>
                  <EditField label="Class and stream">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{placementLabel}</span>
                      <Button size="sm" variant="outline" onClick={() => setPlacementOpen(true)}>
                        {student.currentClassId ? 'Change placement' : 'Place in a class'}
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Placement is recorded as an enrolment for a term, not edited here.
                    </p>
                  </EditField>
                  <EditField label="Religion">
                    <Select value={religion} onValueChange={setReligion}>
                      <SelectTrigger><SelectValue placeholder="Choose a religion" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Choose a religion</SelectItem>
                        {RELIGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="National Identification Number">
                    <Input value={nin} onChange={(e) => setNin(e.target.value)} placeholder="E.g. CM973535343" />
                  </EditField>
                  <EditField label="Learner's Identification Number">
                    <Input value={learnerId} onChange={(e) => setLearnerId(e.target.value)} placeholder="Enter learner's identification number" />
                  </EditField>
                  <EditField label="School pay code" full>
                    <Input value={schoolPayCode} onChange={(e) => setSchoolPayCode(e.target.value)} placeholder="Enter student's school pay code" />
                  </EditField>
                  <EditField label="Email">
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
                  </EditField>
                  <EditField label="Phone">
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256…" />
                  </EditField>
                </div>
              </CardContent>
            </Card>

            {/* Read-only identities / status */}
            <SectionCard title="System Information">
              <Field label="Registration no." value={student.partner?.code ?? '—'} />
              <Field label="Admission no." value={student.admissionNo} />
              <Field label="Stream" value={sectionName(student.currentSectionId) ?? '—'} />
              <Field label="House" value={cf.house ?? '—'} />
              <Field label="Entry status (current)" value={student.status} />
            </SectionCard>
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
          <AcademicsTab studentId={student.id} portal={portal} />
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
      <PlacementDialog
        open={placementOpen}
        onClose={() => setPlacementOpen(false)}
        studentProfileId={student.id}
        admissionNo={student.admissionNo}
        currentClassId={student.currentClassId ?? null}
        currentSectionId={student.currentSectionId ?? null}
        classes={classes?.data ?? []}
        terms={terms?.data ?? []}
        enrollments={enrollments ?? []}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['school', 'student', id] });
          qc.invalidateQueries({ queryKey: ['school', 'enrollments', id] });
        }}
      />

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

    </div>
  );
}

/* ───────────────────────── Shared blocks ───────────────────────── */

function EditField({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <div className={full ? 'md:col-span-4 space-y-1' : 'space-y-1'}>
      <Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>
      {children}
    </div>
  );
}

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

function AcademicsTab({ studentId, portal, student }: { studentId: string; portal?: any; student?: any }) {
  const { data: terms } = useTerms();
  const [termId, setTermId] = useState('');
  const { data: result } = useStudentResultSet(studentId, termId || undefined);

  // Default the term selector to the current academic term when it loads.
  const termList = terms?.data ?? [];
  const activeTermId = termList.find((t: any) => t.isCurrent)?.id ?? termList[0]?.id;
  if (!termId && activeTermId) {
    // setTermId during render is safe here because it's idempotent (only runs when empty).
    queueMicrotask(() => setTermId(activeTermId));
  }

  const placement = student?.currentClass
    ? formatClass({ className: student.currentClass.name, sectionName: student.currentSection?.name, streamName: student.currentStream?.name })
    : null;

  if (!portal?.publishedResults && !result) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {placement && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Current academic placement: </span>
                <span className="font-medium">{placement}</span>
              </div>
            )}
            <Empty label="No published results yet — compute & publish a result set first." />
          </div>
        </CardContent>
      </Card>
    );
  }

  const r = result ?? portal?.publishedResults;
  const subjects = (result?.subjects ?? []).map((s: any) => ({
    name: s.subjectName ?? s.subjectId?.slice(0, 6),
    final: s.finalPercent != null ? Number(s.finalPercent) : null,
    grade: s.grade ?? '—',
  }));

  return (
    <div className="space-y-4">
      {placement && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Current academic placement: </span>
          <span className="font-medium">{placement}</span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Academic results</CardTitle>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Select term" /></SelectTrigger>
            <SelectContent>
              {termList.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Mean %" value={r?.meanPercent != null ? Number(r.meanPercent).toFixed(1) : (result?.students?.[0]?.meanPercent != null ? Number(result.students[0].meanPercent).toFixed(1) : '—')} />
            <Stat label="Class rank" value={r?.classRank != null ? `#${r.classRank}` : (result?.students?.[0]?.classRank != null ? `#${result.students[0].classRank}` : '—')} />
            <Stat label="Recommendation" value={r?.promotionRecommendation ?? (result?.students?.[0]?.promotionRecommendation ?? '—')} />
          </div>

          {subjects.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs font-medium text-muted-foreground">
                <tr><th className="px-2 py-1">Subject</th><th className="px-2 py-1 text-right">Final %</th><th className="px-2 py-1 text-center">Grade</th></tr>
              </thead>
              <tbody>
                {subjects.map((s: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-2 py-1.5">{s.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{s.final != null ? `${s.final}%` : '—'}</td>
                    <td className="px-2 py-1.5 text-center"><Badge variant="outline">{s.grade}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty label="No subject results for this term yet." />
          )}
        </CardContent>
      </Card>
    </div>
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
          <Stat label="Paid" value={money(statement.collected)} />
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

/**
 * Place a pupil in a class for a term.
 *
 * This replaces a plain class dropdown that wrote StudentProfile.currentClassId
 * through the profile endpoint. That moved the mirror and nothing else: the
 * pupil's record said P5 while every enrolment, register, mark sheet and result
 * still said P4. Enrollment is the authoritative placement record, so the only
 * way to move a pupil is to write one.
 */
function PlacementDialog({
  open, onClose, studentProfileId, admissionNo, currentClassId, currentSectionId, classes, terms, enrollments, onDone,
}: {
  open: boolean;
  onClose: () => void;
  studentProfileId: string;
  admissionNo: string;
  currentClassId: string | null;
  currentSectionId: string | null;
  classes: any[];
  terms: any[];
  enrollments: any[];
  onDone: () => void;
}) {
  const enroll = useEnrollStudent();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [termId, setTermId] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const sections = useSectionsForClass(classId || undefined);

  useEffect(() => {
    if (!open) return;
    setClassId(currentClassId ?? '');
    setSectionId(currentSectionId ?? '');
    // Default to the term the school is actually in, not whichever term the API
    // happened to return first.
    setTermId(terms.find((t: any) => t.isCurrent)?.id ?? terms[0]?.id ?? '');
    setRollNumber(admissionNo ?? '');
  }, [open, currentClassId, currentSectionId, terms, admissionNo]);

  // A stream belongs to one class, so changing class invalidates the choice.
  useEffect(() => {
    if (sectionId && !sections.data.some((x: any) => x.id === sectionId)) setSectionId('');
  }, [classId, sections.data, sectionId]);

  const already = enrollments.find((e: any) => e.termId === termId && e.status === 'enrolled');
  const termName = terms.find((t: any) => t.id === termId)?.name ?? 'this term';

  const submit = async () => {
    if (!classId || !termId || !rollNumber.trim()) {
      notify.error('Class, term and roll number are required');
      return;
    }
    try {
      await enroll.mutateAsync({
        studentProfileId,
        classId,
        sectionId: sectionId || undefined,
        termId,
        rollNumber: rollNumber.trim(),
      });
      const label = [classes.find((c: any) => c.id === classId)?.name, sections.data.find((x: any) => x.id === sectionId)?.name]
        .filter(Boolean).join(' — ');
      notify.success(`Placed in ${label} for ${termName}`);
      onDone();
      onClose();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not place this pupil');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Place pupil in a class</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger><SelectValue placeholder="Choose a term" /></SelectTrigger>
              <SelectContent>
                {terms.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Class</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Stream</Label>
            <Select value={sectionId} onValueChange={setSectionId} disabled={!classId || sections.data.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={!classId ? 'Choose a class first' : sections.data.length ? 'Choose a stream' : 'This class has no streams'} />
              </SelectTrigger>
              <SelectContent>
                {sections.data.map((x: any) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Roll number</Label>
            <Input value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} placeholder="E.g. 12" />
          </div>

          {already && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              This pupil already has an enrolment for {termName}. A pupil can hold only one
              placement per term — end the existing one before creating another.
            </p>
          )}

          {enrollments.length > 0 && (
            <div className="rounded border p-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Placement history</p>
              <ul className="space-y-0.5 text-xs">
                {enrollments.slice(0, 6).map((e: any) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>{e.schoolClass?.name ?? e.classId?.slice(0, 6)}{e.section?.name ? ` — ${e.section.name}` : ''}</span>
                    <span className="text-muted-foreground">{e.term?.name ?? ''} · {e.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={enroll.isPending || !!already}>
            {enroll.isPending ? 'Placing…' : 'Place pupil'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
