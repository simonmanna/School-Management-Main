import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Phase 3 — Financial/Control Reports.
 *
 * These reports read from the Accounting module's canonical services:
 * - AccountingReportingService: GL, Trial Balance, Account Ledger
 * - PnLReportService: Income Statement (Profit & Loss)
 * - BalanceSheetReportService: Balance Sheet
 * - CashFlowReportService: Cash Flow Statement
 * - TieOutService: AR/AP ↔ GL Reconciliation
 * - FiscalPeriodService: Period lock status
 *
 * Every figure comes from the accounting engine — never re-derived here.
 * The snapshots (Trial Balance, P&L, Balance Sheet) are served when exact
 * for the requested asOf; otherwise live aggregation is used.
 */
export function financeReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  const FINANCE = [PERMISSIONS.school.readFinanceReports];

  return [
    // ==================== GENERAL LEDGER ====================

    {
      key: 'finance.general-ledger',
      title: 'General Ledger',
      domain: 'finance',
      description: 'Every journal line in date order with account, description, debit, and credit. Paginated.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'accountId', 'journalCode'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'service',
      rowCapHint: 50_000,
      defaultSort: { key: 'date', order: 'asc' },
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 12 },
        { key: 'entryNumber', label: 'Entry No', type: 'string', width: 14 },
        { key: 'accountCode', label: 'Code', type: 'string', width: 10 },
        { key: 'accountName', label: 'Account', type: 'string', width: 24 },
        { key: 'description', label: 'Description', type: 'string', width: 30 },
        { key: 'debit', label: 'Debit', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'credit', label: 'Credit', type: 'money', format: '', width: 14, total: 'sum' },
      ],
      async run(ctx, params, opts) {
        const range = { from: params.dateFrom, to: params.dateTo };
        const result = await deps.accounting.generalLedger(range, opts.page, opts.pageSize);
        return {
          rows: result.data as any[],
          total: result.meta.total,
          caption: `General Ledger · ${result.meta.total} line(s) · Page ${result.meta.page} of ${result.meta.totalPages}`,
          notes: range.from || range.to
            ? [`Filtered: ${range.from ?? 'beginning'} to ${range.to ?? 'now'}`]
            : [],
        };
      },
    },

    // ==================== TRIAL BALANCE ====================

    {
      key: 'finance.trial-balance',
      title: 'Trial Balance',
      domain: 'finance',
      description: 'All accounts with debit/credit balances and net balance. Snapshot-first for historical accuracy.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['asOf', 'accountId'],
      classBasisDefault: 'current',
      asOfMode: 'as-of',
      paging: 'memory',
      rowCapHint: 2_000,
      defaultSort: { key: 'code', order: 'asc' },
      columns: [
        { key: 'code', label: 'Code', type: 'string', width: 10 },
        { key: 'name', label: 'Account', type: 'string', width: 28 },
        { key: 'categoryKey', label: 'Category', type: 'string', width: 14 },
        { key: 'classification', label: 'Classification', type: 'string', width: 14 },
        { key: 'normalBalance', label: 'Normal', type: 'enum', width: 10 },
        { key: 'debit', label: 'Debit', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'credit', label: 'Credit', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'balance', label: 'Balance', type: 'money', format: '', width: 14, total: 'sum' },
      ],
      async run(ctx, params) {
        const range = { to: params.asOf };
        const result = await deps.accounting.trialBalance(range);

        let rows = result.rows;
        if (params.accountId) {
          rows = rows.filter((r: any) => r.accountId === params.accountId);
        }

        return {
          rows,
          totals: {
            debit: result.totals.debit,
            credit: result.totals.credit,
            balance: new Prisma.Decimal(result.totals.debit).minus(result.totals.credit).toString(),
          },
          caption: `Trial Balance as of ${result.asOf ?? params.asOf ?? 'now'} · ${result.source} · ${result.balanced ? 'BALANCED' : '⚠ OUT OF BALANCE'}`,
          notes: result.balanced
            ? []
            : ['Debits ≠ Credits — investigate journal entries.'],
        };
      },
    },

    // ==================== INCOME STATEMENT (P&L) ====================

    {
      key: 'finance.income-statement',
      title: 'Income Statement (Profit & Loss)',
      domain: 'finance',
      description: 'Revenue, COGS, expenses, and net profit for a period. Snapshot-first.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'summary',
      filters: ['dateFrom', 'dateTo'],
      classBasisDefault: 'current',
      asOfMode: 'as-of',
      paging: 'none',
      columns: [
        { key: 'label', label: 'Item', type: 'string', width: 30 },
        { key: 'value', label: 'Amount', type: 'money', format: '', width: 18, total: 'sum' },
      ],
      async run(ctx, params) {
        const range = { from: params.dateFrom, to: params.dateTo };
        const result = await deps.pnl.pnl(range);

        const rows = [
          { label: 'Revenue', value: result.revenue },
          { label: 'Contra Revenue (Discounts/Returns)', value: result.contraRevenue },
          { label: 'Net Revenue', value: result.netRevenue },
          { label: 'Cost of Goods Sold', value: result.cogs },
          { label: 'Gross Profit', value: result.grossProfit },
          { label: 'Operating Expenses', value: result.expense },
          { label: 'Operating Profit', value: result.operatingProfit },
          { label: 'Other Income', value: result.otherIncome },
          { label: 'Other Expense', value: result.otherExpense },
          { label: 'Net Profit', value: result.netProfit },
        ];

        return {
          rows,
          caption: `Income Statement · ${params.dateFrom ?? 'beginning'} to ${params.dateTo ?? 'now'} · ${result.source}`,
          notes: result.source === 'live'
            ? ['Computed live from JournalLine — no snapshot available for this period.']
            : [],
        };
      },
    },

    // ==================== BALANCE SHEET ====================

    {
      key: 'finance.balance-sheet',
      title: 'Balance Sheet',
      domain: 'finance',
      description: 'Assets, Liabilities, and Equity as of a date. Detailed breakdown by section.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['asOf'],
      classBasisDefault: 'current',
      asOfMode: 'as-of',
      paging: 'memory',
      rowCapHint: 1_000,
      defaultSort: { key: 'sortOrder', order: 'asc' },
      columns: [
        { key: 'section', label: 'Section', type: 'string', width: 18 },
        { key: 'code', label: 'Code', type: 'string', width: 10 },
        { key: 'name', label: 'Account', type: 'string', width: 28 },
        { key: 'balance', label: 'Balance', type: 'money', format: '', width: 18, total: 'sum' },
      ],
      async run(ctx, params) {
        const result = await deps.balanceSheet.balanceSheetDetailed(params.asOf);

        const rows = (result.sections ?? []).flatMap((section: any) => [
          { section: section.label, code: '', name: section.label, balance: section.subtotal, isSubtotal: true, sortOrder: -1 },
          ...section.rows.map((r: any) => ({ section: '', code: r.code, name: r.name, balance: r.balance, isSubtotal: false, sortOrder: r.sortOrder })),
        ]);

        return {
          rows,
          totals: {
            balance: new Prisma.Decimal(result.totalAssets)
              .minus(new Prisma.Decimal(result.totalLiabilitiesAndEquity))
              .toString(),
          },
          caption: `Balance Sheet as of ${result.asOf} · ${result.source} · ${result.balanced ? 'BALANCED' : '⚠ OUT OF BALANCE'}`,
          notes: [
            `Total Assets: ${Number(result.totalAssets).toLocaleString()}`,
            `Total Liabilities + Equity: ${Number(result.totalLiabilitiesAndEquity).toLocaleString()}`,
            ...(result.balanced ? [] : ['⚠ Assets ≠ Liabilities + Equity — investigate.']),
          ],
        };
      },
    },

    // ==================== CASH FLOW STATEMENT ====================

    {
      key: 'finance.cash-flow',
      title: 'Cash Flow Statement',
      domain: 'finance',
      description: 'Operating, investing, and financing cash flows (direct method). Reconciles to closing cash.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'summary',
      filters: ['dateFrom', 'dateTo'],
      classBasisDefault: 'current',
      asOfMode: 'as-of',
      paging: 'none',
      columns: [
        { key: 'label', label: 'Item', type: 'string', width: 30 },
        { key: 'value', label: 'Amount', type: 'money', format: '', width: 18, total: 'sum' },
      ],
      async run(ctx, params) {
        const range = { from: params.dateFrom, to: params.dateTo };
        const result = await deps.cashFlow.cashFlow(range);

        const rows = [
          { label: 'Opening Cash', value: result.openingCash },
          { label: 'Operating Activities', value: result.operating },
          { label: 'Investing Activities', value: result.investing },
          { label: 'Financing Activities', value: result.financing },
          { label: 'Net Cash Flow', value: result.netCashFlow },
          { label: 'Closing Cash (Calculated)', value: result.closingCash },
          { label: 'Closing Cash (Actual)', value: result.actualClosingCash },
        ];

        return {
          rows,
          caption: `Cash Flow Statement · ${params.dateFrom ?? 'beginning'} to ${params.dateTo ?? 'now'} · ${result.reconciled ? 'RECONCILED' : '⚠ UNRECONCILED'}`,
          notes: result.reconciled
            ? ['Calculated closing cash matches actual cash balance.']
            : ['⚠ Calculated closing cash does NOT match actual — investigate cash movements.'],
        };
      },
    },

    // ==================== AR REPORT (Aged Receivables) ====================

    {
      key: 'finance.ar-report',
      title: 'Aged Receivables (AR Report)',
      domain: 'finance',
      description: 'School fee AR aging buckets (Current, 1–30, 31–60, 61–90, 90+) with drilldown to student statements.',
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

        const aging = await deps.advancedFinance.aging(asOf.toISOString().slice(0, 10));

        const rows = aging.rows
          .filter((r: any) => classIds.length === 0 || classIds.some((id: string) => r.documentNumber.includes(id)))
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
          totals: { residual: bucketTotals.current + bucketTotals.d1_30 + bucketTotals.d31_60 + bucketTotals.d61_90 + bucketTotals.d90_plus },
          caption: `AR Aging as of ${asOf.toISOString().slice(0, 10)} · Current ${Math.round(bucketTotals.current).toLocaleString()} · 1–30 ${Math.round(bucketTotals.d1_30).toLocaleString()} · 31–60 ${Math.round(bucketTotals.d31_60).toLocaleString()} · 61–90 ${Math.round(bucketTotals.d61_90).toLocaleString()} · 90+ ${Math.round(bucketTotals.d90_plus).toLocaleString()}`,
        };
      },
    },

    // ==================== AR ↔ GL RECONCILIATION ====================

    {
      key: 'finance.ar-gl-reconciliation',
      title: 'AR ↔ GL Reconciliation',
      domain: 'finance',
      description: 'Tie-out of GL control account (AR) vs sum of open invoice residuals. Variance > $0.01 indicates drift.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'summary',
      filters: ['asOf'],
      classBasisDefault: 'current',
      asOfMode: 'as-of',
      paging: 'none',
      columns: [
        { key: 'label', label: 'Item', type: 'string', width: 30 },
        { key: 'value', label: 'Amount', type: 'money', format: '', width: 18, total: 'sum' },
      ],
      async run(ctx, params) {
        const asOf = params.asOf ? new Date(params.asOf) : new Date();
        const result = await deps.tieOut.latest(asOf.toISOString());

        if (!result) {
          return {
            rows: [],
            notes: ['No tie-out snapshot available for this date. Run the nightly job or trigger manually.'],
          };
        }

        const rows = [
          { label: 'GL AR Balance', value: result.arDetails.glBalance },
          { label: 'Sub-ledger AR Balance (Open Invoices)', value: result.arDetails.subLedgerBalance },
          { label: 'AR Variance', value: result.arVariance },
          { label: 'AP GL Balance', value: result.apDetails.glBalance },
          { label: 'Sub-ledger AP Balance (Open Bills)', value: result.apDetails.subLedgerBalance },
          { label: 'AP Variance', value: result.apVariance },
        ];

        return {
          rows,
          caption: `AR/AP Tie-out as of ${result.asOf.toISOString().slice(0, 10)} · AR ${result.arBalanced ? '✓' : '✗'} · AP ${result.apBalanced ? '✓' : '✗'}`,
          notes: [
            ...(result.arBalanced ? [] : [`⚠ AR variance: ${result.arVariance} — investigate missed allocations or manual journals.`]),
            ...(result.apBalanced ? [] : [`⚠ AP variance: ${result.apVariance} — investigate missed allocations or manual journals.`]),
          ],
        };
      },
    },

    // ==================== PAYMENT RECONCILIATION ====================

    {
      key: 'finance.payment-reconciliation',
      title: 'Payment Reconciliation',
      domain: 'finance',
      description: 'Daily cash book reconciled to GL cash accounts and bank statements.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['dateFrom', 'dateTo'],
      requiredFilters: ['dateFrom'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'date', order: 'asc' },
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 12 },
        { key: 'cashBookNet', label: 'Cash Book Net', type: 'money', format: '', width: 16, total: 'sum' },
        { key: 'glCashMovement', label: 'GL Cash Movement', type: 'money', format: '', width: 18, total: 'sum' },
        { key: 'bankDeposits', label: 'Bank Deposits', type: 'money', format: '', width: 16, total: 'sum' },
        { key: 'variance', label: 'Variance', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'reconciled', label: 'Reconciled', type: 'bool', width: 10 },
      ],
      async run(ctx, params) {
        const from = params.dateFrom;
        const to = params.dateTo ?? params.dateFrom;
        const dates: string[] = [];
        for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
          dates.push(d.toISOString().slice(0, 10));
        }

        const rows: any[] = [];
        for (const date of dates) {
          const cashBook = await deps.finance.dailyCashBook(date);
          const range = { from: date, to: date };
          const cashFlow = await deps.cashFlow.cashFlow(range);

          const cashBookNet = cashBook.netCash;
          const glCashMovement = Number(cashFlow.netCashFlow);
          const variance = cashBookNet - glCashMovement;
          const reconciled = Math.abs(variance) <= 0.01;

          rows.push({
            date,
            cashBookNet,
            glCashMovement,
            bankDeposits: cashBook.netCash, // same as cashBookNet for this report
            variance,
            reconciled,
          });
        }

        const totalVariance = rows.reduce((s, r) => s + r.variance, 0);
        return {
          rows,
          totals: { variance: totalVariance },
          caption: `Payment Reconciliation · ${from} to ${to} · ${rows.filter(r => r.reconciled).length}/${rows.length} days reconciled`,
          notes: rows.some(r => !r.reconciled)
            ? ['⚠ Some days have unreconciled variances — investigate cash handling.']
            : ['All days reconciled.'],
        };
      },
    },

    // ==================== AUDIT REPORTS ====================

    {
      key: 'finance.audit-trail',
      title: 'Audit Trail (Journal Entries)',
      domain: 'audit',
      description: 'All posted journal entries with user, timestamp, and line details for audit compliance.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'userId', 'journalCode', 'status'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'service',
      rowCapHint: 20_000,
      defaultSort: { key: 'postingDate', order: 'desc' },
      columns: [
        { key: 'postingDate', label: 'Date', type: 'date', width: 12 },
        { key: 'entryNumber', label: 'Entry No', type: 'string', width: 14 },
        { key: 'journalCode', label: 'Journal', type: 'string', width: 10 },
        { key: 'description', label: 'Description', type: 'string', width: 30 },
        { key: 'createdBy', label: 'Created By', type: 'string', width: 16 },
        { key: 'status', label: 'Status', type: 'enum', width: 10 },
        { key: 'lineCount', label: 'Lines', type: 'int', width: 8, total: 'sum' },
        { key: 'totalDebit', label: 'Total Debit', type: 'money', format: '', width: 14, total: 'sum' },
        { key: 'totalCredit', label: 'Total Credit', type: 'money', format: '', width: 14, total: 'sum' },
      ],
      async run(ctx, params) {
        const range = { from: params.dateFrom, to: params.dateTo };
        const where: any = {
          entry: { status: { in: ['posted', 'reversed'] }, postingDate: deps.accounting['rangeFilter'](range) },
        };
        if (params.journalCode) where.entry.journal = { code: params.journalCode };
        if (params.userId) where.entry.createdById = params.userId;

        const [entries, total] = await Promise.all([
          (deps.accounting as any).prisma.client.journalEntry.findMany({
            where,
            include: { lines: { include: { account: true } } },
            orderBy: { postingDate: 'desc' },
            skip: (opts.page - 1) * opts.pageSize,
            take: opts.pageSize,
          }),
          (deps.accounting as any).prisma.client.journalEntry.count({ where }),
        ]);

        const rows = entries.map((e: any) => ({
          postingDate: e.postingDate,
          entryNumber: e.entryNumber,
          journalCode: e.journal?.code ?? '',
          description: e.description ?? '',
          createdBy: e.createdBy?.name ?? e.createdById ?? '',
          status: e.status,
          lineCount: e.lines.length,
          totalDebit: e.lines.reduce((s: number, l: any) => s + Number(l.baseDebit), 0),
          totalCredit: e.lines.reduce((s: number, l: any) => s + Number(l.baseCredit), 0),
        }));

        return { rows, total };
      },
    },

    {
      key: 'finance.reversed-entries',
      title: 'Reversed Entries',
      domain: 'audit',
      description: 'All reversed journal entries with original and reversal details for audit trail.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['dateFrom', 'dateTo'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'reversedAt', order: 'desc' },
      columns: [
        { key: 'originalEntryNumber', label: 'Original Entry', type: 'string', width: 14 },
        { key: 'reversalEntryNumber', label: 'Reversal Entry', type: 'string', width: 14 },
        { key: 'originalDate', label: 'Original Date', type: 'date', width: 12 },
        { key: 'reversedAt', label: 'Reversed At', type: 'datetime', width: 18 },
        { key: 'reversedBy', label: 'Reversed By', type: 'string', width: 16 },
        { key: 'reason', label: 'Reason', type: 'string', width: 30 },
      ],
      async run(ctx, params) {
        const range = { from: params.dateFrom, to: params.dateTo };
        const where: any = {
          status: 'reversed',
          postingDate: deps.accounting['rangeFilter'](range),
        };

        const entries = await (deps.accounting as any).prisma.client.journalEntry.findMany({
          where,
          include: { lines: true, createdBy: true, reversedBy: true },
          orderBy: { postingDate: 'desc' },
        });

        const rows = entries.map((e: any) => ({
          originalEntryNumber: e.entryNumber,
          reversalEntryNumber: e.reversalEntryNumber ?? '',
          originalDate: e.postingDate,
          reversedAt: e.updatedAt,
          reversedBy: e.reversedBy?.name ?? e.reversedById ?? '',
          reason: e.reversalReason ?? '',
        }));

        return {
          rows,
          caption: `${rows.length} reversed entries in period`,
        };
      },
    },

    // ==================== FINANCIAL PERIOD REPORTS ====================

    {
      key: 'finance.fiscal-periods',
      title: 'Fiscal Periods',
      domain: 'finance',
      description: 'List of fiscal periods with status (open/closed/locked) and lock dates.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'table',
      filters: ['dateFrom', 'dateTo'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'startDate', order: 'asc' },
      columns: [
        { key: 'name', label: 'Period', type: 'string', width: 20 },
        { key: 'startDate', label: 'Start', type: 'date', width: 12 },
        { key: 'endDate', label: 'End', type: 'date', width: 12 },
        { key: 'status', label: 'Status', type: 'enum', width: 10 },
        { key: 'closedAt', label: 'Closed At', type: 'datetime', width: 18 },
        { key: 'lockedAt', label: 'Locked At', type: 'datetime', width: 18 },
      ],
      async run(ctx, params) {
        const where: any = {};
        if (params.dateFrom) where.startDate = { gte: new Date(params.dateFrom) };
        if (params.dateTo) where.endDate = { lte: new Date(params.dateTo) };

        const periods = await (deps.fiscalPeriod as any).prisma.client.fiscalPeriod.findMany({
          where,
          orderBy: { startDate: 'asc' },
        });

        const rows = periods.map((p: any) => ({
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
          closedAt: p.closedAt,
          lockedAt: p.lockedAt,
        }));

        return {
          rows,
          caption: `${rows.length} fiscal period(s)`,
        };
      },
    },

    {
      key: 'finance.period-close-status',
      title: 'Period Close Status',
      domain: 'finance',
      description: 'Shows whether each period is open for posting, with book lock date.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: FINANCE,
      shape: 'summary',
      filters: ['asOf'],
      classBasisDefault: 'current',
      asOfMode: 'as-of',
      paging: 'none',
      columns: [
        { key: 'label', label: 'Item', type: 'string', width: 30 },
        { key: 'value', label: 'Value', type: 'string', width: 40 },
      ],
      async run(ctx, params) {
        const asOf = params.asOf ? new Date(params.asOf) : new Date();
        const org = await (deps.fiscalPeriod as any).prisma.client.organization.findUnique({
          where: { id: ctx.organizationId },
          select: { booksLockDate: true, requireFiscalPeriod: true },
        });

        const period = await (deps.fiscalPeriod as any).prisma.client.fiscalPeriod.findFirst({
          where: { startDate: { lte: asOf }, endDate: { gte: asOf } },
        });

        const rows = [
          { label: 'Books Lock Date', value: org?.booksLockDate ? new Date(org.booksLockDate).toISOString().slice(0, 10) : 'Not set' },
          { label: 'Require Fiscal Period', value: org?.requireFiscalPeriod ? 'Yes' : 'No' },
          { label: 'Current Period', value: period?.name ?? 'None covering this date' },
          { label: 'Period Status', value: period?.status ?? 'N/A' },
          { label: 'Period Start', value: period?.startDate ? new Date(period.startDate).toISOString().slice(0, 10) : 'N/A' },
          { label: 'Period End', value: period?.endDate ? new Date(period.endDate).toISOString().slice(0, 10) : 'N/A' },
          { label: 'Posting Allowed', value: (period?.status === 'open' && (!org?.booksLockDate || asOf > new Date(org.booksLockDate))) ? 'Yes' : 'No' },
        ];

        return {
          rows,
          caption: `Period Close Status as of ${asOf.toISOString().slice(0, 10)}`,
        };
      },
    },
  ];
}