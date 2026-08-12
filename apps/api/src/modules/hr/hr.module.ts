import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { HrController } from './hr.controller';
import { HrOrgService } from './hr-org.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrTimesheetService } from './hr-timesheet.service';
import { HrLeaveService } from './hr-leave.service';
import { HrPayrollService } from './hr-payroll.service';
import { HrReportsService } from './hr-reports.service';

/**
 * Workforce Management (HR) — attendance, timesheets, leave and payroll.
 *
 * Org masters (departments/positions/employees/shifts) → clock events +
 * daily attendance → timesheets (repair/task-linked) → leave with balances →
 * payroll runs (calculate → approve → payslips → GL posting → bank payment) →
 * advances/loans → performance reviews → reports.
 *
 * Payroll posts through the accounting PostingService (ADR-009) using the
 * payroll account mappings added to the COA (salary expense, net pay payable,
 * PAYE, pension, SSF, insurance, loan/advance receivables).
 */
@Module({
  imports: [AccountingModule],
  controllers: [HrController],
  providers: [
    HrOrgService,
    HrAttendanceService,
    HrTimesheetService,
    HrLeaveService,
    HrPayrollService,
    HrReportsService,
  ],
  exports: [HrPayrollService, HrAttendanceService],
})
export class HrModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'hr',
      version: '1.0.0',
      dependencies: ['core', 'accounting'],
      permissions: [...Object.values(PERMISSIONS.hr)],
    });
  }
}
