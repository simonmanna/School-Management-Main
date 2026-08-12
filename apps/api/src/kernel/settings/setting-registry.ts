/**
 * Setting registry — the single source of truth for configurable settings.
 *
 * Each definition declares the value type, a code-side default, which scope
 * levels it may be set at, and whether it cascades. The resolver
 * (SettingResolverService) reads this to validate writes and to fall back to a
 * default when no override exists at any level. Historically keys were bare
 * string literals scattered across services; new code should reference
 * SETTING_KEYS / getSettingDefinition instead.
 *
 * Scope precedence (most specific first): product -> category -> warehouse ->
 * organization -> registry default.
 */

export type ScopeType = 'organization' | 'warehouse' | 'category' | 'product';

export const SCOPE_PRECEDENCE: ScopeType[] = ['product', 'category', 'warehouse', 'organization'];

export type SettingType = 'bool' | 'enum' | 'string' | 'number' | 'json';

export type SettingGroup = 'inventory' | 'accounting' | 'rental' | 'purchasing';

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  type: SettingType;
  /** Human label for the admin UI. */
  label: string;
  description?: string;
  /** Value returned when no override exists at any scope level. */
  default: unknown;
  /** Allowed values for `type: 'enum'`. */
  enumValues?: readonly string[];
  /**
   * Enum values that are declared (so they appear in the schema / UI and can be
   * enabled later) but MUST be rejected on write today, mapped to the reason.
   * Use for a policy option whose implementation is not yet safe to select.
   */
  unavailableEnumValues?: Readonly<Record<string, string>>;
  /** Whether the value may be overridden below the organization level. */
  cascades: boolean;
  /** Scope levels this key may be set at (org is always allowed). */
  scopeLevels: readonly ScopeType[];
  /**
   * Superseded key. Still readable and writable so existing API clients do not
   * 404, but hidden from the admin UI and ignored by the engine. The
   * description says what replaced it.
   */
  deprecated?: boolean;
}

const ALL_LEVELS: readonly ScopeType[] = ['organization', 'warehouse', 'category', 'product'];
const ORG_ONLY: readonly ScopeType[] = ['organization'];

/**
 * Registered settings. Legacy `inventory.default*` keys keep their exact names
 * so existing rows and the current /settings/inventory-defaults UI keep working;
 * they simply gain cascade behaviour through the resolver.
 */
export const SETTING_DEFINITIONS = {
  // ---- Inventory ----------------------------------------------------------
  // Only enforced settings are registered — a key appears here once code honours
  // it, so the admin UI never shows an inert toggle. Later phases add more.
  'inventory.allowNegativeStock': {
    key: 'inventory.allowNegativeStock',
    group: 'inventory',
    type: 'bool',
    label: 'Allow Negative Stock',
    // Owner rule: a sale must never be blocked. Default stays permissive; set to
    // false per product/category/warehouse to enforce Product.stockPolicy.
    description:
      'When off, stock-out enforcement follows the item stock policy. Default keeps sales unblocked.',
    default: true,
    cascades: true,
    scopeLevels: ALL_LEVELS,
  },
  'inventory.defaultPickingStrategy': {
    key: 'inventory.defaultPickingStrategy',
    group: 'inventory',
    type: 'enum',
    label: 'Removal Strategy',
    description:
      'Overrides the product removal strategy for the chosen scope at issue time. Product column is the fallback.',
    default: 'FEFO',
    enumValues: ['FEFO', 'FIFO', 'MANUAL', 'SERIAL'],
    cascades: true,
    scopeLevels: ALL_LEVELS,
  },
  // New-product inheritance defaults (applied on product create, organization
  // level only — runtime uses the product's own column).
  'inventory.defaultCostingMethod': {
    key: 'inventory.defaultCostingMethod',
    group: 'inventory',
    type: 'enum',
    label: 'Default Costing Method (new products)',
    default: 'AVCO',
    enumValues: ['AVCO', 'FIFO', 'STANDARD', 'SPECIFIC'],
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.defaultBatchTracking': {
    key: 'inventory.defaultBatchTracking',
    group: 'inventory',
    type: 'bool',
    label: 'Default Batch Tracking (new products)',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.defaultExpiryTracking': {
    key: 'inventory.defaultExpiryTracking',
    group: 'inventory',
    type: 'bool',
    label: 'Default Expiry Tracking (new products)',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.defaultSerialTracking': {
    key: 'inventory.defaultSerialTracking',
    group: 'inventory',
    type: 'bool',
    label: 'Default Serial Tracking (new products)',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.reservationMode': {
    key: 'inventory.reservationMode',
    group: 'inventory',
    type: 'enum',
    label: 'Stock Reservation',
    description:
      'Reserve stock (available-to-promise) when a sales order or invoice is raised. Released on cancel/void.',
    default: 'none',
    enumValues: ['none', 'order', 'invoice'],
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.stockPostingTiming': {
    key: 'inventory.stockPostingTiming',
    group: 'inventory',
    type: 'enum',
    label: 'Stock Deduction Timing',
    // WHEN inventory leaves the books. Different industries answer differently:
    // a restaurant consumes ingredients when cooking starts, a shop when the
    // customer pays, a warehouse when goods ship. Rather than hardcode one point,
    // the inventory posting subscriber reacts to the business event named by this
    // policy. Default `at_invoice` keeps the café's existing behaviour exactly.
    //
    // `at_fulfillment_start` is intentionally in the enum but rejected by
    // `coerceSettingValue` below: deducting at kitchen-fire has no reversal path
    // for a cancel-before-invoice order (refund/void reverses via the invoice),
    // so selecting it would strand stock. Enabled once that reversal exists.
    description:
      'When stock is deducted for a sale: at invoice (default), when fulfillment completes (e.g. all kitchen tickets served / goods dispatched), at payment, or manually. "At fulfillment start" is not yet available.',
    default: 'at_invoice',
    enumValues: [
      'at_confirmation',
      'at_fulfillment_start',
      'at_fulfillment_complete',
      'at_invoice',
      'at_payment',
      'manual',
    ],
    unavailableEnumValues: {
      at_fulfillment_start:
        'deducting at fulfillment start has no reversal path for an order cancelled before it is invoiced; enable once cancel-before-invoice stock reversal exists',
    },
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.batchAutoNumber': {
    key: 'inventory.batchAutoNumber',
    group: 'inventory',
    type: 'bool',
    label: 'Auto-generate Batch Numbers',
    description: 'When a batch-tracked receipt omits a batch number, generate one from the format below.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'inventory.batchNumberFormat': {
    key: 'inventory.batchNumberFormat',
    group: 'inventory',
    type: 'string',
    label: 'Batch Number Format',
    description: 'Tokens: YYYY MM DD and #### (sequence). Example: YYYYMMDD-####',
    default: 'YYYYMMDD-####',
    cascades: false,
    scopeLevels: ORG_ONLY,
  },

  // ---- Accounting ---------------------------------------------------------
  'accounting.fiscalYearStartMonth': {
    key: 'accounting.fiscalYearStartMonth',
    group: 'accounting',
    type: 'number',
    label: 'Fiscal Year Start Month',
    description: '1 = January … 12 = December. Used when generating fiscal periods.',
    default: 1,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'accounting.incomeAccountId': {
    key: 'accounting.incomeAccountId',
    group: 'accounting',
    type: 'string',
    label: 'Default Income Account',
    description: 'DEPRECATED — the posting engine never read this key. Account determination uses the AccountMapping key `sales_revenue`.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
    deprecated: true,
  },
  'accounting.expenseAccountId': {
    key: 'accounting.expenseAccountId',
    group: 'accounting',
    type: 'string',
    label: 'Default Expense Account',
    description: 'DEPRECATED — the posting engine never read this key. Account determination uses the AccountMapping key `default_expense`.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
    deprecated: true,
  },
  'accounting.defaultSalesTaxId': {
    key: 'accounting.defaultSalesTaxId',
    group: 'accounting',
    type: 'string',
    label: 'Default Sales Tax',
    description: 'Default tax applied to sales transactions.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'accounting.exchangeDifferenceJournalId': {
    key: 'accounting.exchangeDifferenceJournalId',
    group: 'accounting',
    type: 'string',
    label: 'Exchange Difference Journal',
    description: 'Journal used for recording exchange rate differences.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'accounting.defaultSalesJournalId': {
    key: 'accounting.defaultSalesJournalId',
    group: 'accounting',
    type: 'string',
    label: 'Default Sales Journal',
    description: 'Journal used by default for customer invoice / sales journal entries when the invoice does not pick a specific journal.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'accounting.exchangeGainAccountId': {
    key: 'accounting.exchangeGainAccountId',
    group: 'accounting',
    type: 'string',
    label: 'Exchange Gain Account',
    description: 'DEPRECATED — the posting engine never read this key. FX posting uses the AccountMapping key `fx_gain`.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
    deprecated: true,
  },
  'accounting.exchangeLossAccountId': {
    key: 'accounting.exchangeLossAccountId',
    group: 'accounting',
    type: 'string',
    label: 'Exchange Loss Account',
    description: 'DEPRECATED — the posting engine never read this key. FX posting uses the AccountMapping key `fx_loss`.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
    deprecated: true,
  },
  'accounting.productIncomeAccountId': {
    key: 'accounting.productIncomeAccountId',
    group: 'accounting',
    type: 'string',
    label: 'Product Income Account',
    description: 'DEPRECATED — the posting engine never read this key. Account determination uses the product category incomeAccountId, then the AccountMapping key `sales_revenue`.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
    deprecated: true,
  },
  'accounting.productExpenseAccountId': {
    key: 'accounting.productExpenseAccountId',
    group: 'accounting',
    type: 'string',
    label: 'Product Expense Account',
    description: 'DEPRECATED — the posting engine never read this key. Account determination uses the product category expenseAccountId, then the AccountMapping key `default_expense`.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
    deprecated: true,
  },
  'accounting.allCurrencyCodes': {
    key: 'accounting.allCurrencyCodes',
    group: 'accounting',
    type: 'json',
    label: 'Enabled Currencies',
    description: 'List of currency codes enabled for this organization.',
    default: [],
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  // Which location the till sells stock from. Empty → first active warehouse
  // (legacy behaviour). Set to a bakery/front-counter location so production
  // output and POS reads agree. Grouped under 'inventory' since SettingGroup is
  // intentionally kept to inventory|accounting (see the manufacturing plan).
  'pos.stockLocationId': {
    key: 'pos.stockLocationId',
    group: 'inventory',
    type: 'string',
    label: 'POS Stock Location',
    description: 'Location the POS sells stock from. Blank = first active warehouse.',
    default: '',
    cascades: false,
    scopeLevels: ORG_ONLY,
  },

  // ---- Rental Management --------------------------------------------------
  'rental.autoHoldMinutes': {
    key: 'rental.autoHoldMinutes',
    group: 'rental',
    type: 'number',
    label: 'Reservation Hold (minutes)',
    description: 'How long a reservation hold stays valid before the cron worker expires it.',
    default: 60,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'rental.cleaningTurnaroundDays': {
    key: 'rental.cleaningTurnaroundDays',
    group: 'rental',
    type: 'number',
    label: 'Cleaning Turnaround (days)',
    description: 'Default buffer between a return and the unit being available again.',
    default: 1,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'rental.lateFeePerDay': {
    key: 'rental.lateFeePerDay',
    group: 'rental',
    type: 'number',
    label: 'Late Fee per Day (IDR)',
    description: 'Default daily late fee charged at settlement. Per-product rentalLateFeePerPeriod overrides.',
    default: 0,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'rental.dispositionPolicy': {
    key: 'rental.dispositionPolicy',
    group: 'rental',
    type: 'json',
    label: 'Disposition Policy',
    description: 'JSON array of DispositionRule: inspection outcome → next unit state.',
    default: [],
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'rental.depositPolicy': {
    key: 'rental.depositPolicy',
    group: 'rental',
    type: 'json',
    label: 'Deposit Policy',
    description: 'JSON: { mode: fixed|percent|replacement, percent, fixedAmount }. Fallback: 10% of replacement cost.',
    default: { mode: 'percent', percent: 10 },
    cascades: false,
    scopeLevels: ORG_ONLY,
  },

  // ---- Purchase Configuration --------------------------------------------
  'purchasing.editProductPriceFromPurchaseScreen': {
    key: 'purchasing.editProductPriceFromPurchaseScreen',
    group: 'purchasing',
    type: 'bool',
    label: 'Enable editing product price from purchase screen',
    description: 'Allow the unit cost / price to be edited directly on the purchase (receive) screen.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'purchasing.enablePurchaseStatus': {
    key: 'purchasing.enablePurchaseStatus',
    group: 'purchasing',
    type: 'bool',
    label: 'Enable Purchase Status',
    description: 'Track lifecycle status (draft / ordered / received / billed) on purchases.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'purchasing.enableLotBatchOnPurchase': {
    key: 'purchasing.enableLotBatchOnPurchase',
    group: 'purchasing',
    type: 'bool',
    label: 'Enable lot / batch number on purchases',
    description: 'Require or allow a lot / batch number when receiving purchased stock.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'purchasing.enablePurchaseOrder': {
    key: 'purchasing.enablePurchaseOrder',
    group: 'purchasing',
    type: 'bool',
    label: 'Enable Purchase Order',
    description: 'Allow creating purchase orders that are received into stock.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'purchasing.enablePurchaseRequisition': {
    key: 'purchasing.enablePurchaseRequisition',
    group: 'purchasing',
    type: 'bool',
    label: 'Enable Purchase Requisition',
    description: 'Allow raising internal purchase requisitions before a purchase order.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'purchasing.enableReceiptReminder': {
    key: 'purchasing.enableReceiptReminder',
    group: 'purchasing',
    type: 'bool',
    label: 'Receipt Reminder',
    description: 'Enable reminders for expected receipt dates on purchases.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
  'purchasing.autoRemindReceiptToVendors': {
    key: 'purchasing.autoRemindReceiptToVendors',
    group: 'purchasing',
    type: 'bool',
    label: 'Automatically remind the receipt date to your vendors',
    description: 'Send automatic receipt-date reminders to vendors when enabled.',
    default: false,
    cascades: false,
    scopeLevels: ORG_ONLY,
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

/** Typed key constants to replace scattered string literals. */
export const SETTING_KEYS = Object.freeze(
  Object.fromEntries(Object.keys(SETTING_DEFINITIONS).map((k) => [k, k])),
) as { readonly [K in SettingKey]: K };

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return (SETTING_DEFINITIONS as Record<string, SettingDefinition>)[key];
}

export function settingsForGroup(group: SettingGroup): SettingDefinition[] {
  return Object.values(SETTING_DEFINITIONS as Record<string, SettingDefinition>).filter(
    (d) => d.group === group,
  );
}

/**
 * Validate and normalise a raw value against its definition. Throws Error with a
 * human message on mismatch. Returns the coerced value to store as JSON.
 */
export function coerceSettingValue(def: SettingDefinition, raw: unknown): unknown {
  switch (def.type) {
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error(`Setting '${def.key}' expects a boolean.`);
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Setting '${def.key}' expects a number.`);
      return n;
    }
    case 'enum': {
      const s = String(raw);
      if (!def.enumValues?.includes(s)) {
        throw new Error(`Setting '${def.key}' must be one of: ${def.enumValues?.join(', ')}.`);
      }
      const unavailable = def.unavailableEnumValues?.[s];
      if (unavailable) {
        throw new Error(`Setting '${def.key}' value '${s}' is not available yet: ${unavailable}`);
      }
      return s;
    }
    case 'string':
      return String(raw);
    case 'json':
      return raw;
    default:
      return raw;
  }
}

/** Assert a scope level is permitted for a key. Throws Error otherwise. */
export function assertScopeAllowed(def: SettingDefinition, scopeType: ScopeType): void {
  if (scopeType === 'organization') return;
  if (!def.cascades || !def.scopeLevels.includes(scopeType)) {
    throw new Error(`Setting '${def.key}' cannot be set at ${scopeType} level.`);
  }
}
