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

/** Paying a slip posts Dr net pay payable / Cr bank|cash, and may flip the run to PAID. */
export function useMarkHrPayslipPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: { paymentMethod: string; paidAt?: string } }) =>
      (await api.post(`/hr/payslips/${id}/paid`, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'payslips'] });
      qc.invalidateQueries({ queryKey: ['hr', 'payroll'] });
    },
  });
}

export function useReverseHrPayslipPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`/hr/payslips/${id}/reverse-payment`, { reason })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'payslips'] });
      qc.invalidateQueries({ queryKey: ['hr', 'payroll'] });
    },
  });
}

// ── Ad-hoc payroll inputs ────────────────────────────────────────
//
// One-off money for one employee in one period — bonuses, commissions,
// reimbursements and ad-hoc deductions. Capture needs `hr:payroll_input`;
// APPROVING needs `hr:payroll`, so a 403 on approve is the separation of duties
// working, not a bug.

export type HrPayrollInputType =
  | 'BONUS' | 'COMMISSION' | 'ALLOWANCE' | 'DEDUCTION' | 'REIMBURSEMENT';
export type HrPayrollInputStatus = 'PENDING' | 'APPROVED' | 'APPLIED' | 'CANCELLED';

export interface HrPayrollInput {
  id: string;
  employeeId: string;
  periodId: string;
  inputType: HrPayrollInputType;
  name: string;
  amount: string;
  isTaxable: boolean;
  status: HrPayrollInputStatus;
  appliedRunId: string | null;
  reference: string | null;
  notes: string | null;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string | null };
  period?: { id: string; periodCode: string; startDate: string; endDate: string };
}

export function useHrPayrollInputs(params: {
  periodId?: string; employeeId?: string; status?: string; inputType?: string;
} = {}) {
  return useQuery({
    queryKey: ['hr', 'payroll', 'inputs', params],
    queryFn: async () =>
      (await api.get<HrPayrollInput[]>('/hr/payroll/inputs', { params })).data,
  });
}

/** Bulk capture — a bonus list keyed off one memo lands as one request. */
export function useCreateHrPayrollInputs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { inputs: any[] }) =>
      (await api.post('/hr/payroll/inputs/bulk', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'inputs'] }),
  });
}

export function useUpdateHrPayrollInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) =>
      (await api.patch(`/hr/payroll/inputs/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'inputs'] }),
  });
}

export function useApproveHrPayrollInputs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.post('/hr/payroll/inputs/approve', { ids })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll'] }),
  });
}

export function useCancelHrPayrollInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`/hr/payroll/inputs/${id}/cancel`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'inputs'] }),
  });
}

export function useDeleteHrPayrollInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/payroll/inputs/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'inputs'] }),
  });
}

// ── Leave accrual engine ─────────────────────────────────────────
//
// Every one of these is safe to call twice: a grant is keyed by accrual period,
// so a repeat run grants nothing again. `dryRun` returns the movements without
// writing them, which is what the screens show before committing.

export function useRunLeaveAccrual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { asOf?: string; leaveTypeId?: string; employeeId?: string; dryRun?: boolean }) =>
      (await api.post('/hr/leave/accrual/run', dto)).data,
    onSuccess: (_d, vars) => {
      if (!vars?.dryRun) qc.invalidateQueries({ queryKey: ['hr', 'leave'] });
    },
  });
}

export function useRunLeaveYearEnd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { year?: number; dryRun?: boolean }) =>
      (await api.post('/hr/leave/accrual/year-end', dto)).data,
    onSuccess: (_d, vars) => {
      if (!vars?.dryRun) qc.invalidateQueries({ queryKey: ['hr', 'leave'] });
    },
  });
}

export function useExpireCarryForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { year?: number; asOf?: string; dryRun?: boolean }) =>
      (await api.post('/hr/leave/accrual/expire-carry-forward', dto)).data,
    onSuccess: (_d, vars) => {
      if (!vars?.dryRun) qc.invalidateQueries({ queryKey: ['hr', 'leave'] });
    },
  });
}

/** The movements behind a balance — answers "why do I have 14.5 days?". */
export function useLeaveAccrualLedger(params: {
  employeeId?: string; leaveTypeId?: string; year?: number;
} = {}) {
  return useQuery({
    queryKey: ['hr', 'leave', 'accrual-ledger', params],
    queryFn: async () => (await api.get('/hr/leave/accrual/ledger', { params })).data,
    enabled: Boolean(params.employeeId || params.leaveTypeId || params.year),
  });
}

// ── Bank payments ─────────────────────────────────────────────────────────

export function useHrBankPayments(params: { runId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: ['hr', 'bank-payments', params],
    queryFn: async () => (await api.get('/hr/bank-payments', { params })).data,
  });
}

/** A batch touches the run and its payslips, so every payment mutation refreshes all three. */
function invalidatePayments(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['hr', 'bank-payments'] });
  qc.invalidateQueries({ queryKey: ['hr', 'payslips'] });
  qc.invalidateQueries({ queryKey: ['hr', 'payroll'] });
}

export function useGenerateHrBankPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { runId: string; method?: string; paymentDate?: string; notes?: string }) =>
      (await api.post('/hr/bank-payments/generate', dto)).data,
    onSuccess: () => invalidatePayments(qc),
  });
}

/** GENERATED → SENT → PAID (posts the payment journal), or CANCELLED before PAID. */
export function useUpdateHrBankPaymentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: { status: string; paidAt?: string; fileName?: string; fileUrl?: string } }) =>
      (await api.patch(`/hr/bank-payments/${id}/status`, dto)).data,
    onSuccess: () => invalidatePayments(qc),
  });
}

export function useReverseHrBankPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post(`/hr/bank-payments/${id}/reverse`, { reason })).data,
    onSuccess: () => invalidatePayments(qc),
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

/** Paying out an advance posts Dr advance receivable / Cr bank|cash; only PAID advances are recovered. */
export function useMarkHrAdvancePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: { paymentMethod: string; paidAt?: string } }) =>
      (await api.post(`/hr/advances/${id}/paid`, dto)).data,
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

/** Disbursement posts the loan to the ledger; payroll recovers only disbursed loans. */
export function useDisburseHrLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: { disbursedAt?: string; method?: string } }) =>
      (await api.post(`/hr/loans/${id}/disburse`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'loans'] }),
  });
}

/** Write-off (needs hr:payroll): Dr bad debt / Cr loan receivable. The only way a balance leaves outside payroll. */
export function useWriteOffHrLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await api.post(`/hr/loans/${id}/write-off`, { reason })).data,
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

// ════════════════════════════════════════════════════════════════════════════
// Phase 1+ extensions: salary structures, lifecycle, recruitment, training, statutory, ESS
// ════════════════════════════════════════════════════════════════════════════

// ── Job grades & salary structures ───────────────────────────────────────────────

export interface HrJobGrade { id: string; code: string; name: string; description?: string | null; minSalary?: number | null; maxSalary?: number | null; isActive?: boolean; _count?: { employees: number; structures: number } }
export interface HrSalaryStructure { id: string; gradeId: string; componentId: string; amount?: number | null; rate?: number | null; isActive?: boolean; grade?: HrJobGrade; component?: any }

export function useHrJobGrades(params: Record<string, any> = {}) {
  return useQuery({
    queryKey: ['hr', 'job-grades', params],
    queryFn: async () => (await api.get('/hr/job-grades', { params })).data,
  });
}
export function useHrSalaryStructures(params: Record<string, any> = {}) {
  return useQuery({
    queryKey: ['hr', 'salary-structures', params],
    queryFn: async () => (await api.get('/hr/salary-structures', { params })).data,
  });
}
export function useCreateHrJobGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/job-grades', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'job-grades'] }),
  });
}
export function useCreateHrSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/salary-structures', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'salary-structures'] }),
  });
}
export function useDeleteHrJobGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/job-grades/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'job-grades'] }),
  });
}
export function useDeleteHrSalaryStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/salary-structures/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'salary-structures'] }),
  });
}

// ── Contracts / onboarding / offboarding / settlement ────────────────────────────

export interface HrContract { id: string; contractNumber?: string | null; employeeId: string; positionId?: string | null; contractType: string; startDate: string; endDate?: string | null; salary?: number | null; status?: string; documentUrl?: string | null; employee?: any }
export function useHrContracts(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'contracts', params], queryFn: async () => (await api.get('/hr/contracts', { params })).data });
}
export function useCreateHrContract() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/contracts', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'contracts'] }) });
}
export function useHrExpiringContracts(days = 60) {
  return useQuery({ queryKey: ['hr', 'contracts', 'expiring', days], queryFn: async () => (await api.get('/hr/contracts/expiring', { params: { days } })).data });
}
export function useHrSalaryHistory(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'salary-history', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/salary-history`)).data });
}
export function useHrEmployeeActions(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'actions', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/actions`)).data });
}
export function useHrAuditTrail(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'audit-trail', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/audit-trail`)).data });
}
export function useHrOnboarding(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'onboarding', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/onboarding`)).data });
}
export function useAddHrOnboardingTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/onboarding-tasks', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'onboarding'] }) });
}
export function useCompleteHrOnboardingTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.post(`/hr/onboarding-tasks/${id}/complete`, {})).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'onboarding'] }) });
}
export function useDeleteHrOnboardingTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/onboarding-tasks/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'onboarding'] }) });
}
export function useHrOffboarding(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'offboarding', params], queryFn: async () => (await api.get('/hr/offboarding', { params })).data });
}
/**
 * Read-only estimate. This used to POST `/offboarding/settle`, so pressing
 * "Compute" on the PREVIEW dialog actually settled and deactivated the employee.
 */
export function useHrSettlementPreview() {
  return useMutation({
    mutationFn: async (dto: { employeeId: string; lastDay: string }) =>
      (await api.get('/hr/offboarding/settlement', { params: dto })).data,
  });
}
/** Confirms the settlement: offboarding record + leave-encashment input for the final payroll. */
export function useHrSettle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { employeeId: string; lastDay: string; reason?: string; noticeDate?: string; notes?: string }) =>
      (await api.post('/hr/offboarding/settle', dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'offboarding'] });
      qc.invalidateQueries({ queryKey: ['hr', 'employees'] });
      qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'inputs'] });
    },
  });
}

// ── Recruitment / ATS ────────────────────────────────────────────────────────────

export interface HrVacancy { id: string; title: string; departmentId?: string | null; positionId?: string | null; openings?: number; status?: string; salaryMin?: number | null; salaryMax?: number | null; hiringManagerId?: string | null; _count?: { applicants: number } }
export interface HrApplicant { id: string; firstName: string; lastName?: string | null; email?: string | null; phone?: string | null; vacancyId: string; status?: string; experienceYears?: number | null; expectedSalary?: number | null; rating?: number | null; vacancy?: HrVacancy }
export function useHrVacancies(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'vacancies', params], queryFn: async () => (await api.get('/hr/vacancies', { params })).data });
}
export function useCreateHrVacancy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/vacancies', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'vacancies'] }) });
}
export function useDeleteHrVacancy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/vacancies/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'vacancies'] }) });
}
export function useHrApplicants(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'applicants', params], queryFn: async () => (await api.get('/hr/applicants', { params })).data });
}
export function useCreateHrApplicant() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/applicants', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'applicants'] }) });
}
export function useSetHrApplicantStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => (await api.post(`/hr/applicants/${id}/status`, { status, notes })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'applicants'] }) });
}
export function useHireHrApplicant() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.post(`/hr/applicants/${id}/hire`, dto)).data, onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr', 'applicants'] }); qc.invalidateQueries({ queryKey: ['hr', 'employees'] }); } });
}

// ── Qualifications / certifications / training ─────────────────────────────────────

export function useHrQualifications(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'qualifications', params], queryFn: async () => (await api.get('/hr/qualifications', { params })).data });
}
export function useCreateHrQualification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/qualifications', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'qualifications'] }) });
}
export function useDeleteHrQualification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/qualifications/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'qualifications'] }) });
}
export function useHrCertifications(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'certifications', params], queryFn: async () => (await api.get('/hr/certifications', { params })).data });
}
export function useHrExpiringCertifications(days = 30) {
  return useQuery({ queryKey: ['hr', 'certifications', 'expiring', days], queryFn: async () => (await api.get('/hr/certifications/expiring', { params: { days } })).data });
}
export function useCreateHrCertification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/certifications', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'certifications'] }) });
}
export function useDeleteHrCertification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/certifications/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'certifications'] }) });
}
export function useHrTrainings(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'trainings', params], queryFn: async () => (await api.get('/hr/trainings', { params })).data });
}
export function useCreateHrTraining() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/trainings', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'trainings'] }) });
}
export function useDeleteHrTraining() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/trainings/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'trainings'] }) });
}
export function useHrEnrollTraining() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/training-enrollments', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'trainings'] }) });
}
export function useHrEnrollmentStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, status, certificateUrl }: { id: string; status: string; certificateUrl?: string }) => (await api.post(`/hr/training-enrollments/${id}/status`, { status, certificateUrl })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'trainings'] }) });
}
export function useHrCpdReport() {
  return useQuery({ queryKey: ['hr', 'cpd-report'], queryFn: async () => (await api.get('/hr/training/cpd-report')).data });
}

// ── Payroll hardening: statutory + preview ──────────────────────────────────────────

export function useHrStatutory(params: Record<string, any> = {}) {
  return useQuery({ queryKey: ['hr', 'statutory', params], queryFn: async () => (await api.get('/hr/payroll/statutory', { params })).data });
}
export function useCreateHrStatutory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/payroll/statutory', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'statutory'] }) });
}
export function useUpdateHrStatutory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/payroll/statutory/${id}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'statutory'] }),
  });
}
export function useDeleteHrStatutory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/hr/payroll/statutory/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'statutory'] }),
  });
}
export function useHrRunPreview(runId?: string) {
  return useQuery({ enabled: !!runId, queryKey: ['hr', 'run-preview', runId], queryFn: async () => (await api.get(`/hr/payroll/runs/${runId}/preview`)).data });
}
export function useRunHrAlerts() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (organizationId?: string) => (await api.post('/hr/alerts/run', { organizationId })).data, onSuccess: () => qc.invalidateQueries() });
}

// ── Employee & Manager self-service ───────────────────────────────────────────────

export function useHrSelfProfile() {
  return useQuery({ queryKey: ['hr', 'self'], queryFn: async () => (await api.get('/hr/self/profile')).data });
}
export function useHrTeam() {
  return useQuery({ queryKey: ['hr', 'team'], queryFn: async () => (await api.get('/hr/team')).data });
}

// ── Skills, experience & personnel documents (Phase 1) ──────────────────────

export interface HrSkill {
  id: string;
  code: string;
  name: string;
  category: string | null;
  isActive: boolean;
}

export interface HrEmployeeSkill {
  id: string;
  employeeId: string;
  skillId: string;
  proficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  yearsExperience: number | null;
  verified: boolean;
  verifiedById: string | null;
  verifiedAt: string | null;
  notes: string | null;
  skill?: HrSkill;
}

export interface HrExperience {
  id: string;
  employeeId: string;
  employer: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  referenceName: string | null;
  referenceContact: string | null;
  documentId: string | null;
}

export interface HrEmployeeDocument {
  id: string;
  employeeId: string;
  category: string;
  type: string | null;
  title: string;
  fileId: string;
  expiresAt: string | null;
  verified: boolean;
  createdAt: string;
  file?: { id: string; filename: string; contentType: string; byteSize: number; createdAt: string };
}

// Skill catalogue
export function useHrSkills(params: { search?: string; category?: string } = {}) {
  return useQuery({ queryKey: ['hr', 'skills', params], queryFn: async () => (await api.get('/hr/skills', { params })).data });
}
export function useCreateHrSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/skills', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'skills'] }) });
}
export function useUpdateHrSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/skills/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'skills'] }) });
}
export function useDeleteHrSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/skills/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'skills'] }) });
}
export function useHrEmployeesBySkill(skillId?: string, minProficiency?: string) {
  return useQuery({
    enabled: !!skillId,
    queryKey: ['hr', 'skills', skillId, 'employees', minProficiency],
    queryFn: async () => (await api.get(`/hr/skills/${skillId}/employees`, { params: { minProficiency } })).data,
  });
}

// Employee <-> skill links
export function useHrEmployeeSkills(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'employee-skills', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/skills`)).data });
}
export function useAddHrEmployeeSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/employee-skills', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'employee-skills'] }) });
}
export function useUpdateHrEmployeeSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/employee-skills/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'employee-skills'] }) });
}
export function useVerifyHrEmployeeSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => (await api.post(`/hr/employee-skills/${id}/verify`, { verified })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'employee-skills'] }) });
}
export function useRemoveHrEmployeeSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/employee-skills/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'employee-skills'] }) });
}

// Experience
export function useHrExperience(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'experience', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/experience`)).data });
}
export function useAddHrExperience() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: any) => (await api.post('/hr/experience', dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'experience'] }) });
}
export function useUpdateHrExperience() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/experience/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'experience'] }) });
}
export function useRemoveHrExperience() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/experience/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'experience'] }) });
}

// Personnel documents
export function useHrDocuments(employeeId?: string) {
  return useQuery({ enabled: !!employeeId, queryKey: ['hr', 'documents', employeeId], queryFn: async () => (await api.get(`/hr/employees/${employeeId}/documents`)).data });
}
export function useUploadHrDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, meta }: { file: File; meta: Record<string, string> }) => {
      const form = new FormData();
      form.append('file', file);
      for (const [k, v] of Object.entries(meta)) if (v != null && v !== '') form.append(k, v);
      return (await api.post('/hr/documents/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'documents'] }),
  });
}
export function useUpdateHrDocument() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/documents/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'documents'] }) });
}
export function useVerifyHrDocument() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => (await api.post(`/hr/documents/${id}/verify`, { verified })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'documents'] }) });
}
export function useDeleteHrDocument() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/hr/documents/${id}`)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'documents'] }) });
}
/** Request a signed download URL for the document's underlying file. */
export async function fetchHrDocumentDownloadUrl(id: string): Promise<string> {
  const res = (await api.post(`/hr/documents/${id}/download`)).data;
  return res.url as string;
}

// Update endpoints for qualifications / certifications (Phase 1)
export function useUpdateHrQualification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/qualifications/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'qualifications'] }) });
}
export function useUpdateHrCertification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, dto }: { id: string; dto: any }) => (await api.patch(`/hr/certifications/${id}`, dto)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'certifications'] }) });
}

// ── Reconciliation: school roster <-> HR record (Phase 2) ───────────────────

export interface HrReconciliation {
  counts: { linked: number; hrOnly: number; schoolOnly: number; employees: number; staffProfiles: number };
  linked: Array<{ employee: any; staffProfile: any }>;
  hrOnly: any[];
  schoolOnly: any[];
}

export function useHrReconciliation() {
  return useQuery({
    queryKey: ['hr', 'reconciliation'],
    queryFn: async () => (await api.get<HrReconciliation>('/hr/reconciliation')).data,
  });
}
export function useHrLinkStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, staffProfileId }: { employeeId: string; staffProfileId: string }) =>
      (await api.post(`/hr/reconciliation/employees/${employeeId}/link`, { staffProfileId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}
export function useHrUnlinkStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (employeeId: string) =>
      (await api.post(`/hr/reconciliation/employees/${employeeId}/unlink`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}
export function useHrCreateEmployeeFromStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/reconciliation/create-employee', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}
export function useHrCreateStaffFromEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => (await api.post('/hr/reconciliation/create-staff', dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr'] }),
  });
}

// ── Staff self-identity (Phase 3) ───────────────────────────────────────────

export interface MyStaffIdentity {
  userId: string;
  hrEmployeeId: string | null;
  partnerId: string | null;
  staffProfileId: string | null;
}

/**
 * Who the signed-in user is, as staff. `staffProfileId` is what every
 * teacher-scoped school endpoint keys on — the UI must send THIS, not a value
 * picked from a dropdown, or the server rejects the request as someone else's.
 */
export function useMyStaffIdentity() {
  return useQuery({
    queryKey: ['hr', 'me', 'identity'],
    queryFn: async () => (await api.get<MyStaffIdentity>('/hr/me/identity')).data,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** The signed-in employee's own payslips. */
export function useMyPayslips() {
  return useQuery({
    queryKey: ['hr', 'self', 'payslips'],
    queryFn: async () => (await api.get('/hr/self/payslips')).data,
  });
}
