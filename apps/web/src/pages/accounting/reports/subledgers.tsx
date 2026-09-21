/**
 * Sub-ledger and analysis reports: customer / supplier ledgers, the cash and
 * bank book, the tax return summary, and the revenue and expense breakdowns.
 *
 * These sit between the statements and the raw ledger — they answer "who owes
 * us", "where did the cash go", "what do we owe the revenue authority" and
 * "what did we spend it on", which is most of what a finance office is asked
 * on any given day.
 */
import React, { useState } from 'react';
import {
  useCashBook,
  useExpenseAnalysis,
  usePartnerLedger,
  useRevenueAnalysis,
  useTaxSummary,
  type SectionAnalysis,
} from '@/features/accounting/reports-api';
import {
  EmptyState,
  LoadingRows,
  ReportHeader,
  ReportTable,
  StatRow,
  StatTile,
  Variance,
  fmtDate,
  fmtPercent,
  periodLabel,
  useAccountingMoney,
  useRegisterExport,
} from './report-kit';
import type { ReportProps } from './statements';

// ───────────────────────────── partner ledgers ─────────────────────────────

const PartnerLedgerReport: React.FC<ReportProps & { type: 'receivable' | 'payable' }> = ({
  from,
  to,
  type,
}) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, error } = usePartnerLedger({ from, to, type, detail: true });
  const m = useAccountingMoney();

  const isAr = type === 'receivable';
  const title = isAr ? 'Customer Ledger (Receivables)' : 'Supplier Ledger (Payables)';
  const who = isAr ? 'Customer' : 'Supplier';

  useRegisterExport(() => {
    if (!data) return null;
    const rows = data.partners.map((p) => [
      p.name,
      p.email ?? '',
      p.phone ?? '',
      p.opening,
      p.debit,
      p.credit,
      p.outstanding,
    ]);
    rows.push(['TOTAL', '', '', data.totals.opening, data.totals.debit, data.totals.credit, data.totals.outstanding]);
    return {
      filename: `${isAr ? 'customer' : 'supplier'}-ledger_${from}_${to}`,
      title,
      subtitle: periodLabel(from, to),
      headers: [who, 'Email', 'Phone', 'Opening', 'Debits', 'Credits', 'Outstanding'],
      rows,
    };
  }, [data, from, to, type]);

  return (
    <div className="acct-report">
      <ReportHeader
        title={title}
        subtitle={`Movement and closing balance per ${who.toLowerCase()}, off the ${
          isAr ? 'receivables' : 'payables'
        } control account`}
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {data?.note && <div className="acct-note">{data.note}</div>}

      {error ? (
        <EmptyState message="Could not load the ledger." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Opening" value={m(data?.totals.opening)} />
            <StatTile label={isAr ? 'Invoiced' : 'Payments made'} value={m(data?.totals.debit)} />
            <StatTile label={isAr ? 'Received' : 'Billed'} value={m(data?.totals.credit)} />
            <StatTile
              label={isAr ? 'Owed to us' : 'Owed by us'}
              value={m(data?.totals.outstanding)}
              tone={isAr ? 'warning' : 'default'}
            />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>{who}</th>
                <th className="acct-num">Opening</th>
                <th className="acct-num">Debits</th>
                <th className="acct-num">Credits</th>
                <th className="acct-num">Outstanding</th>
                <th className="no-print" style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={6} />
              ) : !data || data.partners.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      message={`No ${who.toLowerCase()} activity in this period.`}
                      hint="Only postings that carry a partner on the control account appear here."
                    />
                  </td>
                </tr>
              ) : (
                <>
                  {data.partners.map((p) => (
                    <React.Fragment key={p.partnerId}>
                      <tr>
                        <td>
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          {(p.email || p.phone) && (
                            <div className="acct-report-meta">
                              {[p.email, p.phone].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="acct-num">{m(p.opening)}</td>
                        <td className="acct-num">{m(p.debit)}</td>
                        <td className="acct-num">{m(p.credit)}</td>
                        <td className="acct-num" style={{ fontWeight: 600 }}>
                          {m(p.outstanding)}
                        </td>
                        <td className="no-print">
                          {p.lines.length > 0 && (
                            <button
                              className="acct-preset"
                              onClick={() => setExpanded(expanded === p.partnerId ? null : p.partnerId)}
                            >
                              {expanded === p.partnerId ? 'Hide' : 'Detail'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded === p.partnerId &&
                        p.lines.map((l, i) => (
                          <tr key={`${p.partnerId}-${i}`}>
                            <td className="acct-indent acct-muted">
                              {fmtDate(l.date)} · <span className="acct-code">{l.entryNumber}</span>{' '}
                              {l.description}
                            </td>
                            <td />
                            <td className="acct-num">{m(l.debit)}</td>
                            <td className="acct-num">{m(l.credit)}</td>
                            <td className="acct-num acct-muted">{m(l.balance)}</td>
                            <td className="no-print" />
                          </tr>
                        ))}
                    </React.Fragment>
                  ))}
                  <tr className="acct-row-total">
                    <td>TOTAL</td>
                    <td className="acct-num">{m(data.totals.opening)}</td>
                    <td className="acct-num">{m(data.totals.debit)}</td>
                    <td className="acct-num">{m(data.totals.credit)}</td>
                    <td className="acct-num">{m(data.totals.outstanding)}</td>
                    <td className="no-print" />
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

export const CustomerLedgerReport: React.FC<ReportProps> = (p) => (
  <PartnerLedgerReport {...p} type="receivable" />
);

export const SupplierLedgerReport: React.FC<ReportProps> = (p) => (
  <PartnerLedgerReport {...p} type="payable" />
);

// ───────────────────────────── cash book ───────────────────────────────────

export const CashBookReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useCashBook({ from, to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    const rows = data.accounts.map((a) => [
      a.code,
      a.name,
      a.categoryName ?? '',
      a.openingBalance,
      a.receipts,
      a.payments,
      a.closingBalance,
    ]);
    rows.push([
      '',
      'TOTAL',
      '',
      data.totals.opening,
      data.totals.receipts,
      data.totals.payments,
      data.totals.closing,
    ]);
    return {
      filename: `cash-book_${from}_${to}`,
      title: 'Cash & Bank Book',
      subtitle: periodLabel(from, to),
      headers: ['Code', 'Account', 'Type', 'Opening', 'Receipts', 'Payments', 'Closing'],
      rows,
    };
  }, [data, from, to]);

  const peak = Math.max(
    1,
    ...(data?.daily ?? []).map((d) => Math.max(Number(d.receipts), Number(d.payments))),
  );

  return (
    <div className="acct-report">
      <ReportHeader
        title="Cash & Bank Book"
        subtitle="Opening, receipts, payments and closing balance per cash account"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {data?.note && <div className="acct-note">{data.note}</div>}

      {error ? (
        <EmptyState message="Could not load the cash book." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Opening Balance" value={m(data?.totals.opening)} />
            <StatTile label="Receipts" value={m(data?.totals.receipts)} tone="positive" />
            <StatTile label="Payments" value={m(data?.totals.payments)} tone="negative" />
            <StatTile label="Closing Balance" value={m(data?.totals.closing)} />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th className="acct-num">Opening</th>
                <th className="acct-num">Receipts</th>
                <th className="acct-num">Payments</th>
                <th className="acct-num">Net</th>
                <th className="acct-num">Closing</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={7} />
              ) : !data || data.accounts.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState message="No cash or bank accounts are configured." />
                  </td>
                </tr>
              ) : (
                <>
                  {data.accounts.map((a) => (
                    <tr key={a.accountId}>
                      <td className="acct-code">{a.code}</td>
                      <td>
                        {a.name}
                        {a.categoryName && <div className="acct-report-meta">{a.categoryName}</div>}
                      </td>
                      <td className="acct-num">{m(a.openingBalance)}</td>
                      <td className="acct-num">{m(a.receipts)}</td>
                      <td className="acct-num">{m(a.payments)}</td>
                      <td className="acct-num">
                        <Variance value={a.netMovement} />
                      </td>
                      <td className="acct-num" style={{ fontWeight: 600 }}>
                        {m(a.closingBalance)}
                      </td>
                    </tr>
                  ))}
                  <tr className="acct-row-total">
                    <td colSpan={2}>TOTAL</td>
                    <td className="acct-num">{m(data.totals.opening)}</td>
                    <td className="acct-num">{m(data.totals.receipts)}</td>
                    <td className="acct-num">{m(data.totals.payments)}</td>
                    <td className="acct-num">
                      {m(Number(data.totals.receipts) - Number(data.totals.payments))}
                    </td>
                    <td className="acct-num">{m(data.totals.closing)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </ReportTable>

          {data && data.daily.length > 0 && (
            <>
              <div className="acct-section-title">Daily movement</div>
              <ReportTable dense>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Date</th>
                    <th className="acct-num">Receipts</th>
                    <th className="acct-num">Payments</th>
                    <th style={{ width: '35%' }}>Flow</th>
                    <th className="acct-num">Running balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <td>{fmtDate(d.date)}</td>
                      <td className="acct-num">{m(d.receipts)}</td>
                      <td className="acct-num">{m(d.payments)}</td>
                      <td>
                        <div className="acct-bar-track">
                          <div
                            className="acct-bar"
                            style={{
                              width: `${(Number(d.receipts) / peak) * 100}%`,
                              background: 'hsl(142 71% 40%)',
                            }}
                          />
                          <div
                            className="acct-bar"
                            style={{
                              width: `${(Number(d.payments) / peak) * 100}%`,
                              background: 'hsl(0 72% 55%)',
                              marginTop: 2,
                            }}
                          />
                        </div>
                      </td>
                      <td className="acct-num">{m(d.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </>
          )}
        </>
      )}
    </div>
  );
};

// ───────────────────────────── tax summary ─────────────────────────────────

const VAT_CATEGORY_LABEL: Record<string, string> = {
  standard: 'Standard rated',
  zero_rated: 'Zero rated',
  exempt: 'Exempt',
  out_of_scope: 'Out of scope',
};

export const TaxSummaryReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useTaxSummary({ from, to });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    const rows = data.rows.map((r) => [
      r.name,
      r.code ?? '',
      `${r.rate}%`,
      VAT_CATEGORY_LABEL[r.vatCategory] ?? r.vatCategory,
      r.netSales,
      r.outputTax,
      r.netPurchases,
      r.inputTax,
      r.netTax,
    ]);
    rows.push([
      'TOTAL',
      '',
      '',
      '',
      data.totals.netSales,
      data.totals.outputTax,
      data.totals.netPurchases,
      data.totals.inputTax,
      data.totals.netTax,
    ]);
    return {
      filename: `tax-summary_${from}_${to}`,
      title: 'Tax Summary',
      subtitle: periodLabel(from, to),
      headers: [
        'Tax',
        'Code',
        'Rate',
        'Category',
        'Net sales',
        'Output tax',
        'Net purchases',
        'Input tax',
        'Net tax',
      ],
      rows,
    };
  }, [data, from, to]);

  return (
    <div className="acct-report">
      <ReportHeader
        title="Tax Summary"
        subtitle="Output tax on sales against input tax on purchases, by tax code"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
        basis="Posted documents · by issue date"
      />

      {error ? (
        <EmptyState message="Could not load the tax summary." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Output Tax (sales)" value={m(data?.totals.outputTax)} />
            <StatTile label="Input Tax (purchases)" value={m(data?.totals.inputTax)} />
            <StatTile
              label={data?.position === 'refundable' ? 'Refundable' : 'Net Tax Payable'}
              value={m(data?.totals.netTax)}
              hint="Output tax − input tax"
              tone={data?.position === 'refundable' ? 'positive' : 'warning'}
            />
            <StatTile label="Net Sales" value={m(data?.totals.netSales)} />
          </StatRow>

          <ReportTable>
            <thead>
              <tr>
                <th>Tax</th>
                <th className="acct-num">Rate</th>
                <th className="acct-num">Net sales</th>
                <th className="acct-num">Output tax</th>
                <th className="acct-num">Net purchases</th>
                <th className="acct-num">Input tax</th>
                <th className="acct-num">Net tax</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={7} />
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      message="No posted documents in this period."
                      hint="The tax summary reads posted invoices and bills, not draft ones."
                    />
                  </td>
                </tr>
              ) : (
                <>
                  {data.rows.map((r) => (
                    <tr key={r.taxId ?? 'none'}>
                      <td>
                        {r.name}
                        <div className="acct-report-meta">
                          {r.code ? `${r.code} · ` : ''}
                          {VAT_CATEGORY_LABEL[r.vatCategory] ?? r.vatCategory} · {r.documents} document
                          {r.documents === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="acct-num">{Number(r.rate).toFixed(2)}%</td>
                      <td className="acct-num">{m(r.netSales)}</td>
                      <td className="acct-num">{m(r.outputTax)}</td>
                      <td className="acct-num">{m(r.netPurchases)}</td>
                      <td className="acct-num">{m(r.inputTax)}</td>
                      <td className="acct-num" style={{ fontWeight: 600 }}>
                        {m(r.netTax)}
                      </td>
                    </tr>
                  ))}
                  <tr className="acct-row-total">
                    <td colSpan={2}>TOTAL</td>
                    <td className="acct-num">{m(data.totals.netSales)}</td>
                    <td className="acct-num">{m(data.totals.outputTax)}</td>
                    <td className="acct-num">{m(data.totals.netPurchases)}</td>
                    <td className="acct-num">{m(data.totals.inputTax)}</td>
                    <td className="acct-num">{m(data.totals.netTax)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </ReportTable>

          <p className="acct-report-meta" style={{ marginTop: 10 }}>
            Credit notes and debit notes are netted off the period they were issued in. This is a
            working summary — reconcile it against the tax control account before filing.
          </p>
        </>
      )}
    </div>
  );
};

// ───────────────────────────── revenue / expense analysis ──────────────────

const AnalysisReport: React.FC<{
  data: SectionAnalysis | undefined;
  isLoading: boolean;
  error: unknown;
  title: string;
  subtitle: string;
  from: string;
  to: string;
  tone: 'positive' | 'negative';
}> = ({ data, isLoading, error, title, subtitle, from, to, tone }) => {
  const m = useAccountingMoney();
  const peak = Math.max(1, ...(data?.rows ?? []).map((r) => Math.abs(Number(r.amount))));

  return (
    <div className="acct-report">
      <ReportHeader
        title={title}
        subtitle={subtitle}
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {error ? (
        <EmptyState message={`Could not load ${title.toLowerCase()}.`} hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label={`Total ${data?.label ?? ''}`.trim()} value={m(data?.totals.amount)} tone={tone} />
            <StatTile label="Prior Period" value={m(data?.totals.priorAmount)} />
            <StatTile
              label="Variance"
              value={m(data?.totals.variance)}
              hint={
                data?.totals.variancePercent ? `${Number(data.totals.variancePercent).toFixed(1)}%` : undefined
              }
              tone={Number(data?.totals.variance ?? 0) >= 0 ? 'positive' : 'negative'}
            />
            <StatTile label="Accounts" value={String(data?.rows.length ?? 0)} />
          </StatRow>

          {data && data.categories.length > 0 && (
            <>
              <div className="acct-section-title">By category</div>
              <ReportTable dense>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="acct-num">Amount</th>
                    <th className="acct-num">% of total</th>
                    <th className="acct-num">Prior period</th>
                    <th className="acct-num">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td className="acct-num">{m(c.amount)}</td>
                      <td className="acct-num acct-muted">{fmtPercent(c.percentOfTotal)}</td>
                      <td className="acct-num acct-muted">{m(c.priorAmount)}</td>
                      <td className="acct-num">
                        <Variance value={c.variance} percent={c.variancePercent} invert={tone === 'negative'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </>
          )}

          <div className="acct-section-title">By account</div>
          <ReportTable>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th className="acct-num">Amount</th>
                <th style={{ width: '18%' }}>Share</th>
                <th className="acct-num">% of total</th>
                <th className="acct-num">Prior period</th>
                <th className="acct-num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={7} />
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState message="No postings in this period." />
                  </td>
                </tr>
              ) : (
                <>
                  {data.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="acct-code">{r.code}</td>
                      <td>
                        {r.name}
                        <div className="acct-report-meta">{r.sectionLabel}</div>
                      </td>
                      <td className="acct-num">{m(r.amount)}</td>
                      <td>
                        <div className="acct-bar-track">
                          <div
                            className="acct-bar"
                            style={{ width: `${(Math.abs(Number(r.amount)) / peak) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="acct-num acct-muted">{fmtPercent(r.percentOfTotal)}</td>
                      <td className="acct-num acct-muted">{m(r.priorAmount)}</td>
                      <td className="acct-num">
                        <Variance value={r.variance} percent={r.variancePercent} invert={tone === 'negative'} />
                      </td>
                    </tr>
                  ))}
                  <tr className="acct-row-total">
                    <td colSpan={2}>TOTAL</td>
                    <td className="acct-num">{m(data.totals.amount)}</td>
                    <td />
                    <td className="acct-num">100%</td>
                    <td className="acct-num">{m(data.totals.priorAmount)}</td>
                    <td className="acct-num">
                      <Variance
                        value={data.totals.variance}
                        percent={data.totals.variancePercent}
                        invert={tone === 'negative'}
                      />
                    </td>
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

export const RevenueAnalysisReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useRevenueAnalysis({ from, to });
  useRegisterExport(() => {
    if (!data) return null;
    return {
      filename: `revenue-analysis_${from}_${to}`,
      title: 'Revenue Analysis',
      subtitle: periodLabel(from, to),
      headers: ['Code', 'Account', 'Section', 'Amount', '% of total', 'Prior period', 'Variance'],
      rows: data.rows.map((r) => [
        r.code,
        r.name,
        r.sectionLabel,
        r.amount,
        r.percentOfTotal,
        r.priorAmount,
        r.variance,
      ]),
    };
  }, [data, from, to]);

  return (
    <AnalysisReport
      data={data}
      isLoading={isLoading}
      error={error}
      title="Revenue Analysis"
      subtitle="Income by account and category, against the prior period"
      from={from}
      to={to}
      tone="positive"
    />
  );
};

export const ExpenseAnalysisReport: React.FC<ReportProps> = ({ from, to }) => {
  const { data, isLoading, error } = useExpenseAnalysis({ from, to });
  useRegisterExport(() => {
    if (!data) return null;
    return {
      filename: `expense-analysis_${from}_${to}`,
      title: 'Expense Analysis',
      subtitle: periodLabel(from, to),
      headers: ['Code', 'Account', 'Section', 'Amount', '% of total', 'Prior period', 'Variance'],
      rows: data.rows.map((r) => [
        r.code,
        r.name,
        r.sectionLabel,
        r.amount,
        r.percentOfTotal,
        r.priorAmount,
        r.variance,
      ]),
    };
  }, [data, from, to]);

  return (
    <AnalysisReport
      data={data}
      isLoading={isLoading}
      error={error}
      title="Expense Analysis"
      subtitle="Cost of sales and operating expenses by account, against the prior period"
      from={from}
      to={to}
      tone="negative"
    />
  );
};
