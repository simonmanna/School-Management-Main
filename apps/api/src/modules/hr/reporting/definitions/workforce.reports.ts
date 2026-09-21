import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { HrReportDeps } from '../hr-report-deps';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Workforce reports — establishment, compliance, leave, attendance, turnover.
 *
 * These need `hr:read` rather than `hr:payroll`: a head of department has a
 * legitimate reason to see who is on the establishment and whose teaching
 * licence lapses next term, and no reason at all to see the payroll register.
 * The salary-by-grade report is the exception and says so.
 */
export function workforceReports(deps: HrReportDeps): ReportDefinition<any>[] {
  const READ = PERMISSIONS.hr.readReports;

  return [
    {
      key: 'hr.headcount',
      title: 'Staff Establishment',
      domain: 'hr',
      description:
        'Every active employee with post, department, employment type, tenure and contact details. The staff list a school is asked for.',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.read],
      shape: 'table',
      filters: ['departmentId', 'positionId', 'employmentType'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 10_000,
      defaultSort: { key: 'employeeCode', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'position', label: 'Post', type: 'string', width: 20 },
        { key: 'employmentType', label: 'Type', type: 'enum', width: 12 },
        { key: 'gender', label: 'Gender', type: 'string', width: 9 },
        { key: 'age', label: 'Age', type: 'int', width: 6, align: 'right' },
        { key: 'hireDate', label: 'Hired', type: 'date', width: 12 },
        { key: 'yearsOfService', label: 'Years', type: 'int', width: 7, align: 'right' },
        { key: 'supervisor', label: 'Reports to', type: 'string', width: 20 },
        { key: 'phone', label: 'Phone', type: 'string', width: 14 },
        { key: 'email', label: 'Email', type: 'string', width: 24, hideOn: ['pdf'] },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.headcount(params);
        return { rows, caption: `Staff Establishment · ${rows.length} active employee(s)` };
      },
    },

    {
      key: 'hr.contracts-expiring',
      title: 'Contracts Expiring',
      domain: 'hr',
      description:
        'Employment contracts ending inside the window (default: the next 90 days), soonest first. A lapsed contract is a teacher who cannot lawfully be timetabled.',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.contract],
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'endDate', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'position', label: 'Post', type: 'string', width: 20 },
        { key: 'contractType', label: 'Contract', type: 'string', width: 14 },
        { key: 'startDate', label: 'From', type: 'date', width: 12 },
        { key: 'endDate', label: 'Ends', type: 'date', width: 12 },
        { key: 'daysRemaining', label: 'Days left', type: 'int', width: 10, align: 'right' },
        { key: 'status', label: 'Status', type: 'string', width: 12 },
        { key: 'phone', label: 'Phone', type: 'string', width: 14 },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.contractsExpiring(params);
        const overdue = rows.filter((r: any) => r.daysRemaining < 0).length;
        return {
          rows,
          caption: `Contracts Expiring · ${rows.length} contract(s)`,
          notes: overdue > 0
            ? [`${overdue} contract(s) have ALREADY expired and have not been renewed or terminated.`]
            : [],
        };
      },
    },

    {
      key: 'hr.certifications-expiring',
      title: 'Certifications & Licences Expiring',
      domain: 'hr',
      description:
        'Teaching licences, first-aid certificates and other credentials lapsing inside the window (default: the next 90 days).',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.qualification],
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'expiryDate', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'certification', label: 'Credential', type: 'string', width: 26 },
        { key: 'issuingBody', label: 'Issued by', type: 'string', width: 20 },
        { key: 'issueDate', label: 'Issued', type: 'date', width: 12 },
        { key: 'expiryDate', label: 'Expires', type: 'date', width: 12 },
        { key: 'daysRemaining', label: 'Days left', type: 'int', width: 10, align: 'right' },
        { key: 'status', label: 'Status', type: 'string', width: 12 },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.certificationsExpiring(params);
        const lapsed = rows.filter((r: any) => r.daysRemaining < 0).length;
        return {
          rows,
          caption: `Certifications Expiring · ${rows.length} credential(s)`,
          notes: lapsed > 0 ? [`${lapsed} credential(s) have already lapsed.`] : [],
        };
      },
    },

    {
      key: 'hr.leave-balances',
      title: 'Leave Balances',
      domain: 'hr',
      description:
        'Entitlement, adjustments, days taken and days remaining per employee per leave type for the current year.',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.leave],
      shape: 'table',
      filters: ['departmentId', 'employeeId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 20_000,
      defaultSort: { key: 'employeeCode', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'leaveType', label: 'Leave type', type: 'string', width: 20 },
        { key: 'paid', label: 'Paid?', type: 'string', width: 9 },
        { key: 'accrued', label: 'Entitled', type: 'int', width: 10, align: 'right', total: 'sum' },
        { key: 'adjusted', label: 'Adjusted', type: 'int', width: 10, align: 'right', total: 'sum' },
        { key: 'used', label: 'Taken', type: 'int', width: 9, align: 'right', total: 'sum' },
        { key: 'remaining', label: 'Remaining', type: 'int', width: 11, align: 'right', total: 'sum' },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.leaveBalances(params);
        const overdrawn = rows.filter((r: any) => r.remaining < 0).length;
        return {
          rows,
          caption: `Leave Balances · ${new Date().getFullYear()} · ${rows.length} balance(s)`,
          notes: overdrawn > 0
            ? [`${overdrawn} balance(s) are overdrawn — leave was approved beyond entitlement.`]
            : [],
        };
      },
    },

    {
      key: 'hr.leave-register',
      title: 'Leave Register',
      domain: 'hr',
      description:
        'Every leave request overlapping the window, with type, dates, days and decision. The term leave diary.',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.leave],
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'departmentId', 'employeeId', 'status'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 20_000,
      defaultSort: { key: 'startDate', order: 'desc' },
      columns: [
        { key: 'requestCode', label: 'Request', type: 'string', width: 13 },
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 22 },
        { key: 'department', label: 'Department', type: 'string', width: 16 },
        { key: 'leaveType', label: 'Type', type: 'string', width: 18 },
        { key: 'paid', label: 'Paid?', type: 'string', width: 9 },
        { key: 'startDate', label: 'From', type: 'date', width: 12 },
        { key: 'endDate', label: 'To', type: 'date', width: 12 },
        { key: 'days', label: 'Days', type: 'int', width: 7, align: 'right', total: 'sum' },
        { key: 'status', label: 'Status', type: 'enum', width: 12 },
        { key: 'reason', label: 'Reason', type: 'string', width: 26, hideOn: ['pdf'] },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.leaveRegister(params);
        return { rows, caption: `Leave Register · ${rows.length} request(s)` };
      },
    },

    {
      key: 'hr.attendance-summary',
      title: 'Staff Attendance Summary',
      domain: 'hr',
      description:
        'Days present, absent, late and on leave per employee for the window (default: the last 30 days), with hours worked. Lowest attendance first.',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.attendance],
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'departmentId', 'employeeId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 10_000,
      defaultSort: { key: 'attendanceRate', order: 'asc' },
      columns: [
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'daysRecorded', label: 'Days', type: 'int', width: 8, align: 'right' },
        { key: 'present', label: 'Present', type: 'int', width: 9, align: 'right', total: 'sum' },
        { key: 'late', label: 'Late', type: 'int', width: 8, align: 'right', total: 'sum' },
        { key: 'absent', label: 'Absent', type: 'int', width: 9, align: 'right', total: 'sum' },
        { key: 'onLeave', label: 'On leave', type: 'int', width: 10, align: 'right', total: 'sum' },
        { key: 'workedHours', label: 'Hours', type: 'int', width: 9, align: 'right', total: 'sum' },
        { key: 'overtimeHours', label: 'Overtime', type: 'int', width: 10, align: 'right', total: 'sum' },
        { key: 'attendanceRate', label: 'Attendance %', type: 'percent', width: 13 },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.attendanceSummary(params);
        return {
          rows,
          caption: `Staff Attendance · ${rows.length} employee(s)`,
          notes: ['Percentages are of days for which attendance was actually recorded, so closed periods do not read as absence.'],
        };
      },
    },

    {
      key: 'hr.turnover',
      title: 'Joiners, Leavers & Turnover',
      domain: 'hr',
      description:
        'Staff movements in the window (default: this calendar year) with reasons and tenure, plus the turnover rate over average headcount.',
      permission: READ,
      alsoRequires: [PERMISSIONS.hr.read],
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 10_000,
      defaultSort: { key: 'effectiveDate', order: 'asc' },
      columns: [
        { key: 'movement', label: 'Movement', type: 'enum', width: 11 },
        { key: 'employeeCode', label: 'Code', type: 'string', width: 10 },
        { key: 'employeeName', label: 'Employee', type: 'string', width: 24 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'position', label: 'Post', type: 'string', width: 20 },
        { key: 'employmentType', label: 'Type', type: 'enum', width: 12 },
        { key: 'effectiveDate', label: 'Date', type: 'date', width: 12 },
        { key: 'tenureYears', label: 'Tenure', type: 'int', width: 8, align: 'right' },
        { key: 'reason', label: 'Reason', type: 'string', width: 20 },
      ],
      async run(_ctx, params) {
        const result = await deps.data.turnover(params);
        return {
          rows: result.rows,
          caption:
            `Turnover · ${result.joiners} joiner(s), ${result.leavers} leaver(s) · ` +
            `${result.turnoverRate}% of an average headcount of ${Math.round(result.averageHeadcount)}`,
          notes: ['Turnover rate is leavers over AVERAGE headcount for the window, not closing headcount.'],
        };
      },
    },

    {
      key: 'hr.salary-by-grade',
      title: 'Salary Bands by Grade',
      domain: 'hr',
      description:
        'Minimum, average and maximum base salary per job grade, with headcount, total cost and the gender pay gap at each grade.',
      permission: READ,
      // Aggregated, but still pay data — it needs the payroll grant, not just hr:read.
      alsoRequires: [PERMISSIONS.hr.payroll],
      shape: 'table',
      filters: ['departmentId'],
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 500,
      defaultSort: { key: 'totalCost', order: 'desc' },
      columns: [
        { key: 'grade', label: 'Grade', type: 'string', width: 22 },
        { key: 'headcount', label: 'Staff', type: 'int', width: 8, align: 'right', total: 'sum' },
        { key: 'minSalary', label: 'Minimum', type: 'money', width: 15 },
        { key: 'avgSalary', label: 'Average', type: 'money', width: 15 },
        { key: 'maxSalary', label: 'Maximum', type: 'money', width: 15 },
        { key: 'totalCost', label: 'Monthly cost', type: 'money', width: 17, total: 'sum' },
        { key: 'male', label: 'Men', type: 'int', width: 7, align: 'right', total: 'sum' },
        { key: 'female', label: 'Women', type: 'int', width: 8, align: 'right', total: 'sum' },
        { key: 'genderPayGapPct', label: 'Pay gap %', type: 'percent', width: 12 },
      ],
      async run(_ctx, params) {
        const rows = await deps.data.salaryByGrade(params);
        return {
          rows,
          caption: `Salary Bands by Grade · ${rows.length} grade(s)`,
          notes: [
            'Pay gap is (men’s average − women’s average) / men’s average at that grade. Blank where one group is unrepresented.',
            'Base salary only — allowances and overtime are not included.',
          ],
        };
      },
    },
  ];
}
