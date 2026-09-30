import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

export interface BankAccountRow {
  id: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  accountId: string;
}

export interface StatementLine {
  id: string;
  postedAt: string;
  externalRef: string | null;
  description: string;
  /** Signed decimal string: money in positive, money out negative. */
  amount: string;
  currencyCode: string;
  status: 'unmatched' | 'matched' | 'excluded';
  excludedReason: string | null;
  match: {
    journalLineId: string;
    method: 'auto' | 'manual';
    entryNumber: string;
    postingDate: string;
    description: string | null;
  } | null;
}

export interface LedgerLine {
  id: string;
  entryNumber: string;
  postingDate: string;
  description: string | null;
  amount: string;
  reversal: boolean;
}

export interface ReconReport {
  asOf: string;
  statementClosingBalance: string;
  statementClosingSource: 'sum_of_imported_lines' | 'entered';
  ledgerBalance: string;
  ledgerItemsNotOnStatement: string;
  statementItemsNotInLedger: string;
  adjustedBankBalance: string;
  adjustedBookBalance: string;
  difference: string;
  reconciled: boolean;
}

export interface ImportLine {
  postedAt: string;
  externalRef?: string;
  description: string;
  amount: string;
}

const KEY = ['bank-reconciliation'];
const err = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Request failed';

export function useBankAccountsForRecon() {
  return useQuery({
    queryKey: ['bank-accounts', 'recon'],
    queryFn: async () =>
      (await api.get<PaginatedResult<BankAccountRow>>('/bank-accounts', { params: { pageSize: 100 } })).data,
  });
}

export function useStatementLines(bankAccountId?: string) {
  return useQuery({
    queryKey: [...KEY, 'lines', bankAccountId],
    enabled: !!bankAccountId,
    queryFn: async () =>
      (await api.get<StatementLine[]>('/bank-reconciliation/lines', { params: { bankAccountId } })).data,
  });
}

export function useOpenLedgerLines(bankAccountId?: string) {
  return useQuery({
    queryKey: [...KEY, 'ledger', bankAccountId],
    enabled: !!bankAccountId,
    queryFn: async () =>
      (await api.get<LedgerLine[]>('/bank-reconciliation/ledger-lines', { params: { bankAccountId } })).data,
  });
}

export function useReconReport(bankAccountId: string | undefined, asOf: string, closing: string) {
  return useQuery({
    queryKey: [...KEY, 'report', bankAccountId, asOf, closing],
    enabled: !!bankAccountId && !!asOf,
    queryFn: async () =>
      (
        await api.get<ReconReport>('/bank-reconciliation/report', {
          params: { bankAccountId, asOf, statementClosingBalance: closing || undefined },
        })
      ).data,
  });
}

function useReconMutation<TVars>(fn: (v: TVars) => Promise<any>, success: (r: any) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: KEY });
      notify.success(success(r));
    },
    onError: (e: any) => notify.error('Failed', err(e)),
  });
}

export function useImportStatement() {
  return useReconMutation(
    async (v: { bankAccountId: string; lines: ImportLine[] }) =>
      (await api.post('/bank-reconciliation/import', v)).data,
    (r) => `Imported ${r.imported} line(s)${r.skipped ? `, ${r.skipped} already imported` : ''}`,
  );
}

export function useAutoMatch() {
  return useReconMutation(
    async (v: { bankAccountId: string; dateToleranceDays?: number }) =>
      (await api.post('/bank-reconciliation/match', v)).data,
    (r) => `Matched ${r.matched}; ${r.ambiguous} need a person to choose`,
  );
}

export function useManualMatch() {
  return useReconMutation(
    async (v: { lineId: string; journalLineId: string }) =>
      (await api.post(`/bank-reconciliation/lines/${v.lineId}/match`, { journalLineId: v.journalLineId })).data,
    () => 'Line matched',
  );
}

export function useUnmatch() {
  return useReconMutation(
    async (v: { lineId: string; reason?: string }) =>
      (await api.post(`/bank-reconciliation/lines/${v.lineId}/unmatch`, { reason: v.reason })).data,
    () => 'Line released',
  );
}

export function useExcludeLine() {
  return useReconMutation(
    async (v: { lineId: string; reason: string }) =>
      (await api.post(`/bank-reconciliation/lines/${v.lineId}/exclude`, { reason: v.reason })).data,
    () => 'Line excluded',
  );
}

/** Split one CSV record, honouring double-quoted fields. */
function splitCsv(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Keep digits, sign and the decimal point: "1,250,000.00" → "1250000.00". */
function money(raw: string | undefined): string {
  const s = (raw ?? '').replace(/[^\d.-]/g, '');
  return s === '' || s === '-' ? '' : s;
}

/**
 * Parse a bank CSV export. Needs a header row with a date column and either an
 * `amount` column (signed) or `debit` / `credit` (money out / money in)
 * columns; `description`/`narration`/`details` and `reference`/`ref` are
 * optional. Returns lines plus the rows it could not read.
 */
export function parseStatementCsv(text: string): { lines: ImportLine[]; errors: string[] } {
  const rows = text.split(/\r?\n/).filter((r) => r.trim() !== '');
  if (rows.length < 2) return { lines: [], errors: ['The file needs a header row and at least one line'] };
  const header = splitCsv(rows[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iDate = col('date', 'posted', 'value date');
  const iDesc = col('description', 'narration', 'details', 'particulars');
  const iRef = col('reference', 'ref');
  const iAmt = header.findIndex((h) => h === 'amount');
  const iDebit = col('debit', 'withdrawal', 'money out');
  const iCredit = col('credit', 'deposit', 'money in');
  const errors: string[] = [];
  if (iDate < 0) errors.push('No date column found');
  if (iAmt < 0 && (iDebit < 0 || iCredit < 0)) errors.push('Need an "amount" column, or "debit" and "credit" columns');
  if (errors.length) return { lines: [], errors };

  const lines: ImportLine[] = [];
  rows.slice(1).forEach((row, n) => {
    const c = splitCsv(row);
    const d = new Date(c[iDate]);
    if (Number.isNaN(d.getTime())) return errors.push(`Row ${n + 2}: unreadable date "${c[iDate]}"`);
    let amount = '';
    if (iAmt >= 0) amount = money(c[iAmt]);
    else {
      const out = money(c[iDebit]);
      const inn = money(c[iCredit]);
      if (inn && Number(inn) !== 0) amount = inn.replace(/^-/, '');
      else if (out && Number(out) !== 0) amount = `-${out.replace(/^-/, '')}`;
    }
    if (!amount || Number(amount) === 0) return errors.push(`Row ${n + 2}: no amount`);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    lines.push({
      postedAt: `${y}-${m}-${day}`,
      description: (iDesc >= 0 ? c[iDesc] : '') || 'Bank statement line',
      externalRef: iRef >= 0 && c[iRef] ? c[iRef] : undefined,
      amount,
    });
  });
  return { lines, errors };
}
