import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  useHrDepartments,
  useHrEmployees,
  useHrPayrollPeriods,
  useHrPayrollRuns,
  useHrPositions,
} from '@/features/hr/api';
import type { ReportCatalogEntry } from '@/features/reports/types';
import type { HrReportFilters } from '@/features/hr/reports-api';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * One filter bar for every HR report.
 *
 * It renders exactly the filters the server definition declares
 * (`meta.filters`) and marks the required ones, so the user is told what is
 * missing before the server has to refuse. There is no per-report filter
 * component and there should never be one: a report is data, and its controls
 * follow from its declaration.
 */

const REQUIRED_MARK = <span className="ml-0.5 text-destructive">*</span>;

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CASUAL', 'PROBATION'];
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="min-w-[11rem] flex-1">
      <Label className="text-xs text-muted-foreground">
        {label}{required ? REQUIRED_MARK : null}
      </Label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Select({
  value, onChange, options, placeholder,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function HrReportFilterBar({
  meta, filters, onChange,
}: {
  meta: ReportCatalogEntry;
  filters: HrReportFilters;
  onChange: (next: HrReportFilters) => void;
}) {
  const shows = useMemo(() => new Set(meta.filters), [meta.filters]);
  const required = useMemo(() => new Set(meta.requiredFilters), [meta.requiredFilters]);
  const set = (patch: Partial<HrReportFilters>) => onChange({ ...filters, ...patch });

  if (meta.filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-muted/20 p-3">
      {shows.has('payrollPeriodId') && (
        <PeriodField
          value={filters.payrollPeriodId}
          required={required.has('payrollPeriodId')}
          hint={!filters.payrollPeriodId && !filters.payrollRunId ? 'Latest run if left blank' : undefined}
          // Changing the period invalidates a run chosen under the old one.
          onChange={(v) => set({ payrollPeriodId: v, payrollRunId: undefined })}
        />
      )}

      {shows.has('payrollRunId') && (
        <RunField
          value={filters.payrollRunId}
          periodId={filters.payrollPeriodId}
          required={required.has('payrollRunId')}
          onChange={(v) => set({ payrollRunId: v })}
        />
      )}

      {shows.has('departmentId') && (
        <DepartmentField
          value={filters.departmentId}
          required={required.has('departmentId')}
          onChange={(v) => set({ departmentId: v })}
        />
      )}

      {shows.has('positionId') && (
        <PositionField
          value={filters.positionId}
          required={required.has('positionId')}
          onChange={(v) => set({ positionId: v })}
        />
      )}

      {shows.has('employeeId') && (
        <EmployeeField
          value={filters.employeeId}
          required={required.has('employeeId')}
          onChange={(v) => set({ employeeId: v })}
        />
      )}

      {shows.has('employmentType') && (
        <Field label="Employment type" required={required.has('employmentType')}>
          <Select
            value={filters.employmentType}
            placeholder="All types"
            options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase() }))}
            onChange={(v) => set({ employmentType: v })}
          />
        </Field>
      )}

      {shows.has('dateFrom') && (
        <Field label="From" required={required.has('dateFrom')}>
          <Input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => set({ dateFrom: e.target.value || undefined })}
          />
        </Field>
      )}

      {shows.has('dateTo') && (
        <Field label="To" required={required.has('dateTo')}>
          <Input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => set({ dateTo: e.target.value || undefined })}
          />
        </Field>
      )}

      {shows.has('status') && (
        <Field label="Status" required={required.has('status')}>
          <Select
            value={filters.status?.[0]}
            placeholder="Any status"
            options={LEAVE_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))}
            // The API takes an array; the bar offers one at a time, which is
            // what people actually filter by.
            onChange={(v) => set({ status: v ? [v] : undefined })}
          />
        </Field>
      )}
    </div>
  );
}

// ── Lookup-backed fields ─────────────────────────────────────────────────────
//
// Each owns its own query, and each is rendered only when the report declares
// the matching filter. That is why they are separate components rather than
// five `useQuery` calls in the bar: hooks cannot be called conditionally, so a
// single component would fetch the whole staff list to render a payroll
// register that has no employee filter at all.

const asOptions = (rows: any, label: (r: any) => string) =>
  ((rows?.rows ?? rows ?? []) as any[]).map((r) => ({ value: r.id, label: label(r) }));

type FieldProps = {
  value: string | undefined;
  required?: boolean;
  onChange: (v: string | undefined) => void;
};

function PeriodField({ value, required, hint, onChange }: FieldProps & { hint?: string }) {
  const { data } = useHrPayrollPeriods();
  return (
    <Field label="Pay period" required={required} hint={hint}>
      <Select
        value={value}
        placeholder="Latest period"
        options={asOptions(data, (p) => p.periodCode)}
        onChange={onChange}
      />
    </Field>
  );
}

function RunField({ value, periodId, required, onChange }: FieldProps & { periodId?: string }) {
  const { data } = useHrPayrollRuns(periodId ? { periodId } : {});
  return (
    <Field label="Payroll run" required={required}>
      <Select
        value={value}
        placeholder="Latest run"
        options={asOptions(data, (r) => `${r.runNumber} · ${r.status}`)}
        onChange={onChange}
      />
    </Field>
  );
}

function DepartmentField({ value, required, onChange }: FieldProps) {
  const { data } = useHrDepartments();
  return (
    <Field label="Department" required={required}>
      <Select value={value} placeholder="All departments" options={asOptions(data, (d) => d.name)} onChange={onChange} />
    </Field>
  );
}

function PositionField({ value, required, onChange }: FieldProps) {
  const { data } = useHrPositions();
  return (
    <Field label="Post" required={required}>
      <Select value={value} placeholder="All posts" options={asOptions(data, (p) => p.name ?? p.title)} onChange={onChange} />
    </Field>
  );
}

function EmployeeField({ value, required, onChange }: FieldProps) {
  const { data } = useHrEmployees({ pageSize: 500, isActive: 'true' });
  return (
    <Field label="Employee" required={required}>
      <Select
        value={value}
        placeholder="All employees"
        options={asOptions(data, (e) => `${e.employeeCode} · ${e.firstName}${e.lastName ? ' ' + e.lastName : ''}`)}
        onChange={onChange}
      />
    </Field>
  );
}
