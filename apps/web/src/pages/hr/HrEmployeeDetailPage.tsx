import { useParams, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useHrEmployee } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const fmt = (n: number | string | null) =>
  n === null || n === undefined ? '—' : `Rp ${Number(n).toLocaleString('id-ID')}`;

const EMP_TYPE_STYLE: Record<string, string> = {
  FULL_TIME: 'bg-emerald-100 text-emerald-800',
  PART_TIME: 'bg-sky-100 text-sky-800',
  CONTRACT: 'bg-violet-100 text-violet-800',
  INTERN: 'bg-amber-100 text-amber-800',
  CASUAL: 'bg-muted text-muted-foreground',
  PROBATION: 'bg-cyan-100 text-cyan-800',
};

const ADVANCE_STATUS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-cyan-100 text-cyan-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  SETTLED: 'bg-sky-100 text-sky-800',
  REJECTED: 'bg-muted text-muted-foreground',
};

const LOAN_STATUS: Record<string, string> = {
  ACTIVE: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  DEFAULTED: 'bg-rose-100 text-rose-800',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between border-b py-2 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-right">{value ?? '—'}</dd>
    </div>
  );
}

export function HrEmployeeDetailPage() {
  const { id } = useParams();
  const { data: emp, isLoading } = useHrEmployee(id);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!emp) return <div className="p-6 text-sm text-muted-foreground">Employee not found.</div>;

  return (
    <div className="space-y-4 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/hr" className="hover:text-foreground">Workforce</Link>
        <ChevronRight className="h-3 w-3" />
        <Link to="/hr/employees" className="hover:text-foreground">Employees</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{emp.employeeCode}</span>
      </nav>

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold">
            {emp.firstName?.[0]}{emp.lastName?.[0] ?? ''}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{emp.firstName}{emp.lastName ? ' ' + emp.lastName : ''}</h1>
              <Badge variant="outline" className={EMP_TYPE_STYLE[emp.employmentType] ?? ''}>
                {emp.employmentType.replace(/_/g, ' ')}
              </Badge>
              {!emp.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{emp.employeeCode} · {emp.department?.name ?? 'No department'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Employment & pay */}
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Employment & pay</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <dl>
              <InfoRow label="Position" value={emp.position?.name} />
              <InfoRow label="Department" value={emp.department?.name} />
              <InfoRow label="Supervisor" value={emp.supervisor ? `${emp.supervisor.firstName}${emp.supervisor.lastName ? ' ' + emp.supervisor.lastName : ''}` : null} />
              <InfoRow label="Hire date" value={emp.hireDate ? new Date(emp.hireDate).toLocaleDateString('id-ID') : null} />
              <InfoRow label="Base salary" value={fmt(emp.baseSalary)} />
              <InfoRow label="Pay frequency" value={emp.payFrequency.replace(/_/g, ' ')} />
              <InfoRow label="Hourly rate" value={fmt(emp.hourlyRate)} />
            </dl>
          </CardContent>
        </Card>

        {/* Contact & banking */}
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Contact & banking</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <dl>
              <InfoRow label="Email" value={emp.email} />
              <InfoRow label="Phone" value={emp.phone} />
              <InfoRow label="Bank" value={emp.bankName} />
              <InfoRow label="Account name" value={emp.bankAccountName} />
              <InfoRow label="Account number" value={emp.bankAccountNumber} />
              <InfoRow label="Mobile money" value={emp.mobileMoneyNumber ? `${emp.mobileMoneyProvider ?? ''} ${emp.mobileMoneyNumber}`.trim() : null} />
              <InfoRow label="Tax number" value={emp.taxNumber} />
            </dl>
          </CardContent>
        </Card>

        {/* Leave balances */}
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Leave balances {new Date().getFullYear()}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {emp.leaveBalances?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No leave balances.</p>}
              {emp.leaveBalances?.map((b: any) => {
                const remaining = Number(b.accruedDays) + Number(b.adjustedDays) - Number(b.usedDays);
                return (
                  <div key={b.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{b.leaveType?.name}</p>
                      <p className="text-xs text-muted-foreground">{Number(b.accruedDays)} accrued · {Number(b.usedDays)} used</p>
                    </div>
                    <span className="text-sm font-semibold">{remaining} day(s)</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Advances */}
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Salary advances</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {emp.salaryAdvances?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No advances.</p>}
              {emp.salaryAdvances?.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{a.advanceCode}</p>
                    <p className="text-xs text-muted-foreground">Balance {fmt(a.balance)} · Rp {Number(a.monthlyDeduction).toLocaleString('id-ID')}/mo</p>
                  </div>
                  <Badge variant="outline" className={ADVANCE_STATUS[a.status] ?? ''}>{a.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Loans */}
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Employee loans</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {emp.loans?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No loans.</p>}
              {emp.loans?.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{l.loanCode}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.installmentsPaid}/{l.installmentsTotal} paid · Balance {fmt(l.balance)}
                    </p>
                  </div>
                  <Badge variant="outline" className={LOAN_STATUS[l.status] ?? ''}>{l.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
