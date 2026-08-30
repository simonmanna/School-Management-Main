import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  GraduationCap, Users, Scale, Wallet, Landmark, ClipboardCheck, ClipboardList,
  CalendarCheck, ArrowRight, Trophy,
} from 'lucide-react';
import {
  useSchoolAdminDashboard,
  useSchoolFinanceDashboard,
  useSchoolAcademicDashboard,
  useSchoolAttendanceToday,
  useSchoolTopPerformers,
  useSchoolOutstandingByClass,
  useSchoolDailyCollections,
  useTerms,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const money = (n: number | undefined) =>
  (n ?? 0).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number | undefined) => (n ?? 0).toLocaleString('en-UG');

export function SchoolDashboardPage() {
  const { data: admin } = useSchoolAdminDashboard();
  const { data: fin } = useSchoolFinanceDashboard();
  const { data: academic } = useSchoolAcademicDashboard();
  const { data: attendance } = useSchoolAttendanceToday();
  const { data: top } = useSchoolTopPerformers(5);
  const { data: byClass } = useSchoolOutstandingByClass();
  const { data: collections } = useSchoolDailyCollections(30);
  const { data: terms } = useTerms();

  const currentTerm = terms?.data?.find((t) => t.isCurrent) ?? terms?.data?.[0];

  // Teacher:pupil ratio. This divided by ALL active staff — cooks, drivers,
  // bursary — and still called the result a teacher ratio. `teachers` counts
  // only staff whose category is teaching.
  const ratio = admin && admin.teachers > 0
    ? `1 : ${Math.round(admin.students / admin.teachers)}`
    : '—';

  const present = attendance?.present ?? 0;
  const absent = attendance?.absent ?? 0;
  const late = attendance?.late ?? 0;
  const marked = present + absent + late + (attendance?.excused ?? 0);

  // What is waiting on somebody. This is the reason the page exists — a
  // headteacher opening it needs to know what is stuck, not only what is done.
  const queue = [
    {
      label: 'Marks waiting for approval',
      value: academic?.awaitingApproval ?? 0,
      to: '/school/approvals',
      cta: 'Review approvals',
      icon: ClipboardCheck,
    },
    {
      label: 'Marks entered but not submitted',
      value: academic?.draft ?? 0,
      to: '/school/enter-marks',
      cta: 'Open mark entry',
      icon: ClipboardList,
    },
    {
      label: 'Marks sent back for correction',
      value: academic?.rejected ?? 0,
      to: '/school/approvals',
      cta: 'Review approvals',
      icon: ClipboardList,
    },
    {
      label: 'Registers taken today',
      value: marked,
      to: '/school/attendance',
      cta: 'Take attendance',
      icon: CalendarCheck,
      neutral: true,
    },
  ];

  const kpis = [
    { label: 'Pupils', value: admin?.students, icon: GraduationCap },
    { label: 'Staff', value: admin?.staff, icon: Users },
    { label: 'Classes', value: admin?.classes, icon: Landmark },
    { label: 'Teacher : pupil ratio', value: ratio, icon: Scale, raw: true },
  ];

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {currentTerm ? currentTerm.name : 'This term'} at a glance
        </h1>
        <p className="text-sm text-muted-foreground">
          What is waiting on someone, how the term is marked, and where the fees stand.
        </p>
      </div>

      {/* ── Work queue ─────────────────────────────────────────────────────
          The dashboard used to be finance and headcount only, so nothing on it
          ever told an administrator there was work outstanding. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {queue.map((q) => {
          const Icon = q.icon;
          const needsAction = !q.neutral && q.value > 0;
          return (
            <Card key={q.label} className={needsAction ? 'border-amber-500/50' : undefined}>
              <CardContent className="flex h-full flex-col justify-between gap-3 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{q.label}</p>
                    <p className={`mt-1 text-2xl font-bold ${needsAction ? 'text-amber-600' : ''}`}>
                      {academic === undefined && attendance === undefined
                        ? <Skeleton className="h-7 w-12" />
                        : int(q.value)}
                    </p>
                  </div>
                  <Icon className={`h-7 w-7 ${needsAction ? 'text-amber-500/70' : 'text-muted-foreground/50'}`} />
                </div>
                <Button asChild size="sm" variant={needsAction ? 'default' : 'ghost'} className="w-fit">
                  <Link to={q.to}>{q.cta} <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Headline counts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
                  {k.raw ? (
                    <p className="mt-1 text-2xl font-bold">{k.value as string}</p>
                  ) : (
                    <p className="mt-1 text-2xl font-bold">
                      {k.value === undefined ? <Skeleton className="h-7 w-16" /> : int(k.value as number)}
                    </p>
                  )}
                </div>
                <Icon className="h-8 w-8 text-muted-foreground/60" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Fees ────────────────────────────────────────────────────────────
          Both figures come straight from the canonical finance service. The
          previous "Invoiced Amount" tile added an all-time outstanding balance
          to one month of collections, which is not a quantity that means
          anything; "Deferred Revenue" was hardcoded to zero. Neither is worth
          showing over saying less, accurately. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Collected this month
              </p>
              <Wallet className="h-4 w-4 text-muted-foreground/60" />
            </div>
            <p className="mt-2 text-xl font-bold text-green-600">UGX {money(fin?.collectionsThisMonth)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Fees still owed
              </p>
              <Landmark className="h-4 w-4 text-muted-foreground/60" />
            </div>
            <p className="mt-2 text-xl font-bold text-orange-600">UGX {money(fin?.outstanding ?? admin?.outstandingFees)}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Marking progress + top of the school ──────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Marking this term</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {academic?.termId ? (
              <>
                <Row label="Marks entered" value={int(academic.totalMarks)} />
                <Row label="Approved" value={int(academic.approved)} />
                <Row label="Pass rate (approved marks)" value={`${academic.passRate}%`} />
                <Row label="Waiting for approval" value={int(academic.awaitingApproval)} warn={academic.awaitingApproval > 0} />
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link to="/school/results">Work out results <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                No term is marked current. <Link className="underline" to="/school/management/terms">Set the current term</Link> to see marking progress.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" /> Top of the school</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(top ?? []).length === 0 ? (
              <p className="text-muted-foreground">
                Nothing to show until this term’s results are released.
              </p>
            ) : (
              (top ?? []).map((t) => (
                <div key={t.id} className="flex items-center justify-between border-b pb-1 last:border-0">
                  <span>
                    <span className="font-medium">{t.classRank}.</span> {t.name ?? t.admissionNo}
                    {t.className && <span className="text-muted-foreground"> · {t.className}</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {t.meanPercent != null ? `${t.meanPercent}%` : ''}{t.division ? ` · Div ${t.division}` : ''}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Fee charts ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Fees owed, by class</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-base">Collections, last 14 days</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-base">Go to</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Link className="text-primary hover:underline" to="/school/students">Pupils &amp; guardians</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="text-primary hover:underline" to="/school/attendance">Attendance</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="text-primary hover:underline" to="/school/fees">Fees &amp; billing</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="text-primary hover:underline" to="/school/report-cards">Report cards</Link>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b pb-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${warn ? 'text-amber-600' : ''}`}>{value}</span>
    </div>
  );
}
