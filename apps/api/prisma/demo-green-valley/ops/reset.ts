/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Clears the operations demo (money, payroll, expenses, transport and meals
 * activity) for one demo school so `ops/run.cjs` can write a fresh year, and
 * restarts that school's document numbering. Configuration (accounts, fee
 * structures, routes, staff, menus) is kept — the stages upsert it anyway.
 *
 * Academic data is never touched.
 *
 *   pnpm --filter @erp/api db:reset:sunrise-ops -- --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SCHOOL, assertNotProduction } from '../shared';

/** Activity tables, children first. Retry passes absorb any ordering we got wrong. */
const TABLES = [
  'PaymentAllocationReversal', 'PaymentAllocation', 'FeeCreditAllocation', 'CashMovement', 'Payment',
  'FeeCredit', 'Waiver', 'FeeAdjustment', 'PenaltyAssessment', 'PenaltyRun', 'SchoolFeeInvoice', 'TransportCharge',
  'DocumentLine', 'Document', 'JournalLine', 'JournalEntry',
  'ExpensePayment', 'Expense',
  'HrPayslip', 'HrPayrollAllowance', 'HrPayrollDeduction', 'HrPayrollItem', 'HrBankPaymentLine', 'HrBankPayment',
  'HrPayrollRun', 'HrPayrollInput', 'HrPayrollPeriod', 'HrSalaryAdvance', 'HrEmployeeLoan',
  'HrLeaveRequest', 'HrLeaveAccrual', 'HrLeaveBalance', 'TeacherCover',
  'TransportBoardingEvent', 'TransportTripEvent', 'TransportTripPassenger', 'TransportTripStop', 'TransportEndOfTripCheck',
  'TransportIncidentAction', 'TransportIncidentStudent', 'TransportIncident', 'TransportTrip',
  'TransportInspectionItem', 'TransportVehicleInspection',
  'TransportRequest', 'TransportAuthorizedPerson', 'TransportSpecialRequirement', 'StudentTransportAssignment',
  'MealAttendance', 'MealSession', 'MealWaste', 'MealConsumption', 'MealProductionItem', 'MealProductionPlan',
  'MealAccountTransaction', 'MealPurchase', 'MealAccount', 'MealPlanAssignment',
  'Sponsorship', 'Scholarship', 'StudentOptionalFee', 'Budget',
];

/** Numbering this demo consumes. */
const SEQUENCES = [
  'expense_2026', 'feecredit_2026', 'hr_advance', 'hr_bank_payment', 'hr_leave_request', 'hr_loan', 'hr_payroll_run',
  'hr_payslip', 'invoice_2026', 'journal_BANK_2026', 'journal_CASH_2026', 'journal_GEN_2026', 'journal_SALES_2026',
  'payment_2026', 'schoolfeeinvoice_2026',
];

async function main() {
  assertNotProduction();
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUnique({ where: { code: SCHOOL.orgCode } });
    if (!org) throw new Error(`Organization ${SCHOOL.orgCode} not found`);
    const O = org.id;
    console.log(`\n${apply ? 'Clearing' : 'Would clear'} operations demo data for ${SCHOOL.orgName} (${O})\n`);

    const existing = new Set(
      ((await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)) as any[]).map((r) => r.table_name),
    );
    let pending = TABLES.filter((t) => existing.has(t));
    for (const t of pending) {
      const [{ n }] = (await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}" WHERE "organizationId" = $1`, O)) as any[];
      if (n > 0) console.log(`  ${t.padEnd(30)} ${n}`);
    }
    if (!apply) {
      console.log('\nDry run. Re-run with --apply to delete.');
      return;
    }
    for (let pass = 1; pass <= 6 && pending.length; pass += 1) {
      const failed: string[] = [];
      for (const t of pending) {
        try {
          await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "organizationId" = $1`, O);
        } catch {
          failed.push(t);
        }
      }
      pending = failed;
    }
    if (pending.length) throw new Error(`Could not clear: ${pending.join(', ')}`);

    const short = O.replace(/-/g, '').slice(0, 8);
    for (const s of SEQUENCES) {
      await prisma.$executeRawUnsafe(`ALTER SEQUENCE IF EXISTS numbering."seq_${short}_${s}" RESTART WITH 1`);
    }
    console.log('\nCleared. Numbering restarted. Now: pnpm --filter @erp/api db:seed:sunrise-ops\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
