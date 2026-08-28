import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import { HrOrgService } from './hr-org.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrTimesheetService } from './hr-timesheet.service';
import { HrLeaveService } from './hr-leave.service';
import { HrPayrollService } from './hr-payroll.service';
import { HrReportsService } from './hr-reports.service';
import { HrLifecycleService } from './hr-lifecycle.service';
import { HrRecruitmentService } from './hr-recruitment.service';
import { HrTrainingService } from './hr-training.service';
import { HrAlertsSubscriber } from './hr-alerts.subscriber';
import { HrPeopleService } from './hr-people.service';
import { HrReconciliationService } from './hr-reconciliation.service';
import { EmployeeIdentityService } from '../../kernel/auth/employee-identity.service';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import {
  AddInterviewDto,
  AddOnboardingTaskDto,
  AdjustLeaveBalanceDto,
  AssignShiftDto,
  ClockDto,
  CreateAdvanceDto,
  CreateApplicantDto,
  CreateCertificationDto,
  CreateContractDto,
  CreateDepartmentDto,
  CreateEmployeeDto,
  CreateHolidayDto,
  CreateJobGradeDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  CreateLoanDto,
  CreatePayrollComponentDto,
  CreatePayrollPeriodDto,
  CreatePayrollRunDto,
  CreatePositionDto,
  CreateQualificationDto,
  CreateReviewDto,
  CreateSalaryStructureDto,
  CreateShiftDto,
  CreateStatutoryConfigDto,
  CreateTaxTableDto,
  CreateTimesheetDto,
  CreateTimesheetEntryDto,
  CreateTrainingDto,
  CreateVacancyDto,
  EnrollTrainingDto,
  GenerateBankPaymentDto,
  HireApplicantDto,
  LeaveDecisionDto,
  LinkEmployeeUserDto,
  MarkPayslipPaidDto,
  RejectDto,
  ReverseRunDto,
  SetApplicantStatusDto,
  SetEnrollmentStatusDto,
  SettleOffboardingDto,
  UpdateBankPaymentStatusDto,
  UpdateCertificationDto,
  UpdateContractDto,
  UpdateDepartmentDto,
  UpdateEmployeeDto,
  UpdateHolidayDto,
  UpdateInterviewDto,
  UpdateJobGradeDto,
  UpdateLeaveTypeDto,
  UpdateLoanDto,
  UpdatePayrollComponentDto,
  UpdatePayrollPeriodDto,
  UpdatePositionDto,
  UpdateQualificationDto,
  UpdateReviewDto,
  UpdateSalaryStructureDto,
  UpdateShiftDto,
  UpdateStatutoryConfigDto,
  UpdateTaxTableDto,
  UpdateTimesheetDto,
  UpdateTimesheetEntryDto,
  UpdateVacancyDto,
  UpsertManualAttendanceDto,
  AddEmployeeSkillDto,
  AddExperienceDto,
  CreateSkillDto,
  UpdateDocumentDto,
  UpdateEmployeeSkillDto,
  UpdateExperienceDto,
  UpdateSkillDto,
  UploadDocumentMetaDto,
  VerifyDto,
  CreateEmployeeFromStaffDto,
  CreateStaffFromEmployeeDto,
  LinkStaffDto,
} from './dto.types';

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
    private readonly lifecycle: HrLifecycleService,
    private readonly recruitment: HrRecruitmentService,
    private readonly training: HrTrainingService,
    private readonly alerts: HrAlertsSubscriber,
    private readonly people: HrPeopleService,
    private readonly reconciliation: HrReconciliationService,
    private readonly employeeIdentity: EmployeeIdentityService,
    private readonly tenant: TenantContextService,
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
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.org.createDepartment(dto);
  }

  @Patch('departments/:id')
  @RequirePermissions('hr:employee')
  updateDepartment(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
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
  createPosition(@Body() dto: CreatePositionDto) {
    return this.org.createPosition(dto);
  }

  @Patch('positions/:id')
  @RequirePermissions('hr:employee')
  updatePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
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
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.org.createEmployee(dto);
  }

  @Patch('employees/:id')
  @RequirePermissions('hr:employee')
  updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.org.updateEmployee(id, dto);
  }

  /**
   * Bind an employee to a login account (`userId: null` unlinks).
   *
   * Separate from `PATCH employees/:id` and gated on `hr:employee_identity`:
   * `HrEmployee.userId` is what self-service resolves on, so this is an
   * identity operation, not a profile edit.
   */
  @Post('employees/:id/link-user')
  @RequirePermissions('hr:employee_identity')
  linkEmployeeUser(@Param('id') id: string, @Body() dto: LinkEmployeeUserDto) {
    return this.org.linkUser(id, dto.userId ?? null);
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
  createShift(@Body() dto: CreateShiftDto) {
    return this.org.createShift(dto);
  }

  @Patch('shifts/:id')
  @RequirePermissions('hr:shift')
  updateShift(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
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
  assignShift(@Body() dto: AssignShiftDto) {
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
  clock(@Body() dto: ClockDto) {
    return this.attendance.clock(dto);
  }

  @Post('attendance/manual')
  @RequirePermissions('hr:attendance')
  upsertManual(@Body() dto: UpsertManualAttendanceDto) {
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
  createTimesheet(@Body() dto: CreateTimesheetDto) {
    return this.timesheets.create(dto);
  }

  @Patch('timesheets/:id')
  @RequirePermissions('hr:timesheet')
  updateTimesheet(@Param('id') id: string, @Body() dto: UpdateTimesheetDto) {
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
  rejectTimesheet(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.timesheets.reject(id, dto);
  }

  @Delete('timesheets/:id')
  @RequirePermissions('hr:timesheet')
  deleteTimesheet(@Param('id') id: string) {
    return this.timesheets.delete(id);
  }

  @Post('timesheets/:id/entries')
  @RequirePermissions('hr:timesheet')
  addEntry(@Param('id') id: string, @Body() dto: CreateTimesheetEntryDto) {
    return this.timesheets.addEntry(id, dto);
  }

  @Patch('timesheets/entries/:entryId')
  @RequirePermissions('hr:timesheet')
  updateEntry(@Param('entryId') entryId: string, @Body() dto: UpdateTimesheetEntryDto) {
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
  createLeaveType(@Body() dto: CreateLeaveTypeDto) {
    return this.leave.createType(dto);
  }

  @Patch('leave/types/:id')
  @RequirePermissions('hr:leave')
  updateLeaveType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
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
  adjustBalance(@Body() dto: AdjustLeaveBalanceDto) {
    return this.leave.adjustBalance(dto);
  }

  @Get('leave/requests')
  @RequirePermissions('hr:leave')
  listLeaveRequests(@Query() query: any) {
    return this.leave.listRequests(query);
  }

  @Post('leave/requests')
  @RequirePermissions('hr:leave')
  createLeaveRequest(@Body() dto: CreateLeaveRequestDto) {
    return this.leave.createRequest(dto);
  }

  @Post('leave/requests/:id/approve')
  @RequirePermissions('hr:leave')
  approveLeaveRequest(@Param('id') id: string, @Body() dto: LeaveDecisionDto) {
    return this.leave.approveRequest(id, dto);
  }

  @Post('leave/requests/:id/reject')
  @RequirePermissions('hr:leave')
  rejectLeaveRequest(@Param('id') id: string, @Body() dto: LeaveDecisionDto) {
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
  createHoliday(@Body() dto: CreateHolidayDto) {
    return this.leave.createHoliday(dto);
  }

  @Patch('holidays/:id')
  @RequirePermissions('hr:holiday')
  updateHoliday(@Param('id') id: string, @Body() dto: UpdateHolidayDto) {
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
  createComponent(@Body() dto: CreatePayrollComponentDto) {
    return this.payroll.createComponent(dto);
  }

  @Patch('payroll/components/:id')
  @RequirePermissions('hr:payroll')
  updateComponent(@Param('id') id: string, @Body() dto: UpdatePayrollComponentDto) {
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
  createTaxTable(@Body() dto: CreateTaxTableDto) {
    return this.payroll.createTaxTable(dto);
  }

  @Patch('payroll/tax-tables/:id')
  @RequirePermissions('hr:tax_table')
  updateTaxTable(@Param('id') id: string, @Body() dto: UpdateTaxTableDto) {
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
  createPeriod(@Body() dto: CreatePayrollPeriodDto) {
    return this.payroll.createPeriod(dto);
  }

  @Patch('payroll/periods/:id')
  @RequirePermissions('hr:payroll')
  updatePeriod(@Param('id') id: string, @Body() dto: UpdatePayrollPeriodDto) {
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
  createRun(@Body() dto: CreatePayrollRunDto) {
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
  reverseRun(@Param('id') id: string, @Body() dto: ReverseRunDto) {
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
  markPayslipPaid(@Param('id') id: string, @Body() dto: MarkPayslipPaidDto) {
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
  generateBankPayment(@Body() dto: GenerateBankPaymentDto) {
    return this.payroll.generateBankPayment(dto);
  }

  @Patch('bank-payments/:id/status')
  @RequirePermissions('hr:payroll')
  updateBankPaymentStatus(@Param('id') id: string, @Body() dto: UpdateBankPaymentStatusDto) {
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
  createAdvance(@Body() dto: CreateAdvanceDto) {
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
  rejectAdvance(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.payroll.rejectAdvance(id, dto);
  }

  @Get('loans')
  @RequirePermissions('hr:loan')
  listLoans(@Query() query: any) {
    return this.payroll.listLoans(query);
  }

  @Post('loans')
  @RequirePermissions('hr:loan')
  createLoan(@Body() dto: CreateLoanDto) {
    return this.payroll.createLoan(dto);
  }

  @Patch('loans/:id')
  @RequirePermissions('hr:loan')
  updateLoan(@Param('id') id: string, @Body() dto: UpdateLoanDto) {
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
  createReview(@Body() dto: CreateReviewDto) {
    return this.reports.createReview(dto);
  }

  @Patch('reviews/:id')
  @RequirePermissions('hr:performance')
  updateReview(@Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return this.reports.updateReview(id, dto);
  }

  @Delete('reviews/:id')
  @RequirePermissions('hr:performance')
  deleteReview(@Param('id') id: string) {
    return this.reports.deleteReview(id);
  }

  // ── Salary structures & job grades ─────────────────────────────────────────

  @Get('job-grades')
  @RequirePermissions('hr:grade')
  listJobGrades(@Query() query: any) {
    return this.lifecycle.listGrades(query);
  }

  @Get('job-grades/:id')
  @RequirePermissions('hr:grade')
  getJobGrade(@Param('id') id: string) {
    return this.lifecycle.getGrade(id);
  }

  @Post('job-grades')
  @RequirePermissions('hr:grade')
  createJobGrade(@Body() dto: CreateJobGradeDto) {
    return this.lifecycle.createGrade(dto);
  }

  @Patch('job-grades/:id')
  @RequirePermissions('hr:grade')
  updateJobGrade(@Param('id') id: string, @Body() dto: UpdateJobGradeDto) {
    return this.lifecycle.updateGrade(id, dto);
  }

  @Delete('job-grades/:id')
  @RequirePermissions('hr:grade')
  deleteJobGrade(@Param('id') id: string) {
    return this.lifecycle.deleteGrade(id);
  }

  @Get('salary-structures')
  @RequirePermissions('hr:grade')
  listSalaryStructures(@Query() query: any) {
    return this.lifecycle.listStructures(query);
  }

  @Post('salary-structures')
  @RequirePermissions('hr:grade')
  createSalaryStructure(@Body() dto: CreateSalaryStructureDto) {
    return this.lifecycle.createStructure(dto);
  }

  @Patch('salary-structures/:id')
  @RequirePermissions('hr:grade')
  updateSalaryStructure(@Param('id') id: string, @Body() dto: UpdateSalaryStructureDto) {
    return this.lifecycle.updateStructure(id, dto);
  }

  @Delete('salary-structures/:id')
  @RequirePermissions('hr:grade')
  deleteSalaryStructure(@Param('id') id: string) {
    return this.lifecycle.deleteStructure(id);
  }

  // ── Contracts / onboarding / offboarding / settlement ──────────────────────

  @Get('contracts')
  @RequirePermissions('hr:contract')
  listContracts(@Query() query: any) {
    return this.lifecycle.listContracts(query);
  }

  @Get('contracts/expiring')
  @RequirePermissions('hr:contract')
  expiringContracts(@Query('days') days?: string) {
    return this.lifecycle.listExpiringContracts(days ? Number(days) : 60);
  }

  @Post('contracts')
  @RequirePermissions('hr:contract')
  createContract(@Body() dto: CreateContractDto) {
    return this.lifecycle.createContract(dto);
  }

  @Patch('contracts/:id')
  @RequirePermissions('hr:contract')
  updateContract(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.lifecycle.updateContract(id, dto);
  }

  @Delete('contracts/:id')
  @RequirePermissions('hr:contract')
  deleteContract(@Param('id') id: string) {
    return this.lifecycle.deleteContract(id);
  }

  @Get('employees/:id/salary-history')
  @RequirePermissions('hr:audit')
  salaryHistory(@Param('id') id: string) {
    return this.lifecycle.listSalaryHistory(id);
  }

  @Get('employees/:id/actions')
  @RequirePermissions('hr:employee')
  employeeActions(@Param('id') id: string) {
    return this.lifecycle.listActions(id);
  }

  @Get('employees/:id/audit-trail')
  @RequirePermissions('hr:audit')
  auditTrail(@Param('id') id: string) {
    return this.lifecycle.listAuditTrail(id);
  }

  @Get('employees/:id/onboarding')
  @RequirePermissions('hr:employee')
  listOnboarding(@Param('id') id: string) {
    return this.lifecycle.listOnboarding({ employeeId: id });
  }

  @Post('onboarding-tasks')
  @RequirePermissions('hr:employee')
  addOnboardingTask(@Body() dto: AddOnboardingTaskDto) {
    return this.lifecycle.addOnboardingTask(dto);
  }

  @Post('onboarding-tasks/:id/complete')
  @RequirePermissions('hr:employee')
  completeOnboardingTask(@Param('id') id: string) {
    return this.lifecycle.completeOnboardingTask(id);
  }

  @Delete('onboarding-tasks/:id')
  @RequirePermissions('hr:employee')
  removeOnboardingTask(@Param('id') id: string) {
    return this.lifecycle.removeOnboardingTask(id);
  }

  @Get('offboarding')
  @RequirePermissions('hr:offboarding')
  listOffboarding(@Query() query: any) {
    return this.lifecycle.listOffboarding(query);
  }

  @Get('offboarding/settlement')
  @RequirePermissions('hr:offboarding')
  previewSettlement(@Query('employeeId') employeeId: string, @Query('lastDay') lastDay: string) {
    if (!employeeId || !lastDay) throw new BadRequestException('employeeId and lastDay are required');
    return this.lifecycle.computeFinalSettlement(employeeId, lastDay, false);
  }

  @Post('offboarding/settle')
  @RequirePermissions('hr:offboarding')
  settle(@Body() dto: SettleOffboardingDto) {
    if (!dto.employeeId || !dto.lastDay) throw new BadRequestException('employeeId and lastDay are required');
    return this.lifecycle.computeFinalSettlement(dto.employeeId, dto.lastDay, true);
  }

  // ── Recruitment / ATS ───────────────────────────────────────────────────────

  @Get('vacancies')
  @RequirePermissions('hr:recruitment')
  listVacancies(@Query() query: any) {
    return this.recruitment.listVacancies(query);
  }

  @Post('vacancies')
  @RequirePermissions('hr:recruitment')
  createVacancy(@Body() dto: CreateVacancyDto) {
    return this.recruitment.createVacancy(dto);
  }

  @Patch('vacancies/:id')
  @RequirePermissions('hr:recruitment')
  updateVacancy(@Param('id') id: string, @Body() dto: UpdateVacancyDto) {
    return this.recruitment.updateVacancy(id, dto);
  }

  @Delete('vacancies/:id')
  @RequirePermissions('hr:recruitment')
  deleteVacancy(@Param('id') id: string) {
    return this.recruitment.deleteVacancy(id);
  }

  @Get('applicants')
  @RequirePermissions('hr:recruitment')
  listApplicants(@Query() query: any) {
    return this.recruitment.listApplicants(query);
  }

  @Post('applicants')
  @RequirePermissions('hr:recruitment')
  createApplicant(@Body() dto: CreateApplicantDto) {
    return this.recruitment.createApplicant(dto);
  }

  @Post('applicants/:id/status')
  @RequirePermissions('hr:recruitment')
  setApplicantStatus(@Param('id') id: string, @Body() dto: SetApplicantStatusDto) {
    return this.recruitment.setApplicantStatus(id, dto.status, dto.notes);
  }

  @Delete('applicants/:id')
  @RequirePermissions('hr:recruitment')
  deleteApplicant(@Param('id') id: string) {
    return this.recruitment.deleteApplicant(id);
  }

  @Post('interviews')
  @RequirePermissions('hr:recruitment')
  addInterview(@Body() dto: AddInterviewDto) {
    return this.recruitment.addInterview(dto);
  }

  @Patch('interviews/:id')
  @RequirePermissions('hr:recruitment')
  updateInterview(@Param('id') id: string, @Body() dto: UpdateInterviewDto) {
    return this.recruitment.updateInterview(id, dto);
  }

  @Delete('interviews/:id')
  @RequirePermissions('hr:recruitment')
  deleteInterview(@Param('id') id: string) {
    return this.recruitment.deleteInterview(id);
  }

  @Post('applicants/:id/hire')
  @RequirePermissions('hr:recruitment')
  hire(@Param('id') id: string, @Body() dto: HireApplicantDto) {
    return this.recruitment.hire(id, dto);
  }

  // ── Qualifications / certifications / training ──────────────────────────────

  @Get('qualifications')
  @RequirePermissions('hr:qualification')
  listQualifications(@Query() query: any) {
    return this.training.listQualifications(query);
  }

  @Post('qualifications')
  @RequirePermissions('hr:qualification')
  createQualification(@Body() dto: CreateQualificationDto) {
    return this.training.createQualification(dto);
  }

  @Delete('qualifications/:id')
  @RequirePermissions('hr:qualification')
  deleteQualification(@Param('id') id: string) {
    return this.training.deleteQualification(id);
  }

  @Patch('qualifications/:id')
  @RequirePermissions('hr:qualification')
  updateQualification(@Param('id') id: string, @Body() dto: UpdateQualificationDto) {
    return this.training.updateQualification(id, dto);
  }

  @Get('certifications')
  @RequirePermissions('hr:qualification')
  listCertifications(@Query() query: any) {
    return this.training.listCertifications(query);
  }

  @Get('certifications/expiring')
  @RequirePermissions('hr:qualification')
  expiringCertifications(@Query('days') days?: string) {
    return this.training.listExpiringCertifications(days ? Number(days) : 30);
  }

  @Post('certifications')
  @RequirePermissions('hr:qualification')
  createCertification(@Body() dto: CreateCertificationDto) {
    return this.training.createCertification(dto);
  }

  @Post('certifications/:id/refresh')
  @RequirePermissions('hr:qualification')
  refreshCertification(@Param('id') id: string) {
    return this.training.refreshCertificationStatus(id);
  }

  @Delete('certifications/:id')
  @RequirePermissions('hr:qualification')
  deleteCertification(@Param('id') id: string) {
    return this.training.deleteCertification(id);
  }

  @Patch('certifications/:id')
  @RequirePermissions('hr:qualification')
  updateCertification(@Param('id') id: string, @Body() dto: UpdateCertificationDto) {
    return this.training.updateCertification(id, dto);
  }

  @Get('trainings')
  @RequirePermissions('hr:training')
  listTrainings(@Query() query: any) {
    return this.training.listTrainings(query);
  }

  @Post('trainings')
  @RequirePermissions('hr:training')
  createTraining(@Body() dto: CreateTrainingDto) {
    return this.training.createTraining(dto);
  }

  @Delete('trainings/:id')
  @RequirePermissions('hr:training')
  deleteTraining(@Param('id') id: string) {
    return this.training.deleteTraining(id);
  }

  @Post('training-enrollments')
  @RequirePermissions('hr:training')
  enrollTraining(@Body() dto: EnrollTrainingDto) {
    return this.training.enroll(dto);
  }

  @Post('training-enrollments/:id/status')
  @RequirePermissions('hr:training')
  setEnrollmentStatus(@Param('id') id: string, @Body() dto: SetEnrollmentStatusDto) {
    return this.training.setEnrollmentStatus(id, dto.status, dto.certificateUrl);
  }

  @Delete('training-enrollments/:id')
  @RequirePermissions('hr:training')
  deleteEnrollment(@Param('id') id: string) {
    return this.training.deleteEnrollment(id);
  }

  @Get('training/cpd-report')
  @RequirePermissions('hr:training')
  cpdReport() {
    return this.training.cpdReport();
  }

  // ── Payroll hardening: statutory + preview ──────────────────────────────────

  @Get('payroll/statutory')
  @RequirePermissions('hr:tax_table')
  listStatutory(@Query() query: any) {
    return this.payroll.listStatutoryConfigs(query);
  }

  @Post('payroll/statutory')
  @RequirePermissions('hr:tax_table')
  createStatutory(@Body() dto: CreateStatutoryConfigDto) {
    return this.payroll.createStatutoryConfig(dto);
  }

  @Patch('payroll/statutory/:id')
  @RequirePermissions('hr:tax_table')
  updateStatutory(@Param('id') id: string, @Body() dto: UpdateStatutoryConfigDto) {
    return this.payroll.updateStatutoryConfig(id, dto);
  }

  @Delete('payroll/statutory/:id')
  @RequirePermissions('hr:tax_table')
  deleteStatutory(@Param('id') id: string) {
    return this.payroll.deleteStatutoryConfig(id);
  }

  @Get('payroll/runs/:id/preview')
  @RequirePermissions('hr:payroll')
  payrollPreview(@Param('id') id: string) {
    return this.payroll.previewRun(id);
  }

  /**
   * Sweep HR expiry alerts for the CALLER'S organization.
   *
   * The org is taken from the tenant context, never from the body. The sweep
   * can target an arbitrary org (that is how a scheduled multi-org job uses
   * it), so accepting an id off the wire would let any `hr:report` holder fire
   * a sweep against — and read employee data from — another tenant.
   */
  @Post('alerts/run')
  @RequirePermissions('hr:report')
  runAlerts() {
    return this.alerts.runAlerts(this.tenant.organizationId);
  }

  // ── Skills catalogue (Phase 1) ──────────────────────────────────────────────

  @Get('skills')
  @RequirePermissions('hr:read')
  listSkills(@Query() query: any) {
    return this.people.listSkills(query);
  }

  @Post('skills')
  @RequirePermissions('hr:skill')
  createSkill(@Body() dto: CreateSkillDto) {
    return this.people.createSkill(dto);
  }

  @Patch('skills/:id')
  @RequirePermissions('hr:skill')
  updateSkill(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.people.updateSkill(id, dto);
  }

  @Delete('skills/:id')
  @RequirePermissions('hr:skill')
  deleteSkill(@Param('id') id: string) {
    return this.people.deleteSkill(id);
  }

  /** Employees holding a skill at/above a proficiency — the cover-finder. */
  @Get('skills/:id/employees')
  @RequirePermissions('hr:read')
  employeesBySkill(@Param('id') id: string, @Query('minProficiency') minProficiency?: string) {
    return this.people.findEmployeesBySkill(id, minProficiency);
  }

  // ── Employee ↔ skill links ──────────────────────────────────────────────────

  @Get('employees/:id/skills')
  @RequirePermissions('hr:read')
  listEmployeeSkills(@Param('id') id: string) {
    return this.people.listEmployeeSkills(id);
  }

  @Post('employee-skills')
  @RequirePermissions('hr:skill')
  addEmployeeSkill(@Body() dto: AddEmployeeSkillDto) {
    return this.people.addEmployeeSkill(dto);
  }

  @Patch('employee-skills/:id')
  @RequirePermissions('hr:skill')
  updateEmployeeSkill(@Param('id') id: string, @Body() dto: UpdateEmployeeSkillDto) {
    return this.people.updateEmployeeSkill(id, dto);
  }

  @Post('employee-skills/:id/verify')
  @RequirePermissions('hr:skill')
  verifyEmployeeSkill(@Param('id') id: string, @Body() dto: VerifyDto) {
    return this.people.verifyEmployeeSkill(id, dto.verified);
  }

  @Delete('employee-skills/:id')
  @RequirePermissions('hr:skill')
  removeEmployeeSkill(@Param('id') id: string) {
    return this.people.removeEmployeeSkill(id);
  }

  // ── Prior work experience ───────────────────────────────────────────────────

  @Get('employees/:id/experience')
  @RequirePermissions('hr:read')
  listExperience(@Param('id') id: string) {
    return this.people.listExperience(id);
  }

  @Post('experience')
  @RequirePermissions('hr:experience')
  addExperience(@Body() dto: AddExperienceDto) {
    return this.people.addExperience(dto);
  }

  @Patch('experience/:id')
  @RequirePermissions('hr:experience')
  updateExperience(@Param('id') id: string, @Body() dto: UpdateExperienceDto) {
    return this.people.updateExperience(id, dto);
  }

  @Delete('experience/:id')
  @RequirePermissions('hr:experience')
  removeExperience(@Param('id') id: string) {
    return this.people.removeExperience(id);
  }

  // ── Personnel documents (CV, ID, contract copies) ───────────────────────────

  @Get('employees/:id/documents')
  @RequirePermissions('hr:document')
  listDocuments(@Param('id') id: string) {
    return this.people.listDocuments(id);
  }

  /** Multipart upload — the file plus metadata form fields. */
  @Post('documents/upload')
  @RequirePermissions('hr:document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadDocument(@UploadedFile() file: any, @Body() meta: UploadDocumentMetaDto) {
    return this.people.uploadDocument({ ...meta, file });
  }

  @Patch('documents/:id')
  @RequirePermissions('hr:document')
  updateDocument(@Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.people.updateDocument(id, dto);
  }

  @Post('documents/:id/verify')
  @RequirePermissions('hr:document')
  verifyDocument(@Param('id') id: string, @Body() dto: VerifyDto) {
    return this.people.verifyDocument(id, dto.verified);
  }

  /** Ownership-checked signed download URL for the document's file. */
  @Post('documents/:id/download')
  @RequirePermissions('hr:document')
  downloadDocument(@Param('id') id: string) {
    return this.people.getDocumentDownload(id);
  }

  @Delete('documents/:id')
  @RequirePermissions('hr:document')
  deleteDocument(@Param('id') id: string) {
    return this.people.deleteDocument(id);
  }

  // ── Reconciliation: school roster ↔ HR payroll record (Phase 2) ─────────────

  /**
   * Three buckets: linked, HR-only, school-only. This is the permanent tool for
   * orgs that keep adding people on one side only — the Phase 2 migration
   * linked exact matches, never fuzzy ones.
   */
  @Get('reconciliation')
  @RequirePermissions('hr:employee_identity')
  reconciliationOverview() {
    return this.reconciliation.overview();
  }

  @Post('reconciliation/employees/:id/link')
  @RequirePermissions('hr:employee_identity')
  linkStaff(@Param('id') id: string, @Body() dto: LinkStaffDto) {
    return this.reconciliation.link(id, dto.staffProfileId);
  }

  @Post('reconciliation/employees/:id/unlink')
  @RequirePermissions('hr:employee_identity')
  unlinkStaff(@Param('id') id: string) {
    return this.reconciliation.unlink(id);
  }

  @Post('reconciliation/create-employee')
  @RequirePermissions('hr:employee_identity')
  createEmployeeFromStaff(@Body() dto: CreateEmployeeFromStaffDto) {
    const { staffProfileId, ...overrides } = dto;
    return this.reconciliation.createEmployeeFromStaff(staffProfileId, overrides);
  }

  @Post('reconciliation/create-staff')
  @RequirePermissions('hr:employee_identity')
  createStaffFromEmployee(@Body() dto: CreateStaffFromEmployeeDto) {
    const { employeeId, ...overrides } = dto;
    return this.reconciliation.createStaffFromEmployee(employeeId, overrides);
  }

  // ── Employee & Manager self-service ─────────────────────────────────────────

  /**
   * Who the caller is as staff: their HR employee id, master-data Partner and
   * school StaffProfile. The UI needs `staffProfileId` to call teacher-scoped
   * school endpoints as itself rather than picking a colleague from a list.
   *
   * Gated on `hr:self` — it only ever describes the caller.
   */
  @Get('me/identity')
  @RequirePermissions('hr:self')
  myIdentity() {
    return this.employeeIdentity.forUser();
  }

  /**
   * The caller's OWN record. Gated on `hr:self`, not `hr:read` — `hr:read`
   * grants read of every employee in the org, which is the wrong permission
   * for a teacher opening their own payslip. The user id comes from the
   * verified session, never from input.
   */
  @Get('self/profile')
  @RequirePermissions('hr:self')
  selfProfile() {
    const userId = this.tenant.userId;
    if (!userId) throw new NotFoundException('No signed-in user');
    return this.payroll.employeeForUser(userId);
  }

  /** Direct reports of the caller, resolved from their own employee record. */
  @Get('team')
  @RequirePermissions('hr:self')
  async team() {
    const userId = this.tenant.userId;
    if (!userId) return [];
    const emp = await this.payroll.employeeForUser(userId);
    return emp ? this.payroll.teamForManager(emp.id) : [];
  }

  /** The caller's own payslips. Never another employee's. */
  @Get('self/payslips')
  @RequirePermissions('hr:self')
  async selfPayslips() {
    const userId = this.tenant.userId;
    if (!userId) return { rows: [], total: 0 };
    const emp = await this.payroll.employeeForUser(userId);
    if (!emp) return { rows: [], total: 0 };
    return this.payroll.listPayslips({ employeeId: emp.id });
  }
}
