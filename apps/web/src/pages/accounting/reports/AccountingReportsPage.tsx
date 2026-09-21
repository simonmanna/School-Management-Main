/**
 * Accounting Reports — the report hub under Accounting.
 *
 * One catalog, one period control, one export/print bar, and a report surface
 * that swaps out the statement being viewed. The selected report and the period
 * live in the URL, so a report is a link a finance officer can send to someone
 * else and get the same page back.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Building2,
  Calculator,
  CircleDollarSign,
  Coins,
  FileSpreadsheet,
  Landmark,
  Percent,
  PiggyBank,
  Printer,
  Receipt,
  Scale,
  ScrollText,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Download,
  FileText,
} from 'lucide-react';
import { exportCSV } from '@/lib/export-csv';
import { exportPDF } from '@/lib/export-pdf';
import { useAuthStore } from '@/stores/auth.store';
import {
  ExportProvider,
  todayIso,
  useExportPayload,
} from './report-kit';
import {
  BalanceSheetReport,
  CashFlowStatementReport,
  EquityStatementReport,
  FinancialRatiosReport,
  IncomeStatementReport,
  type ReportProps,
} from './statements';
import {
  AccountBalancesReport,
  DetailedGeneralLedgerReport,
  ExtendedTrialBalanceReport,
  JournalDayBookReport,
} from './ledgers';
import {
  CashBookReport,
  CustomerLedgerReport,
  ExpenseAnalysisReport,
  RevenueAnalysisReport,
  SupplierLedgerReport,
  TaxSummaryReport,
} from './subledgers';
import './accounting-reports.css';

interface ReportDef {
  key: string;
  label: string;
  group: string;
  icon: typeof BarChart3;
  description: string;
  component: React.FC<ReportProps>;
}

/**
 * The catalog. Grouped the way an accountant thinks about the month: the
 * statements you publish, the ledgers you reconcile, the sub-ledgers you chase,
 * and the analysis you take to management.
 */
const REPORTS: ReportDef[] = [
  {
    key: 'income-statement',
    label: 'Income Statement',
    group: 'Financial Statements',
    icon: TrendingUp,
    description: 'Profit or loss by account, with a comparative period',
    component: IncomeStatementReport,
  },
  {
    key: 'balance-sheet',
    label: 'Balance Sheet',
    group: 'Financial Statements',
    icon: Landmark,
    description: 'Financial position as at a date, with a comparative column',
    component: BalanceSheetReport,
  },
  {
    key: 'cash-flow',
    label: 'Cash Flow Statement',
    group: 'Financial Statements',
    icon: Wallet,
    description: 'Operating, investing and financing cash movements',
    component: CashFlowStatementReport,
  },
  {
    key: 'equity-statement',
    label: 'Changes in Equity',
    group: 'Financial Statements',
    icon: PiggyBank,
    description: 'Opening equity, movements and the period result',
    component: EquityStatementReport,
  },
  {
    key: 'extended-trial-balance',
    label: 'Extended Trial Balance',
    group: 'Ledgers & Balances',
    icon: Scale,
    description: 'Opening, movement and closing balance per account',
    component: ExtendedTrialBalanceReport,
  },
  {
    key: 'general-ledger',
    label: 'General Ledger (Detailed)',
    group: 'Ledgers & Balances',
    icon: BookOpen,
    description: 'Every posted line by account, with a running balance',
    component: DetailedGeneralLedgerReport,
  },
  {
    key: 'journal-report',
    label: 'Journal Report',
    group: 'Ledgers & Balances',
    icon: ScrollText,
    description: 'Day book of every journal entry and its lines',
    component: JournalDayBookReport,
  },
  {
    key: 'account-balances',
    label: 'Account Balances',
    group: 'Ledgers & Balances',
    icon: FileSpreadsheet,
    description: 'Chart of accounts with as-at balances',
    component: AccountBalancesReport,
  },
  {
    key: 'customer-ledger',
    label: 'Customer Ledger',
    group: 'Sub-ledgers',
    icon: Users,
    description: 'Receivables movement and outstanding balance per customer',
    component: CustomerLedgerReport,
  },
  {
    key: 'supplier-ledger',
    label: 'Supplier Ledger',
    group: 'Sub-ledgers',
    icon: Truck,
    description: 'Payables movement and outstanding balance per supplier',
    component: SupplierLedgerReport,
  },
  {
    key: 'cash-book',
    label: 'Cash & Bank Book',
    group: 'Sub-ledgers',
    icon: Coins,
    description: 'Receipts, payments and balances per cash account',
    component: CashBookReport,
  },
  {
    key: 'tax-summary',
    label: 'Tax Summary',
    group: 'Sub-ledgers',
    icon: Percent,
    description: 'Output tax against input tax, by tax code',
    component: TaxSummaryReport,
  },
  {
    key: 'revenue-analysis',
    label: 'Revenue Analysis',
    group: 'Analysis',
    icon: CircleDollarSign,
    description: 'Income by account and category, against the prior period',
    component: RevenueAnalysisReport,
  },
  {
    key: 'expense-analysis',
    label: 'Expense Analysis',
    group: 'Analysis',
    icon: Receipt,
    description: 'Costs by account and category, against the prior period',
    component: ExpenseAnalysisReport,
  },
  {
    key: 'financial-ratios',
    label: 'Financial Ratios',
    group: 'Analysis',
    icon: Calculator,
    description: 'Liquidity, profitability, leverage and efficiency',
    component: FinancialRatiosReport,
  },
];

const GROUPS = [...new Set(REPORTS.map((r) => r.group))];

// ───────────────────────────── period presets ──────────────────────────────

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const PRESETS: Array<{ label: string; get: () => { from: string; to: string } }> = [
  {
    label: 'This Month',
    get: () => {
      const n = new Date();
      return { from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: todayIso() };
    },
  },
  {
    label: 'Last Month',
    get: () => {
      const n = new Date();
      return {
        from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        to: iso(new Date(n.getFullYear(), n.getMonth(), 0)),
      };
    },
  },
  {
    label: 'This Quarter',
    get: () => {
      const n = new Date();
      return {
        from: iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)),
        to: todayIso(),
      };
    },
  },
  {
    label: 'Year to Date',
    get: () => {
      const n = new Date();
      return { from: iso(new Date(n.getFullYear(), 0, 1)), to: todayIso() };
    },
  },
  {
    label: 'Last Year',
    get: () => {
      const y = new Date().getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

// ───────────────────────────── toolbar ─────────────────────────────────────

const Toolbar: React.FC<{
  from: string;
  to: string;
  setPeriod: (from: string, to: string) => void;
  reportLabel: string;
}> = ({ from, to, setPeriod, reportLabel }) => {
  const payload = useExportPayload();
  const org = useAuthStore((s) => s.organization);

  const download = (kind: 'csv' | 'pdf') => {
    if (!payload) return;
    const title = `${org?.name ?? ''} — ${payload.title}`.trim();
    if (kind === 'csv') {
      exportCSV(`${payload.filename}.csv`, payload.headers, payload.rows);
    } else {
      exportPDF(
        `${payload.filename}.pdf`,
        payload.subtitle ? `${title} (${payload.subtitle})` : title,
        payload.headers,
        payload.rows,
      );
    }
  };

  return (
    <div className="acct-toolbar no-print">
      <div className="acct-toolbar-group">
        <div className="acct-field">
          <label htmlFor="report-from">From</label>
          <input
            id="report-from"
            className="acct-input"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setPeriod(e.target.value, to)}
          />
        </div>
        <div className="acct-field">
          <label htmlFor="report-to">To</label>
          <input
            id="report-to"
            className="acct-input"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setPeriod(from, e.target.value)}
          />
        </div>
        <div className="acct-field">
          <label>Quick period</label>
          <div className="acct-presets">
            {PRESETS.map((p) => {
              const range = p.get();
              const active = range.from === from && range.to === to;
              return (
                <button
                  key={p.label}
                  type="button"
                  className={`acct-preset${active ? ' active' : ''}`}
                  onClick={() => setPeriod(range.from, range.to)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="acct-toolbar-group">
        <button
          type="button"
          className="acct-preset"
          disabled={!payload}
          title={payload ? `Export ${reportLabel} as CSV` : 'Report still loading'}
          onClick={() => download('csv')}
        >
          <Download size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          CSV
        </button>
        <button
          type="button"
          className="acct-preset"
          disabled={!payload}
          title={payload ? `Export ${reportLabel} as PDF` : 'Report still loading'}
          onClick={() => download('pdf')}
        >
          <FileText size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          PDF
        </button>
        <button type="button" className="acct-preset" onClick={() => window.print()}>
          <Printer size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          Print
        </button>
      </div>
    </div>
  );
};

// ───────────────────────────── page ────────────────────────────────────────

export function AccountingReportsPage() {
  const [params, setParams] = useSearchParams();

  const active = REPORTS.find((r) => r.key === params.get('report')) ?? REPORTS[0];
  const defaults = useMemo(() => PRESETS[3].get(), []); // Year to date
  const from = params.get('from') ?? defaults.from;
  const to = params.get('to') ?? defaults.to;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };

  const Report = active.component;

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-2xl font-semibold">Accounting Reports</h1>
        <p className="text-sm text-muted-foreground">
          Statements, ledgers and analysis drawn straight from posted journal entries. Every report
          exports to CSV or PDF and prints on its own letterhead.
        </p>
      </div>

      <div className="acct-reports">
        <nav className="acct-catalog no-print" aria-label="Accounting reports">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="acct-catalog-group">{group}</div>
              {REPORTS.filter((r) => r.group === group).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={`acct-catalog-item${r.key === active.key ? ' active' : ''}`}
                  title={r.description}
                  onClick={() => update({ report: r.key })}
                >
                  <r.icon />
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="acct-catalog-group">Reference</div>
          <a className="acct-catalog-item" href="/tieout">
            <Building2 />
            <span>Tie-Out &amp; Controls</span>
          </a>
          <a className="acct-catalog-item" href="/ar-aging">
            <BarChart3 />
            <span>Aged Receivables</span>
          </a>
        </nav>

        <div>
          <ExportProvider>
            <Toolbar
              from={from}
              to={to}
              reportLabel={active.label}
              setPeriod={(f, t) => update({ from: f, to: t })}
            />
            <Report key={active.key} from={from} to={to} />
          </ExportProvider>
        </div>
      </div>
    </div>
  );
}

export default AccountingReportsPage;
