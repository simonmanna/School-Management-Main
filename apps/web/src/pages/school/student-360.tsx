import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useStudent, useStudentPortal, useGuardians, useStudentStatement, useStudentAttendance,
  useStudentDocuments, useStudentMedical,
  useStudentLibrary, useStudentMeals, useStudentTransport, useStudentActivities,
  type Student, type FeeStatement, type Guardian,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const money = (n: number | string | null | undefined) => `UGX ${Number(n ?? 0).toLocaleString()}`;
const initials = (name?: string) => (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

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
  const { data: student, isLoading } = useStudent(id);
  const { data: portal } = useStudentPortal(id);
  const { data: guardians } = useGuardians(id);
  const { data: statement } = useStudentStatement(id);
  const { data: attendance } = useStudentAttendance(id);
  const { data: documents } = useStudentDocuments(id);
  const { data: medical } = useStudentMedical(id);
  const { data: library } = useStudentLibrary(id);
  const { data: meals } = useStudentMeals(id);
  const { data: transport } = useStudentTransport(id);
  const { data: activities } = useStudentActivities(id);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading student…</div>;
  if (!student) return <div className="p-6 text-sm text-muted-foreground">Student not found. <Link className="text-primary underline" to="/school/students">Back to students</Link></div>;

  const photo = (student.partner as any)?.customFields?.photoUrl as string | undefined;
  const cf = ((student as any).customFields ?? {}) as any;

  return (
    <div className="space-y-4 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/school/students')}>← Students</Button>

      {/* Identity header */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(student.partner?.name)}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold">{student.partner?.name}</h1>
            <p className="font-mono text-xs text-muted-foreground">{student.admissionNo} · ID {student.id.slice(0, 8)}</p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <Badge className={STATUS_META[student.status] ?? 'bg-slate-100'}>{student.status}</Badge>
              {cf.house && <Badge variant="outline">House {cf.house}</Badge>}
              <Badge variant="outline" className="capitalize">{student.residenceType}</Badge>
              {student.gender && <Badge variant="outline" className="capitalize">{student.gender}</Badge>}
              {student.currentClassId && <Badge variant="secondary">Class {student.currentClassId.slice(0, 6)}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="profile">
        <TabsList className="flex flex-wrap gap-1">
          {TABS.map((t) => <TabsTrigger key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="profile" className="pt-4"><ProfileTab student={student} guardians={guardians} cf={cf} /></TabsContent>
        <TabsContent value="academics" className="pt-4"><AcademicsTab portal={portal} /></TabsContent>
        <TabsContent value="attendance" className="pt-4"><AttendanceTab rows={attendance} /></TabsContent>
        <TabsContent value="assessments" className="pt-4"><AssessmentsTab portal={portal} /></TabsContent>
        <TabsContent value="behavior" className="pt-4"><BehaviorTab activities={activities} /></TabsContent>
        <TabsContent value="fees" className="pt-4"><FeesTab statement={statement} /></TabsContent>
        <TabsContent value="payments" className="pt-4"><FeesTab statement={statement} payments /></TabsContent>
        <TabsContent value="transport" className="pt-4"><TransportTab rows={transport} /></TabsContent>
        <TabsContent value="meals" className="pt-4"><MealsTab wallet={meals} /></TabsContent>
        <TabsContent value="library" className="pt-4"><LibraryTab rows={library} /></TabsContent>
        <TabsContent value="communication" className="pt-4"><CommunicationTab activities={activities} /></TabsContent>
        <TabsContent value="documents" className="pt-4"><DocumentsTab docs={documents} /></TabsContent>
        <TabsContent value="health" className="pt-4"><HealthTab medical={medical} /></TabsContent>
        <TabsContent value="activities" className="pt-4"><ActivitiesTab activities={activities} /></TabsContent>
      </Tabs>
    </div>
  );
}

const TABS = ['profile', 'academics', 'attendance', 'assessments', 'behavior', 'fees', 'payments', 'transport', 'meals', 'library', 'communication', 'documents', 'health', 'activities'] as const;

function ProfileTab({ student, guardians, cf }: { student: Student; guardians?: Guardian[]; cf: any }) {
  const rows: [string, string][] = [
    ['Admission no.', student.admissionNo],
    ['Student ID', student.id],
    ['Date of birth', cf.dateOfBirth ?? student.dateOfBirth ?? '—'],
    ['Gender', student.gender ?? '—'],
    ['Nationality', (student as any).nationality ?? '—'],
    ['Religion', (student as any).religion ?? '—'],
    ['House', cf.house ?? '—'],
    ['Residence', student.residenceType],
    ['Status', student.status],
    ['Enrolled', student.enrollmentDate ? new Date(student.enrollmentDate).toLocaleDateString() : '—'],
    ['Email', student.partner?.email ?? '—'],
    ['Phone', student.partner?.phone ?? '—'],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Demographics</CardTitle></CardHeader>
        <CardContent><dl className="grid grid-cols-2 gap-2 text-sm">
          {rows.map(([k, v]) => (<div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="capitalize">{String(v)}</dd></div>))}
        </dl></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Guardians & emergency contacts</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(guardians ?? []).length === 0 && <li className="text-muted-foreground">No guardians linked.</li>}
            {(guardians ?? []).map((g) => (
              <li key={g.id} className="rounded-md border p-2">
                <div className="font-medium">{g.contact?.firstName} {g.contact?.lastName ?? ''}</div>
                <div className="text-xs text-muted-foreground capitalize">{g.relationship}{g.isPrimary ? ' · primary' : ''} · {g.contact?.phone ?? 'no phone'}</div>
              </li>
            ))}
          </ul>
          {cf.emergencyContact && <p className="mt-3 text-xs text-muted-foreground">Emergency: {cf.emergencyContact}</p>}
          {cf.siblings && <p className="mt-1 text-xs text-muted-foreground">Siblings on roll: {cf.siblings}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function AcademicsTab({ portal }: { portal?: any }) {
  if (!portal?.publishedResults) return <Empty label="No published results yet — compute & publish a result set first." />;
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

function AttendanceTab({ rows }: { rows?: any[] }) {
  if (!rows) return <Empty label="No attendance records in range." />;
  const present = rows.filter((r) => r.status === 'present').length;
  const pct = rows.length ? ((present / rows.length) * 100).toFixed(1) : '0';
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Attendance — {rows.length} records · {pct}% present</CardTitle></CardHeader>
      <CardContent className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Date</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Late</th></tr></thead>
          <tbody>{rows.slice(0, 60).map((r, i) => (
            <tr key={i} className="border-b last:border-0"><td className="px-2 py-1">{new Date(r.date).toLocaleDateString()}</td><td className="px-2 py-1 capitalize">{r.status}</td><td className="px-2 py-1">{r.minutesLate ? `${r.minutesLate}m` : '—'}</td></tr>
          ))}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function FeesTab({ statement, payments }: { statement?: FeeStatement; payments?: boolean }) {
  if (!statement) return <Empty label="No fee statement." />;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{payments ? 'Payments' : 'Fees'}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Billed" value={money(statement.totalBilled)} />
        <Stat label="Paid" value={money(statement.totalPaid)} />
        <Stat label="Balance" value={money(statement.balance)} tone={statement.balance > 0 ? 'rose' : 'emerald'} />
      </CardContent>
    </Card>
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

function HealthTab({ medical }: { medical?: any }) {
  if (!medical) return <Empty label="No medical record." />;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Health</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Info k="Blood group" v={medical.bloodGroup ?? '—'} />
        <Info k="Allergies" v={(medical.allergies ?? []).join(', ') || '—'} />
        <Info k="Conditions" v={(medical.conditions ?? []).join(', ') || '—'} />
        <Info k="Notes" v={medical.notes ?? '—'} />
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
              <span>From: {new Date(t.startDate).toLocaleDateString()}</span>
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
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Date</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Amount</th><th className="px-2 py-1">Balance</th></tr></thead>
            <tbody>
              {txns.map((t: any) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-2 py-1">{new Date(t.createdAt).toLocaleDateString()}</td>
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
              <span>Borrowed: {new Date(b.borrowedAt).toLocaleDateString()}</span>
              <span>Due: {new Date(b.dueAt).toLocaleDateString()}</span>
              {b.returnedAt && <span>Returned: {new Date(b.returnedAt).toLocaleDateString()}</span>}
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
function Info({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs text-muted-foreground">{k}</dt><dd className="capitalize">{v}</dd></div>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{label}</div><div className={`font-semibold ${tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : ''}`}>{value}</div></div>;
}
