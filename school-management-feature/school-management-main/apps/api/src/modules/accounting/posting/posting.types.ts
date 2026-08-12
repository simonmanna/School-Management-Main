/**
 * The contract every module uses to post to the ledger (ADR-009).
 * Modules NEVER create JournalEntry rows directly — they build a PostingRequest
 * (typically via AccountDeterminationService) and call PostingService.post().
 */
export interface PostingLineInput {
  accountId: string;
  /** Transaction-currency amount. Exactly one of debit/credit must be > 0. */
  debit?: number | string;
  credit?: number | string;
  partnerId?: string;
  description?: string;
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
  lines: PostingLineInput[];
}

/** Documents may implement this to describe how they post. */
export interface Postable {
  toPostingRequest(): PostingRequest | Promise<PostingRequest>;
}
