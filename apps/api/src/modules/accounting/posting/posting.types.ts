/**
 * The contract every module uses to post to the ledger (ADR-009).
 * Modules NEVER create JournalEntry rows directly — they build a PostingRequest
 * (typically via AccountDeterminationService) and call PostingService.post().
 */
/**
 * Journal-entry statuses that affect account balances. A reversal posts a NEW
 * `posted` entry AND flips the original to `reversed`; BOTH must be summed so
 * the pair nets to zero. Summing only `posted` would leave the reversal alone,
 * flipping the sign of the original transaction (see accounting audit C1).
 * `draft` entries are intentionally excluded — they are not yet in the books.
 */
export const BALANCE_AFFECTING_STATUSES = ['posted', 'reversed'] as const;

/**
 * Journal-entry filter that leaves out the period-closing journal — the closing
 * entry AND the reversal a reopen posts into the same journal. Performance
 * statements (P&L, revenue/expense analysis, ratios, KPIs) read activity before
 * closing; including the closing entry made every closed period report zero
 * profit (wave 19). Balance views — trial balance, balance sheet, ledgers —
 * keep the closing entries.
 */
export const EXCLUDE_CLOSING_JOURNAL = { journal: { journalType: { not: 'closing' as const } } };

/**
 * `sourceType` values a person creates through the journal-entry screens. Every
 * other source posted the entry on behalf of a document (fee invoice, bill,
 * payment, payroll…) and is corrected from that document, never from the GL.
 */
export const MANUAL_SOURCE_TYPES: ReadonlyArray<string | null> = [null, 'manual', 'opening_balance'];

/**
 * Accounts whose balance a sub-ledger owns (pupil/customer receivables, supplier
 * payables, stock). A manual journal on one of them puts the GL out of step with
 * the sub-ledger the tie-out compares it to.
 */
export const SUBLEDGER_CONTROL_TYPES = ['ar', 'ap', 'inventory'] as const;
export const SUBLEDGER_CONTROL_MAPPING_KEYS = [
  'accounts_receivable',
  'accounts_payable',
  'inventory',
  'stock_valuation',
] as const;

export interface PostingLineInput {
  accountId: string;
  /** Transaction-currency amount. Exactly one of debit/credit must be > 0. */
  debit?: number | string;
  credit?: number | string;
  partnerId?: string;
  description?: string;
  /** Reporting dimensions; fall back to the request-level values when omitted. */
  branchId?: string;
  costCenterId?: string;
  /** Extensible financial dimensions for this line; falls back to the request-level bag. */
  dimensions?: Record<string, string | number | boolean>;
}

export interface PostingRequest {
  /** Journal code, e.g. "SALES", "CASH", "BANK", "GEN". */
  journalCode: string;
  date: Date | string;
  description?: string;
  currencyId?: string;
  /** Rate to the org functional currency. Default 1. */
  exchangeRate?: number;
  /** Provenance, e.g. sourceType="invoice", sourceId=<documentId>. */
  sourceType?: string;
  sourceId?: string;
  /** Classifies this posting for its source: "primary" (default), "reversal", "partial_refund", … */
  postingType?: string;
  /**
   * GL-layer idempotency token. When provided, PostingService returns the
   * already-posted entry with this key instead of writing a duplicate. Omit for
   * postings that may legitimately recur for one source (e.g. partial refunds).
   */
  postingKey?: string;
  /** Reporting dimensions applied to the entry and, by default, every line. */
  branchId?: string;
  costCenterId?: string;
  /**
   * Extensible financial dimensions applied to the entry and, by default, every
   * line (generic segmentation without a column per dimension). Flat map of
   * primitive values, e.g. { cashierId, cashSessionId, registerId, campus, term }.
   */
  dimensions?: Record<string, string | number | boolean>;
  lines: PostingLineInput[];
}

/** Documents may implement this to describe how they post. */
export interface Postable {
  toPostingRequest(): PostingRequest | Promise<PostingRequest>;
}
