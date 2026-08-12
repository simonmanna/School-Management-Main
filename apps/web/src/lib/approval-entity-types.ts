/**
 * Human labels for the approval engine's entityTypes — the document types that
 * can be gated behind an approval workflow. Shared by the workflow builder and
 * the legacy policy page.
 */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  purchase_order: 'Purchase Orders',
  goods_receipt: 'Goods Receipts',
  credit_note: 'Credit Notes',
  invoice_cancel: 'Invoice Cancel',
  supplier_payment: 'Supplier Payments',
  asset_acquisition: 'Asset Acquisition',
  asset_disposal: 'Asset Disposal',
  asset_transfer: 'Asset Transfer',
  asset_revaluation: 'Asset Revaluation',
  inventory_count_submit: 'Inventory Count Submit',
  vendor_bill: 'Vendor Bills',
  // F.5b — newly gated flows
  expense: 'Expenses',
  stock_out: 'Stock-Out',
  waste: 'Waste',
  debit_note: 'Debit Notes',
  depreciation_run: 'Depreciation',
  pos_discount: 'POS Discount Override',
  pos_refund: 'POS Refund Override',
  // Rental — agreement approval (trip when score < min, over credit limit,
  // or the customer has an open overdue agreement).
  rental_agreement: 'Rental Agreements',
};

export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}
