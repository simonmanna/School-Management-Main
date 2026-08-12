/**
 * School ERP Vertical.
 *
 * Per the ROADMAP §11 and TRANSFER §11, a school is a thin vertical:
 *   - student = Partner (with customFields for grade/parent/etc)
 *   - tuition = service Product
 *   - term fees = recurring sales_invoices
 *   - fee collection = inbound Payment (reuse the kernel)
 *   - enrollment/classes/fee schedules = workflow + new module-scoped table
 *
 * The new table this module owns is `SchoolEnrollment`. Everything else is
 * composed from existing core types via customFields and JSONB.
 *
 * NOTE: this module lives at modules/school/ (not modules/verticals/school/)
 * because depcruise's regex does not support cross-segment backreferences. See
 * the POS module for the same rationale.
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { CoreModule } from '../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { SchoolController } from './school.controller';
import { SchoolService } from './school.service';

export const SCHOOL_PERMISSIONS = {
  school: {
    read: 'school:read',
    enroll: 'school:enroll',
    issueTermFees: 'school:issue_term_fees',
    recordPayment: 'school:record_payment',
    manageSchedule: 'school:manage_schedule',
  },
};

@Module({
  imports: [CoreModule, AccountingModule, InvoicingModule],
  controllers: [SchoolController],
  providers: [SchoolService],
})
export class SchoolModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'school',
      version: '1.0.0',
      dependencies: ['core', 'accounting', 'invoicing'],
      permissions: Object.values(SCHOOL_PERMISSIONS.school),
    });
  }
}
