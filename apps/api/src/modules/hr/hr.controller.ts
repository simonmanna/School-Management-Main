import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { HrOrgService } from './hr-org.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrTimesheetService } from './hr-timesheet.service';
import { HrLeaveService } from './hr-leave.service';
import { HrPayrollService } from './hr-payroll.service';
import { HrReportsService } from './hr-reports.service';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

/**
 * Workforce Management (HR) controller — employees, departments, positions,
 * shifts, attendance, timesheets, leave, holidays, payroll, payslips,
 * advances, loans, bank payments, performance reviews and reports.
 *
 * Every route is org-scoped by the tenancy extension and gated with `hr:*`
 * permissions (registered with the ModuleRegistry).
 */
@RequiresModule('hr')
@Controller('hr')
export class HrController {
  constructor(
    private readonly org: HrOrgService,
    private readonly attendance: HrAttendanceService,
    private readonly timesheets: HrTimesheetService,
    private readonly leave: HrLeaveService,
    private readonly payroll: HrPayrollService,
    private readonly reports: HrReportsService,
  ) {}

  // ── Dashboard / reports ──────────────────────────────────────────────────

  @Get('dashboard')
  @RequirePermissions('hr:read')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('reports/headcount-trend')
  @RequirePermissions('hr:report')
  headcountTrend(@Query('months') months?: string) {
    return this.reports.headcountTrend(months ? Number(months) : 6);
  }

  @Get('reports/payroll-register/:runId')
  @RequirePermissions('hr:report')
  payrollRegister(@Param('runId') runId: string) {
    return this.reports.payrollRegister(runId);
  }

  @Get('reports/attendance-register')
  @RequirePermissions('hr:report')
  attendanceRegister(@Query() query: any) {
    return this.reports.attendanceRegister(query);
  }

  @Get('reports/leave-overview')
  @RequirePermissions('hr:report')
  leaveOverview(@Query() query: any) {
    return this.reports.leaveOverview(query);
  }

  // ── Departments ──────────────────────────────────────────────────────────

  @Get('departments')
  @RequirePermissions('hr:read')
  listDepartments(@Query() query: any) {
    return this.org.listDepartments(query);
  }

  @Get('departments/:id')
  @RequirePermissions('hr:read')
  getDepartment(@Param('id') id: string) {
    return this.org.getDepartment(id);
  }

  @Post('departments')
  @RequirePermissions('hr:employee')
  createDepartment(@Body() dto: any) {
    return this.org.createDepartment(dto);
  }

  @Patch('departments/:id')
  @RequirePermissions('hr:employee')
  updateDepartment(@Param('id') id: string, @Body() dto: any) {
    return this.org.updateDepartment(id, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions('hr:employee')
  deleteDepartment(@Param('id') id: string) {
    return this.org.deleteDepartment(id);
  }

  // ── Positions ────────────────────────────────────────────────────────────

  @Get('positions')
  @RequirePermissions('hr:read')
  listPositions(@Query() query: any) {
    return this.org.listPositions(query);
  }

  @Post('positions')
  @RequirePermissions('hr:employee')
  createPosition(@Body() dto: any) {
    return this.org.createPosition(dto);
  }

  @Patch('positions/:id')
  @RequirePermissions('hr:employee')
  updatePosition(@Param('id') id: string, @Body() dto: any) {
    return this.org.updatePosition(id, dto);
  }

  @Delete('positions/:id')
  @RequirePermissions('hr:employee')
  deletePosition(@Param('id') id: string) {
    return this.org.deletePosition(id);
  }

  // ── Employees ────────────────────────────────────────────────────────────

  @Get('employees')
  @RequirePermissions('hr:read')
  listEmployees(@Query() query: any) {
    return this.org.listEmployees(query);
  }

  @Get('employees/:id')
  @RequirePermissions('hr:read')
  getEmployee(@Param('id') id: string) {
    return this.org.getEmployee(id);
  }

  @Post('employees')
  @RequirePermissions('hr:employee')
  createEmployee(@Body() dto: any) {
    return this.org.createEmployee(dto);
  }

  @Patch('employees/:id')
  @RequirePermissions('hr:employee')
  updateEmployee(@Param('id') id: string, @Body() dto: any) {
    return this.org.updateEmployee(id, dto);
  }

  @Delete('employees/:id')
  @RequirePermissions('hr:employee')
  deleteEmployee(@Param('id') id: string) {
    return this.org.deleteEmployee(id);
  }

  // ── Shifts + assignments ─────────────────────────────────────────────────

  @Get('shifts')
  @RequirePermissions('hr:read')
  listShifts(@Query() query: any) {
    return this.org.listShifts(query);
  }

  @Post('shifts')
  @RequirePermissions('hr:shift')
  createShift(@Body() dto: any) {
    return this.org.createShift(dto);
  }

  @Patch('shifts/:id')
  @RequirePermissions('hr:shift')
  updateShift(@Param('id') id: string, @Body() dto: any) {
    return this.org.updateShift(id, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions('hr:shift')
  deleteShift(@Param('id') id: string) {
    return this.org.deleteShift(id);
  }

  @Get('assignments')
  @RequirePermissions('hr:read')
  listAssignments(@Query() query: any) {
    return this.org.listAssignments(query);
  }

  @Post('assignments')
  @RequirePermissions('hr:shift')
  assignShift(@Body() dto: any) {
    return this.org.assignShift(dto);
  }

  @Delete('assignments/:id')
  @RequirePermissions('hr:shift')
  revokeAssignment(@Param('id') id: string) {
    return this.org.revokeAssignment(id);
  }

  // ── Attendance ───────────────────────────────────────────────────────────

  @Post('attendance/clock')
  @RequirePermissions('hr:attendance')
  clock(@Body() dto: any) {
    return this.attendance.clock(dto);
  }

  @Post('attendance/manual')
  @RequirePermissions('hr:attendance')
  upsertManual(@Body() dto: any) {
    return this.attendance.upsertManual(dto);
  }

  @Get('attendance')
  @RequirePermissions('hr:attendance')
  listAttendance(@Query() query: any) {
    return this.attendance.listAttendance(query);
  }

  @Get('attendance/summary')
  @RequirePermissions('hr:attendance')
  attendanceSummary(@Query() query: any) {
    return this.attendance.summary(query);
  }

  @Get('attendance/:id')
  @RequirePermissions('hr:attendance')
  getAttendance(@Param('id') id: string) {
    return this.attendance.getAttendance(id);
  }

  @Get('attendance-logs')
  @RequirePermissions('hr:attendance')
  listLogs(@Query() query: any) {
    return this.attendance.listLogs(query);
  }

  // ── Timesheets ───────────────────────────────────────────────────────────

  @Get('timesheets')
  @RequirePermissions('hr:timesheet')
  listTimesheets(@Query() query: any) {
    return this.timesheets.list(query);
  }

  @Get('timesheets/:id')
  @RequirePermissions('hr:timesheet')
  getTimesheet(@Param('id') id: string) {
    return this.timesheets.get(id);
  }

  @Post('timesheets')
  @RequirePermissions('hr:timesheet')
  createTimesheet(@Body() dto: any) {
    return this.timesheets.create(dto);
  }

  @Patch('timesheets/:id')
  @RequirePermissions('hr:timesheet')
  updateTimesheet(@Param('id') id: string, @Body() dto: any) {
    return this.timesheets.update(id, dto);
  }

  @Post('timesheets/:id/submit')
  @RequirePermissions('hr:timesheet')
  submitTimesheet(@Param('id') id: string) {
    return this.timesheets.submit(id);
  }

  @Post('timesheets/:id/approve')
  @RequirePermissions('hr:timesheet')
  approveTimesheet(@Param('id') id: string) {
    return this.timesheets.approve(id);
  }

  @Post('timesheets/:id/reject')
  @RequirePermissions('hr:timesheet')
  rejectTimesheet(@Param('id') id: string, @Body() dto: any) {
    return this.timesheets.reject(id, dto);
  }

  @Delete('timesheets/:id')
  @RequirePermissions('hr:timesheet')
  deleteTimesheet(@Param('id') id: string) {
    return this.timesheets.delete(id);
  }

  @Post('timesheets/:id/entries')
  @RequirePermissions('hr:timesheet')
  addEntry(@Param('id') id: string, @Body() dto: any) {
    return this.timesheets.addEntry(id, dto);
  }

  @Patch('timesheets/entries/:entryId')
  @RequirePermissions('hr:timesheet')
  updateEntry(@Param('entryId') entryId: string, @Body() dto: any) {
    return this.timesheets.updateEntry(entryId, dto);
  }

  @Delete('timesheets/entries/:entryId')
  @RequirePermissions('hr:timesheet')
  deleteEntry(@Param('entryId') entryId: string) {
    return this.timesheets.deleteEntry(entryId);
  }

  // ── Leave ────────────────────────────────────────────────────────────────

  @Get('leave/types')
  @RequirePermissions('hr:leave')
  listLeaveTypes(@Query() query: any) {
    return this.leave.listTypes(query);
  }

  @Post('leave/types')
  @RequirePermissions('hr:leave')
  createLeaveType(@Body() dto: any) {
    return this.leave.createType(dto);
  }

  @Patch('leave/types/:id')
  @RequirePermissions('hr:leave')
  updateLeaveType(@Param('id') id: string, @Body() dto: any) {
    return this.leave.updateType(id, dto);
  }

  @Delete('leave/types/:id')
  @RequirePermissions('hr:leave')
  deleteLeaveType(@Param('id') id: string) {
    return this.leave.deleteType(id);
  }

  @Get('leave/balances')
  @RequirePermissions('hr:leave')
  listLeaveBalances(@Query() query: any) {
    return this.leave.listBalances(query);
  }

  @Post('leave/balances/adjust')
  @RequirePermissions('hr:leave')
  adjustBalance(@Body() dto: any) {
    return this.leave.adjustBalance(dto);
  }

  @Get('leave/requests')
  @RequirePermissions('hr:leave')
  listLeaveRequests(@Query() query: any) {
    return this.leave.listRequests(query);
  }

  @Post('leave/requests')
  @RequirePermissions('hr:leave')
  createLeaveRequest(@Body() dto: any) {
    return this.leave.createRequest(dto);
  }

  @Post('leave/requests/:id/approve')
  @RequirePermissions('hr:leave')
  approveLeaveRequest(@Param('id') id: string, @Body() dto: any) {
    return this.leave.approveRequest(id, dto);
  }

  @Post('leave/requests/:id/reject')
  @RequirePermissions('hr:leave')
  rejectLeaveRequest(@Param('id') id: string, @Body() dto: any) {
    return this.leave.rejectRequest(id, dto);
  }

  @Post('leave/requests/:id/cancel')
  @RequirePermissions('hr:leave')
  cancelLeaveRequest(@Param('id') id: string) {
    return this.leave.cancelRequest(id);
  }

  @Get('holidays')
  @RequirePermissions('hr:holiday')
  listHolidays(@Query() query: any) {
    return this.leave.listHolidays(query);
  }

  @Post('holidays')
  @RequirePermissions('hr:holiday')
  createHoliday(@Body() dto: any) {
    return this.leave.createHoliday(dto);
  }

  @Patch('holidays/:id')
  @RequirePermissions('hr:holiday')
  updateHoliday(@Param('id') id: string, @Body() dto: any) {
    return this.leave.updateHoliday(id, dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions('hr:holiday')
  deleteHoliday(@Param('id') id: string) {
    return this.leave.deleteHoliday(id);
  }

  // ── Payroll components + tax tables ──────────────────────────────────────

  @Get('payroll/components')
  @RequirePermissions('hr:payroll')
  listComponents(@Query() query: any) {
    return this.payroll.listComponents(query);
  }

  @Post('payroll/components')
  @RequirePermissions('hr:payroll')
  createComponent(@Body() dto: any) {
    return this.payroll.createComponent(dto);
  }

  @Patch('payroll/components/:id')
  @RequirePermissions('hr:payroll')
  updateComponent(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.updateComponent(id, dto);
  }

  @Delete('payroll/components/:id')
  @RequirePermissions('hr:payroll')
  deleteComponent(@Param('id') id: string) {
    return this.payroll.deleteComponent(id);
  }

  @Get('payroll/tax-tables')
  @RequirePermissions('hr:tax_table')
  listTaxTables(@Query() query: any) {
    return this.payroll.listTaxTables(query);
  }

  @Post('payroll/tax-tables')
  @RequirePermissions('hr:tax_table')
  createTaxTable(@Body() dto: any) {
    return this.payroll.createTaxTable(dto);
  }

  @Patch('payroll/tax-tables/:id')
  @RequirePermissions('hr:tax_table')
  updateTaxTable(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.updateTaxTable(id, dto);
  }

  @Delete('payroll/tax-tables/:id')
  @RequirePermissions('hr:tax_table')
  deleteTaxTable(@Param('id') id: string) {
    return this.payroll.deleteTaxTable(id);
  }

  // ── Payroll periods + runs ───────────────────────────────────────────────

  @Get('payroll/periods')
  @RequirePermissions('hr:payroll')
  listPeriods(@Query() query: any) {
    return this.payroll.listPeriods(query);
  }

  @Post('payroll/periods')
  @RequirePermissions('hr:payroll')
  createPeriod(@Body() dto: any) {
    return this.payroll.createPeriod(dto);
  }

  @Patch('payroll/periods/:id')
  @RequirePermissions('hr:payroll')
  updatePeriod(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.updatePeriod(id, dto);
  }

  @Get('payroll/runs')
  @RequirePermissions('hr:payroll')
  listRuns(@Query() query: any) {
    return this.payroll.listRuns(query);
  }

  @Get('payroll/runs/:id')
  @RequirePermissions('hr:payroll')
  getRun(@Param('id') id: string) {
    return this.payroll.getRun(id);
  }

  @Post('payroll/runs')
  @RequirePermissions('hr:payroll')
  createRun(@Body() dto: any) {
    return this.payroll.createRun(dto);
  }

  @Post('payroll/runs/:id/calculate')
  @RequirePermissions('hr:payroll')
  calculateRun(@Param('id') id: string) {
    return this.payroll.calculateRun(id);
  }

  @Post('payroll/runs/:id/approve')
  @RequirePermissions('hr:payroll')
  approveRun(@Param('id') id: string) {
    return this.payroll.approveRun(id);
  }

  @Post('payroll/runs/:id/reverse')
  @RequirePermissions('hr:payroll')
  reverseRun(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.reverseRun(id, dto);
  }

  @Delete('payroll/runs/:id')
  @RequirePermissions('hr:payroll')
  deleteRun(@Param('id') id: string) {
    return this.payroll.deleteRun(id);
  }

  // ── Payslips ─────────────────────────────────────────────────────────────

  @Get('payslips')
  @RequirePermissions('hr:payslip')
  listPayslips(@Query() query: any) {
    return this.payroll.listPayslips(query);
  }

  @Get('payslips/:id')
  @RequirePermissions('hr:payslip')
  getPayslip(@Param('id') id: string) {
    return this.payroll.getPayslip(id);
  }

  @Post('payslips/:id/paid')
  @RequirePermissions('hr:payslip')
  markPayslipPaid(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.markPaid(id, dto);
  }

  // ── Bank payments ────────────────────────────────────────────────────────

  @Get('bank-payments')
  @RequirePermissions('hr:payroll')
  listBankPayments(@Query() query: any) {
    return this.payroll.listBankPayments(query);
  }

  @Post('bank-payments/generate')
  @RequirePermissions('hr:payroll')
  generateBankPayment(@Body() dto: any) {
    return this.payroll.generateBankPayment(dto);
  }

  @Patch('bank-payments/:id/status')
  @RequirePermissions('hr:payroll')
  updateBankPaymentStatus(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.updateBankPaymentStatus(id, dto);
  }

  // ── Advances + loans ─────────────────────────────────────────────────────

  @Get('advances')
  @RequirePermissions('hr:advance')
  listAdvances(@Query() query: any) {
    return this.payroll.listAdvances(query);
  }

  @Post('advances')
  @RequirePermissions('hr:advance')
  createAdvance(@Body() dto: any) {
    return this.payroll.createAdvance(dto);
  }

  @Post('advances/:id/approve')
  @RequirePermissions('hr:advance')
  approveAdvance(@Param('id') id: string) {
    return this.payroll.approveAdvance(id);
  }

  @Post('advances/:id/paid')
  @RequirePermissions('hr:advance')
  markAdvancePaid(@Param('id') id: string) {
    return this.payroll.markAdvancePaid(id);
  }

  @Post('advances/:id/reject')
  @RequirePermissions('hr:advance')
  rejectAdvance(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.rejectAdvance(id, dto);
  }

  @Get('loans')
  @RequirePermissions('hr:loan')
  listLoans(@Query() query: any) {
    return this.payroll.listLoans(query);
  }

  @Post('loans')
  @RequirePermissions('hr:loan')
  createLoan(@Body() dto: any) {
    return this.payroll.createLoan(dto);
  }

  @Patch('loans/:id')
  @RequirePermissions('hr:loan')
  updateLoan(@Param('id') id: string, @Body() dto: any) {
    return this.payroll.updateLoan(id, dto);
  }

  @Delete('loans/:id')
  @RequirePermissions('hr:loan')
  deleteLoan(@Param('id') id: string) {
    return this.payroll.deleteLoan(id);
  }

  // ── Performance reviews ──────────────────────────────────────────────────

  @Get('reviews')
  @RequirePermissions('hr:performance')
  listReviews(@Query() query: any) {
    return this.reports.listReviews(query);
  }

  @Post('reviews')
  @RequirePermissions('hr:performance')
  createReview(@Body() dto: any) {
    return this.reports.createReview(dto);
  }

  @Patch('reviews/:id')
  @RequirePermissions('hr:performance')
  updateReview(@Param('id') id: string, @Body() dto: any) {
    return this.reports.updateReview(id, dto);
  }

  @Delete('reviews/:id')
  @RequirePermissions('hr:performance')
  deleteReview(@Param('id') id: string) {
    return this.reports.deleteReview(id);
  }
}
