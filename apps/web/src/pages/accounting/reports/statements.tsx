/**
 * The primary financial statements: Income Statement, Balance Sheet,
 * Statement of Changes in Equity and the ratio pack.
 *
 * All four read amounts as decimal strings and never re-derive a total in the
 * browser — every subtotal, variance and ratio on screen is the one the ledger
 * produced, so an exported statement can be tied straight back to the API.
 */
import React from 'react';
import { useCashFlow } from '@/features/accounting/api';
import {
  useComparativeBalanceSheet,
  useEquityStatement,
  useFinancialRatios,
  useIncomeStatement,
  type FinancialRatios,
  type StatementSection,
} from '@/features/accounting/reports-api';
import {
  EmptyState,
  LoadingRows,
  ReportHeader,
  ReportTable,
  StatRow,
  StatTile,
  Variance,
  asOfLabel,
  fmtPercent,
  periodLabel,
  useAccountingMoney,
  useRegisterExport,
} from './report-kit';

export interface ReportProps {
  from: string;
  to: string;
}

// ───────────────────────────── income statement ────────────────────────────

export const IncomeStatementReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useIncomeStatement({ from, to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    const rows: string[][] = [];
    for (const s of data.sections) {
      rows.push([s.label, '', '', '', '']);
      for (const r of s.rows) {
        rows.push([`  ${r.code} ${r.name}`, r.amount, r.priorAmount, r.variance, r.percentOfRevenue ?? '']);
      }
      rows.push([`  Total ${s.label}`, s.subtotal, s.priorSubtotal, s.variance, s.percentOfRevenue ?? '']);
    }
    for (const t of data.subtotals) {
      rows.push([t.label, t.amount, t.priorAmount, t.variance, t.percentOfRevenue]);
    }
    return {
      filename: `income-statement_${from}_${to}`,
      title: 'Income Statement',
      subtitle: periodLabel(from, to),
      headers: ['Line', 'Amount', 'Prior period', 'Variance', '% of revenue'],
      rows,
    };
  }, [data, from, to]);

  const subtotal = (key: string) => data?.subtotals.find((s) => s.key === key);

  return (
    <div className="acct-report">
      <ReportHeader
        title="Income Statement"
        subtitle="Statement of profit or loss, by account"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {error ? (
        <EmptyState message="Could not load the income statement." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Net Revenue" value={m(subtotal('net_revenue')?.amount)} />
            <StatTile
              label="Gross Profit"
              value={m(subtotal('gross_profit')?.amount)}
              hint={`Margin ${fmtPercent(data?.margins.grossMargin)}`}
            />
            <StatTile
              label="Operating Profit"
              value={m(subtotal('operating_profit')?.amount)}
              hint={`Margin ${fmtPercent(data?.margins.operatingMargin)}`}
            />
            <StatTile
              label="Net Profit"
              value={m(subtotal('net_profit')?.amount)}
              hint={`Margin ${fmtPercent(data?.margins.netMargin)}`}
              tone={Number(subtotal('net_profit')?.amount ?? 0) < 0 ? 'negative' : 'positive'}
            />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Account</th>
                <th className="acct-num">Current period</th>
                <th className="acct-num">Prior period</th>
                <th className="acct-num">Variance</th>
                <th className="acct-num">% of revenue</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={5} />
              ) : !data || data.sections.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      message="No revenue or expense postings in this period."
                      hint="Widen the date range, or post an entry to a revenue or expense account."
                    />
                  </td>
                </tr>
              ) : (
                <>
                  {data.sections.map((section) => (
                    <React.Fragment key={section.key}>
                      <tr className="acct-row-section">
                        <td colSpan={5}>{section.label}</td>
                      </tr>
                      {section.rows.map((r) => (
                        <tr key={r.accountId ?? r.name}>
                          <td className="acct-indent">
                            <span className="acct-code">{r.code}</span> {r.name}
                          </td>
                          <td className="acct-num">{m(r.amount)}</td>
                          <td className="acct-num acct-muted">{m(r.priorAmount)}</td>
                          <td className="acct-num">
                            <Variance value={r.variance} percent={r.variancePercent} />
                          </td>
                          <td className="acct-num acct-muted">{fmtPercent(r.percentOfRevenue)}</td>
                        </tr>
                      ))}
                      <tr className="acct-row-subtotal">
                        <td>Total {section.label}</td>
                        <td className="acct-num">{m(section.subtotal)}</td>
                        <td className="acct-num">{m(section.priorSubtotal)}</td>
                        <td className="acct-num">
                          <Variance value={section.variance} percent={section.variancePercent} />
                        </td>
                        <td className="acct-num">{fmtPercent(section.percentOfRevenue)}</td>
                      </tr>
                    </React.Fragment>
                  ))}
                  {data.subtotals.map((t) => (
                    <tr key={t.key} className={t.key === 'net_profit' ? 'acct-row-total' : 'acct-row-group'}>
                      <td>{t.label}</td>
                      <td className="acct-num">{m(t.amount)}</td>
                      <td className="acct-num">{m(t.priorAmount)}</td>
                      <td className="acct-num">
                        <Variance value={t.variance} percent={t.variancePercent} />
                      </td>
                      <td className="acct-num">{fmtPercent(t.percentOfRevenue)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </ReportTable>
          {data && (
            <p className="acct-report-meta" style={{ marginTop: 10 }}>
              Comparative column covers the immediately preceding period of equal length
              {' '}
              ({data.comparativePeriod.from.slice(0, 10)} to {data.comparativePeriod.to.slice(0, 10)}).
            </p>
          )}
        </>
      )}
    </div>
  );
};

// ───────────────────────────── balance sheet ───────────────────────────────

const sideLabel: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
};

export const BalanceSheetReport: React.FC<ReportProps> = ({ to }) => {
  const { data, isLoading, error } = useComparativeBalanceSheet({ asOf: to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    const rows: string[][] = [];
    for (const s of data.sections) {
      rows.push([s.label, '', '', '']);
      for (const r of s.rows) rows.push([`  ${r.code} ${r.name}`, r.amount, r.priorAmount, r.variance]);
      rows.push([`  Total ${s.label}`, s.subtotal, s.priorSubtotal, s.variance]);
    }
    rows.push(['TOTAL ASSETS', data.totals.assets, data.totals.priorAssets, '']);
    rows.push([
      'TOTAL LIABILITIES & EQUITY',
      data.totals.liabilitiesAndEquity,
      data.totals.priorLiabilitiesAndEquity,
      '',
    ]);
    return {
      filename: `balance-sheet_${to}`,
      title: 'Balance Sheet',
      subtitle: asOfLabel(to),
      headers: ['Line', 'Current', 'Comparative', 'Variance'],
      rows,
    };
  }, [data, to]);

  const groups = (['asset', 'liability', 'equity'] as const).map((side) => ({
    side,
    sections: (data?.sections ?? []).filter((s: StatementSection) => s.side === side),
  }));

  return (
    <div className="acct-report">
      <ReportHeader
        title="Balance Sheet"
        subtitle="Statement of financial position, with comparative"
        periodLabel={asOfLabel(to)}
        generatedAt={data?.generatedAt}
        basis="Accrual basis · posted entries only"
      />

      {error ? (
        <EmptyState message="Could not load the balance sheet." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Total Assets" value={m(data?.totals.assets)} />
            <StatTile label="Total Liabilities" value={m(data?.totals.liabilities)} />
            <StatTile label="Total Equity" value={m(data?.totals.equity)} />
            <StatTile
              label="Balance Check"
              value={data ? (data.balanced ? 'Balanced' : m(data.difference)) : '—'}
              hint="Assets − (Liabilities + Equity)"
              tone={data ? (data.balanced ? 'positive' : 'negative') : 'default'}
            />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th style={{ width: '46%' }}>Account</th>
                <th className="acct-num">{data ? data.asOf.slice(0, 10) : 'Current'}</th>
                <th className="acct-num">{data ? data.compareAsOf.slice(0, 10) : 'Comparative'}</th>
                <th className="acct-num">Movement</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={4} />
              ) : !data || data.sections.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState message="No balance sheet postings as at this date." />
                  </td>
                </tr>
              ) : (
                groups.map((group) =>
                  group.sections.length === 0 ? null : (
                    <React.Fragment key={group.side}>
                      <tr className="acct-row-group">
                        <td colSpan={4}>{sideLabel[group.side]}</td>
                      </tr>
                      {group.sections.map((section) => (
                        <React.Fragment key={section.key}>
                          <tr className="acct-row-section">
                            <td colSpan={4}>{section.label}</td>
                          </tr>
                          {section.rows.map((r) => (
                            <tr key={r.accountId ?? r.name}>
                              <td className="acct-indent">
                                <span className="acct-code">{r.code}</span> {r.name}
                                {r.derived && <span className="acct-badge" style={{ marginLeft: 6 }}>derived</span>}
                              </td>
                              <td className="acct-num">{m(r.amount)}</td>
                              <td className="acct-num acct-muted">{m(r.priorAmount)}</td>
                              <td className="acct-num">
                                <Variance value={r.variance} percent={r.variancePercent} />
                              </td>
                            </tr>
                          ))}
                          <tr className="acct-row-subtotal">
                            <td>Total {section.label}</td>
                            <td className="acct-num">{m(section.subtotal)}</td>
                            <td className="acct-num">{m(section.priorSubtotal)}</td>
                            <td className="acct-num">
                              <Variance value={section.variance} percent={section.variancePercent} />
                            </td>
                          </tr>
                        </React.Fragment>
                      ))}
                      {group.side === 'asset' && (
                        <tr className="acct-row-total">
                          <td>TOTAL ASSETS</td>
                          <td className="acct-num">{m(data.totals.assets)}</td>
                          <td className="acct-num">{m(data.totals.priorAssets)}</td>
                          <td />
                        </tr>
                      )}
                      {group.side === 'equity' && (
                        <tr className="acct-row-total">
                          <td>TOTAL LIABILITIES &amp; EQUITY</td>
                          <td className="acct-num">{m(data.totals.liabilitiesAndEquity)}</td>
                          <td className="acct-num">{m(data.totals.priorLiabilitiesAndEquity)}</td>
                          <td />
                        </tr>
                      )}
                    </React.Fragment>
                  ),
                )
              )}
            </tbody>
          </ReportTable>

          {data && !data.balanced && (
            <div className="acct-note" style={{ marginTop: 12 }}>
              Assets do not equal liabilities plus equity — difference {m(data.difference)}. Run the
              Tie-Out report to locate the unbalanced entry before circulating this statement.
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ───────────────────────────── equity statement ────────────────────────────

export const EquityStatementReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useEquityStatement({ from, to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    const rows = data.rows.map((r) => [`${r.code} ${r.name}`, r.opening, r.movement, r.closing]);
    rows.push(['Profit for the period', '', data.profitForPeriod, data.profitForPeriod]);
    rows.push(['Total equity', data.totals.opening, data.totals.movement, data.totals.closing]);
    return {
      filename: `equity-statement_${from}_${to}`,
      title: 'Statement of Changes in Equity',
      subtitle: periodLabel(from, to),
      headers: ['Component', 'Opening', 'Movement', 'Closing'],
      rows,
    };
  }, [data, from, to]);

  return (
    <div className="acct-report">
      <ReportHeader
        title="Statement of Changes in Equity"
        subtitle="Opening equity, movements and the period result"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {error ? (
        <EmptyState message="Could not load the equity statement." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Opening Equity" value={m(data?.totals.opening)} />
            <StatTile label="Movements" value={m(data?.totals.movement)} />
            <StatTile
              label="Profit for the Period"
              value={m(data?.profitForPeriod)}
              tone={Number(data?.profitForPeriod ?? 0) < 0 ? 'negative' : 'positive'}
            />
            <StatTile label="Closing Equity" value={m(data?.totals.closing)} />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th style={{ width: '46%' }}>Equity component</th>
                <th className="acct-num">Opening</th>
                <th className="acct-num">Movement in period</th>
                <th className="acct-num">Closing</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={4} />
              ) : !data || (data.rows.length === 0 && Number(data.profitForPeriod) === 0) ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState message="No equity balances or movements in this period." />
                  </td>
                </tr>
              ) : (
                <>
                  {data.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td>
                        <span className="acct-code">{r.code}</span> {r.name}
                      </td>
                      <td className="acct-num">{m(r.opening)}</td>
                      <td className="acct-num">{m(r.movement)}</td>
                      <td className="acct-num">{m(r.closing)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      Profit for the period
                      <div className="acct-report-meta">
                        Not yet closed into retained earnings — shown separately so equity reconciles.
                      </div>
                    </td>
                    <td className="acct-num acct-muted">—</td>
                    <td className="acct-num">{m(data.profitForPeriod)}</td>
                    <td className="acct-num">{m(data.profitForPeriod)}</td>
                  </tr>
                  <tr className="acct-row-total">
                    <td>Total equity</td>
                    <td className="acct-num">{m(data.totals.opening)}</td>
                    <td className="acct-num">
                      {m(Number(data.totals.movement) + Number(data.totals.profitForPeriod))}
                    </td>
                    <td className="acct-num">{m(data.totals.closing)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </ReportTable>
        </>
      )}
    </div>
  );
};

// ───────────────────────────── financial ratios ────────────────────────────

type RatioRow = FinancialRatios['ratios'][number];

const formatRatio = (
  value: string | null,
  format: 'ratio' | 'percent' | 'amount' | 'days',
  m: (v?: string | number | null) => string,
): string => {
  if (value === null) return '—';
  if (format === 'amount') return m(value);
  if (format === 'percent') return `${Number(value).toFixed(1)}%`;
  if (format === 'days') return `${Number(value).toFixed(1)} days`;
  return Number(value).toFixed(2);
};

export const FinancialRatiosReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useFinancialRatios({ from, to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    return {
      filename: `financial-ratios_${from}_${to}`,
      title: 'Financial Ratios',
      subtitle: periodLabel(from, to),
      headers: ['Group', 'Ratio', 'Value', 'Numerator', 'Denominator', 'Basis'],
      rows: data.ratios.map((r) => [
        r.group,
        r.label,
        formatRatio(r.value, r.format, m),
        r.numerator,
        r.denominator,
        r.basis,
      ]),
    };
  }, [data, from, to]);

  const groups = React.useMemo(() => {
    const out = new Map<string, RatioRow[]>();
    for (const r of data?.ratios ?? []) {
      if (!out.has(r.group)) out.set(r.group, []);
      out.get(r.group)!.push(r);
    }
    return [...out.entries()];
  }, [data]);

  return (
    <div className="acct-report">
      <ReportHeader
        title="Financial Ratios"
        subtitle="Liquidity, profitability, leverage and efficiency"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {error ? (
        <EmptyState message="Could not load the ratio pack." hint={String((error as Error).message)} />
      ) : isLoading ? (
        <ReportTable>
          <tbody>
            <LoadingRows cols={4} />
          </tbody>
        </ReportTable>
      ) : !data ? (
        <EmptyState message="No data for this period." />
      ) : (
        <>
          <StatRow>
            <StatTile label="Total Assets" value={m(data.inputs.totalAssets)} />
            <StatTile label="Total Liabilities" value={m(data.inputs.totalLiabilities)} />
            <StatTile label="Equity" value={m(data.inputs.equity)} hint="Assets − liabilities" />
            <StatTile
              label="Net Profit"
              value={m(data.inputs.netProfit)}
              tone={Number(data.inputs.netProfit) < 0 ? 'negative' : 'positive'}
            />
          </StatRow>

          {groups.map(([group, ratios]) => (
            <React.Fragment key={group}>
              <div className="acct-section-title">{group}</div>
              <ReportTable>
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>Ratio</th>
                    <th className="acct-num">Value</th>
                    <th className="acct-num">Numerator</th>
                    <th className="acct-num">Denominator</th>
                    <th>How it is calculated</th>
                  </tr>
                </thead>
                <tbody>
                  {ratios.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="acct-num" style={{ fontWeight: 600 }}>
                        {formatRatio(r.value, r.format, m)}
                      </td>
                      <td className="acct-num acct-muted">{m(r.numerator)}</td>
                      <td className="acct-num acct-muted">
                        {r.format === 'amount' ? '—' : m(r.denominator)}
                      </td>
                      <td className="acct-muted">{r.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </React.Fragment>
          ))}

          <p className="acct-report-meta" style={{ marginTop: 12 }}>
            A ratio reads “—” when its denominator is zero for the period. Balance-sheet inputs are
            taken as at {data.period.to.slice(0, 10)}; income inputs cover the {data.period.days}-day
            period.
          </p>
        </>
      )}
    </div>
  );
};

// ───────────────────────────── cash flow statement ─────────────────────────

/**
 * Cash flow statement, classified by the account's own cash-flow class, with
 * the closing figure reconciled against the actual cash balance. A mismatch is
 * surfaced rather than hidden — it means a cash account is misclassified.
 */
export const CashFlowStatementReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useCashFlow({ from, to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    return {
      filename: `cash-flow_${from}_${to}`,
      title: 'Cash Flow Statement',
      subtitle: periodLabel(from, to),
      headers: ['Line', 'Amount'],
      rows: [
        ['Opening cash', data.openingCash],
        ['Operating activities', data.operating],
        ['Investing activities', data.investing],
        ['Financing activities', data.financing],
        ['Net cash flow', data.netCashFlow],
        ['Closing cash (derived)', data.closingCash],
        ['Closing cash (actual)', data.actualClosingCash],
      ],
    };
  }, [data, from, to]);

  const line = (label: string, value?: string, cls?: string) => (
    <tr className={cls}>
      <td>{label}</td>
      <td className="acct-num">{m(value)}</td>
    </tr>
  );

  return (
    <div className="acct-report">
      <ReportHeader
        title="Cash Flow Statement"
        subtitle="Operating, investing and financing movements in cash & equivalents"
        periodLabel={periodLabel(from, to)}
      />

      {error ? (
        <EmptyState message="Could not load the cash flow statement." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Opening Cash" value={m(data?.openingCash)} />
            <StatTile
              label="Net Cash Flow"
              value={m(data?.netCashFlow)}
              tone={Number(data?.netCashFlow ?? 0) < 0 ? 'negative' : 'positive'}
            />
            <StatTile label="Closing Cash" value={m(data?.closingCash)} />
            <StatTile
              label="Reconciled"
              value={data ? (data.reconciled ? 'Yes' : 'No') : '—'}
              hint="Derived vs actual cash balance"
              tone={data ? (data.reconciled ? 'positive' : 'negative') : 'default'}
            />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th style={{ width: '60%' }}>Line</th>
                <th className="acct-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={2} />
              ) : !data ? (
                <tr>
                  <td colSpan={2}>
                    <EmptyState message="No cash movement in this period." />
                  </td>
                </tr>
              ) : (
                <>
                  {line('Cash and cash equivalents at the beginning of the period', data.openingCash, 'acct-row-group')}
                  {line('Net cash from operating activities', data.operating)}
                  {line('Net cash from investing activities', data.investing)}
                  {line('Net cash from financing activities', data.financing)}
                  {line('Net increase / (decrease) in cash', data.netCashFlow, 'acct-row-subtotal')}
                  {line('Cash and cash equivalents at the end of the period', data.closingCash, 'acct-row-total')}
                  {line('Actual cash balance per the ledger', data.actualClosingCash)}
                </>
              )}
            </tbody>
          </ReportTable>

          {data && !data.reconciled && (
            <div className="acct-note" style={{ marginTop: 12 }}>
              The derived closing cash figure does not match the ledger cash balance. Check that every
              cash and bank account is mapped to a cash-equivalent category.
            </div>
          )}
        </>
      )}
    </div>
  );
};
