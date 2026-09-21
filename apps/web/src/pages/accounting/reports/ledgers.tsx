/**
 * Ledger-level reports: the extended trial balance, the detailed general
 * ledger, the journal day book and the chart-of-accounts balance listing.
 *
 * These are the transaction-level reports — the ones an auditor uses to walk
 * from a statement figure down to the entry that produced it — so every row
 * carries its entry number and links back to the entry it came from.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useAccountBalances,
  useDetailedGeneralLedger,
  useExtendedTrialBalance,
  useJournalReport,
} from '@/features/accounting/reports-api';
import { useJournals } from '@/features/accounting/api';
import {
  EmptyState,
  LoadingRows,
  ReportHeader,
  ReportTable,
  StatRow,
  StatTile,
  asOfLabel,
  fmtDate,
  periodLabel,
  useAccountingMoney,
  useRegisterExport,
} from './report-kit';
import type { ReportProps } from './statements';

// ───────────────────────────── extended trial balance ──────────────────────

export const ExtendedTrialBalanceReport: React.FC<ReportProps> = ({ from, to }) => {
  const [includeZero, setIncludeZero] = useState(false);
  const { data, isLoading, error } = useExtendedTrialBalance({ from, to, includeZero });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    const rows = data.rows.map((r) => [
      r.code,
      r.name,
      r.sectionLabel,
      r.openingDebit,
      r.openingCredit,
      r.periodDebit,
      r.periodCredit,
      r.closingDebit,
      r.closingCredit,
    ]);
    rows.push([
      '',
      'TOTAL',
      '',
      data.totals.openingDebit,
      data.totals.openingCredit,
      data.totals.periodDebit,
      data.totals.periodCredit,
      data.totals.closingDebit,
      data.totals.closingCredit,
    ]);
    return {
      filename: `extended-trial-balance_${from}_${to}`,
      title: 'Extended Trial Balance',
      subtitle: periodLabel(from, to),
      headers: [
        'Code',
        'Account',
        'Section',
        'Opening Dr',
        'Opening Cr',
        'Period Dr',
        'Period Cr',
        'Closing Dr',
        'Closing Cr',
      ],
      rows,
    };
  }, [data, from, to]);

  return (
    <div className="acct-report">
      <ReportHeader
        title="Extended Trial Balance"
        subtitle="Opening balance, period movement and closing balance per account"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
        right={
          <label className="acct-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={includeZero}
              onChange={(e) => setIncludeZero(e.target.checked)}
            />
            <span style={{ fontSize: 12 }}>Show accounts with no activity</span>
          </label>
        }
      />

      {error ? (
        <EmptyState message="Could not load the trial balance." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Opening (Dr)" value={m(data?.totals.openingDebit)} />
            <StatTile label="Period Movement (Dr)" value={m(data?.totals.periodDebit)} />
            <StatTile label="Closing (Dr)" value={m(data?.totals.closingDebit)} />
            <StatTile
              label="Foots"
              value={data ? (data.balanced ? 'Balanced' : 'Out of balance') : '—'}
              hint="Closing debits vs credits"
              tone={data ? (data.balanced ? 'positive' : 'negative') : 'default'}
            />
          </StatRow>

          <ReportTable dense>
            <thead>
              <tr>
                <th>Code</th>
                <th style={{ minWidth: 180 }}>Account</th>
                <th className="acct-num">Opening Dr</th>
                <th className="acct-num">Opening Cr</th>
                <th className="acct-num">Period Dr</th>
                <th className="acct-num">Period Cr</th>
                <th className="acct-num">Closing Dr</th>
                <th className="acct-num">Closing Cr</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={8} />
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState message="No account activity in this period." />
                  </td>
                </tr>
              ) : (
                <>
                  {data.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="acct-code">{r.code}</td>
                      <td>
                        <Link to={`/accounts/ledger/${r.accountId}`}>{r.name}</Link>
                        <div className="acct-report-meta">{r.sectionLabel}</div>
                      </td>
                      <td className="acct-num">{m(r.openingDebit)}</td>
                      <td className="acct-num">{m(r.openingCredit)}</td>
                      <td className="acct-num">{m(r.periodDebit)}</td>
                      <td className="acct-num">{m(r.periodCredit)}</td>
                      <td className="acct-num">{m(r.closingDebit)}</td>
                      <td className="acct-num">{m(r.closingCredit)}</td>
                    </tr>
                  ))}
                  <tr className="acct-row-total">
                    <td colSpan={2}>TOTAL</td>
                    <td className="acct-num">{m(data.totals.openingDebit)}</td>
                    <td className="acct-num">{m(data.totals.openingCredit)}</td>
                    <td className="acct-num">{m(data.totals.periodDebit)}</td>
                    <td className="acct-num">{m(data.totals.periodCredit)}</td>
                    <td className="acct-num">{m(data.totals.closingDebit)}</td>
                    <td className="acct-num">{m(data.totals.closingCredit)}</td>
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

// ───────────────────────────── detailed general ledger ─────────────────────

export const DetailedGeneralLedgerReport: React.FC<ReportProps> = ({ from, to }) => {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useDetailedGeneralLedger({ from, to, page, pageSize: 15 });
  const m = useAccountingMoney();

  // A new period is a different report — restart at the first page of accounts.
  React.useEffect(() => setPage(1), [from, to]);

  useRegisterExport(() => {
    if (!data) return null;
    const rows: string[][] = [];
    for (const a of data.accounts) {
      rows.push([`${a.code} ${a.name}`, '', 'Opening balance', '', '', '', a.openingBalance]);
      for (const l of a.lines) {
        rows.push([
          `${a.code} ${a.name}`,
          fmtDate(l.date),
          l.entryNumber,
          l.description,
          l.debit,
          l.credit,
          l.balance,
        ]);
      }
      rows.push([`${a.code} ${a.name}`, '', 'Closing balance', '', a.periodDebit, a.periodCredit, a.closingBalance]);
    }
    return {
      filename: `general-ledger_${from}_${to}_p${page}`,
      title: 'General Ledger (Detailed)',
      subtitle: periodLabel(from, to),
      headers: ['Account', 'Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'],
      rows,
    };
  }, [data, from, to, page]);

  return (
    <div className="acct-report">
      <ReportHeader
        title="General Ledger (Detailed)"
        subtitle="Every posted line, by account, with a running balance"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
      />

      {error ? (
        <EmptyState message="Could not load the general ledger." hint={String((error as Error).message)} />
      ) : isLoading ? (
        <ReportTable>
          <tbody>
            <LoadingRows cols={6} />
          </tbody>
        </ReportTable>
      ) : !data || data.accounts.length === 0 ? (
        <EmptyState
          message="No account has an opening balance or activity in this period."
          hint="Try widening the date range."
        />
      ) : (
        <>
          {data.accounts.map((a) => (
            <div key={a.accountId} style={{ marginBottom: 22 }}>
              <div className="acct-section-title" style={{ marginBottom: 4 }}>
                <span className="acct-code">{a.code}</span> {a.name}
                <span className="acct-badge" style={{ marginLeft: 8 }}>{a.sectionLabel}</span>
              </div>
              <ReportTable dense>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Date</th>
                    <th style={{ width: 140 }}>Entry</th>
                    <th>Description</th>
                    <th style={{ width: 140 }}>Partner</th>
                    <th className="acct-num">Debit</th>
                    <th className="acct-num">Credit</th>
                    <th className="acct-num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="acct-row-subtotal">
                    <td colSpan={6}>Opening balance</td>
                    <td className="acct-num">{m(a.openingBalance)}</td>
                  </tr>
                  {a.lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="acct-muted" style={{ textAlign: 'center' }}>
                        No movement in this period.
                      </td>
                    </tr>
                  ) : (
                    a.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{fmtDate(l.date)}</td>
                        <td>
                          <Link to={`/journal-entries/${l.entryId}`} className="acct-code">
                            {l.entryNumber}
                          </Link>
                          {l.entryStatus === 'reversed' && (
                            <span className="acct-badge acct-badge-bad" style={{ marginLeft: 6 }}>
                              reversed
                            </span>
                          )}
                        </td>
                        <td>{l.description || <span className="acct-muted">—</span>}</td>
                        <td>{l.partner ?? <span className="acct-muted">—</span>}</td>
                        <td className="acct-num">{m(l.debit)}</td>
                        <td className="acct-num">{m(l.credit)}</td>
                        <td className="acct-num">{m(l.balance)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="acct-row-total">
                    <td colSpan={4}>Closing balance</td>
                    <td className="acct-num">{m(a.periodDebit)}</td>
                    <td className="acct-num">{m(a.periodCredit)}</td>
                    <td className="acct-num">{m(a.closingBalance)}</td>
                  </tr>
                </tbody>
              </ReportTable>
            </div>
          ))}

          <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <span className="acct-muted" style={{ fontSize: 12 }}>
              Accounts {(data.meta.page - 1) * data.meta.pageSize + 1}–
              {Math.min(data.meta.page * data.meta.pageSize, data.meta.total)} of {data.meta.total}
            </span>
            <button className="acct-preset" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button
              className="acct-preset"
              disabled={page >= data.meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ───────────────────────────── journal day book ────────────────────────────

export const JournalDayBookReport: React.FC<ReportProps> = ({ from, to }) => {
  const [journalId, setJournalId] = useState('');
  const [page, setPage] = useState(1);
  const { data: journals } = useJournals();
  const { data, isLoading, error } = useJournalReport({
    from,
    to,
    journalId: journalId || undefined,
    page,
    pageSize: 25,
  });
  const m = useAccountingMoney();

  React.useEffect(() => setPage(1), [from, to, journalId]);

  useRegisterExport(() => {
    if (!data) return null;
    const rows: string[][] = [];
    for (const e of data.data) {
      for (const l of e.lines) {
        rows.push([
          fmtDate(e.postingDate),
          e.entryNumber,
          e.journal?.code ?? '',
          e.description,
          l.accountCode,
          l.accountName,
          l.description,
          l.debit,
          l.credit,
        ]);
      }
    }
    return {
      filename: `journal-report_${from}_${to}_p${page}`,
      title: 'Journal Report (Day Book)',
      subtitle: periodLabel(from, to),
      headers: [
        'Date',
        'Entry',
        'Journal',
        'Entry description',
        'Account code',
        'Account',
        'Line description',
        'Debit',
        'Credit',
      ],
      rows,
    };
  }, [data, from, to, page]);

  return (
    <div className="acct-report">
      <ReportHeader
        title="Journal Report"
        subtitle="Every journal entry in the period, with its lines"
        periodLabel={periodLabel(from, to)}
        generatedAt={data?.generatedAt}
        right={
          <div className="acct-field">
            <label htmlFor="journal-filter">Journal</label>
            <select
              id="journal-filter"
              className="acct-select"
              value={journalId}
              onChange={(e) => setJournalId(e.target.value)}
            >
              <option value="">All journals</option>
              {(journals?.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {error ? (
        <EmptyState message="Could not load the journal report." hint={String((error as Error).message)} />
      ) : (
        <>
          <StatRow>
            <StatTile label="Entries" value={String(data?.meta.total ?? 0)} />
            <StatTile label="Total Debits" value={m(data?.totals.debit)} hint="This page" />
            <StatTile label="Total Credits" value={m(data?.totals.credit)} hint="This page" />
          </StatRow>

          <ReportTable dense>
            <thead>
              <tr>
                <th style={{ width: 96 }}>Date</th>
                <th style={{ width: 140 }}>Entry</th>
                <th style={{ width: 90 }}>Code</th>
                <th>Account / description</th>
                <th className="acct-num">Debit</th>
                <th className="acct-num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={6} />
              ) : !data || data.data.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState message="No journal entries in this period." />
                  </td>
                </tr>
              ) : (
                data.data.map((e) => (
                  <React.Fragment key={e.id}>
                    <tr className="acct-row-group">
                      <td>{fmtDate(e.postingDate)}</td>
                      <td>
                        <Link to={`/journal-entries/${e.id}`} className="acct-code">
                          {e.entryNumber}
                        </Link>
                      </td>
                      <td colSpan={2}>
                        {e.journal ? `${e.journal.code} · ` : ''}
                        {e.description || <span className="acct-muted">No description</span>}
                        {e.status === 'reversed' && (
                          <span className="acct-badge acct-badge-bad" style={{ marginLeft: 6 }}>
                            reversed
                          </span>
                        )}
                        {!e.balanced && (
                          <span className="acct-badge acct-badge-bad" style={{ marginLeft: 6 }}>
                            unbalanced
                          </span>
                        )}
                      </td>
                      <td className="acct-num">{m(e.debit)}</td>
                      <td className="acct-num">{m(e.credit)}</td>
                    </tr>
                    {e.lines.map((l) => (
                      <tr key={l.id}>
                        <td />
                        <td />
                        <td className="acct-code">{l.accountCode}</td>
                        <td>
                          {l.accountName}
                          {l.description && <span className="acct-muted"> · {l.description}</span>}
                        </td>
                        <td className="acct-num">{m(l.debit)}</td>
                        <td className="acct-num">{m(l.credit)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </ReportTable>

          {data && data.meta.totalPages > 1 && (
            <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <span className="acct-muted" style={{ fontSize: 12 }}>
                Page {data.meta.page} of {data.meta.totalPages}
              </span>
              <button className="acct-preset" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button
                className="acct-preset"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ───────────────────────────── account balances ────────────────────────────

export const AccountBalancesReport: React.FC<ReportProps> = ({ to }) => {
  const [includeZero, setIncludeZero] = useState(false);
  const { data, isLoading, error } = useAccountBalances({ asOf: to, includeZero });
  const m = useAccountingMoney();

  useRegisterExport(() => {
    if (!data) return null;
    return {
      filename: `account-balances_${to}`,
      title: 'Chart of Accounts — Balances',
      subtitle: asOfLabel(to),
      headers: ['Code', 'Account', 'Category', 'Section', 'Classification', 'Debit', 'Credit', 'Balance'],
      rows: data.rows.map((r) => [
        r.code,
        r.name,
        r.categoryName ?? '',
        r.sectionLabel,
        r.classification ?? '',
        r.debit,
        r.credit,
        r.balance,
      ]),
    };
  }, [data, to]);

  const classifications = Object.entries(data?.totalsByClassification ?? {});

  return (
    <div className="acct-report">
      <ReportHeader
        title="Chart of Accounts — Balances"
        subtitle="Every account with its as-at balance, category and behaviour"
        periodLabel={asOfLabel(to)}
        generatedAt={data?.generatedAt}
        right={
          <label className="acct-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={includeZero}
              onChange={(e) => setIncludeZero(e.target.checked)}
            />
            <span style={{ fontSize: 12 }}>Include unused accounts</span>
          </label>
        }
      />

      {error ? (
        <EmptyState message="Could not load account balances." hint={String((error as Error).message)} />
      ) : (
        <>
          {classifications.length > 0 && (
            <StatRow>
              {classifications.map(([key, value]) => (
                <StatTile key={key} label={key.replace(/_/g, ' ')} value={m(value)} />
              ))}
            </StatRow>
          )}

          <ReportTable dense>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th>Category</th>
                <th>Section</th>
                <th className="acct-num">Debit</th>
                <th className="acct-num">Credit</th>
                <th className="acct-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <LoadingRows cols={7} />
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState message="No accounts carry a balance as at this date." />
                  </td>
                </tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="acct-code">{r.code}</td>
                    <td>
                      <Link to={`/accounts/ledger/${r.accountId}`}>{r.name}</Link>
                      {r.controlAccountType && (
                        <span className="acct-badge" style={{ marginLeft: 6 }}>
                          {r.controlAccountType.toUpperCase()} control
                        </span>
                      )}
                      {!r.isActive && (
                        <span className="acct-badge acct-badge-bad" style={{ marginLeft: 6 }}>
                          inactive
                        </span>
                      )}
                    </td>
                    <td className="acct-muted">{r.categoryName ?? '—'}</td>
                    <td className="acct-muted">{r.sectionLabel}</td>
                    <td className="acct-num">{m(r.debit)}</td>
                    <td className="acct-num">{m(r.credit)}</td>
                    <td className="acct-num" style={{ fontWeight: 600 }}>
                      {m(r.balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </ReportTable>
          <p className="acct-report-meta" style={{ marginTop: 10 }}>
            Balances are shown in each account's own normal direction — a credit-normal account
            reads positive when it is in credit.
          </p>
        </>
      )}
    </div>
  );
};
