import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { GraduationCap, UserPlus, Users, Scale, Receipt, Wallet, Landmark, PiggyBank } from 'lucide-react';
import {
  useSchoolAdminDashboard,
  useSchoolFinanceDashboard,
  useSchoolOutstandingByClass,
  useSchoolDailyCollections,
  useTerms,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const money = (n: number | undefined) =>
  (n ?? 0).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number | undefined) => (n ?? 0).toLocaleString('en-UG');

export function SchoolDashboardPage() {
  const { data: admin } = useSchoolAdminDashboard();
  const { data: fin } = useSchoolFinanceDashboard();
  const { data: byClass } = useSchoolOutstandingByClass();
  const { data: collections } = useSchoolDailyCollections(30);
  const { data: terms } = useTerms();
  const currentTerm = terms?.data?.find((t) => t.isCurrent) ?? terms?.data?.[0];
  const [year, term] = [currentTerm?.academicYearId, currentTerm?.name];

  // Teacher:student ratio (active staff vs students)
  const ratio = admin && admin.staff > 0 ? `1 : ${Math.round(admin.students / admin.staff)}` : '—';

  // Financial cards (UGX) — semantic colors per reference
  const invoiced = (admin?.outstandingFees ?? 0) + (fin?.collectionsThisMonth ?? 0);
  const financial = [
    { label: 'Invoiced Amount', value: invoiced, color: 'text-orange-600', icon: Receipt },
    { label: 'Collected Amount', value: fin?.collectionsThisMonth ?? 0, color: 'text-green-600', icon: Wallet },
    { label: 'Previous Balances', value: admin?.outstandingFees ?? 0, color: 'text-purple-600', icon: Landmark },
    { label: 'Deferred Revenue', value: 0, color: 'text-blue-600', icon: PiggyBank },
  ];

  const kpis = [
    { label: 'Total Students', value: admin?.students, icon: GraduationCap },
    { label: 'New Students', value: admin?.students, icon: UserPlus },
    { label: 'Total Staff', value: admin?.staff, icon: Users },
    { label: 'Teacher Student Ratio', value: ratio, icon: Scale, raw: true },
  ];

  // Charts — real data
  const outstandingChart = (byClass ?? []).map((c) => ({
    name: c.className,
    Outstanding: Number(c.outstanding),
  }));
  const collectionsChart = (collections ?? []).slice(-14).map((c) => ({
    name: c.date.slice(5),
    Collected: Number(c.total),
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dashboard for {currentTerm ? currentTerm.name : 'Current Term'}
          </h1>
          <p className="text-sm text-muted-foreground">Enrolment, staffing and school finances at a glance.</p>
        </div>
        <div className="flex gap-2">
          <select className="w-28 rounded-md border bg-card px-3 py-2 text-sm">
            <option>{year ? '2025' : 'Year'}</option>
          </select>
          <select className="w-32 rounded-md border bg-card px-3 py-2 text-sm">
            <option>{term ?? 'Term'}</option>
          </select>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
                  {k.raw ? (
                    <p className="mt-1 text-2xl font-bold">{k.value}</p>
                  ) : (
                    <p className="mt-1 text-2xl font-bold">{k.value === undefined ? <Skeleton className="h-7 w-16" /> : int(k.value as number)}</p>
                  )}
                </div>
                <Icon className="h-8 w-8 text-muted-foreground/60" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Financial row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {financial.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</p>
                  <Icon className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <p className={`mt-2 text-xl font-bold ${f.color}`}>UGX {money(f.value)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Outstanding by Category</CardTitle>
            <div className="flex gap-2">
              <select className="w-24 rounded-md border bg-card px-2 py-1 text-xs"><option>2025</option></select>
              <select className="w-24 rounded-md border bg-card px-2 py-1 text-xs"><option>{term ?? 'Term 1'}</option></select>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={outstandingChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="Outstanding" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Collections (last 14 days)</CardTitle>
            <div className="flex gap-2">
              <select className="w-24 rounded-md border bg-card px-2 py-1 text-xs"><option>2025</option></select>
              <select className="w-24 rounded-md border bg-card px-2 py-1 text-xs"><option>{term ?? 'Term 1'}</option></select>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={collectionsChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="Collected" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Quick links</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Link className="text-primary hover:underline" to="/school/students">Students &amp; guardians</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="text-primary hover:underline" to="/school/fees">Fees &amp; billing</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="text-primary hover:underline" to="/school/transport">Transport</Link>
        </CardContent>
      </Card>
    </div>
  );
}
