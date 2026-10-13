/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * School operations for the demo school: the money and the people who are not
 * in a classroom. Driven by ./run.cjs, which boots the API's own services.
 *
 *   13  accounts    chart of accounts, banks, fiscal periods, balances b/f, treasury
 *   14  fees        fee catalogue, bursaries & sponsors, billing, receipts, waivers
 *   15  hr          departments, support staff, salaries, leave, advances, payroll
 *   16  expenses    suppliers, categories, a year of approved and paid expenses
 *   17  transport   zones, stops, routes, buses, crew, riders, trips, transport fees
 *   18  meals       meal types, plans, menus, kitchen, daily service, tuck-shop cards
 *   19  library     catalogue, copies, lending, returns, overdue fines
 *   20  store       stores, units, stock items, opening stock, issues, counts
 *   21  purchasing  suppliers, requisitions, orders, deliveries, bills, payments
 *   22  revenue     income heads, other income, institutional sales, credit notes
 *
 * Every stage first writes its configuration, then puts its dated events on one
 * timeline; the timeline replays January → yesterday in order with the clock
 * set to each business day, so receipt numbers, journal dates and payslips
 * line up the way a real year would leave them.
 *
 * Idempotent: configuration is upserted on stable codes, and every money event
 * carries a key (an external reference, a posting key, or a natural key) that
 * the service — or the stage — checks before writing again.
 *
 * Environment:
 *   --school=<key>       sunrise | greenvalley
 *   DEMO_OPS_ONLY        comma list of stages to run, e.g. "13,14"
 *   DEMO_AS_OF           last story date (default: yesterday)
 */
import { PrismaClient } from '@prisma/client';
import { SCHOOL, loadSchool, ok, warn, log } from '../shared';
import { buildContext, clock, iso, Timeline, type OpsHost } from './kit';
import { seedAccounts } from './13-accounts';
import { seedFees } from './14-fees';
import { ensureSupportStaff, seedHr, OPS_LOGINS } from './15-hr';
import { seedExpenses } from './16-expenses';
import { seedTransport } from './17-transport';
import { seedMeals } from './18-meals';
import { seedLibrary } from './19-library';
import { seedStore } from './20-store';
import { seedPurchasing } from './21-purchasing';
import { seedRevenue } from './22-revenue';
import { loadRoster } from './roster';

export async function runOps(host: OpsHost): Promise<void> {
  const started = Date.now();
  const realStart = new Date();
  clock.install();
  const prisma = new PrismaClient();
  try {
    console.log(`\n=== ${SCHOOL.orgName} — school operations demo (FICTIONAL DATA) ===\n`);
    const school = await loadSchool(prisma);
    const asOf = storyEnd();

    const hired = await ensureSupportStaff(prisma, school);
    const ctx = await buildContext(host, prisma, school, asOf);
    ok(`organization ${SCHOOL.orgCode}; story runs to ${asOf}; ${hired} support staff on the roll`);

    const only = (process.env.DEMO_OPS_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const run = (stage: number) => only.length === 0 || only.includes(String(stage));
    const tl = new Timeline();

    console.log('\n── 13. Books ──');
    const books = await seedAccounts(ctx, tl);
    const roster = await loadRoster(ctx);
    ok(`roll: ${roster.pupils.length} pupils, terms ${roster.terms.map((t) => `${t.name} ${t.start}→${t.end}`).join(', ')}`);

    if (run(14)) {
      console.log('\n── 14. School fees ──');
      await seedFees(ctx, tl, books, roster);
    }
    if (run(15)) {
      console.log('\n── 15. HR & payroll ──');
      await seedHr(ctx, tl, books);
    }
    if (run(16)) {
      console.log('\n── 16. Expenses ──');
      await seedExpenses(ctx, tl, books, roster);
    }
    if (run(17)) {
      console.log('\n── 17. Transport ──');
      await seedTransport(ctx, tl, books, roster);
    }
    if (run(18)) {
      console.log('\n── 18. Meals & cafeteria ──');
      await seedMeals(ctx, tl, books, roster);
    }

    if (run(19)) {
      console.log('\n── 19. Library ──');
      await seedLibrary(ctx, tl, roster);
    }
    let store: Awaited<ReturnType<typeof seedStore>> | null = null;
    if (run(20) || run(21) || run(22)) {
      console.log('\n── 20. School store ──');
      store = await seedStore(ctx, tl, books, roster);
    }
    if (run(21) && store) {
      console.log('\n── 21. Purchasing ──');
      await seedPurchasing(ctx, tl, books, store, roster);
    }
    if (run(22) && store) {
      console.log('\n── 22. Revenue beyond fees ──');
      await seedRevenue(ctx, tl, books, store, roster);
    }

    console.log(`\n── Replaying the year (${tl.size} events) ──`);
    await tl.run({ asOf, concurrency: 6, log: (m) => console.log(`  - ${m}`) });
    tl.report();

    console.log('\n── Dating what the database stamped "now" ──');
    await restampCreatedAt(prisma, school.O, realStart);

    console.log('\n── Integrity ──');
    await integrity(prisma, school.O, books.account('1300'));

    await summary(prisma, school.O);

    console.log('\n── Operations logins ──');
    const d = SCHOOL.emailDomain;
    const pw = process.env.DEMO_STAFF_PASSWORD ?? SCHOOL.passwords.staff;
    log(`${`bursar@${d}`.padEnd(26)} Bursar (fees, expenses, payroll payments)   ${pw}`);
    log(`${`head@${d}`.padEnd(26)} Head Teacher (approvals)                     ${pw}`);
    for (const l of OPS_LOGINS) log(`${`${l.key}@${d}`.padEnd(26)} ${l.role.padEnd(44)} ${pw}`);

    console.log(`\nDEMO DATA — fictional school. Done in ${Math.round((Date.now() - started) / 1000)}s.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Yesterday (Kampala time), capped at the end of the 2026 school year. */
function storyEnd(): string {
  if (process.env.DEMO_AS_OF) return process.env.DEMO_AS_OF.slice(0, 10);
  const kampalaToday = iso(new Date(Date.now() + 3 * 3_600_000));
  const yesterday = iso(new Date(new Date(`${kampalaToday}T00:00:00Z`).getTime() - 86_400_000));
  if (yesterday > '2026-12-31') return '2026-12-31';
  if (yesterday < '2026-01-01') warn('The 2026 story has not started yet; nothing dated will be written.');
  return yesterday;
}

/**
 * Rows the services wrote carry the business date in their own columns, but
 * `createdAt` is the database's real "now". Lists sorted by creation would put
 * February's receipts beside yesterday's, so re-date the ones this run wrote.
 */
async function restampCreatedAt(prisma: PrismaClient, O: string, since: Date): Promise<void> {
  const statements: Array<[string, string]> = [
    ['journal entries', `UPDATE "JournalEntry" SET "createdAt" = COALESCE("postedAt", "postingDate") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['journal lines', `UPDATE "JournalLine" jl SET "createdAt" = je."createdAt" FROM "JournalEntry" je WHERE je.id = jl."journalEntryId" AND jl."organizationId" = $1 AND jl."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['invoices', `UPDATE "Document" SET "createdAt" = "issueDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['fee invoices', `UPDATE "SchoolFeeInvoice" s SET "createdAt" = d."issueDate" FROM "Document" d WHERE d.id = s."documentId" AND s."organizationId" = $1 AND s."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['receipts', `UPDATE "Payment" SET "createdAt" = "paymentDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['allocations', `UPDATE "PaymentAllocation" a SET "createdAt" = p."paymentDate" FROM "Payment" p WHERE p.id = a."paymentId" AND a."organizationId" = $1 AND a."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['fee credits', `UPDATE "FeeCredit" c SET "createdAt" = p."paymentDate" FROM "Payment" p WHERE p.id = c."sourcePaymentId" AND c."organizationId" = $1 AND c."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['expenses', `UPDATE "Expense" SET "createdAt" = "expenseDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['expense payments', `UPDATE "ExpensePayment" SET "createdAt" = "paymentDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['payroll periods', `UPDATE "HrPayrollPeriod" SET "createdAt" = "startDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['payroll runs', `UPDATE "HrPayrollRun" r SET "createdAt" = COALESCE(r."paymentDate", p."endDate") - interval '4 days' FROM "HrPayrollPeriod" p WHERE p.id = r."periodId" AND r."organizationId" = $1 AND r."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['payslips', `UPDATE "HrPayslip" s SET "createdAt" = r."createdAt" + interval '1 day' FROM "HrPayrollItem" i JOIN "HrPayrollRun" r ON r.id = i."runId" WHERE i.id = s."itemId" AND s."organizationId" = $1 AND s."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['leave requests', `UPDATE "HrLeaveRequest" SET "createdAt" = "startDate" - interval '7 days' WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['advances', `UPDATE "HrSalaryAdvance" SET "createdAt" = COALESCE("approvedAt", "paidAt", "createdAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['loans', `UPDATE "HrEmployeeLoan" SET "createdAt" = COALESCE("disbursedAt", "createdAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['transport assignments', `UPDATE "StudentTransportAssignment" SET "createdAt" = "startDate" - interval '10 days' WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['transport charges', `UPDATE "TransportCharge" c SET "createdAt" = d."issueDate" FROM "Document" d WHERE d.id = c."documentId" AND c."organizationId" = $1 AND c."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['trips', `UPDATE "TransportTrip" SET "createdAt" = "date" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['inspections', `UPDATE "TransportVehicleInspection" SET "createdAt" = "date" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['incidents', `UPDATE "TransportIncident" SET "createdAt" = "occurredAt" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['meal plans', `UPDATE "MealPlanAssignment" SET "createdAt" = "startDate" - interval '10 days' WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['production plans', `UPDATE "MealProductionPlan" SET "createdAt" = "date" - interval '9 hours' WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['waste', `UPDATE "MealWaste" w SET "createdAt" = p."date" + interval '11 hours', "recordedAt" = p."date" + interval '11 hours' FROM "MealProductionPlan" p WHERE p.id = w."mealProductionPlanId" AND w."organizationId" = $1 AND w."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['sponsorships', `UPDATE "Sponsorship" SET "createdAt" = "validFrom" + interval '9 days' WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['library loans', `UPDATE "Borrowing" SET "borrowedAt" = "dueAt" - interval '14 days' WHERE "organizationId" = $1 AND "borrowedAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['other income', `UPDATE "Income" SET "createdAt" = "incomeDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['purchase orders', `UPDATE "PurchaseOrder" SET "createdAt" = "orderDate" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['goods receipts', `UPDATE "GoodsReceiptNote" SET "createdAt" = COALESCE("postedAt", "receivedAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['supplier payments', `UPDATE "PurchasePayment" SET "createdAt" = "paidAt" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['debit notes', `UPDATE "DebitNote" SET "createdAt" = COALESCE("postedAt", "issueDate") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock issues', `UPDATE "StockOut" SET "createdAt" = COALESCE("postedAt", "approvedAt", "createdAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock waste', `UPDATE "WasteRecord" SET "createdAt" = COALESCE("postedAt", "approvedAt", "createdAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock adjustments', `UPDATE "StockAdjustment" SET "createdAt" = COALESCE("postedAt", "approvedAt", "createdAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock transfers', `UPDATE "StockTransfer" SET "createdAt" = COALESCE("completedAt", "postedAt", "approvedAt", "createdAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock counts', `UPDATE "InventoryCountSession" SET "createdAt" = COALESCE("submittedAt", "startedAt"), "startedAt" = COALESCE("submittedAt", "startedAt") WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock ledger', `UPDATE "InventoryLedger" il SET "createdAt" = je."postingDate" FROM "JournalEntry" je WHERE je."organizationId" = il."organizationId" AND je."sourceId" = il."referenceId" AND il."organizationId" = $1 AND il."createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['stock batches', `UPDATE "InventoryBatch" SET "createdAt" = "receivedAt" WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
    ['scholarships', `UPDATE "Scholarship" SET "createdAt" = "validFrom" + interval '9 days' WHERE "organizationId" = $1 AND "createdAt" >= ($2::timestamptz AT TIME ZONE 'UTC')`],
  ];
  const done: string[] = [];
  for (const [label, sql] of statements) {
    try {
      const n = await prisma.$executeRawUnsafe(sql, O, since);
      if (n > 0) done.push(`${label} ${n}`);
    } catch (err: any) {
      warn(`re-dating ${label} skipped: ${String(err?.message ?? err).split('\n').pop()?.slice(0, 160)}`);
    }
  }
  log(done.join(', ') || 'nothing new to re-date');
}

/** The checks an auditor runs first. */
async function integrity(prisma: PrismaClient, O: string, arAccountId: string): Promise<void> {
  const [tb]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(jl."baseDebit"),0)::numeric d, COALESCE(SUM(jl."baseCredit"),0)::numeric c
       FROM "JournalLine" jl JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
      WHERE jl."organizationId" = $1 AND je.status IN ('posted','reversed')`,
    O,
  );
  const unbalanced: any[] = await prisma.$queryRawUnsafe(
    `SELECT je."entryNumber" FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
      WHERE je."organizationId" = $1 GROUP BY je.id, je."entryNumber" HAVING SUM(jl."baseDebit") <> SUM(jl."baseCredit")`,
    O,
  );
  const [ar]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(jl."baseDebit" - jl."baseCredit"),0)::numeric gl
       FROM "JournalLine" jl JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
      WHERE jl."organizationId" = $1 AND jl."accountId" = $2 AND je.status IN ('posted','reversed')`,
    O,
    arAccountId,
  );
  const [sub]: any[] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("amountResidual"),0)::numeric open FROM "Document"
      WHERE "organizationId" = $1 AND "documentType" = 'sales_invoice' AND status IN ('posted','paid')`,
    O,
  );
  const fractional: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "Document" WHERE "organizationId" = $1 AND ("totalAmount" <> ROUND("totalAmount") OR "amountResidual" <> ROUND("amountResidual")) LIMIT 5`,
    O,
  );
  const balanced = String(tb.d) === String(tb.c);
  (balanced ? ok : warn)(`trial balance: debits ${Number(tb.d).toLocaleString()} = credits ${Number(tb.c).toLocaleString()}`);
  (unbalanced.length === 0 ? ok : warn)(`journal entries out of balance: ${unbalanced.length}`);
  const credits: any[] = await prisma.$queryRawUnsafe(`SELECT COALESCE(SUM(remaining),0)::numeric r FROM "FeeCredit" WHERE "organizationId" = $1`, O);
  log(`receivables: GL ${Number(ar.gl).toLocaleString()} vs open invoices ${Number(sub.open).toLocaleString()} (fee credits held ${Number(credits[0].r).toLocaleString()})`);
  (fractional.length === 0 ? ok : warn)(`invoices with fractional shillings: ${fractional.length}`);
}

async function summary(prisma: PrismaClient, O: string): Promise<void> {
  const counts = {
    feeInvoices: await prisma.schoolFeeInvoice.count({ where: { organizationId: O } }),
    invoicesAll: await prisma.document.count({ where: { organizationId: O, documentType: 'sales_invoice' } }),
    receipts: await prisma.payment.count({ where: { organizationId: O, direction: 'inbound' } }),
    feeCredits: await prisma.feeCredit.count({ where: { organizationId: O } }),
    waivers: await prisma.waiver.count({ where: { organizationId: O } }),
    journalEntries: await prisma.journalEntry.count({ where: { organizationId: O } }),
    employees: await prisma.hrEmployee.count({ where: { organizationId: O, deletedAt: null } }),
    payrollRuns: await prisma.hrPayrollRun.count({ where: { organizationId: O } }),
    payslips: await prisma.hrPayslip.count({ where: { organizationId: O } }),
    leaveRequests: await prisma.hrLeaveRequest.count({ where: { organizationId: O } }),
    advances: await prisma.hrSalaryAdvance.count({ where: { organizationId: O } }),
    loans: await prisma.hrEmployeeLoan.count({ where: { organizationId: O } }),
    expenses: await prisma.expense.count({ where: { organizationId: O } }),
    expensePayments: await prisma.expensePayment.count({ where: { organizationId: O } }),
    vehicles: await prisma.vehicle.count({ where: { organizationId: O, deletedAt: null } }),
    transportRiders: await prisma.studentTransportAssignment.count({ where: { organizationId: O } }),
    trips: await prisma.transportTrip.count({ where: { organizationId: O } }),
    boardingEvents: await prisma.transportBoardingEvent.count({ where: { organizationId: O } }),
    mealAssignments: await prisma.mealPlanAssignment.count({ where: { organizationId: O } }),
    mealSessions: await prisma.mealSession.count({ where: { organizationId: O } }),
    mealsServed: await prisma.mealAttendance.count({ where: { organizationId: O, status: 'served' } }),
    productionPlans: await prisma.mealProductionPlan.count({ where: { organizationId: O } }),
    tuckShopCards: await prisma.mealAccount.count({ where: { organizationId: O } }),
    tuckShopTxns: await prisma.mealAccountTransaction.count({ where: { organizationId: O } }),
    libraryTitles: await prisma.bookMetadata.count({ where: { organizationId: O } }),
    libraryCopies: await prisma.bookCopy.count({ where: { organizationId: O } }),
    borrowings: await prisma.borrowing.count({ where: { organizationId: O } }),
    libraryFines: await prisma.borrowing.count({ where: { organizationId: O, fineAmount: { gt: 0 } } }),
    stockItems: await prisma.product.count({ where: { organizationId: O, trackInventory: true, productType: 'stockable' } }),
    stockLedger: await prisma.inventoryLedger.count({ where: { organizationId: O } }),
    stockIssues: await prisma.stockOut.count({ where: { organizationId: O } }),
    stockTransfers: await prisma.stockTransfer.count({ where: { organizationId: O } }),
    stockCounts: await prisma.inventoryCountSession.count({ where: { organizationId: O } }),
    purchaseRequests: await prisma.purchaseRequest.count({ where: { organizationId: O } }),
    purchaseOrders: await prisma.purchaseOrder.count({ where: { organizationId: O } }),
    goodsReceipts: await prisma.goodsReceiptNote.count({ where: { organizationId: O } }),
    debitNotes: await prisma.debitNote.count({ where: { organizationId: O } }),
    vendorBills: await prisma.document.count({ where: { organizationId: O, documentType: 'vendor_bill' } }),
    creditNotes: await prisma.document.count({ where: { organizationId: O, documentType: 'credit_note' } }),
    supplierPayments: await prisma.payment.count({ where: { organizationId: O, direction: 'outbound' } }),
    otherIncome: await prisma.income.count({ where: { organizationId: O } }),
  };
  console.log('\n' + JSON.stringify(counts, null, 2));
}
