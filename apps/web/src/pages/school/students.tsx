import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, GraduationCap, UserPlus, X, Zap } from 'lucide-react';
import {
  useStudents,
  useCreateStudent,
  useUpdateStudent,
  useClasses,
  useSections,
  useStreams,
  useTerms,
  useRegisterStudent,
  useGuardians,
  useCreateGuardian,
  useStudentStatement,
  type Student,
  type StudentStatus,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const STATUS_META: Record<StudentStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-amber-100 text-amber-700',
  transferred: 'bg-sky-100 text-sky-700',
  withdrawn: 'bg-rose-100 text-rose-700',
  alumni: 'bg-slate-100 text-slate-700',
};

const money = (n: number | string) => `UGX ${Number(n).toLocaleString()}`;

export function SchoolStudentsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Student | null>(null);

  const { data, isLoading } = useStudents({ search: search || undefined, pageSize: 50 });
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: streams } = useStreams();
  const { data: terms } = useTerms();
  const create = useCreateStudent();
  const register = useRegisterStudent();
  const update = useUpdateStudent();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const classNameById = useMemo(
    () => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])),
    [classes],
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ enrollmentDate: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };

  const submit = async () => {
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          dto: {
            name: form.name || undefined,
            email: form.email || undefined,
            phone: form.phone || undefined,
            gender: (form.gender || undefined) as 'male' | 'female' | 'other' | undefined,
            // Class is absent by design: moving a pupil is an enrolment, made
            // from the pupil's record. Editing it here changed only the profile
            // mirror and left the academic record behind.
            residenceType: (form.residenceType || undefined) as 'day' | 'boarder' | undefined,
          },
        });
        notify.success('Student updated');
      } else {
        await create.mutateAsync({
          name: form.name,
          admissionNo: form.admissionNo,
          enrollmentDate: form.enrollmentDate,
          email: form.email || undefined,
          phone: form.phone || undefined,
          gender: (form.gender || undefined) as 'male' | 'female' | 'other' | undefined,
          currentClassId: form.currentClassId || undefined,
          residenceType: (form.residenceType || undefined) as 'day' | 'boarder' | undefined,
        });
        notify.success('Student admitted');
      }
      setOpen(false);
    } catch (e) {
      notify.error('Could not save student');
    }
  };

  // ── Quick "register & place" — one action creates the student AND enrolls them. ──
  const [quick, setQuick] = useState<Record<string, string>>({});
  const quickSubmit = async () => {
    try {
      if (!quick.name?.trim() || !quick.classId || !quick.termId || !quick.rollNumber?.trim()) {
        notify.error('Name, class, term and roll number are required');
        return;
      }
      await register.mutateAsync({
        name: quick.name.trim(),
        admissionNo: quick.admissionNo?.trim() || undefined,
        dateOfBirth: quick.dateOfBirth || null,
        gender: (quick.gender || undefined) as 'male' | 'female' | 'other' | null,
        classId: quick.classId,
        sectionId: quick.sectionId || null,
        streamId: quick.streamId || null,
        termId: quick.termId,
        rollNumber: quick.rollNumber.trim(),
        guardianName: quick.guardianName?.trim() || undefined,
        guardianPhone: quick.guardianPhone?.trim() || undefined,
        guardianRelationship: quick.guardianRelationship?.trim() || undefined,
      });
      notify.success('Student registered and placed');
      setQuickOpen(false);
      setQuick({});
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not register student');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Students</h1>
          <p className="text-sm text-muted-foreground">Admissions, class placement and guardians.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Admit student
        </Button>
        <Button variant="secondary" onClick={() => setQuickOpen(true)}>
          <Zap className="h-4 w-4" /> Quick register &amp; place
        </Button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or admission no…"
        className="w-72 rounded-md border bg-card px-3 py-2 text-sm"
      />

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Admission no.</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Class</th>
                <th className="px-4 py-2 font-medium">Residence</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No students yet. Admit your first student.</td></tr>
              )}
              {rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-xs">{s.admissionNo}</td>
                  <td className="px-4 py-2">
                    <Link className="font-medium text-primary hover:underline" to={`/school/students/${s.id}`}>
                      {s.partner?.name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{s.currentClassId ? classNameById[s.currentClassId] ?? '—' : '—'}</td>
                  <td className="px-4 py-2 capitalize">{s.residenceType ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge className={STATUS_META[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/school/students/${s.id}`)}>Edit</Button>
                    <Link to={`/school/students/${s.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit student' : 'Admit student'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name" required>
              <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Admission no." required>
              <Input value={form.admissionNo ?? ''} disabled={!!editing} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} />
            </Field>
            {!editing && (
              <Field label="Enrollment date" required>
                <Input type="date" value={form.enrollmentDate ?? ''} onChange={(e) => setForm({ ...form, enrollmentDate: e.target.value })} />
              </Field>
            )}
            <Field label="Gender">
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.gender ?? ''} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Class">
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.currentClassId ?? ''} onChange={(e) => setForm({ ...form, currentClassId: e.target.value })}>
                <option value="">—</option>
                {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Residence">
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.residenceType ?? ''} onChange={(e) => setForm({ ...form, residenceType: e.target.value })}>
                <option value="">—</option>
                <option value="day">Day</option>
                <option value="boarder">Boarder</option>
              </select>
            </Field>
            <Field label="Email"><Input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || !form.name || (!editing && (!form.admissionNo || !form.enrollmentDate))}>
              {editing ? 'Save' : 'Admit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detail && <StudentDetail student={detail} onClose={() => setDetail(null)} classNameById={classNameById} money={money} />}

      <QuickRegisterDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        form={quick}
        setForm={setQuick}
        terms={terms?.data ?? []}
        classes={classes?.data ?? []}
        sections={sections?.data ?? []}
        streams={streams?.data ?? []}
        onSubmit={quickSubmit}
        busy={register.isPending}
      />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>
      {children}
    </div>
  );
}

function StudentDetail({
  student,
  onClose,
  classNameById,
  money,
}: {
  student: Student;
  onClose: () => void;
  classNameById: Record<string, string>;
  money: (n: number | string) => string;
}) {
  const { data: guardians } = useGuardians(student.id);
  const { data: statement } = useStudentStatement(student.id);
  const createGuardian = useCreateGuardian();
  const [gForm, setGForm] = useState<Record<string, string>>({ relationship: 'guardian' });
  const [gOpen, setGOpen] = useState(false);

  const addGuardian = async () => {
    try {
      await createGuardian.mutateAsync({
        studentProfileId: student.id,
        guardian: { firstName: gForm.firstName, lastName: gForm.lastName || undefined, phone: gForm.phone || undefined, email: gForm.email || undefined },
        relationship: gForm.relationship,
        isPrimary: gForm.isPrimary === 'yes',
        receivesStatements: true,
      });
      notify.success('Guardian added');
      setGOpen(false);
      setGForm({ relationship: 'guardian' });
    } catch {
      notify.error('Could not add guardian');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><GraduationCap className="h-5 w-5" /> {student.partner?.name}</h2>
            <p className="font-mono text-xs text-muted-foreground">{student.admissionNo}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Info k="Class" v={student.currentClassId ? classNameById[student.currentClassId] : '—'} />
          <Info k="Residence" v={student.residenceType ?? '—'} />
          <Info k="Gender" v={student.gender ?? '—'} />
          <Info k="Status" v={student.status} />
          <Info k="Email" v={student.partner?.email ?? '—'} />
          <Info k="Phone" v={student.partner?.phone ?? '—'} />
        </dl>

        {statement && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Fees</h3>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <Stat label="Billed" value={money(statement.totalBilled)} />
              <Stat label="Paid" value={money(statement.collected)} />
              <Stat label="Balance" value={money(statement.balance)} tone={statement.balance > 0 ? 'rose' : 'emerald'} />
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Guardians</h3>
            <Button variant="ghost" size="sm" onClick={() => setGOpen((v) => !v)}><UserPlus className="h-4 w-4" /> Add</Button>
          </div>
          <ul className="space-y-2 text-sm">
            {(guardians ?? []).length === 0 && <li className="text-muted-foreground">No guardians linked.</li>}
            {(guardians ?? []).map((g) => (
              <li key={g.id} className="rounded-md border p-2">
                <div className="font-medium">{g.contact?.firstName} {g.contact?.lastName ?? ''}</div>
                <div className="text-xs text-muted-foreground capitalize">{g.relationship}{g.isPrimary ? ' · primary' : ''} · {g.contact?.phone ?? 'no phone'}</div>
              </li>
            ))}
          </ul>

          {gOpen && (
            <div className="mt-3 space-y-2 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="First name" value={gForm.firstName ?? ''} onChange={(e) => setGForm({ ...gForm, firstName: e.target.value })} />
                <Input placeholder="Last name" value={gForm.lastName ?? ''} onChange={(e) => setGForm({ ...gForm, lastName: e.target.value })} />
                <Input placeholder="Phone" value={gForm.phone ?? ''} onChange={(e) => setGForm({ ...gForm, phone: e.target.value })} />
                <select className="rounded-md border bg-card px-3 py-2 text-sm" value={gForm.relationship} onChange={(e) => setGForm({ ...gForm, relationship: e.target.value })}>
                  {['father', 'mother', 'guardian', 'uncle', 'aunt', 'sibling', 'grandparent', 'other'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <Button size="sm" onClick={addGuardian} disabled={!gForm.firstName || createGuardian.isPending}>Save guardian</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="capitalize">{v}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : ''}`}>{value}</div>
    </div>
  );
}

/**
 * Quick "register & place" — the one-screen path a secretary uses at the front desk.
 * Creates the student and enrolls them in a class in a single server transaction,
 * so there is no second "now assign a class" step. Guardian is optional; if given,
 * a Contact is created and linked inline.
 */
function QuickRegisterDialog({
  open, onOpenChange, form, setForm, terms, classes, sections, streams, onSubmit, busy,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  form: Record<string, string>; setForm: (v: Record<string, string>) => void;
  terms: any[]; classes: any[]; sections: any[]; streams: any[];
  onSubmit: () => void; busy: boolean;
}) {
  const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Quick register &amp; place</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Register the pupil and place them in a class in one step.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Full name *</Label>
              <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="E.g. Isabelle Atweoki" />
            </div>
            <div>
              <Label>Admission no.</Label>
              <Input value={form.admissionNo ?? ''} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} placeholder="Auto if blank" />
            </div>
            <div>
              <Label>Date of birth</Label>
              <Input type="date" value={form.dateOfBirth ?? ''} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </div>
            <div>
              <Label>Gender</Label>
              <select className={sel} value={form.gender ?? ''} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <Label>Term *</Label>
              <select className={sel} value={form.termId ?? ''} onChange={(e) => setForm({ ...form, termId: e.target.value })}>
                <option value="">Choose term</option>
                {(terms ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Class *</Label>
              <select className={sel} value={form.classId ?? ''} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                <option value="">Choose class</option>
                {(classes ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Section</Label>
              <select className={sel} value={form.sectionId ?? ''} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">—</option>
                {(sections ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Stream</Label>
              <select className={sel} value={form.streamId ?? ''} onChange={(e) => setForm({ ...form, streamId: e.target.value })}>
                <option value="">—</option>
                {(streams ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Roll number *</Label>
              <Input value={form.rollNumber ?? ''} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} placeholder="E.g. 23" />
            </div>
            <div>
              <Label>Guardian name</Label>
              <Input value={form.guardianName ?? ''} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <Label>Guardian phone</Label>
              <Input value={form.guardianPhone ?? ''} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <Label>Relationship</Label>
              <select className={sel} value={form.guardianRelationship ?? ''} onChange={(e) => setForm({ ...form, guardianRelationship: e.target.value })}>
                <option value="">—</option>
                {['father', 'mother', 'guardian', 'uncle', 'aunt', 'sibling', 'grandparent', 'other'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={busy}><Zap className="h-4 w-4" /> Register &amp; place</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
