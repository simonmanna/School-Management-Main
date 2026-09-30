import { formatCurrency } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, GraduationCap, UserPlus, X, Zap } from 'lucide-react';
import {
  useStudents,
  useClasses,
  useSections,
  useGuardians,
  useCreateGuardian,
  useStudentStatement,
  type Student,
  type StudentStatus, useTerminology } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import { ListPager, QueryError } from '@/components/query-state';

const STATUS_META: Record<StudentStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-amber-100 text-amber-700',
  transferred: 'bg-sky-100 text-sky-700',
  withdrawn: 'bg-rose-100 text-rose-700',
  alumni: 'bg-slate-100 text-slate-700',
  applicant: 'bg-slate-100 text-slate-700',
  graduated: 'bg-violet-100 text-violet-700',
  deceased: 'bg-zinc-200 text-zinc-700',
  archived: 'bg-muted text-muted-foreground',
};

// The school's own currency (Organization.currencyCode), not a hard-coded UGX.
const money = (n: number | string | null | undefined) => formatCurrency(n);

export function SchoolStudentsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Student | null>(null);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const [classFilter, setClassFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const { data, isLoading, isError, error, refetch } = useStudents({
    search: search || undefined,
    classId: classFilter || undefined,
    sectionId: sectionFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const total = data?.meta?.total ?? 0;
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const vocab = useTerminology();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const classNameById = useMemo(
    () => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])),
    [classes],
  );

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Students</h1>
          <p className="text-sm text-muted-foreground">Admissions, class placement and guardians.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate('/school/students/new')}>
            <Plus className="h-4 w-4" /> Admit student
          </Button>
          <Button variant="secondary" onClick={() => navigate('/school/students/register')}>
            <Zap className="h-4 w-4" /> Quick register &amp; place
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name or admission no…"
          aria-label="Search pupils"
          className="w-72 max-w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
        <select
          aria-label="Filter by class"
          className="rounded-md border bg-card px-3 py-2 text-sm"
          value={classFilter}
          onChange={(e) => { setClassFilter(e.target.value); setSectionFilter(''); setPage(1); }}
        >
          <option value="">All classes</option>
          {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {classFilter && (sections?.data ?? []).some((x: any) => x.classId === classFilter) && (
          <select
            aria-label={`Filter by ${vocab.section.toLowerCase()}`}
            className="rounded-md border bg-card px-3 py-2 text-sm"
            value={sectionFilter}
            onChange={(e) => { setSectionFilter(e.target.value); setPage(1); }}
          >
            <option value="">All {vocab.sectionPlural.toLowerCase()}</option>
            {(sections?.data ?? []).filter((x: any) => x.classId === classFilter).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
      </div>

      {isError && <QueryError error={error} onRetry={() => void refetch()} />}

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
              {!isLoading && !isError && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {search || classFilter ? 'No pupils match these filters.' : 'No students yet. Admit your first student.'}
                </td></tr>
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
          {!isError && <ListPager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} noun="pupils" />}
        </CardContent>
      </Card>

      {detail && <StudentDetail student={detail} onClose={() => setDetail(null)} classNameById={classNameById} money={money} />}

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
