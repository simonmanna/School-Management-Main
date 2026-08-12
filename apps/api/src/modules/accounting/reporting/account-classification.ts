import { Prisma } from '@prisma/client';
import {
  REPORT_SECTION_BY_KEY,
  REPORT_SECTION_DEFS,
  type AccountClassification,
  type CashFlowClass,
  type ReportSection,
} from '@erp/shared';
import type { AccountMeta } from '../posting/account-resolver.service';

/**
 * The one place statement structure is decided.
 *
 * Every financial report used to carry its own hardcoded `accountType` array —
 * six copies across five services, two of them byte-identical, and all six
 * branching on a `contra_revenue` value that was not a member of the enum and
 * therefore could never match. Section membership, sign and cash-flow class now
 * all derive from the account's category.
 */

export const ZERO = new Prisma.Decimal(0);

export { REPORT_SECTION_DEFS, REPORT_SECTION_BY_KEY };

/** Balance-sheet sections, in statement order. */
export const BALANCE_SHEET_SECTIONS = REPORT_SECTION_DEFS.filter((s) => s.side !== null);

/** P&L sections, in statement order. */
export const PNL_SECTIONS = REPORT_SECTION_DEFS.filter(
  (s) => s.side === null && s.key !== 'off_balance',
);

export function isProfitAndLoss(classification: AccountClassification | null): boolean {
  return classification === 'revenue' || classification === 'expense';
}

export function isBalanceSheet(classification: AccountClassification | null): boolean {
  return (
    classification === 'asset' || classification === 'liability' || classification === 'equity'
  );
}

export function reportSectionOf(meta: Pick<AccountMeta, 'reportSection'>): ReportSection | null {
  return meta.reportSection;
}

/** Which side of the balance sheet a section sits on, or null for P&L sections. */
export function balanceSheetSideOf(
  section: ReportSection | null,
): 'asset' | 'liability' | 'equity' | null {
  if (!section) return null;
  return REPORT_SECTION_BY_KEY[section]?.side ?? null;
}

/**
 * Present a raw ledger net (debit − credit) the way a statement reader expects:
 * debit-normal accounts positive when debited, credit-normal accounts positive
 * when credited. Contra accounts are already handled, because a contra category
 * carries the opposite normal balance of its classification.
 */
export function displayBalance(
  net: Prisma.Decimal,
  meta: Pick<AccountMeta, 'normalBalance'>,
): Prisma.Decimal {
  return meta.normalBalance === 'credit' ? net.negated() : net;
}

/**
 * Cash-flow section. Revenue and expense accounts are always operating;
 * everything else uses the account override, then the category default.
 */
export function cashFlowSectionOf(
  meta: Pick<AccountMeta, 'classification' | 'cashFlowClass'>,
): 'operating' | 'investing' | 'financing' {
  if (isProfitAndLoss(meta.classification)) return 'operating';
  const c: CashFlowClass = meta.cashFlowClass;
  if (c === 'investing' || c === 'financing') return c;
  return 'operating';
}

export interface RollupNode<T> {
  node: T;
  children: RollupNode<T>[];
  /** This account's own balance. Always zero for group accounts. */
  ownBalance: Prisma.Decimal;
  /** ownBalance + the subtotal of every descendant. */
  subtotal: Prisma.Decimal;
  level: number;
}

interface Rollupable {
  id: string;
  parentAccountId: string | null;
  sortOrder?: number;
  code: string;
}

/**
 * Build the account forest and compute post-order subtotals:
 * `subtotal = ownBalance + Σ children.subtotal`.
 *
 * Group accounts cannot be posted to, so their ownBalance is always zero and
 * their subtotal is a pure roll-up of the accounts beneath them.
 */
export function rollupTree<T extends Rollupable>(
  nodes: T[],
  balanceOf: (node: T) => Prisma.Decimal,
): RollupNode<T>[] {
  const byId = new Map<string, RollupNode<T>>();
  for (const n of nodes) {
    byId.set(n.id, {
      node: n,
      children: [],
      ownBalance: balanceOf(n),
      subtotal: ZERO,
      level: 0,
    });
  }

  const roots: RollupNode<T>[] = [];
  for (const entry of byId.values()) {
    const parentId = entry.node.parentAccountId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }

  const sortFn = (a: RollupNode<T>, b: RollupNode<T>): number =>
    (a.node.sortOrder ?? 0) - (b.node.sortOrder ?? 0) || a.node.code.localeCompare(b.node.code);

  // Post-order DFS, iterative so a pathological tree cannot blow the stack.
  // A depth cap defends against a cycle that slipped past the service guards.
  const MAX_DEPTH = 32;
  const visit = (entry: RollupNode<T>, level: number): Prisma.Decimal => {
    entry.level = level;
    entry.children.sort(sortFn);
    let total = entry.ownBalance;
    if (level < MAX_DEPTH) {
      for (const child of entry.children) total = total.plus(visit(child, level + 1));
    }
    entry.subtotal = total;
    return total;
  };

  roots.sort(sortFn);
  for (const root of roots) visit(root, 0);
  return roots;
}

/** Flatten a rollup forest depth-first, preserving statement order. */
export function flattenRollup<T>(roots: RollupNode<T>[]): RollupNode<T>[] {
  const out: RollupNode<T>[] = [];
  const walk = (n: RollupNode<T>): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}
