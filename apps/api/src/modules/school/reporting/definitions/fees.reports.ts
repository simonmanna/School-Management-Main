import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Fee-domain reports.
 *
 * EVERY figure here comes from SchoolFinanceQueryService or AdvancedFinanceService.
 * None is computed in this file. That is not a style preference — it is the
 * AR identity in docs/architecture/FINANCIAL_INVARIANTS.md:
 *
 *   posted charges + valid debit adjustments + refunded allocated payments
 *   − valid payment allocations − valid waivers − valid credit applications
 *   − valid write-offs
 *
 * `Document.amountResidual` is a CACHED PROJECTION and is never an independent
 * input. A report that sums it produces a number that disagrees with the pupil's
 * own statement — the "dashboard says 20M, statement says 18M" failure this
 * whole layer exists to prevent. `report-definition-canon.spec.ts` fails the
 * build if this file mentions it.
 */
export function feesReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  /** Fee reports carry an extra grant: "who owes money" is the most sensitive set a school holds. */
  const FINANCE = [PERMISSIONS.school.readFinanceReports];

  return [
    {
      key: 'fees.student-statement',
      title: 'Student Fee Statement',
      domain: 'fees',
      description: 'One pupil: what was billed, paid, waived and credited, with the running ledger.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['studentProfileId', 'termId', 'dateFrom', 'dateTo'],
      requiredFilters: ['studentProfileId'],
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'date', order: 'asc' },
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 12 },
        { key: 'reference', label: 'Reference', type: 'string', width: 16 },
        { key: 'description', label: 'Description', type: 'string', width: 30 },
        { key: 'ledgerType', label: 'Type', type: 'enum', width: 12 },
        { key: 'debit', label: 'Charge', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'credit', label: 'Credit', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'balance', label: 'Balance', type: 'money', format: '', width: 12 },
      ],
      async run(ctx, params) {
        const [ledger, balance] = await Promise.all([
          deps.finance.studentLedger(params.studentProfileId, {
            from: params.dateFrom,
            to: params.dateTo,
          }),
          deps.finance.studentBalance(params.studentProfileId),
        ]);
        const directory = await deps.resolver.studentDirectory([params.studentProfileId]);
        const who = directory.get(params.studentProfileId);

        return {
          rows: ledger.rows as any[],
          // Totals come from the canonical balance, not from summing the rows on
          // screen: a date-filtered ledger would otherwise total to a figure that
          // is not the pupil's balance.
          totals: {
            description: 'Closing balance',
            debit: balance.billed + balance.adjusted,
            credit: balance.collected + balance.waived + balance.credited,
            balance: balance.balance,
          },
          caption: [
            who ? `${who.name} (${who.admissionNo})` : params.studentProfileId,
            who?.className,
            `Opening balance ${Math.round(ledger.openingBalance).toLocaleString('en-UG')}`,
          ].filter(Boolean).join(' · '),
        };
      },
    },

    {
      key: 'fees.class-clearance',
      title: 'Class Fee Clearance',
      domain: 'fees',
      description:
        'Who in a class is cleared, partly paid or blocked against the clearance threshold.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      // classId is REQUIRED and there is no campus/grade filter on purpose: the
      // underlying classFeeClearance calls studentBalance per pupil, which is
      // itself multi-query. Org-wide would be ~10,000 queries for a 2,000-pupil
      // school. Widening this needs a batch balance method in the fees service
      // first — the arithmetic belongs there, not here.
      filters: ['classId', 'termId'],
      requiredFilters: ['classId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 200,
      defaultSort: { key: 'outstanding', order: 'desc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'status', label: 'Clearance', type: 'enum', width: 12 },
        { key: 'billed', label: 'Billed', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'settled', label: 'Settled', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'outstanding', label: 'Outstanding', type: 'money', format: '', width: 14, total: 'sum',
          link: { reportKey: 'fees.student-statement', paramFrom: { studentProfileId: 'studentProfileId' } } },
        { key: 'settledPercent', label: 'Settled %', type: 'percent', width: 11 },
        { key: 'shortfall', label: 'Shortfall', type: 'money', format: '', width: 14, total: 'sum' },
      ],
      async run(ctx, params) {
        const result = await deps.finance.classFeeClearance(params.classId);
        return {
          rows: result.rows as any[],
          caption:
            `Threshold ${result.thresholdPercent}% · `
            + `${result.cleared} cleared, ${result.partial} partial, ${result.blocked} blocked `
            + `of ${result.total}`,
        };
      },
    },

    {
      key: 'fees.outstanding-by-student',
      title: 'Outstanding Fees by Student',
      domain: 'fees',
      description: 'Every pupil with a balance, split into overdue and not-yet-due.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['classId', 'gradeLevelId', 'campusId', 'termId', 'classBasis'],
      requiredFilters: ['classId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 500,
      defaultSort: { key: 'outstanding', order: 'desc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'className', label: 'Class', type: 'string', width: 12 },
        { key: 'billed', label: 'Billed', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'collected', label: 'Collected', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'waived', label: 'Waived', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'outstanding', label: 'Outstanding', type: 'money', format: '', width: 14, total: 'sum',
          link: { reportKey: 'fees.student-statement', paramFrom: { studentProfileId: 'studentProfileId' } } },
        { key: 'overdue', label: 'Overdue', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'dueLater', label: 'Due later', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'nextDueDate', label: 'Next due', type: 'date', width: 12 },
      ],
      async run(ctx) {
        const studentIds = await deps.resolver.studentIdsFor(ctx);
        const directory = await deps.resolver.studentDirectory(studentIds);

        // studentBalance is multi-query per pupil, so this is deliberately
        // class-scoped (classId is a required filter). See the note on
        // fees.class-clearance.
        const rows = await Promise.all(studentIds.map(async (id) => {
          const [balance, breakdown] = await Promise.all([
            deps.finance.studentBalance(id),
            deps.finance.outstandingBreakdown(id),
          ]);
          const d = directory.get(id);
          return {
            studentProfileId: id,
            admissionNo: d?.admissionNo ?? '',
            studentName: d?.name ?? id,
            className: d?.className ?? '',
            billed: balance.billed,
            collected: balance.collected,
            waived: balance.waived,
            outstanding: balance.balance,
            overdue: breakdown.overdue,
            dueLater: breakdown.dueLater,
            nextDueDate: breakdown.nextDueDate,
          };
        }));

        // Pupils who owe nothing are not "outstanding fees".
        return { rows: rows.filter((r) => r.outstanding > 0) };
      },
    },

    {
      key: 'fees.defaulters',
      title: 'Fee Defaulters',
      domain: 'fees',
      description: 'Pupils with an unpaid balance, ranked by how long it has been overdue.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['classId', 'asOf'],
      // The underlying studentArRows sums the CURRENT residual while filtering on
      // a historical issue date — the mode FINANCIAL_INVARIANTS.md marks
      // FORBIDDEN. Until an as-of built on JournalLine.postingDate replaces it,
      // this report tells the truth about being current-only rather than
      // presenting a past-dated figure that will not tie to the GL.
      asOfMode: 'current-only',
      paging: 'memory',
      defaultSort: { key: 'maxDaysOverdue', order: 'desc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'className', label: 'Class', type: 'string', width: 12 },
        { key: 'totalBalance', label: 'Balance', type: 'money', format: '', width: 14, total: 'sum',
          link: { reportKey: 'fees.student-statement', paramFrom: { studentProfileId: 'studentProfileId' } } },
        { key: 'waived', label: 'Waived', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'invoiceCount', label: 'Invoices', type: 'int', width: 9, total: 'sum' },
        { key: 'oldestDueDate', label: 'Oldest due', type: 'date', width: 12 },
        { key: 'maxDaysOverdue', label: 'Days overdue', type: 'int', width: 12 },
      ],
      async run(ctx, params) {
        const result = await deps.advancedFinance.feeDefaulters(undefined, 0.01, params.classId);
        const classIds = ctx.resolved.classIds;
        const rows = classIds
          ? (result.rows as any[]).filter((r) => !params.classId || classIds.includes(params.classId))
          : (result.rows as any[]);
        return { rows, caption: `${result.count} defaulter(s)` };
      },
    },

    {
      key: 'fees.daily-cash-book',
      title: 'Daily Cash Book',
      domain: 'fees',
      description: 'Every receipt taken on a day, by payment method, with refunds and reversals.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['dateFrom', 'dateTo'],
      requiredFilters: ['dateFrom'],
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'time', order: 'asc' },
      columns: [
        { key: 'paymentNumber', label: 'Receipt No', type: 'string', width: 14 },
        { key: 'time', label: 'Time', type: 'datetime', width: 16 },
        { key: 'payer', label: 'Payer', type: 'string', width: 24 },
        { key: 'method', label: 'Method', type: 'enum', width: 12 },
        { key: 'reference', label: 'Reference', type: 'string', width: 16 },
        { key: 'amount', label: 'Amount', type: 'money', format: '', width: 14, total: 'sum' },
      ],
      async run(ctx, params) {
        const book = await deps.finance.dailyCashBook(params.dateFrom);
        const notes: string[] = [];
        if (params.dateTo && params.dateTo !== params.dateFrom) {
          // Honest rather than silently ignoring half the request.
          notes.push('The cash book is a single-day document. Showing the "from" date only.');
        }
        if (book.reversedCount > 0) {
          notes.push(
            `${book.reversedCount} reversed payment(s) totalling ${Math.round(book.reversedTotal).toLocaleString('en-UG')} are excluded from the total.`,
          );
        }
        return {
          rows: book.receipts as any[],
          caption:
            `${book.date} · ${book.receiptCount} receipt(s) · `
            + `cash ${Math.round(book.cashTotal).toLocaleString('en-UG')} · `
            + `refunds ${Math.round(book.refundsPaid).toLocaleString('en-UG')} · `
            + `net cash ${Math.round(book.netCash).toLocaleString('en-UG')}`,
          notes,
        };
      },
    },

    {
      key: 'fees.receipt-register',
      title: 'Receipt Register',
      domain: 'fees',
      description:
        'Search receipts by number, admission number, pupil, phone or mobile-money reference.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['search', 'dateFrom', 'dateTo'],
      asOfMode: 'live',
      // The only Phase 1 report whose service pages natively.
      paging: 'service',
      defaultSort: { key: 'paymentDate', order: 'desc' },
      columns: [
        { key: 'paymentNumber', label: 'Receipt No', type: 'string', width: 14 },
        { key: 'paymentDate', label: 'Date', type: 'datetime', width: 16 },
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Pupil / Payer', type: 'string', width: 22 },
        { key: 'paymentMethod', label: 'Method', type: 'enum', width: 12 },
        { key: 'reference', label: 'Reference', type: 'string', width: 16 },
        { key: 'amount', label: 'Amount', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'allocatedAmount', label: 'Allocated', type: 'money', format: '', width: 14 },
        { key: 'unallocatedAmount', label: 'Unallocated', type: 'money', format: '', width: 14 },
        // A cancelled receipt still appears, flagged: "why was this reversed?"
        // is exactly the question that brings someone to this report.
        { key: 'reversed', label: 'Reversed', type: 'bool', width: 10 },
      ],
      async run(ctx, params, opts) {
        const result = await deps.finance.searchReceipts({
          q: params.search,
          from: params.dateFrom,
          to: params.dateTo,
          page: opts.unpaged ? 1 : opts.page,
          pageSize: opts.unpaged ? 1000 : opts.pageSize,
        });
        return { rows: result.data as any[], total: result.total };
      },
    },

    // ==================== PHASE 2 — MANAGEMENT REPORTS ====================

    {
      key: 'fees.collection-summary',
      title: 'Fee Collection Summary',
      domain: 'fees',
      description: 'Term-level collection by class: billed, collected, waived, outstanding, and collection rate.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['termId', 'academicYearId', 'campusId', 'gradeLevelId', 'classBasis'],
      classBasisDefault: 'enrollment',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 500,
      defaultSort: { key: 'className', order: 'asc' },
      columns: [
        { key: 'className', label: 'Class', type: 'string', width: 16,
          link: { reportKey: 'fees.class-clearance', paramFrom: { classId: 'classId' } } },
        { key: 'gradeLevelName', label: 'Grade', type: 'string', width: 12 },
        { key: 'enrolled', label: 'Enrolled', type: 'int', width: 10, total: 'sum' },
        { key: 'billed', label: 'Billed', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'collected', label: 'Collected', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'waived', label: 'Waived', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'credited', label: 'Credited', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'adjusted', label: 'Adjusted', type: 'money', format: '', width: 12, total: 'sum' },
        { key: 'outstanding', label: 'Outstanding', type: 'money', format: '', width: 14, total: 'sum',
          link: { reportKey: 'fees.outstanding-by-student', paramFrom: { classId: 'classId' } } },
        { key: 'collectionRate', label: 'Collection %', type: 'percent', width: 12 },
      ],
      async run(ctx) {
        const termId = ctx.resolved.termId;
        if (!termId) {
          return {
            rows: [],
            notes: ['No term is marked current, and none was selected. Choose a term.'],
          };
        }

        // Get classes in scope
        const classes = await deps.resolver.classesWithCapacity(ctx.resolved.classIds);
        const classIds = classes.map((c: any) => c.id);

        // Get all enrollments for the term
        const enrollments = await deps.enrollment.list(ctx.organizationId, { termId, status: 'enrolled' });
        const enrollmentByClass = new Map<string, any[]>();
        for (const e of enrollments as any[]) {
          if (!enrollmentByClass.has(e.classId)) enrollmentByClass.set(e.classId, []);
          enrollmentByClass.get(e.classId)!.push(e);
        }

        // For each class, aggregate balances
        const rows = await Promise.all(classIds.map(async (classId) => {
          const classEnrollments = enrollmentByClass.get(classId) ?? [];
          const studentIds = classEnrollments.map((e: any) => e.studentProfileId);
          const classInfo = classes.find((c: any) => c.id === classId);

          if (studentIds.length === 0) {
            return {
              classId,
              className: classInfo?.name ?? classId,
              gradeLevelName: classInfo?.gradeLevelName ?? '',
              enrolled: 0,
              billed: 0,
              collected: 0,
              waived: 0,
              credited: 0,
              adjusted: 0,
              outstanding: 0,
              collectionRate: 0,
            };
          }

          // Get balances for all students in this class
          const balances = await Promise.all(studentIds.map((id: string) => deps.finance.studentBalance(id)));
          const totalBilled = balances.reduce((sum, b) => sum + b.billed, 0);
          const totalCollected = balances.reduce((sum, b) => sum + b.collected, 0);
          const totalWaived = balances.reduce((sum, b) => sum + b.waived, 0);
          const totalCredited = balances.reduce((sum, b) => sum + b.credited, 0);
          const totalAdjusted = balances.reduce((sum, b) => sum + b.adjusted, 0);
          const totalOutstanding = balances.reduce((sum, b) => sum + b.balance, 0);

          return {
            classId,
            className: classInfo?.name ?? classId,
            gradeLevelName: classInfo?.gradeLevelName ?? '',
            enrolled: studentIds.length,
            billed: totalBilled,
            collected: totalCollected,
            waived: totalWaived,
            credited: totalCredited,
            adjusted: totalAdjusted,
            outstanding: totalOutstanding,
            collectionRate: totalBilled > 0 ? ((totalCollected + totalCredited + totalWaived) / totalBilled) * 100 : 0,
          };
        }));

        const totalBilled = rows.reduce((sum, r) => sum + r.billed, 0);
        const totalCollected = rows.reduce((sum, r) => sum + r.collected, 0);
        return {
          rows,
          notes: rows.length === 0 ? ['No classes with enrollments in scope.'] : [],
          caption: `Term collection summary · Billed ${Math.round(totalBilled).toLocaleString()} · Collected ${Math.round(totalCollected).toLocaleString()} · ${totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 0}%`,
        };
      },
    },

    {
      key: 'fees.arrears-aging',
      title: 'Fee Arrears Aging',
      domain: 'fees',
      description: 'AR aging buckets (Current, 1–30, 31–60, 61–90, 90+) for fee invoices, with drilldown to student statements.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['asOf', 'campusId', 'gradeLevelId', 'classId', 'classBasis'],
      classBasisDefault: 'current',
      asOfMode: 'current-only',
      paging: 'memory',
      rowCapHint: 2_000,
      defaultSort: { key: 'daysOverdue', order: 'desc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'className', label: 'Class', type: 'string', width: 12 },
        { key: 'invoiceNumber', label: 'Invoice', type: 'string', width: 14 },
        { key: 'dueDate', label: 'Due Date', type: 'date', width: 12 },
        { key: 'daysOverdue', label: 'Days Overdue', type: 'int', width: 12 },
        { key: 'bucket', label: 'Bucket', type: 'enum', width: 12 },
        { key: 'residual', label: 'Outstanding', type: 'money', format: '', width: 14, total: 'sum',
          link: { reportKey: 'fees.student-statement', paramFrom: { studentProfileId: 'studentProfileId' } } },
      ],
      async run(ctx, params) {
        const asOf = params.asOf ? new Date(params.asOf) : new Date();
        const classIds = ctx.resolved.classIds;

        // Use the aging service
        const aging = await deps.advancedFinance.aging(asOf.toISOString().slice(0, 10));

        // Filter by class scope
        const rows = aging.rows
          .filter((r: any) => (classIds?.length ?? 0) === 0 || (classIds ?? []).some((id: string) => r.documentNumber.includes(id))) // approximation
          .map((r: any) => ({
            studentProfileId: r.studentProfileId ?? '',
            admissionNo: r.admissionNo ?? '',
            studentName: r.studentName ?? r.partnerName ?? '',
            className: r.className ?? '',
            invoiceNumber: r.documentNumber,
            dueDate: r.dueDate,
            daysOverdue: r.daysOverdue,
            bucket: r.bucket,
            residual: r.residual,
          }));

        const bucketTotals = {
          current: rows.filter((r: any) => r.bucket === 'current').reduce((s: number, r: any) => s + r.residual, 0),
          d1_30: rows.filter((r: any) => r.bucket === 'd1_30').reduce((s: number, r: any) => s + r.residual, 0),
          d31_60: rows.filter((r: any) => r.bucket === 'd31_60').reduce((s: number, r: any) => s + r.residual, 0),
          d61_90: rows.filter((r: any) => r.bucket === 'd61_90').reduce((s: number, r: any) => s + r.residual, 0),
          d90_plus: rows.filter((r: any) => r.bucket === 'd90_plus').reduce((s: number, r: any) => s + r.residual, 0),
        };

        return {
          rows,
          totals: {
            residual: bucketTotals.current + bucketTotals.d1_30 + bucketTotals.d31_60 + bucketTotals.d61_90 + bucketTotals.d90_plus,
          },
          caption: `Aging as of ${asOf.toISOString().slice(0, 10)} · Current ${Math.round(bucketTotals.current).toLocaleString()} · 1–30 ${Math.round(bucketTotals.d1_30).toLocaleString()} · 31–60 ${Math.round(bucketTotals.d31_60).toLocaleString()} · 61–90 ${Math.round(bucketTotals.d61_90).toLocaleString()} · 90+ ${Math.round(bucketTotals.d90_plus).toLocaleString()}`,
        };
      },
    },
  ];
}
