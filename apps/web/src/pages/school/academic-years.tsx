import { useQueryClient } from '@tanstack/react-query';
import { SimpleCrud } from './_components/simple-crud';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

type YearStatus = 'PLANNING' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

const TONE: Record<YearStatus, string> = {
  PLANNING: 'bg-slate-100 text-slate-700',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-amber-100 text-amber-800',
  ARCHIVED: 'bg-muted text-muted-foreground',
};

/** Mirrors YEAR_TRANSITIONS in academic-year.service.ts. */
const NEXT: Record<YearStatus, Array<{ to: YearStatus; label: string; confirm?: string; needsReason?: boolean }>> = {
  PLANNING: [
    { to: 'ACTIVE', label: 'Activate' },
    { to: 'ARCHIVED', label: 'Archive', confirm: 'Archive this planned year? It cannot be reopened.' },
  ],
  ACTIVE: [
    {
      to: 'CLOSED',
      label: 'Close',
      confirm: 'Close this year? Attendance, marks and fees for it become read-only, and its current term is cleared.',
    },
  ],
  CLOSED: [
    { to: 'ARCHIVED', label: 'Archive', confirm: 'Archive this year? An archived year can never be reopened.' },
    { to: 'ACTIVE', label: 'Reopen', needsReason: true },
  ],
  ARCHIVED: [],
};

/**
 * Academic years with their lifecycle (E2E audit Y1).
 *
 * `PATCH /school/academic-years/:id/status` existed with no screen, so a year
 * could never be closed or archived from the UI. Making a year current is
 * still the "Current year" switch in the form, and saving any other edit no
 * longer re-sends it (SimpleCrud sends only changed fields).
 */
export function SchoolAcademicYearsPage() {
  const qc = useQueryClient();

  const move = async (row: { id: string; name: string }, step: (typeof NEXT)[YearStatus][number]) => {
    if (step.confirm && !confirm(`${row.name}: ${step.confirm}`)) return;
    let reason: string | undefined;
    if (step.needsReason) {
      reason = prompt(`Reopening "${row.name}" makes its records writable again. Why?`)?.trim() || undefined;
      if (!reason) return;
    }
    try {
      await api.patch(`/school/academic-years/${row.id}/status`, { status: step.to, reason });
      notify.success(`${row.name} is now ${step.to.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ['school', 'academic-years'] });
      qc.invalidateQueries({ queryKey: ['school', 'terms'] });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not change the year');
    }
  };

  return (
    <SimpleCrud
      title="Academic Years"
      subtitle="Define the school's academic years, set the current one, and close a year when it ends."
      endpoint="academic-years"
      queryKey="academic-years"
      nameField="name"
      fields={[
        { name: 'name', label: 'Name', placeholder: '2025/2026', required: true },
        { name: 'startDate', label: 'Start Date', type: 'date', required: true },
        { name: 'endDate', label: 'End Date', type: 'date', required: true },
        { name: 'isCurrent', label: 'Current year', type: 'boolean' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        {
          key: 'status',
          label: 'Status',
          render: (r) => (
            <Badge variant="outline" className={`border-transparent ${TONE[(r.status ?? 'PLANNING') as YearStatus]}`}>
              {(r.status ?? 'PLANNING').toLowerCase()}
            </Badge>
          ),
        },
        { key: 'isCurrent', label: 'Current', render: (r) => (r.isCurrent ? '✓' : '') },
      ]}
      rowActions={(r) =>
        NEXT[(r.status ?? 'PLANNING') as YearStatus].map((step) => (
          <Button key={step.to} variant="ghost" size="sm" onClick={() => move(r, step)}>
            {step.label}
          </Button>
        ))
      }
    />
  );
}
