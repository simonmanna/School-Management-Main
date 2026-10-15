import { CustomFieldsSection, pickCustomFieldValues, useCustomFieldDefs } from '@/features/school/custom-fields';
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
  useAssessment, openFeeReceiptPdf,
  type FeeStatement, type Guardian, type PupilEnrollment, type AttendanceRecord,
  useTerminology } from '@/features/school/api';
import { useInvoice, usePayment } from '@/features/invoicing/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Trash2, Pencil, Plus, Camera, User, GraduationCap, Wallet, HeartPulse, Activity, Users, CalendarCheck, Save,
  ChevronRight, Printer, Receipt, ClipboardList, CalendarDays, Hash, Home, Flag, BadgeCheck, Cake, School,
  TrendingUp, Trophy, FileText, Bus, Utensils, BookOpen, Award, Clock, Inbox, Mail, Phone, Sparkles,
  Eye, ExternalLink, Download,
} from 'lucide-react';
import { notify } from '@/lib/notify';
import { formatClass, formatCurrency } from '@/lib/utils';

// The school's own currency (Organization.currencyCode), not a hard-coded UGX.
const money = (n: number | string | null | undefined) => formatCurrency(n);
const initials = (name?: string) => (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

const STATUS_META: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  suspended: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
  transferred: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25',
  withdrawn: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
  alumni: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/25',
};

/** "11 years 7 months", the way a head teacher reads an age — not a decimal. */
const ageOf = (dob?: string | null) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 0) return null;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y} year${y === 1 ? '' : 's'}${m ? ` ${m} month${m === 1 ? '' : 's'}` : ''}`;
};

/** The one published term result, whichever shape the portal hands back. */
const latestResult = (portal?: any) =>
  Array.isArray(portal?.publishedResults) ? portal.publishedResults[0] : portal?.publishedResults;

const RELIGIONS = ['Christian', 'Muslim', 'Hindu', 'Traditional', 'Other'];
const ENTRY_STATUSES = ['New entrant', 'Transfer', 'Re-admission', 'Returning'];

export function SchoolStudent360Page() {
  const labels = useTerminology();
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
  // Wave 16: the school's own fields, edited alongside the fixed ones.
  const { data: cfDefs } = useCustomFieldDefs('student');
  const [ownCf, setOwnCf] = useState<Record<string, unknown>>({});

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

    setNin('');
    setLearnerId(cf.learnerId ?? '');
    setSchoolPayCode(cf.schoolPayCode ?? '');
    setEmail(p.email ?? '');
    setPhone(p.phone ?? '');
    setOwnCf({ ...(s.customFields ?? {}) });
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
      // One pupil-record save (F15): the photo belongs to the pupil, and saving
      // it must not need the general contact-editing permission.
      await updateStudent.mutateAsync({ id: student.id, dto: { photoUrl: photoPreview } as any });
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
        learnerId: learnerId || undefined,
        schoolPayCode: schoolPayCode || undefined,
        ...pickCustomFieldValues(cfDefs, ownCf),
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
          // Name, contact and ID go in the same request: one transaction, so
          // the record is either fully saved or unchanged (F15).
          email,
          phone,
          ...(nin ? { nin } : {}),
        } as any,
      });
      qc.invalidateQueries({ queryKey: ['school', 'student', id] });
      notify.success('Student information updated');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      notify.error(`Nothing was saved. ${Array.isArray(msg) ? msg.join('; ') : msg ?? 'Try again.'}`);
    } finally {
      setBioBusy(false);
    }
  };

  if (isLoading) return <StudentSkeleton />;
  if (!student) return <div className="p-6 text-sm text-muted-foreground">Student not found. <Link className="text-primary underline" to="/school/students">Back to students</Link></div>;

  const TABS = [
    { value: 'profile', label: 'Profile', icon: User },
    { value: 'guardians', label: 'Guardians', icon: Users },
    { value: 'academic', label: 'Academic', icon: GraduationCap },
    { value: 'assessments', label: 'Assessments', icon: ClipboardList },
    { value: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { value: 'financial', label: 'Financial', icon: Wallet },
    { value: 'wellbeing', label: 'Wellbeing', icon: HeartPulse },
    { value: 'engagement', label: 'Engagement', icon: Activity },
  ] as const;

  const result = latestResult(portal);
  const rate = typeof attendance?.attendanceRate === 'number' ? attendance.attendanceRate : null;
  const age = ageOf(student.dateOfBirth as any);
  const year = (years?.data ?? []).find((y: any) => y.id === (cf.academicYearId ?? ''))?.name;

  return (
    <div className="space-y-5 p-6 print:p-0">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted-foreground print:hidden">
        <Link to="/school/students" className="hover:text-foreground">{labels.learnerPlural}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Student profile</span>
      </nav>

      {/* ── Identity hero ───────────────────────────────────────────── */}
      <Card className="overflow-hidden border-primary/15">
        <div className="relative">
          {/* Soft brand wash behind the identity block */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 via-primary/5 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <CardContent className="relative grid gap-5 p-6 lg:grid-cols-[auto_1fr_auto]">
            {/* Photo */}
            <div className="flex justify-center lg:block">
              <div className="group relative">
                <div className="h-28 w-28 overflow-hidden rounded-2xl bg-primary/10 text-primary shadow-sm ring-2 ring-primary/20 ring-offset-2 ring-offset-card flex items-center justify-center text-3xl font-semibold">
                  {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(student.partner?.name)}
                </div>
                <span
                  className={`absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-card ${
                    student.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                  title={student.status}
                />
                <button
                  onClick={() => setPhotoOpen(true)}
                  className="absolute inset-x-0 -bottom-2 mx-auto flex w-max items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-md transition hover:brightness-110 print:hidden"
                >
                  <Camera className="h-3 w-3" /> Photo
                </button>
              </div>
            </div>

            {/* Name, badges, key facts */}
            <div className="min-w-0 space-y-3 text-center lg:text-left">
              <div>
                <h1 className="truncate text-3xl font-semibold tracking-tight">{student.partner?.name}</h1>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {student.admissionNo}{student.partner?.code ? ` · ${student.partner.code}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 lg:justify-start">
                <Badge variant="outline" className={`capitalize ${STATUS_META[student.status] ?? ''}`}>{student.status}</Badge>
                {placementLabel !== 'Not placed' && <Badge variant="secondary">{placementLabel}</Badge>}
                {student.residenceType && <Badge variant="outline" className="capitalize">{student.residenceType}</Badge>}
                {student.gender && <Badge variant="outline" className="capitalize">{student.gender}</Badge>}
                {cf.house && <Badge variant="outline">House {cf.house}</Badge>}
              </div>
              <div className="grid gap-x-6 gap-y-2 text-left sm:grid-cols-2 xl:grid-cols-3">
                <MetaChip icon={Hash} label="Admission no." value={student.admissionNo} />
                <MetaChip icon={Cake} label="Date of birth" value={`${fmtDate(student.dateOfBirth as any)}${age ? ` · ${age}` : ''}`} />
                <MetaChip icon={School} label={labels.section} value={student.currentSection?.name ?? '—'} />
                <MetaChip icon={CalendarDays} label="Academic year" value={year ?? '—'} />
                <MetaChip icon={Flag} label="Nationality" value={(student as any).nationality ?? '—'} />
                <MetaChip icon={Home} label="Residence" value={student.residenceType ?? '—'} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-row flex-wrap justify-center gap-2 lg:w-48 lg:flex-col print:hidden">
              <Button className="lg:w-full" onClick={() => setTab('profile')}>
                <Pencil className="mr-2 h-4 w-4" /> Edit profile
              </Button>
              <Button variant="outline" className="lg:w-full" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" /> Print profile
              </Button>
              <Button variant="outline" className="lg:w-full" onClick={() => navigate(`/school/students/${student.id}/ledger`)}>
                <Receipt className="mr-2 h-4 w-4" /> Fee ledger
              </Button>
              <Button variant="outline" className="lg:w-full" onClick={() => setPlacementOpen(true)}>
                <GraduationCap className="mr-2 h-4 w-4" /> {student.currentClassId ? 'Change class' : 'Place in class'}
              </Button>
            </div>
          </CardContent>
        </div>
      </Card>

      {/* ── Headline numbers ────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          icon={CalendarCheck}
          label="Attendance · 90 days"
          value={rate == null ? '—' : `${rate.toFixed(0)}%`}
          hint={attendance ? `${attendance.present ?? 0} present of ${attendance.total ?? 0}` : 'No register marks yet'}
          progress={rate}
          tone={rate == null ? 'slate' : rate >= 90 ? 'emerald' : rate >= 75 ? 'amber' : 'rose'}
          onClick={() => setTab('attendance')}
        />
        <KpiTile
          icon={TrendingUp}
          label="Mean score"
          value={result?.meanPercent != null ? `${Number(result.meanPercent).toFixed(1)}%` : '—'}
          hint={result ? 'Latest released result' : 'No released results'}
          progress={result?.meanPercent != null ? Number(result.meanPercent) : null}
          tone="sky"
          onClick={() => setTab('academic')}
        />
        <KpiTile
          icon={Trophy}
          label="Class position"
          value={result?.classRank != null ? `#${result.classRank}` : '—'}
          hint={result?.division ? `Division ${result.division}` : result?.promotionRecommendation ? `Recommendation: ${result.promotionRecommendation}` : 'Awaiting results'}
          tone="violet"
          onClick={() => setTab('academic')}
        />
        <KpiTile
          icon={Wallet}
          label="Fee balance"
          value={statement ? money(statement.balance) : '—'}
          hint={statement ? `${money(statement.collected)} paid of ${money(statement.totalBilled)}` : 'No statement'}
          tone={statement && Number(statement.balance) > 0 ? 'rose' : 'emerald'}
          onClick={() => setTab('financial')}
        />
      </div>

      {/* Tab strip — icon + text, brand underline on active */}
      <div className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-background/85 px-1 backdrop-blur scroll-thin print:hidden">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
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
                  <EditField label="Class and stream" full>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border bg-muted/40 px-2 py-1 text-sm font-medium">{placementLabel}</span>
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
                    <Input
                      value={nin}
                      onChange={(e) => setNin(e.target.value)}
                      placeholder={cf.ninOnFile ? `On file (ends ${cf.ninLast4 ?? '····'}) — type to replace` : 'E.g. CM973535343'}
                      autoComplete="off"
                    />
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
                <CustomFieldsSection entityType="student" values={ownCf} onChange={setOwnCf} className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 md:grid-cols-2 lg:grid-cols-4" />
              </CardContent>
            </Card>

            {/* Read-only identities / status */}
            <SectionCard title="System Information">
              <Field label="Registration no." value={student.partner?.code ?? '—'} />
              <Field label="Admission no." value={student.admissionNo} />
              <Field label={labels.section} value={student.currentSection?.name ?? '—'} />
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
          <AcademicsTab studentId={student.id} portal={portal} student={student} />
          <TimetableCard slots={(portal as any)?.timetable} />
          <LibraryTab rows={library} />
        </TabsContent>

        {/* ───────────────────────── Assessments ───────────────────────── */}
        <TabsContent value="assessments" className="space-y-4 pt-4">
          <RecentMarksCard grades={(portal as any)?.grades} />
          <AssessmentsTab portal={portal} />
          <CertificatesCard rows={(portal as any)?.certificates} />
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

      {/* ── Right rail: the answers a head teacher wants without clicking ── */}
      <aside className="space-y-4 xl:sticky xl:top-14 xl:self-start print:hidden">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-primary" /> Quick summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <RailRow icon={GraduationCap} label={labels.class} value={placementLabel} tone="sky" />
            <RailRow icon={Cake} label="Age" value={age ?? '—'} tone="violet" />
            <RailRow icon={Hash} label="Admission no." value={student.admissionNo} tone="slate" />
            <RailRow icon={BadgeCheck} label="Status" value={student.status} tone={student.status === 'active' ? 'emerald' : 'slate'} />
            <RailRow icon={CalendarCheck} label="Attendance" value={rate == null ? '—' : `${rate.toFixed(0)}%`} tone={rate != null && rate < 75 ? 'rose' : 'emerald'} />
            <RailRow icon={Wallet} label="Balance" value={statement ? money(statement.balance) : '—'} tone={statement && Number(statement.balance) > 0 ? 'rose' : 'emerald'} />
          </CardContent>
        </Card>

        <RecentActivityCard activities={activities} statement={statement} library={library} />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Quick links</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <RailLink icon={Receipt} label="Fee ledger" onClick={() => navigate(`/school/students/${student.id}/ledger`)} />
            <RailLink icon={Users} label="Parents / guardians" onClick={() => setTab('guardians')} />
            <RailLink icon={ClipboardList} label="Assessments" onClick={() => setTab('assessments')} />
            <RailLink icon={CalendarCheck} label="Attendance" onClick={() => setTab('attendance')} />
            <RailLink icon={FileText} label="Documents" onClick={() => setTab('engagement')} />
          </CardContent>
        </Card>
      </aside>
      </div>

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
          qc.invalidateQueries({ queryKey: ['school', 'student-enrollments'] });
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

type Tone = 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' | 'slate';

const TONE: Record<Tone, { text: string; bg: string; bar: string }> = {
  emerald: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', bar: 'bg-emerald-500' },
  rose: { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', bar: 'bg-rose-500' },
  amber: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', bar: 'bg-amber-500' },
  sky: { text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10', bar: 'bg-sky-500' },
  violet: { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10', bar: 'bg-violet-500' },
  slate: { text: 'text-muted-foreground', bg: 'bg-muted', bar: 'bg-muted-foreground/50' },
};

/** The page before the pupil has loaded — shaped like the page, not a spinner. */
function StudentSkeleton() {
  return (
    <div className="space-y-5 p-6">
      <div className="h-3 w-40 animate-pulse rounded bg-muted" />
      <Card><CardContent className="flex gap-5 p-6">
        <div className="h-28 w-28 shrink-0 animate-pulse rounded-2xl bg-muted" />
        <div className="flex-1 space-y-3">
          <div className="h-7 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="grid gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" />)}
          </div>
        </div>
      </CardContent></Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
      </div>
    </div>
  );
}

function MetaChip({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium capitalize">{value || '—'}</div>
      </div>
    </div>
  );
}

function KpiTile({
  icon: Icon, label, value, hint, progress, tone = 'slate', onClick,
}: { icon: any; label: string; value: string; hint?: string; progress?: number | null; tone?: Tone; onClick?: () => void }) {
  const t = TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${t.text}`}>{value}</div>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.text}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      {progress != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${t.bar} transition-all`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
      {hint && <div className="mt-2 truncate text-xs text-muted-foreground">{hint}</div>}
    </button>
  );
}

function RailRow({ icon: Icon, label, value, tone = 'slate' }: { icon: any; label: string; value: string; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.text}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium capitalize">{value}</div>
      </div>
    </div>
  );
}

function RailLink({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-4 w-4 text-primary" /> {label}
      <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" />
    </button>
  );
}

/**
 * One timeline from the records the pupil already has — payments, logged
 * contact, borrowings. Nothing is invented: an empty rail means an empty file.
 */
function RecentActivityCard({ activities, statement, library }: { activities?: any[]; statement?: FeeStatement; library?: any[] }) {
  const rows = [
    ...(activities ?? []).map((a) => ({
      at: a.occurredAt, title: a.title as string,
      detail: a.type === 'note' ? 'Note' : a.type === 'call' ? 'Call logged' : a.type === 'email' ? 'Message sent' : 'Activity',
      icon: a.type === 'call' ? Phone : a.type === 'email' ? Mail : ClipboardList, tone: 'violet' as Tone,
    })),
    ...((statement?.payments ?? []) as any[]).map((p) => ({
      at: p.paymentDate, title: `Payment ${money(p.amount)}`, detail: p.paymentNumber ?? 'Fee payment',
      icon: Wallet, tone: 'emerald' as Tone,
    })),
    ...((library ?? []) as any[]).map((b) => ({
      at: b.borrowedAt, title: b.bookMetadata?.title ?? 'Book borrowed', detail: 'Library',
      icon: BookOpen, tone: 'sky' as Tone,
    })),
  ]
    .filter((r) => r.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Clock className="h-4 w-4 text-primary" /> Recent activity</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty label="Nothing recorded yet." /> : (
          <ol className="relative space-y-4 border-l border-border pl-5">
            {rows.map((r, i) => {
              const Icon = r.icon;
              const t = TONE[r.tone];
              return (
                <li key={i} className="relative">
                  <span className={`absolute -left-[30px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card ${t.text}`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="text-sm font-medium leading-tight">{r.title}</div>
                  <div className="text-xs text-muted-foreground">{r.detail} · {fmtDate(r.at)}</div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The pupil's week, from the class timetable they are placed in. */
function TimetableCard({ slots }: { slots?: any[] }) {
  if (!slots || slots.length === 0) {
    return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Timetable</CardTitle></CardHeader><CardContent><Empty label="No timetable for this pupil's class yet." icon={CalendarDays} /></CardContent></Card>;
  }
  const byDay = new Map<number, any[]>();
  for (const s of slots) {
    const d = Number(s.dayOfWeek) || 0;
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Weekly timetable</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) => (
          <div key={day} className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{DAYS[day] ?? `Day ${day}`}</div>
            <ul className="space-y-1.5">
              {list.map((s: any) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{s.subject?.name ?? 'Lesson'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{s.period?.name ?? s.period?.startTime ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Released marks, newest first — the spine's own figures, never re-derived. */
function RecentMarksCard({ grades }: { grades?: any[] }) {
  const rows = grades ?? [];
  // The assessment a reader asked to see, with this pupil's own mark attached
  // so the dialog can show the score beside what the assessment was.
  const [open, setOpen] = useState<AssessmentView | null>(null);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4 text-primary" /> Released marks</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty label="No released marks yet." icon={ClipboardList} /> : (
          <div className="space-y-2">
            {rows.map((g: any) => {
              const pct = g.percentage != null ? Number(g.percentage) : null;
              const tone: Tone = pct == null ? 'slate' : pct >= 75 ? 'emerald' : pct >= 50 ? 'amber' : 'rose';
              return (
                <div key={g.id} className="rounded-lg border p-3 transition hover:border-primary/30 hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{g.assessment?.title ?? 'Assessment'}</div>
                      <div className="text-xs text-muted-foreground">{g.subject?.name ?? '—'} · {fmtDate(g.recordedAt)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className={`text-sm font-semibold tabular-nums ${TONE[tone].text}`}>
                          {g.score ?? '—'}<span className="text-muted-foreground">/{g.maxScore}</span>
                        </div>
                        {pct != null && <div className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(0)}%</div>}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2"
                        onClick={() => setOpen({
                          assessmentId: g.assessment?.id ?? null,
                          title: g.assessment?.title ?? 'Assessment',
                          subject: g.subject?.name ?? null,
                          score: g.score ?? null,
                          maxScore: g.maxScore ?? null,
                          percentage: pct,
                          recordedAt: g.recordedAt ?? null,
                        })}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                    </div>
                  </div>
                  {pct != null && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${TONE[tone].bar}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <AssessmentDetailDialog view={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

/** What the screen already knows about an assessment, before the fetch. */
interface AssessmentView {
  assessmentId: string | null;
  title: string;
  subject: string | null;
  score?: string | number | null;
  maxScore?: string | number | null;
  percentage?: number | null;
  recordedAt?: string | null;
  dueDate?: string | null;
  description?: string | null;
  submissions?: any[];
}

/**
 * One assessment in full.
 *
 * The list rows carry what the pupil scored; the assessment itself (its
 * component, weight, window and lifecycle state) is read from the assessment
 * record, so the dialog shows the school's definition rather than a copy of it
 * that drifts. Without the read grant the dialog still shows the pupil's mark.
 */
function AssessmentDetailDialog({ view, onClose }: { view: AssessmentView | null; onClose: () => void }) {
  const { data, isLoading } = useAssessment(view?.assessmentId ?? undefined);
  const a = data as any;
  const submission = view?.submissions?.[0];
  return (
    <Dialog open={!!view} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" /> {view?.title ?? 'Assessment'}
          </DialogTitle>
        </DialogHeader>
        {view && (
          <div className="space-y-4">
            {(view.score != null || view.percentage != null) && (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Score" value={view.score != null ? String(view.score) : '—'} />
                <Stat label="Out of" value={view.maxScore != null ? String(view.maxScore) : (a?.maxScore != null ? String(a.maxScore) : '—')} />
                <Stat
                  label="Percent"
                  value={view.percentage != null ? `${view.percentage.toFixed(0)}%` : '—'}
                  tone={view.percentage == null ? undefined : view.percentage >= 75 ? 'emerald' : view.percentage >= 50 ? 'amber' : 'rose'}
                />
              </div>
            )}

            <div>
              <DetailRow label="Subject" value={view.subject ?? '—'} />
              {view.dueDate && <DetailRow label="Due" value={fmtDate(view.dueDate)} />}
              {view.recordedAt && <DetailRow label="Marked on" value={fmtDate(view.recordedAt)} />}
              {isLoading && <DetailRow label="Assessment" value="Loading…" />}
              {a && (
                <>
                  <DetailRow label="Component" value={a.component?.name ?? '—'} />
                  <DetailRow label="Kind" value={<span className="capitalize">{a.component?.kind ?? a.sourceType ?? '—'}</span>} />
                  <DetailRow label="Weight in component" value={a.weightInComponent != null ? String(a.weightInComponent) : '—'} />
                  <DetailRow label="Lifecycle" value={<Badge variant="outline" className="capitalize">{a.status}</Badge>} />
                  {a.dueAt && !view.dueDate && <DetailRow label="Due" value={fmtDate(a.dueAt)} />}
                </>
              )}
            </div>

            {view.description && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Instructions</p>
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{view.description}</p>
              </div>
            )}

            {submission && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Submission</p>
                <div className="rounded-md border p-3 text-sm">
                  <DetailRow label="Submitted" value={submission.submittedAt ? fmtDate(submission.submittedAt) : 'Not submitted'} />
                  <DetailRow label="Attempt" value={submission.attemptNo != null ? String(submission.attemptNo) : '—'} />
                  {submission.score != null && <DetailRow label="Score" value={String(submission.score)} />}
                  {submission.feedback && <DetailRow label="Feedback" value={submission.feedback} />}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CertificatesCard({ rows }: { rows?: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Award className="h-4 w-4 text-primary" /> Certificates</CardTitle></CardHeader>
      <CardContent>
        {!rows || rows.length === 0 ? <Empty label="No certificates issued." icon={Award} /> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((c: any) => (
              <li key={c.id} className="rounded-lg border p-3">
                <div className="text-sm font-medium">{c.title}</div>
                <div className="text-xs capitalize text-muted-foreground">{(c.type ?? '').replace(/_/g, ' ')} · {fmtDate(c.issuedAt)}</div>
                {c.serialNumber && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{c.serialNumber}</div>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EditField({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <div className={full ? 'md:col-span-4 space-y-1' : 'space-y-1'}>
      <Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>
      {children}
    </div>
  );
}

function SectionCard({ title, icon: Icon, actions, children }: { title: string; icon?: any; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          {title}
        </CardTitle>
        {actions && <div className="flex gap-1">{actions}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
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
  const [receivesResults, setReceivesResults] = useState(true);
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
    setReceivesResults(g.receivesResults ?? true);
    setOpen(true);
  };

  const save = async () => {
    if (!firstName.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await updateG.mutateAsync({
          id: editing.id, studentProfileId,
          relationship, isPrimary, canPickup, receivesStatements, receivesResults,
          guardian: { firstName: firstName.trim(), lastName: lastName.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined },
        });
      } else {
        await createG.mutateAsync({
          studentProfileId, relationship, isPrimary, canPickup, receivesStatements, receivesResults,
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
                  {g.relationship}{g.isPrimary ? ' · primary' : ''}{g.canPickup ? ' · pickup' : ''}{g.receivesStatements ? ' · statements' : ''}{g.receivesResults === false ? ' · no results messages' : ''}
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
              <label className="flex items-center gap-2"><input type="checkbox" checked={receivesResults} onChange={(e) => setReceivesResults(e.target.checked)} /> Receives results (SMS / portal)</label>
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

  const published = latestResult(portal);
  if (!published && !result) {
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
            <Empty label="No published results yet — compute & publish a result set first." icon={GraduationCap} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const r = result ?? published;
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
          <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4 text-primary" /> Academic results</CardTitle>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Select term" /></SelectTrigger>
            <SelectContent>
              {termList.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.label ?? t.name}</SelectItem>)}
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
              <thead className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-2 py-1.5">Subject</th><th className="px-2 py-1.5">Score</th><th className="px-2 py-1.5 text-right">Final %</th><th className="px-2 py-1.5 text-center">Grade</th></tr>
              </thead>
              <tbody>
                {subjects.map((s: any, i: number) => {
                  const tone: Tone = s.final == null ? 'slate' : s.final >= 75 ? 'emerald' : s.final >= 50 ? 'amber' : 'rose';
                  return (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-2 py-2 font-medium">{s.name}</td>
                      <td className="w-1/3 px-2 py-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={`h-full rounded-full ${TONE[tone].bar}`} style={{ width: `${Math.max(0, Math.min(100, s.final ?? 0))}%` }} />
                        </div>
                      </td>
                      <td className={`px-2 py-2 text-right font-medium tabular-nums ${TONE[tone].text}`}>{s.final != null ? `${s.final}%` : '—'}</td>
                      <td className="px-2 py-2 text-center"><Badge variant="outline">{s.grade}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty label="No subject results for this term yet." icon={ClipboardList} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssessmentsTab({ portal }: { portal?: any }) {
  const list: any[] = portal?.assignments ?? [];
  const now = Date.now();
  const [open, setOpen] = useState<AssessmentView | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-primary" /> Assignments</CardTitle>
        {list.length > 0 && <Badge variant="secondary">{list.length}</Badge>}
      </CardHeader>
      <CardContent>
        {list.length === 0 ? <Empty label="No assignments fanned out to this pupil yet." icon={FileText} /> : (
          <ul className="space-y-2">
            {list.map((a) => {
              const sub = a.submissions?.[0];
              const due = a.dueDate ?? a.dueAt;
              const overdue = !sub?.submittedAt && due && new Date(due).getTime() < now;
              const state = sub?.submittedAt ? 'submitted' : overdue ? 'overdue' : a.status ?? 'open';
              const tone: Tone = state === 'submitted' ? 'emerald' : state === 'overdue' ? 'rose' : 'sky';
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 transition hover:border-primary/30 hover:bg-muted/40">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.subject?.name ? `${a.subject.name} · ` : ''}{due ? `Due ${fmtDate(due)}` : 'No due date'}
                      {sub?.score != null ? ` · Scored ${sub.score}/${a.maxScore ?? '—'}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className={`capitalize ${TONE[tone].text} ${TONE[tone].bg} border-transparent`}>{state}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setOpen({
                        assessmentId: a.assessmentId ?? null,
                        title: a.title,
                        subject: a.subject?.name ?? null,
                        maxScore: a.maxScore ?? null,
                        score: sub?.score ?? null,
                        percentage: sub?.score != null && Number(a.maxScore) > 0 ? (Number(sub.score) / Number(a.maxScore)) * 100 : null,
                        dueDate: due ?? null,
                        description: a.description ?? null,
                        submissions: a.submissions ?? [],
                      })}
                    >
                      <Eye className="mr-1 h-3.5 w-3.5" /> View
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <AssessmentDetailDialog view={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

/** A rate as a ring — read at a glance, not counted off a table. */
function Ring({ value, tone }: { value: number | null; tone: Tone }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
          className={`${TONE[tone].text} transition-all duration-700`} stroke="currentColor"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-semibold tabular-nums ${TONE[tone].text}`}>{value == null ? '—' : `${value.toFixed(0)}%`}</span>
        <span className="text-[11px] text-muted-foreground">attendance</span>
      </div>
    </div>
  );
}

const BUCKET_TONE: Record<string, Tone> = {
  present: 'emerald', late: 'amber', excused: 'sky', absent: 'rose', other: 'slate',
};

function AttendanceTab({ summary }: { summary?: any }) {
  // Which counter the reader opened. Null = the summary alone.
  const [bucket, setBucket] = useState<string | null>(null);
  const [day, setDay] = useState<AttendanceRecord | null>(null);
  if (!summary) return <Card><CardContent className="p-6"><Empty label="No attendance records in range." icon={CalendarCheck} /></CardContent></Card>;
  const total = summary.total ?? 0;
  const present = summary.present ?? 0;
  const late = summary.late ?? 0;
  const excused = summary.excused ?? 0;
  const absent = summary.absent ?? 0;
  // Audit F08: the server's one calculation; never re-derived here.
  const rate: number | null = typeof summary.attendanceRate === 'number' ? summary.attendanceRate : null;
  const tone: Tone = rate == null ? 'slate' : rate >= 90 ? 'emerald' : rate >= 75 ? 'amber' : 'rose';
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const bars: Array<{ label: string; n: number; tone: Tone }> = [
    { label: 'Present', n: present, tone: 'emerald' },
    { label: 'Late', n: late, tone: 'amber' },
    { label: 'Excused', n: excused, tone: 'sky' },
    { label: 'Absent', n: absent, tone: 'rose' },
  ];
  // The days behind the counters. The server classified each one; the screen
  // only filters, so a tile and its list can never disagree.
  const records: AttendanceRecord[] = summary.records ?? [];
  const count = (b: string) => records.filter((r) => r.bucket === b).length;
  const toggle = (b: string) => setBucket((cur) => (cur === b ? null : b));
  const shown = bucket === 'all' ? records : records.filter((r) => r.bucket === bucket);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4 text-primary" /> Attendance · last 90 days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <Ring value={rate} tone={tone} />
          <div className="w-full space-y-3">
            {bars.map((b) => (
              <div key={b.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="font-medium tabular-nums">{b.n}{total > 0 ? ` · ${share(b.n).toFixed(0)}%` : ''}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${TONE[b.tone].bar} transition-all duration-500`} style={{ width: `${share(b.n)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Marked days" value={String(total)} hint={records.length ? 'Show all' : undefined}
            onClick={records.length ? () => setBucket((b) => (b === 'all' ? null : 'all')) : undefined} active={bucket === 'all'} />
          <Stat label="Present" value={String(present)} tone="emerald" hint={count('present') ? 'View days' : undefined}
            onClick={count('present') ? () => toggle('present') : undefined} active={bucket === 'present'} />
          <Stat label="Late" value={String(late)} tone="amber" hint={count('late') ? 'View days' : undefined}
            onClick={count('late') ? () => toggle('late') : undefined} active={bucket === 'late'} />
          <Stat label="Excused" value={String(excused)} tone="sky" hint={count('excused') ? 'View days' : undefined}
            onClick={count('excused') ? () => toggle('excused') : undefined} active={bucket === 'excused'} />
          <Stat label="Absent" value={String(absent)} tone="rose" hint={count('absent') ? 'View days' : undefined}
            onClick={count('absent') ? () => toggle('absent') : undefined} active={bucket === 'absent'} />
        </div>

        {bucket && (
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium capitalize">
                {bucket === 'all' ? 'All marked days' : `${bucket} days`}
                <span className="ml-2 text-xs text-muted-foreground">{shown.length} record{shown.length === 1 ? '' : 's'}</span>
              </span>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setBucket(null)}>Hide</Button>
            </div>
            {shown.length === 0 ? (
              <div className="p-4"><Empty label="No days in this group." icon={CalendarCheck} /></div>
            ) : (
              <div className="max-h-80 overflow-y-auto scroll-thin">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Session</th><th className="px-3 py-2">Note</th><th className="px-3 py-2 text-right">Action</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2 font-medium">{fmtDate(r.date)}</td>
                        <td className="px-3 py-2"><AttendanceStatusBadge record={r} /></td>
                        <td className="px-3 py-2 text-muted-foreground">{r.periodName ?? 'Whole day'}</td>
                        <td className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground">
                          {r.reason ?? (r.minutesLate ? `${r.minutesLate} min late` : '-')}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDay(r)}>
                            <Eye className="mr-1 h-3.5 w-3.5" /> View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {summary.policyMissing
            ? 'The rate is hidden until the school chooses how late arrivals count (School settings).'
            : 'Late arrivals count as the school has set in School settings.'}
        </p>
      </CardContent>

      <AttendanceDayDialog record={day} onClose={() => setDay(null)} />
    </Card>
  );
}

/** The register's own status label and colour, not a guess from the code. */
function AttendanceStatusBadge({ record }: { record: AttendanceRecord }) {
  const tone = BUCKET_TONE[record.bucket] ?? 'slate';
  return (
    <Badge
      variant="outline"
      className={`capitalize border-transparent ${TONE[tone].bg} ${TONE[tone].text}`}
      style={record.statusColor ? { color: record.statusColor, backgroundColor: `${record.statusColor}1a` } : undefined}
    >
      {record.statusLabel}
    </Badge>
  );
}

/** One marked session, in full: who marked it, when, and what they wrote. */
function AttendanceDayDialog({ record, onClose }: { record: AttendanceRecord | null; onClose: () => void }) {
  return (
    <Dialog open={!!record} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-primary" />
            {record ? new Date(record.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Attendance'}
          </DialogTitle>
        </DialogHeader>
        {record && (
          <div className="space-y-1">
            <DetailRow label="Status" value={<AttendanceStatusBadge record={record} />} />
            <DetailRow label="Session" value={record.periodName ?? 'Whole day'} />
            <DetailRow label={'Class'} value={[record.className, record.sectionName].filter(Boolean).join(' - ') || '-'} />
            {record.minutesLate > 0 && <DetailRow label="Minutes late" value={String(record.minutesLate)} />}
            {record.earlyDepartureMinutes != null && record.earlyDepartureMinutes > 0 && (
              <DetailRow label="Left early by" value={`${record.earlyDepartureMinutes} min`} />
            )}
            <DetailRow label="Reason" value={record.reason ?? '-'} />
            <DetailRow label="Marked by" value={record.markedByName ?? 'Not recorded'} />
            <DetailRow label="Marked at" value={new Date(record.markedAt).toLocaleString()} />
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinancialTab({ statement }: { statement?: FeeStatement }) {
  // Which document the reader asked to see. One at a time: the dialog is the
  // detail view, so opening a second closes the first.
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  if (!statement) return <Card><CardContent className="p-6"><Empty label="No fee statement." icon={Wallet} /></CardContent></Card>;
  const billed = Number(statement.totalBilled) || 0;
  const paid = Number(statement.collected) || 0;
  const pctPaid = billed > 0 ? Math.max(0, Math.min(100, (paid / billed) * 100)) : 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Fees summary</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Billed" value={money(statement.totalBilled)} />
            <Stat label="Paid" value={money(statement.collected)} tone="emerald" />
            <Stat label="Balance" value={money(statement.balance)} tone={statement.balance > 0 ? 'rose' : 'emerald'} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Collected</span><span className="tabular-nums">{pctPaid.toFixed(0)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pctPaid}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Invoices</CardTitle></CardHeader>
        <CardContent>
          {statement.invoices.length === 0 && <Empty label="No invoices issued." icon={Receipt} />}
          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-1.5">Document</th><th className="px-2 py-1.5">Issue date</th><th className="px-2 py-1.5">Amount</th><th className="px-2 py-1.5">Balance</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5 text-right">Action</th></tr></thead>
              <tbody>
                {statement.invoices.map((inv: any) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-2 py-1.5 font-medium">{inv.documentNumber}</td>
                    <td className="px-2 py-1.5">{fmtDate(inv.issueDate)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{money(inv.totalAmount)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{money(inv.amountResidual)}</td>
                    <td className="px-2 py-1.5"><PayStatusBadge status={inv.paymentStatus} /></td>
                    <td className="px-2 py-1.5 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setInvoiceId(inv.id)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent>
          {statement.payments.length === 0 && <Empty label="No payments recorded." icon={Wallet} />}
          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-1.5">Receipt</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Method</th><th className="px-2 py-1.5">Amount</th><th className="px-2 py-1.5 text-right">Action</th></tr></thead>
              <tbody>
                {statement.payments.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-2 py-1.5 font-medium">{p.paymentNumber}</td>
                    <td className="px-2 py-1.5">{fmtDate(p.paymentDate)}</td>
                    <td className="px-2 py-1.5 capitalize">{(p.paymentMethod ?? '').replace(/_/g, ' ')}</td>
                    <td className="px-2 py-1.5 tabular-nums">{money(p.amount)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPaymentId(p.id)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <InvoiceDetailDialog invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />
      <PaymentDetailDialog paymentId={paymentId} onClose={() => setPaymentId(null)} />
    </div>
  );
}

function PayStatusBadge({ status }: { status?: string | null }) {
  const code = (status ?? '').toLowerCase();
  const tone: Tone = code === 'paid' ? 'emerald' : code === 'partial' ? 'amber' : code === 'overdue' ? 'rose' : 'slate';
  return <Badge variant="outline" className={`capitalize border-transparent ${TONE[tone].bg} ${TONE[tone].text}`}>{status ?? '-'}</Badge>;
}

/** A row in a detail dialog: label left, value right. */
function DetailRow({ label, value, mono }: { label: string; value?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '-'}</span>
    </div>
  );
}

/**
 * The invoice behind a statement line.
 *
 * The statement carries only the summary columns, so the lines are read from
 * the invoicing module itself - the same record the bursar's invoice page
 * shows, never a second copy assembled here. A reader without the invoicing
 * grant is told so rather than left with an empty dialog.
 */
function InvoiceDetailDialog({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useInvoice(invoiceId ?? undefined);
  return (
    <Dialog open={!!invoiceId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" /> Invoice {data?.documentNumber ?? ''}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading invoice...</p>}
        {isError && <p className="py-6 text-center text-sm text-muted-foreground">This invoice could not be opened - your account may not have the invoicing permission.</p>}
        {data && (
          <div className="space-y-4">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <DetailRow label="Document" value={data.documentNumber} />
              <DetailRow label="Status" value={<PayStatusBadge status={data.paymentStatus} />} />
              <DetailRow label="Issue date" value={fmtDate(data.issueDate)} />
              <DetailRow label="Due date" value={fmtDate(data.dueDate)} />
              <DetailRow label="Billed to" value={data.partner?.name ?? '-'} />
              <DetailRow label="Payment term" value={data.paymentTermName ?? '-'} />
            </div>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit</th><th className="px-3 py-2 text-right">Subtotal</th></tr>
                </thead>
                <tbody>
                  {(data.lines ?? []).map((l: any) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{l.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(l.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(l.subtotal)}</td>
                    </tr>
                  ))}
                  {(data.lines ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No lines on this invoice.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total" value={money(data.totalAmount)} />
              <Stat label="Paid" value={money(data.amountPaid)} tone="emerald" />
              <Stat label="Balance" value={money(data.amountResidual)} tone={Number(data.amountResidual) > 0 ? 'rose' : 'emerald'} />
            </div>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
          {invoiceId && (
            <Button variant="outline" onClick={() => navigate(`/invoices/${invoiceId}`)}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open full invoice
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The receipt behind a payment line, with the school's own PDF copies. */
function PaymentDetailDialog({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = usePayment(paymentId ?? undefined);
  const [pdfBusy, setPdfBusy] = useState(false);
  const openPdf = async (format: 'a4' | 'thermal') => {
    if (!paymentId) return;
    setPdfBusy(true);
    try {
      await openFeeReceiptPdf(paymentId, format);
    } catch {
      notify.error('Could not produce the receipt PDF');
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <Dialog open={!!paymentId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Receipt {data?.paymentNumber ?? ''}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading payment...</p>}
        {isError && <p className="py-6 text-center text-sm text-muted-foreground">This payment could not be opened - your account may not have the payments permission.</p>}
        {data && (
          <div className="space-y-4">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <DetailRow label="Receipt no." value={data.paymentNumber} />
              <DetailRow label="Date" value={fmtDate(data.paymentDate)} />
              <DetailRow label="Method" value={<span className="capitalize">{(data.paymentMethod ?? '').replace(/_/g, ' ')}</span>} />
              <DetailRow label="Status" value={<span className="capitalize">{data.status}</span>} />
              <DetailRow label="Paid by" value={data.partner?.name ?? '-'} />
              <DetailRow label="Reference" value={data.reference ?? '-'} mono />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Stat label="Amount" value={money(data.amount)} tone="emerald" />
              <Stat label="Allocated" value={money(data.allocatedAmount)} />
              <Stat label="Unallocated" value={money(data.unallocatedAmount)} tone={Number(data.unallocatedAmount) > 0 ? 'amber' : undefined} />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Settles</p>
              {(data.allocations ?? []).length === 0 ? (
                <Empty label="Not yet allocated to an invoice." icon={Receipt} />
              ) : (
                <ul className="space-y-1.5">
                  {data.allocations.map((a: any) => (
                    <li key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium">{a.document?.documentNumber ?? 'Document'}</span>
                      <span className="tabular-nums">{money(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
          <Button variant="outline" disabled={pdfBusy} onClick={() => openPdf('a4')}>
            <Download className="mr-2 h-4 w-4" /> Receipt PDF
          </Button>
          <Button variant="outline" disabled={pdfBusy} onClick={() => openPdf('thermal')}>
            <Printer className="mr-2 h-4 w-4" /> Thermal
          </Button>
          {paymentId && (
            <Button variant="outline" onClick={() => navigate(`/payments/${paymentId}`)}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open full record
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentsTab({ docs }: { docs?: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
      <CardContent>
        {!docs || docs.length === 0 ? <Empty label="No documents uploaded." icon={FileText} /> :
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
  if (!medical) return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Health</CardTitle></CardHeader><CardContent><Empty label="No medical record." icon={HeartPulse} /></CardContent></Card>;
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
        {rows.length === 0 && <Empty label="No behaviour records." icon={ClipboardList} />}
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
        {rows.length === 0 && <Empty label="No communication logs." icon={Mail} />}
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
        {rows.length === 0 && <Empty label="No co-curricular activities recorded." icon={Activity} />}
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
  if (!rows || rows.length === 0) return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Transport</CardTitle></CardHeader><CardContent><Empty label="No transport assignment for this pupil." icon={Bus} /></CardContent></Card>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Transport</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-md border p-3">
            <div className="font-medium">{t.route?.name ?? 'Route'}</div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>Stop: {t.stop?.name ?? '—'}</span>
              <span>Zone: {t.stop?.zone?.name ?? '—'}</span>
              <span>Service: {t.serviceMode === 'both' ? 'Morning & afternoon' : (t.serviceMode ?? '—').replace(/_/g, ' ')}</span>
              <span>{fmtDate(t.startDate)} → {t.endDate ? fmtDate(t.endDate) : 'open'}</span>
            </div>
            <div className="mt-2"><Badge variant={t.status === 'active' ? 'default' : 'secondary'}>{t.status ?? 'active'}</Badge></div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MealsTab({ wallet }: { wallet?: any }) {
  if (!wallet || !wallet.exists) return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Meals</CardTitle></CardHeader><CardContent><Empty label="No meal account for this pupil." icon={Utensils} /></CardContent></Card>;
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
  if (!rows || rows.length === 0) return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Library</CardTitle></CardHeader><CardContent><Empty label="No borrowings for this pupil." icon={BookOpen} /></CardContent></Card>;
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

function Empty({ label, icon: Icon = Inbox }: { label: string; icon?: any }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
function Stat({ label, value, tone, onClick, active, hint }: {
  label: string; value: string; tone?: Tone; onClick?: () => void; active?: boolean; hint?: string;
}) {
  const t = tone ? TONE[tone] : null;
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${t?.text ?? ''}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </>
  );
  if (!onClick) return <div className="rounded-lg border bg-muted/30 p-3 text-center">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={`rounded-lg border p-3 text-center transition hover:border-primary/40 hover:bg-muted/60 ${
        active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'bg-muted/30'
      }`}
    >
      {body}
    </button>
  );
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
  enrollments: PupilEnrollment[];
  onDone: () => void;
}) {
  const labels = useTerminology();
  const enroll = useEnrollStudent();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [termId, setTermId] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [reason, setReason] = useState('');
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

  // Membership is per academic year (ADR-018): a pupil already enrolled for the
  // term's year is MOVED (the open placement is end-dated), not enrolled twice.
  const term = terms.find((t: any) => t.id === termId);
  const termName = term?.name ?? 'this term';
  const yearEnrollment = term ? enrollments.find((e) => e.academicYearId === term.academicYearId) : undefined;
  const seated = yearEnrollment && ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(yearEnrollment.status);
  const blocked = yearEnrollment && !seated;
  const history = enrollments.flatMap((e) =>
    e.placements.map((p) => ({ ...p, year: e.academicYear?.name ?? '', status: e.status })),
  );

  const submit = async () => {
    if (!classId || !termId || !rollNumber.trim()) {
      notify.error('Class, term and roll number are required');
      return;
    }
    if (seated && !reason.trim()) {
      notify.error('Say why the pupil is moving — it is kept in their history');
      return;
    }
    try {
      await enroll.mutateAsync({
        studentProfileId,
        academicYearId: term.academicYearId,
        classId,
        sectionId: sectionId || undefined,
        termId,
        rollNumber: rollNumber.trim(),
        existingEnrollmentId: seated ? yearEnrollment.id : undefined,
        reason: reason.trim() || undefined,
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
                  <SelectItem key={t.id} value={t.id}>{t.label ?? t.name}{t.isCurrent ? ' (current)' : ''}</SelectItem>
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
            <Label>{labels.section}</Label>
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

          {seated && (
            <div>
              <Label>Why is the pupil moving? *</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="E.g. Parent request" />
              <p className="mt-1 text-xs text-muted-foreground">
                Already enrolled for this year — their current placement is end-dated, not overwritten.
              </p>
            </div>
          )}

          {blocked && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              This pupil&apos;s enrollment for {termName}&apos;s year is {yearEnrollment.status.toLowerCase()}. Reinstate
              it from the Enrollment workspace before placing them.
            </p>
          )}

          {history.length > 0 && (
            <div className="rounded border p-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Placement history</p>
              <ul className="space-y-0.5 text-xs">
                {history.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {p.classCohort?.schoolClass?.name ?? '—'}
                      {p.section?.name ? ` — ${p.section.name}` : ''}
                    </span>
                    <span className="text-muted-foreground">
                      {p.year} {p.term?.name ?? ''} · {p.effectiveTo ? 'ended' : 'current'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={enroll.isPending || !!blocked || !term}>
            {enroll.isPending ? 'Placing…' : seated ? 'Move pupil' : 'Place pupil'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
