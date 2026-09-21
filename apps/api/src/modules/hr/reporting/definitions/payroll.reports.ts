import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { HrReportDeps } from '../hr-report-deps';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Payroll reports.
 *
 * Every one of these is a presentation of the SAME stored `HrPayrollItem` rows
 * that the payslips and the GL journal were built from. None of them
 * recalculates pay. That is what makes the register, the PAYE return, the
 * statutory schedule and the bank list agree with each other and with the
 * ledger — a report that recomputed would drift the moment a tax table changed.
 *
 * All of them additionally require `hr:payroll`: an HR officer who may read
 * employee records has no business seeing what every colleague is paid.
 */
export function payrollReports(deps: HrReportDeps): ReportDefinition<any>[] {
  const PAYROLL = [PERMISSIONS.hr.payroll];
  const READ = PERMISSIONS.hr.readReports;

  /** Every payroll report names the run it is about, on its face. */
  const runCaption = (run: any, suffix = '') =>
    `${run.runNumber} · ${run.period?.periodCode ?? ''} · ${run.status}${suffix ? ` · ${suffix}` : ''}`;

  /** A reversed or unapproved run is not evidence of anything. Say so. */
  const statusNotes = (run: any): string[] => {
    const notes: string[] = [];
    if (run.status === 'DRAFT' || run.status === 'CALCULATED') {
      notes.push(
        `Run ${run.runNumber} is ${run.status} and has not been approved. These figures are provisional and are not in the ledger.`,
      );
    }
    if (run.status === 'REVERSED') {
      notes.push(`Run ${run.runNumber} has been REVERSED — the ledger no longer carries these amounts.`);
    }
    return notes;
  };

  return [
    {
      key: 'payroll.register',
      title: 'Payroll Register',
      domain: 'payroll',
      description:
        'One row per employee for a payroll run: days paid, basic, allowances, every deduction and net pay. The master payroll document.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['payrollRunId', 'payrollPeriodId', 'departmentId', 'employeeId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'employeeCode', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 22 },
        { key: 'department', label: 'Department', type: 'string', width: 16 },
        { key: 'payslipNumber', label: 'Payslip', type: 'string', width: 12, hideOn: ['screen'] },
        { key: 'paidDays', label: 'Days', type: 'int', width: 7, align: 'right' },
        { key: 'basicPay', label: 'Basic', type: 'money', width: 13, total: 'sum' },
        { key: 'overtimePay', label: 'Overtime', type: 'money', width: 12, total: 'sum' },
        { key: 'allowances', label: 'Allowances', type: 'money', width: 13, total: 'sum' },
        { key: 'bonus', label: 'Bonus', type: 'money', width: 12, total: 'sum' },
        { key: 'grossPay', label: 'Gross', type: 'money', width: 14, total: 'sum' },
        { key: 'paye', label: 'PAYE', type: 'money', width: 12, total: 'sum' },
        { key: 'pension', label: 'Pension', type: 'money', width: 12, total: 'sum' },
        { key: 'socialSecurity', label: 'Social sec.', type: 'money', width: 12, total: 'sum' },
        { key: 'loanRepayment', label: 'Loans', type: 'money', width: 12, total: 'sum' },
        { key: 'advanceRepayment', label: 'Advances', type: 'money', width: 12, total: 'sum' },
        { key: 'otherDeductions', label: 'Other', type: 'money', width: 12, total: 'sum' },
        { key: 'totalDeductions', label: 'Deductions', type: 'money', width: 14, total: 'sum' },
        { key: 'netPay', label: 'Net pay', type: 'money', width: 14, total: 'sum' },
      ],
      async run(_ctx, params) {
        const { run, rows } = await deps.data.payrollRegister(params);
        return {
          rows,
          caption: `Payroll Register · ${runCaption(run, `${rows.length} employee(s)`)}`,
          notes: statusNotes(run),
        };
      },
    },

    {
      key: 'payroll.paye-return',
      title: 'PAYE Return',
      domain: 'payroll',
      description:
        'Per-employee PAYE schedule for a period: gross, deductible contributions, chargeable income and tax due. The filing worksheet.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['payrollRunId', 'payrollPeriodId', 'departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'employeeName', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'taxNumber', label: 'TIN', type: 'string', width: 14 },
        { key: 'department', label: 'Department', type: 'string', width: 16 },
        { key: 'grossPay', label: 'Gross pay', type: 'money', width: 15, total: 'sum' },
        { key: 'pension', label: 'Pension', type: 'money', width: 13, total: 'sum' },
        { key: 'socialSecurity', label: 'Social sec.', type: 'money', width: 13, total: 'sum' },
        { key: 'chargeableIncome', label: 'Chargeable', type: 'money', width: 15, total: 'sum' },
        { key: 'payeDue', label: 'PAYE due', type: 'money', width: 15, total: 'sum' },
      ],
      async run(_ctx, params) {
        const { run, rows } = await deps.data.payeReturn(params);
        const missingTin = rows.filter((r: any) => !r.taxNumber && r.payeDue > 0).length;
        const notes = statusNotes(run);
        if (missingTin > 0) {
          // A return filed without a TIN cannot be matched to the taxpayer, so
          // this is a filing blocker, not a cosmetic gap.
          notes.push(`${missingTin} employee(s) owe PAYE but have no tax number recorded — the return cannot be filed until those are captured.`);
        }
        return {
          rows,
          caption: `PAYE Return · ${runCaption(run, `${rows.length} employee(s)`)}`,
          notes,
        };
      },
    },

    {
      key: 'payroll.statutory-schedule',
      title: 'Pension & Social Security Schedule',
      domain: 'payroll',
      description:
        'Contribution schedule for the pension and social security funds: member numbers, wage and amount remitted per employee.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['payrollRunId', 'payrollPeriodId', 'departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'employeeName', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'socialSecurityNumber', label: 'Social sec. no.', type: 'string', width: 16 },
        { key: 'pensionNumber', label: 'Pension no.', type: 'string', width: 16 },
        { key: 'grossPay', label: 'Wage', type: 'money', width: 15, total: 'sum' },
        { key: 'pension', label: 'Pension', type: 'money', width: 14, total: 'sum' },
        { key: 'socialSecurity', label: 'Social sec.', type: 'money', width: 14, total: 'sum' },
        { key: 'total', label: 'Total remitted', type: 'money', width: 15, total: 'sum' },
      ],
      async run(_ctx, params) {
        const { run, rows } = await deps.data.statutorySchedule(params);
        const missingNumber = rows.filter(
          (r: any) => !r.socialSecurityNumber && r.socialSecurity > 0,
        ).length;
        const notes = statusNotes(run);
        if (missingNumber > 0) {
          notes.push(`${missingNumber} contributing employee(s) have no social security number — the fund cannot credit their account.`);
        }
        return {
          rows,
          caption: `Statutory Schedule · ${runCaption(run, `${rows.length} contributor(s)`)}`,
          notes,
        };
      },
    },

    {
      key: 'payroll.bank-schedule',
      title: 'Bank Payment Schedule',
      domain: 'payroll',
      description:
        'The net-pay instruction list: account name, number and amount per employee, with anyone lacking payment details flagged.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['payrollRunId', 'payrollPeriodId', 'departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'employeeName', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'method', label: 'Method', type: 'enum', width: 14 },
        { key: 'bankName', label: 'Bank', type: 'string', width: 18 },
        { key: 'accountName', label: 'Account name', type: 'string', width: 22 },
        { key: 'accountNumber', label: 'Account no.', type: 'string', width: 20 },
        { key: 'netPay', label: 'Amount', type: 'money', width: 16, total: 'sum' },
        { key: 'status', label: 'Status', type: 'string', width: 20 },
      ],
      async run(_ctx, params) {
        const { run, rows } = await deps.data.bankSchedule(params);
        const unpayable = rows.filter((r: any) => r.method === 'UNSET');
        const notes = statusNotes(run);
        if (unpayable.length > 0) {
          notes.push(
            `${unpayable.length} employee(s) have NO bank or mobile money account and will not be paid by this schedule: ` +
              unpayable.slice(0, 10).map((r: any) => r.employeeName).join(', ') +
              (unpayable.length > 10 ? ', …' : ''),
          );
        }
        return {
          rows,
          caption: `Bank Payment Schedule · ${runCaption(run, `${rows.length} payee(s)`)}`,
          notes,
        };
      },
    },

    {
      key: 'payroll.cost-by-department',
      title: 'Payroll Cost by Department',
      domain: 'payroll',
      description:
        'What a payroll run cost each department: headcount, gross, statutory deductions and net.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['payrollRunId', 'payrollPeriodId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 500,
      defaultSort: { key: 'grossPay', order: 'desc' },
      columns: [
        { key: 'department', label: 'Department', type: 'string', width: 26 },
        { key: 'headcount', label: 'Staff', type: 'int', width: 8, align: 'right', total: 'sum' },
        { key: 'grossPay', label: 'Gross', type: 'money', width: 16, total: 'sum' },
        { key: 'paye', label: 'PAYE', type: 'money', width: 14, total: 'sum' },
        { key: 'statutory', label: 'Pension + SS', type: 'money', width: 14, total: 'sum' },
        { key: 'otherDeductions', label: 'Other', type: 'money', width: 14, total: 'sum' },
        { key: 'netPay', label: 'Net pay', type: 'money', width: 16, total: 'sum' },
      ],
      async run(_ctx, params) {
        const { run, rows } = await deps.data.payrollCostByDepartment(params);
        return {
          rows,
          caption: `Payroll Cost by Department · ${runCaption(run)}`,
          notes: statusNotes(run),
        };
      },
    },

    {
      key: 'payroll.variance',
      title: 'Payroll Variance vs Previous Period',
      domain: 'payroll',
      description:
        'Per-employee change in net pay against the previous run, largest movement first. Joiners and leavers are shown as such.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['payrollRunId', 'payrollPeriodId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'variance', order: 'desc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'priorNet', label: 'Previous net', type: 'money', width: 15, total: 'sum' },
        { key: 'currentNet', label: 'Current net', type: 'money', width: 15, total: 'sum' },
        { key: 'variance', label: 'Change', type: 'money', width: 15, total: 'sum' },
        { key: 'variancePct', label: 'Change %', type: 'percent', width: 11 },
        { key: 'note', label: 'Note', type: 'string', width: 16 },
      ],
      async run(_ctx, params) {
        const { run, prior, rows } = await deps.data.payrollVariance(params);
        const notes = statusNotes(run);
        if (!prior) {
          notes.push('No earlier payroll run was found, so every employee is compared against zero.');
        }
        return {
          rows,
          caption: prior
            ? `Payroll Variance · ${run.period?.periodCode} vs ${prior.period?.periodCode}`
            : `Payroll Variance · ${run.period?.periodCode} (no prior period)`,
          notes,
        };
      },
    },

    {
      key: 'payroll.readiness',
      title: 'Payroll Readiness Check',
      domain: 'payroll',
      description:
        'Active employees whose record would make payroll wrong or unpayable — missing salary, bank account, tax number, hire date or partner link. Run this BEFORE calculating.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'issueCount', order: 'desc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'issueCount', label: 'Issues', type: 'int', width: 8, align: 'right' },
        { key: 'issues', label: 'What is missing', type: 'string', width: 52 },
      ],
      async run(_ctx, params) {
        const { rows, totalActive } = await deps.data.payrollReadiness(params);
        return {
          rows,
          caption: rows.length === 0
            ? `Payroll Readiness · all ${totalActive} active employee(s) are ready to pay`
            : `Payroll Readiness · ${rows.length} of ${totalActive} active employee(s) need attention`,
          notes: rows.length === 0 ? [] : ['Fix these before calculating the run — a missing bank account means the employee is simply not paid.'],
        };
      },
    },

    {
      key: 'payroll.staff-receivables',
      title: 'Staff Loans & Advances Outstanding',
      domain: 'payroll',
      description:
        'What staff still owe the school: open loans and unrecovered salary advances, with balances and repayment progress.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'table',
      filters: ['departmentId', 'employeeId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'balance', order: 'desc' },
      columns: [
        { key: 'kind', label: 'Type', type: 'enum', width: 10 },
        { key: 'reference', label: 'Reference', type: 'string', width: 14 },
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 22 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'principal', label: 'Principal', type: 'money', width: 15, total: 'sum' },
        { key: 'installment', label: 'Per period', type: 'money', width: 14 },
        { key: 'installmentsPaid', label: 'Paid', type: 'int', width: 7, align: 'right' },
        { key: 'installmentsTotal', label: 'Of', type: 'int', width: 7, align: 'right' },
        { key: 'balance', label: 'Outstanding', type: 'money', width: 16, total: 'sum' },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.staffReceivables(params);
        return {
          rows,
          caption: `Staff Loans & Advances · ${rows.length} open item(s)`,
        };
      },
    },

    {
      key: 'payroll.summary',
      title: 'Payroll Run Summary',
      domain: 'payroll',
      description:
        'The headline figures for one payroll run: headcount, gross, each statutory deduction, and net pay.',
      permission: READ,
      alsoRequires: PAYROLL,
      shape: 'summary',
      filters: ['payrollRunId', 'payrollPeriodId'],
      asOfMode: 'live',
      paging: 'none',
      columns: [
        { key: 'label', label: 'Figure', type: 'string', width: 28 },
        { key: 'value', label: 'Value', type: 'string', width: 20, align: 'right' },
      ],
      async run(_ctx, params) {
        const { run, figures } = await deps.data.payrollSummary(params);
        const rows = [
          { label: 'Period', value: figures.period },
          { label: 'Run', value: figures.runNumber },
          { label: 'Status', value: figures.status },
          { label: 'Employees paid', value: figures.employees },
          { label: 'Gross pay', value: figures.grossPay },
          { label: '— of which allowances', value: figures.allowances },
          { label: '— of which overtime', value: figures.overtime },
          { label: '— of which bonuses', value: figures.bonuses },
          { label: 'PAYE', value: figures.paye },
          { label: 'Pension', value: figures.pension },
          { label: 'Social security', value: figures.socialSecurity },
          { label: 'Loan recoveries', value: figures.loanRecoveries },
          { label: 'Advance recoveries', value: figures.advanceRecoveries },
          { label: 'Total deductions', value: figures.totalDeductions },
          { label: 'Net pay', value: figures.netPay },
          { label: 'Average net pay', value: figures.averageNetPay },
        ];
        return {
          rows,
          caption: `Payroll Summary · ${runCaption(run)}`,
          notes: statusNotes(run),
        };
      },
    },
  ];
}
