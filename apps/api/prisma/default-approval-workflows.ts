/**
 * Default approval workflows — shared by `seed.ts` (new orgs) and
 * `backfill-default-approval-workflows.ts` (existing orgs).
 *
 * Without at least one matching `ApprovalWorkflow`, `ApprovalsService`
 * auto-approves everything (`requestApproval` returns null), so every approval
 * gate in the system is inert. These defaults turn the engine on.
 *
 * Two deliberate safety properties:
 *
 * 1. **Thresholds, not blanket gates.** `resolveWorkflow` only matches when
 *    `amount >= minAmount`, so day-to-day work stays untouched and only
 *    big-ticket documents get routed.
 *
 *    **`amount` is NOT always money.** Each call site decides what it puts in
 *    `snapshot.amount`, and the unit differs per entity type — a threshold in
 *    the wrong unit silently never fires, leaving the gate inert. As of now:
 *
 *    | entityType         | `snapshot.amount` is            | call site |
 *    |--------------------|---------------------------------|-----------|
 *    | `stock_out`        | money (`doc.totalValue`)        | `stock-doc.service.ts:111` |
 *    | `waste`            | money (`doc.totalValue`)        | `stock-doc.service.ts:208` |
 *    | `stock_adjustment` | **quantity** (Σ\|qtyDiff\|)      | `stock-doc.service.ts:315` |
 *    | `stock_transfer`   | **quantity** (Σ\|qty\|)          | `stock-doc.service.ts:403` |
 *    | `expense`          | money (`dto.amount`)            | `expenses.service.ts:362` |
 *    | `purchase_order`   | money (order total)             | `purchase-orders.service.ts:126` |
 *    | `debit_note`       | money (Σ line subtotal)         | `debit-notes.service.ts:149` |
 *    | `invoice_cancel`   | **absent** — snapshot is `{}`   | `invoice.service.ts:240` |
 *    | `credit_note`      | **absent** — snapshot is `{}`   | `credit-note.service.ts:68` |
 *
 *    Where the amount is absent, `amountOf` yields 0, so ONLY a catch-all
 *    (`minAmount: null`) can ever match — such a gate is all-or-nothing until
 *    the call site starts passing an amount.
 *
 *    Money amounts are in the organization's own currency (UGX for the demo
 *    org) — retune per deployment.
 *
 * 2. **Only workflows with a realistic second approver ship active.** An
 *    approver may not approve their own request (segregation of duties), so a
 *    gate whose only approver is the person raising the document would
 *    deadlock. Inventory documents ship active because both Supervisor and
 *    Administrator hold `inventory_doc:approve`. The finance gates ship
 *    `isActive: false` — pre-built and one toggle away in the Approval
 *    Workflows page, once the deployment has a second finance approver.
 *
 * The two POS entries are a special case: POS overrides are authorized
 * synchronously by manager PIN and recorded via
 * `ApprovalsService.recordSynchronousOverride`, which never blocks a sale.
 * They ship active and bandless purely so every till override is attributed to
 * a workflow in the approval ledger.
 */

export interface ApprovalStepDef {
  stepOrder: number;
  name: string;
  approverPermissions: string[];
  requiredCount?: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface ApprovalWorkflowDef {
  entityType: string;
  name: string;
  minAmount: number | null;
  isActive: boolean;
  steps: ApprovalStepDef[];
}

export const DEFAULT_APPROVAL_WORKFLOWS: ApprovalWorkflowDef[] = [
  // -- POS: ledger attribution only, never blocks a sale ---------------------
  {
    entityType: 'pos_discount',
    name: 'POS discount override',
    minAmount: null,
    isActive: true,
    steps: [{ stepOrder: 1, name: 'Manager PIN', approverPermissions: ['pos:discount', 'pos:override'] }],
  },
  {
    entityType: 'pos_refund',
    name: 'POS refund override',
    minAmount: null,
    isActive: true,
    steps: [{ stepOrder: 1, name: 'Manager PIN', approverPermissions: ['pos:refund', 'pos:override'] }],
  },

  // -- Inventory: Supervisor and Administrator both hold the approver perm ---
  // Quantity-based: the gate sees Σ|qtyDiff| across the adjustment's lines, so
  // this is "50 units of total variance", not 50 shillings.
  {
    entityType: 'stock_adjustment',
    name: 'Stock adjustment over 50 units of variance',
    minAmount: 50,
    isActive: true,
    steps: [{ stepOrder: 1, name: 'Inventory approval', approverPermissions: ['inventory_doc:approve'] }],
  },
  {
    entityType: 'stock_out',
    name: 'Stock issue over 100,000',
    minAmount: 100_000,
    isActive: true,
    steps: [{ stepOrder: 1, name: 'Inventory approval', approverPermissions: ['inventory_doc:approve'] }],
  },
  {
    entityType: 'waste',
    name: 'Waste write-off over 100,000',
    minAmount: 100_000,
    isActive: true,
    steps: [{ stepOrder: 1, name: 'Inventory approval', approverPermissions: ['inventory_doc:approve'] }],
  },
  // Quantity-based, same as stock_adjustment: Σ|qty| moved, not a money value.
  {
    entityType: 'stock_transfer',
    name: 'Stock transfer over 100 units',
    minAmount: 100,
    isActive: true,
    steps: [{ stepOrder: 1, name: 'Inventory approval', approverPermissions: ['inventory_doc:approve'] }],
  },

  // -- Finance: pre-built, inactive until a second approver exists -----------
  // Two bands on one workflow: the second step only engages above 2,000,000,
  // which is the multi-step chain the engine is built for.
  {
    entityType: 'expense',
    name: 'Expense over 500,000',
    minAmount: 500_000,
    isActive: false,
    steps: [
      { stepOrder: 1, name: 'Manager', approverPermissions: ['expense:approve'] },
      { stepOrder: 2, name: 'Finance', approverPermissions: ['approvals:manage'], minAmount: 2_000_000 },
    ],
  },
  // `invoice.service.ts:240` passes `snapshot: {}`, so the engine sees amount 0.
  // A threshold here could never match — this gate is necessarily all-or-nothing
  // until that call site passes the invoice total.
  {
    entityType: 'invoice_cancel',
    name: 'Invoice cancellation (all)',
    minAmount: null,
    isActive: false,
    steps: [{ stepOrder: 1, name: 'Finance', approverPermissions: ['invoice:cancel', 'approvals:manage'] }],
  },
  // Same as invoice_cancel: `credit-note.service.ts:68` passes `snapshot: {}`.
  {
    entityType: 'credit_note',
    name: 'Credit note (all)',
    minAmount: null,
    isActive: false,
    steps: [{ stepOrder: 1, name: 'Finance', approverPermissions: ['credit_note:post', 'approvals:manage'] }],
  },
  {
    entityType: 'debit_note',
    name: 'Debit note over 200,000',
    minAmount: 200_000,
    isActive: false,
    steps: [{ stepOrder: 1, name: 'Finance', approverPermissions: ['debit_note:approve'] }],
  },
  {
    entityType: 'purchase_order',
    name: 'Purchase order over 1,000,000',
    minAmount: 1_000_000,
    isActive: false,
    steps: [{ stepOrder: 1, name: 'Procurement', approverPermissions: ['purchase_order:approve'] }],
  },
];

/**
 * Create any missing default workflow for `orgId`. Idempotent, and never
 * touches a workflow that already exists — an operator's retuning or
 * activation always wins over these defaults.
 *
 * `prisma` is a PrismaClient (typed loosely so this file can be imported by
 * both the seed and the standalone backfill script without a shared tsconfig).
 */
export async function applyDefaultApprovalWorkflows(
  prisma: any,
  orgId: string,
  opts: { apply?: boolean; log?: (msg: string) => void } = {},
): Promise<{ created: number; skipped: number }> {
  const apply = opts.apply !== false;
  const log = opts.log ?? (() => {});
  let created = 0;
  let skipped = 0;

  for (const def of DEFAULT_APPROVAL_WORKFLOWS) {
    const existing = await prisma.approvalWorkflow.findFirst({
      where: { organizationId: orgId, entityType: def.entityType, name: def.name },
    });
    if (existing) {
      skipped++;
      continue;
    }
    log(`+ ${def.entityType} — "${def.name}" (${def.isActive ? 'active' : 'inactive'})`);
    if (apply) {
      await prisma.approvalWorkflow.create({
        data: {
          organizationId: orgId,
          name: def.name,
          entityType: def.entityType,
          minAmount: def.minAmount,
          isActive: def.isActive,
          enforceDistinctApprovers: true,
          steps: {
            create: def.steps.map((s) => ({
              organizationId: orgId,
              stepOrder: s.stepOrder,
              name: s.name,
              approverPermissions: s.approverPermissions,
              requiredCount: s.requiredCount ?? 1,
              minAmount: s.minAmount ?? null,
              maxAmount: s.maxAmount ?? null,
            })),
          },
        },
      });
    }
    created++;
  }
  return { created, skipped };
}
