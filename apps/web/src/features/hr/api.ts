/**
 * Workforce Management (HR) API hooks.
 *
 * Surfaces the full HR vertical: departments, positions, employees, shifts +
 * assignments, attendance (clock events, logs, summaries), timesheets with
 * entries, leave types/balances/requests, holidays, payroll components, tax
 * tables, periods, runs (calculate → approve → reverse), payslips, bank
 * payments, advances, loans, performance reviews and reports. Every call is
 * org-scoped server-side; permission failures surface as 403s.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface HrDepartment {
  id: string;
  code: string;
  name: string;
  description: string | null;
  managerId: string | null;
  isActive: boolean;
  _count?: { employees: number; positions: number };
  manager?: { id: string; firstName: string; lastName: string | null; employeeCode: string } | null;
}

export interface HrPosition {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  defaultSalary: number | null;
  isActive: boolean;
  department?: { id: string; name: string } | null;
  _count?: { employees: number };
}

export interface HrEmployeeSummary {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface HrEmployee {
  id: string;
  employeeCode: string;
  userId: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  employmentType: string;
  hireDate: string | null;
  departmentId: string | null;
  positionId: string | null;
  supervisorId: string | null;
  baseSalary: number | null;
  payFrequency: string;
  hourlyRate: number | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  mobileMoneyProvider: string | null;
  mobileMoneyNumber: string | null;
  taxNumber: string | null;
  pensionNumber: string | null;
  socialSecurityNumber: string | null;
  isActive: boolean;
  department?: HrDepartment | null;
  position?: HrPosition | null;
  supervisor?: HrEmployeeSummary | null;
  leaveBalances?: HrLeaveBalance[];
  loans?: HrEmployeeLoan[];
  salaryAdvances?: HrSalaryAdvance[];
}

export interface HrShift {
  id: string;
  code: string;
  name: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  graceMinutes: number;
  maxOvertimeMinutes: number | null;
  isActive: boolean;
  description: string | null;
  _count?: { assignments: number };
}

export interface HrShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  employee?: HrEmployeeSummary;
  shift?: HrShift;
}

export interface HrAttendance {
  id: string;
  employeeId: string;
  date: string;
  shiftId: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  totalBreakMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: string;
  source: string;
  notes: string | null;
  employee?: HrEmployeeSummary;
  shift?: HrShift | null;
  logs?: HrAttendanceLog[];
}

export interface HrAttendanceLog {
  id: string;
  attendanceId: string | null;
  employeeId: string;
  eventType: string;
  timestamp: string;
  method: string;
  deviceId: string | null;
  note: string | null;
  employee?: HrEmployeeSummary;
}

export interface HrTimesheet {
  id: string;
  timesheetCode: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalMinutes: number;
  submittedAt: string | null;
  approvedAt: string | null;
  notes: string | null;
  employee?: HrEmployeeSummary;
  entries?: HrTimesheetEntry[];
  _count?: { entries: number };
}

export interface HrTimesheetEntry {
  id: string;
  timesheetId: string;
  date: string;
  startAt: string;
  endAt: string;
  minutes: number;
  workType: string;
  description: string | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  isBillable: boolean;
}

export interface HrLeaveType {
  id: string;
  code: string;
  name: string;
  daysPerYear: number;
  isPaid: boolean;
  carryForwardDays: number;
  maxConsecutiveDays: number | null;
  isActive: boolean;
}

export interface HrLeaveBalance {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  accruedDays: number;
  usedDays: number;
  adjustedDays: number;
  employee?: HrEmployeeSummary;
  leaveType?: HrLeaveType;
}

export interface HrLeaveRequest {
  id: string;
  requestCode: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string | null;
  approverId: string | null;
  approvedAt: string | null;
  notes: string | null;
  employee?: HrEmployeeSummary;
  leaveType?: HrLeaveType;
}

export interface HrHoliday {
  id: string;
  name: string;
  date: string;
  isRecurring: boolean;
}

export interface HrPayrollComponent {
  id: string;
  code: string;
  name: string;
  componentType: 'ALLOWANCE' | 'DEDUCTION';
  calcMethod: 'FIXED' | 'PERCENTAGE';
  amount: number | null;
  rate: number | null;
  isTaxable: boolean;
  isRecurring: boolean;
  appliesTo: string | null;
  isActive: boolean;
}

export interface HrTaxBracket {
  id: string;
  fromAmount: number;
  toAmount: number | null;
  rate: number;
}

export interface HrTaxTable {
  id: string;
  code: string;
  name: string;
  countryCode: string | null;
  taxType: string;
  effectiveFrom: string;
  isActive: boolean;
  brackets?: HrTaxBracket[];
}

export interface HrPayrollPeriod {
  id: string;
  periodCode: string;
  periodType: string;
  startDate: string;
  endDate: string;
  status: string;
  _count?: { runs: number };
}

export interface HrPayrollRun {
  id: string;
  runNumber: string;
  periodId: string;
  status: string;
  paymentDate: string | null;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  journalEntryId: string | null;
  glPosted: boolean;
  processedAt: string | null;
  notes: string | null;
  period?: HrPayrollPeriod;
  items?: HrPayrollItem[];
  bankPayments?: HrBankPayment[];
  _count?: { items: number };
}

export interface HrPayrollItem {
  id: string;
  runId: string;
  employeeId: string;
  baseSalary: number;
  hourlyRate: number;
  regularHours: number;
  overtimeHours: number;
  overtimePay: number;
  allowancesTotal: number;
  commissionAmount: number;
  bonusAmount: number;
  grossPay: number;
  taxAmount: number;
  pensionAmount: number;
  socialSecurityAmount: number;
  loanDeduction: number;
  advanceDeduction: number;
  insuranceAmount: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  absenceDays: number;
  employee?: HrEmployeeSummary & { departmentId?: string | null };
  allowances?: HrPayrollAllowance[];
  deductions?: HrPayrollDeduction[];
  payslip?: HrPayslip | null;
}

export interface HrPayrollAllowance {
  id: string;
  itemId: string;
  name: string;
  amount: number;
  isTaxable: boolean;
}

export interface HrPayrollDeduction {
  id: string;
  itemId: string;
  name: string;
  amount: number;
  isTaxable: boolean;
}

export interface HrPayslip {
  id: string;
  payslipNumber: string;
  itemId: string;
  status: string;
  issuedAt: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  item?: HrPayrollItem;
}

export interface HrBankPaymentLine {
  id: string;
  bankPaymentId: string;
  employeeId: string;
  amount: number;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  mobileMoneyProvider: string | null;
  mobileMoneyNumber: string | null;
}

export interface HrBankPayment {
  id: string;
  paymentCode: string;
  runId: string;
  paymentDate: string;
  method: string;
  status: string;
  totalAmount: number;
  fileName: string | null;
  fileUrl: string | null;
  notes: string | null;
  run?: { id: string; runNumber: string; period?: HrPayrollPeriod };
  lines?: HrBankPaymentLine[];
  _count?: { lines: number };
}

export interface HrSalaryAdvance {
  id: string;
  advanceCode: string;
  employeeId: string;
  amount: number;
  installmentMonths: number;
  monthlyDeduction: number;
  balance: number;
  status: string;
  approvedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  employee?: HrEmployeeSummary;
}

export interface HrEmployeeLoan {
  id: string;
  loanCode: string;
  employeeId: string;
  principal: number;
  interestRate: number;
  totalPayable: number;
  installmentAmount: number;
  installmentsTotal: number;
  installmentsPaid: number;
  balance: number;
  status: string;
  disbursedAt: string | null;
  notes: string | null;
  employee?: HrEmployeeSummary;
}

export interface HrPerformanceReview {
  id: string;
  employeeId: string;
  reviewDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  attendanceRate: number | null;
  lateRate: number | null;
  absenteeismDays: number | null;
  jobsCompleted: number | null;
  billableHours: number | null;
  overtimeHours: number | null;
  kpiScore: number | null;
  rating: number | null;
  notes: string | null;
  status: string;
  employee?: HrEmployeeSummary;
}

export interface HrDashboard {
  headcount: number;
  activeCount: number;
  departments: number;
  today: { attendanceRecords: number; present: number; late: number; absent: number };
  pendingLeave: number;
  openPeriods: number;
  lastRun: HrPayrollRun | null;
}

// ── Dashboard / reports ────────────────────────────────────────────────────

export function useHrDashboard() {
  return useQuery({
    queryKey: ['hr', 'dashboard'],
    queryFn: async () => (await api.get('/hr/dashboard')).data,
  });
}

export function useHrHeadcountTrend(months?: number) {
  return useQuery({
    queryKey: ['hr', 'reports', 'headcount-trend', months],
    queryFn: async () => (await api.get('/hr/reports/headcount-trend', { params: { months } })).data,
  });
}

export function useHrPayrollRegister(runId?: string) {
  return useQuery({
    queryKey: ['hr', 'reports', 'payroll-register', runId],
    queryFn: async () => (await api.get(`/hr/reports/payroll-register/${runId}`)).data,
    enabled: !!runId,
  });
}

export function useHrAttendanceRegister(params: { from?: string; to?: string; employeeId?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'reports', 'attendance-register', params],
    queryFn: async () => (await api.get('/hr/reports/attendance-register', { params })).data,
  });
}

export function useHrLeaveOverview(params: { year?: number; employeeId?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'reports', 'leave-overview', params],
    queryFn: async () => (await api.get('/hr/reports/leave-overview', { params })).data,
  });
}

// ── Departments ────────────────────────────────────────────────────────────

export function useHrDepartments(params: { search?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'departments', params],
    queryFn: async () => (await api.get('/hr/departments', { params })).data,
  });
}

export function useHrDepartment(id?: string) {
  return useQuery({
    queryKey: ['hr', 'departments', id],
    queryFn: async () => (await api.get(`/hr/departments/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateHrDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/departments', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'departments'] }),
  });
}

export function useUpdateHrDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/departments/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'departments'] }),
  });
}

export function useDeleteHrDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/departments/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'departments'] }),
  });
}

// ── Positions ──────────────────────────────────────────────────────────────

export function useHrPositions(params: { departmentId?: string; search?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'positions', params],
    queryFn: async () => (await api.get('/hr/positions', { params })).data,
  });
}

export function useCreateHrPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/positions', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'positions'] }),
  });
}

export function useUpdateHrPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/positions/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'positions'] }),
  });
}

export function useDeleteHrPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/positions/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'positions'] }),
  });
}

// ── Employees ──────────────────────────────────────────────────────────────

export function useHrEmployees(params: {
  departmentId?: string;
  positionId?: string;
  employmentType?: string;
  isActive?: string;
  search?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  return useQuery({
    queryKey: ['hr', 'employees', params],
    queryFn: async () => (await api.get('/hr/employees', { params })).data,
  });
}

export function useHrEmployee(id?: string) {
  return useQuery({
    queryKey: ['hr', 'employees', id],
    queryFn: async () => (await api.get(`/hr/employees/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateHrEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/employees', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

export function useUpdateHrEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/employees/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

export function useDeleteHrEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/employees/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

// ── Shifts + assignments ───────────────────────────────────────────────────

export function useHrShifts(params: { search?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'shifts', params],
    queryFn: async () => (await api.get('/hr/shifts', { params })).data,
  });
}

export function useCreateHrShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/shifts', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'shifts'] }),
  });
}

export function useUpdateHrShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/shifts/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'shifts'] }),
  });
}

export function useDeleteHrShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/shifts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'shifts'] }),
  });
}

export function useHrAssignments(params: { employeeId?: string; shiftId?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'assignments', params],
    queryFn: async () => (await api.get('/hr/assignments', { params })).data,
  });
}

export function useAssignHrShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/assignments', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'assignments'] }),
  });
}

export function useRevokeHrAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/assignments/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'assignments'] }),
  });
}

// ── Attendance ─────────────────────────────────────────────────────────────

export function useHrClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/attendance/clock', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'attendance'] }),
  });
}

export function useHrManualAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/attendance/manual', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'attendance'] }),
  });
}

export function useHrAttendance(params: {
  employeeId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  return useQuery({
    queryKey: ['hr', 'attendance', params],
    queryFn: async () => (await api.get('/hr/attendance', { params })).data,
  });
}

export function useHrAttendanceSummary(params: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'attendance', 'summary', params],
    queryFn: async () => (await api.get('/hr/attendance/summary', { params })).data,
  });
}

export function useHrAttendanceDetail(id?: string) {
  return useQuery({
    queryKey: ['hr', 'attendance', id],
    queryFn: async () => (await api.get(`/hr/attendance/${id}`)).data,
    enabled: !!id,
  });
}

export function useHrAttendanceLogs(params: { employeeId?: string; eventType?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'attendance-logs', params],
    queryFn: async () => (await api.get('/hr/attendance-logs', { params })).data,
  });
}

// ── Timesheets ─────────────────────────────────────────────────────────────

export function useHrTimesheets(params: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'timesheets', params],
    queryFn: async () => (await api.get('/hr/timesheets', { params })).data,
  });
}

export function useHrTimesheet(id?: string) {
  return useQuery({
    queryKey: ['hr', 'timesheets', id],
    queryFn: async () => (await api.get(`/hr/timesheets/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateHrTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/timesheets', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useUpdateHrTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/timesheets/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useSubmitHrTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/timesheets/${id}/submit`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useApproveHrTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/timesheets/${id}/approve`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useRejectHrTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/hr/timesheets/${id}/reject`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useDeleteHrTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/timesheets/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useAddHrTimesheetEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/hr/timesheets/${id}/entries`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useUpdateHrTimesheetEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, dto }: { entryId: string; dto: any }) =>
      (await api.patch(`/hr/timesheets/entries/${entryId}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

export function useDeleteHrTimesheetEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => (await api.delete(`/hr/timesheets/entries/${entryId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'timesheets'] }),
  });
}

// ── Leave ──────────────────────────────────────────────────────────────────

export function useHrLeaveTypes() {
  return useQuery({
    queryKey: ['hr', 'leave', 'types'],
    queryFn: async () => (await api.get('/hr/leave/types')).data,
  });
}

export function useCreateHrLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/leave/types', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave', 'types'] }),
  });
}

export function useUpdateHrLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/leave/types/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave', 'types'] }),
  });
}

export function useDeleteHrLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/leave/types/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave', 'types'] }),
  });
}

export function useHrLeaveBalances(params: { employeeId?: string; year?: number } = {}) {
  return useQuery({
    queryKey: ['hr', 'leave', 'balances', params],
    queryFn: async () => (await api.get('/hr/leave/balances', { params })).data,
  });
}

export function useAdjustHrLeaveBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/leave/balances/adjust', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave'] }),
  });
}

export function useHrLeaveRequests(params: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'leave', 'requests', params],
    queryFn: async () => (await api.get('/hr/leave/requests', { params })).data,
  });
}

export function useCreateHrLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/leave/requests', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave', 'requests'] }),
  });
}

export function useApproveHrLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/hr/leave/requests/${id}/approve`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave'] }),
  });
}

export function useRejectHrLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/hr/leave/requests/${id}/reject`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave'] }),
  });
}

export function useCancelHrLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/leave/requests/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'leave'] }),
  });
}

// ── Holidays ───────────────────────────────────────────────────────────────

export function useHrHolidays(params: { year?: number } = {}) {
  return useQuery({
    queryKey: ['hr', 'holidays', params],
    queryFn: async () => (await api.get('/hr/holidays', { params })).data,
  });
}

export function useCreateHrHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/holidays', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'holidays'] }),
  });
}

export function useUpdateHrHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/holidays/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'holidays'] }),
  });
}

export function useDeleteHrHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/holidays/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'holidays'] }),
  });
}

// ── Payroll components + tax tables ────────────────────────────────────────

export function useHrPayrollComponents(params: { componentType?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'payroll', 'components', params],
    queryFn: async () => (await api.get('/hr/payroll/components', { params })).data,
  });
}

export function useCreateHrPayrollComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/payroll/components', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'components'] }),
  });
}

export function useUpdateHrPayrollComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/payroll/components/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'components'] }),
  });
}

export function useDeleteHrPayrollComponent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/payroll/components/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'components'] }),
  });
}

export function useHrTaxTables(params: { taxType?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'payroll', 'tax-tables', params],
    queryFn: async () => (await api.get('/hr/payroll/tax-tables', { params })).data,
  });
}

export function useCreateHrTaxTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/payroll/tax-tables', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'tax-tables'] }),
  });
}

export function useUpdateHrTaxTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/payroll/tax-tables/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'tax-tables'] }),
  });
}

export function useDeleteHrTaxTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/payroll/tax-tables/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'tax-tables'] }),
  });
}

// ── Payroll periods + runs ────────────────────────────────────────────────

export function useHrPayrollPeriods() {
  return useQuery({
    queryKey: ['hr', 'payroll', 'periods'],
    queryFn: async () => (await api.get('/hr/payroll/periods')).data,
  });
}

export function useCreateHrPayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/payroll/periods', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

export function useUpdateHrPayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/payroll/periods/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

export function useHrPayrollRuns(params: { periodId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'payroll', 'runs', params],
    queryFn: async () => (await api.get('/hr/payroll/runs', { params })).data,
  });
}

export function useHrPayrollRun(id?: string) {
  return useQuery({
    queryKey: ['hr', 'payroll', 'runs', id],
    queryFn: async () => (await api.get(`/hr/payroll/runs/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateHrPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/payroll/runs', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'runs'] }),
  });
}

export function useCalculateHrPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/payroll/runs/${id}/calculate`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

export function useApproveHrPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/payroll/runs/${id}/approve`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

export function useReverseHrPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/hr/payroll/runs/${id}/reverse`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

export function useDeleteHrPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/payroll/runs/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

// ── Payslips ───────────────────────────────────────────────────────────────

export function useHrPayslips(params: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'payslips', params],
    queryFn: async () => (await api.get('/hr/payslips', { params })).data,
  });
}

export function useHrPayslip(id?: string) {
  return useQuery({
    queryKey: ['hr', 'payslips', id],
    queryFn: async () => (await api.get(`/hr/payslips/${id}`)).data,
    enabled: !!id,
  });
}

export function useMarkHrPayslipPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.post(`/hr/payslips/${id}/paid`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payslips'] }),
  });
}

// ── Bank payments ─────────────────────────────────────────────────────────

export function useHrBankPayments(params: { runId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'bank-payments', params],
    queryFn: async () => (await api.get('/hr/bank-payments', { params })).data,
  });
}

export function useGenerateHrBankPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/bank-payments/generate', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'bank-payments'] }),
  });
}

export function useUpdateHrBankPaymentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/bank-payments/${id}/status`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'bank-payments'] }),
  });
}

// ── Advances + loans ───────────────────────────────────────────────────────

export function useHrAdvances(params: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'advances', params],
    queryFn: async () => (await api.get('/hr/advances', { params })).data,
  });
}

export function useCreateHrAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/advances', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'advances'] }),
  });
}

export function useApproveHrAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/advances/${id}/approve`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'advances'] }),
  });
}

export function useMarkHrAdvancePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/hr/advances/${id}/paid`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'advances'] }),
  });
}

export function useRejectHrAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto?: any }) =>
      (await api.post(`/hr/advances/${id}/reject`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'advances'] }),
  });
}

export function useHrLoans(params: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'loans', params],
    queryFn: async () => (await api.get('/hr/loans', { params })).data,
  });
}

export function useCreateHrLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/loans', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'loans'] }),
  });
}

export function useUpdateHrLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/loans/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'loans'] }),
  });
}

export function useDeleteHrLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/loans/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'loans'] }),
  });
}

// ── Performance reviews ────────────────────────────────────────────────────

export function useHrReviews(params: { employeeId?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'reviews', params],
    queryFn: async () => (await api.get('/hr/reviews', { params })).data,
  });
}

export function useCreateHrReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/reviews', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'reviews'] }),
  });
}

export function useUpdateHrReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/reviews/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'reviews'] }),
  });
}

export function useDeleteHrReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/reviews/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'reviews'] }),
  });
}
