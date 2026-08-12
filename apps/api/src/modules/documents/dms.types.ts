/**
 * DMS — shared types, guard vocabulary and constants (Phase 1).
 * See docs/architecture/dms-architecture.md.
 */

/** Registry categories (fallback permission scopes, UI grouping). */
export const DMS_CATEGORIES = [
  'pos',
  'retail',
  'rental',
  'school',
  'finance',
  'procurement',
  'custom',
] as const;
export type DmsCategory = (typeof DMS_CATEGORIES)[number];

/** Lifecycle action names (G2: new actions are a core-engine change). */
export const DMS_ACTIONS = [
  'submit',
  'approve',
  'reject',
  'confirm',
  'issue',
  'activate',
  'expire',
  'revoke',
  'post',
  'pay',
  'close',
  'cancel',
  'reverse',
  'reissue', // Phase 6 — reversal-of-reversal
  'terminate',
  'archive',
  'amend',
] as const;
export type DmsAction = (typeof DMS_ACTIONS)[number];

/** Generic (non-lifecycle) permission actions. */
export const DMS_GENERIC_ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'print',
  'archive',
  'manage',
] as const;

/** System type codes (Phase 1 seed). */
export const DMS_TYPE_CODES = [
  'sales_invoice',
  'credit_note',
  'vendor_bill',
  'debit_note',
  'proforma_invoice',
  'pos_receipt',
  'delivery_note',
  'quotation',
  'rental_agreement',
  'rental_return',
  'rental_deposit',
  'rental_service_order',
  'school_fee_invoice',
  'school_receipt',
  'school_admission_letter',
  'school_certificate',
  'school_report_card',
] as const;
export type DmsTypeCode = (typeof DMS_TYPE_CODES)[number];

/**
 * Declarative guard vocabulary (G4) — THE whitelist. A new guard kind is a
 * core-engine change, not a seed change. Unknown keys are rejected at seed
 * time by validateGuardJson.
 */
export const GUARD_VOCABULARY = [
  'permission', // (R) reference — resolved at runtime from the type
  'requiresApproval', // (P) policy
  'requiresReason', // (P) policy
  'requiresPaid', // (P) policy
  'requiresSnapshot', // (P) policy
  'allowsAnyState', // (P) policy — audited admin override
] as const;

export interface GuardJson {
  permission?: string | null;
  requiresApproval?: boolean;
  requiresReason?: boolean;
  requiresPaid?: boolean;
  requiresSnapshot?: boolean;
  allowsAnyState?: boolean;
}

/** Policy shapes stored on DocumentTypeDef (classification C/P/R — §2.1). */
export interface ApprovalPolicy {
  requiresApproval?: boolean;
  workflowId?: string | null; // (R) ApprovalWorkflow
}

export interface PostingPolicy {
  /** none | accounting | inventory | fulfillment | mixed */
  behavior: 'none' | 'accounting' | 'inventory' | 'fulfillment' | 'mixed';
  journalHints?: string[];
}

export interface PaymentPolicy {
  requiresSettlement?: boolean;
}

export interface CancellationPolicy {
  reversable: boolean;
  needsReason: boolean;
}

export interface SnapshotPolicy {
  /** issue | post | amend — never 'print' by default (rev 2 review). */
  captureOn: Array<'issue' | 'post' | 'amend'>;
  snapshotOnPrint: boolean;
  keepRenderedFile: boolean;
}

/**
 * Snapshot capture reasons (DocumentSnapshot.reason).
 * 'print' only when the type opts in via snapshotPolicy.snapshotOnPrint.
 */
export const SNAPSHOT_REASONS = ['issue', 'post', 'amend', 'print', 'reverse'] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

/**
 * Document-owned editable content fields — the ONLY keys an `amend` payload
 * may carry (§3.7/§5.3). Anything else (domain fields like tenantBalance,
 * propertyStatus) is rejected on write. Financial docs are never versioned.
 */
export const AMENDABLE_FIELDS = ['terms', 'notes', 'clauses', 'conditions'] as const;

/** Template formats + engines (Phase 4.1, §3.5). */
export const TEMPLATE_FORMATS = ['a4', 'thermal', 'email', 'html', 'plain'] as const;
export const TEMPLATE_ENGINES = ['puppeteer', 'escpos', 'handlebars', 'plain'] as const;

export interface PrintProfile {
  formats: Array<'a4' | 'thermal' | 'email' | 'html' | 'plain'>;
  reprintable: boolean;
  maxCopies?: number;
}

export interface BusinessEffects {
  inventory?: boolean;
  notify?: boolean;
}

export interface SecurityInfo {
  /** Base permission resource (default 'document'). */
  basePermission?: string;
  /** doc | branch | org */
  visibility?: 'doc' | 'branch' | 'org';
  /** Phase 8 — opt-in POS workflow hooks (e.g. ['pos_inventory']). */
  workflowHooks?: string[];
}

export interface TypePolicy {
  code: string;
  name: string;
  description?: string;
  category: DmsCategory;
  isSystem?: boolean;
  /**(C) configuration */
  numberingKey?: string;
  numberingPrefix?: string;
  numberingPadding?: number;
  lifecycle: string;
  approvalPolicy?: ApprovalPolicy;
  postingPolicy?: PostingPolicy;
  paymentPolicy?: PaymentPolicy;
  cancellationPolicy?: CancellationPolicy;
  editPolicy?: 'EDITABLE' | 'VERSIONED' | 'IMMUTABLE_AFTER_ISSUE';
  snapshotPolicy?: SnapshotPolicy;
  printProfile?: PrintProfile;
  businessEffects?: BusinessEffects;
  security?: SecurityInfo;
  isFinancial?: boolean;
  isInventoryRelevant?: boolean;
  requiresPosting?: boolean;
}

export interface LifecycleSeed {
  code: string;
  name: string;
  description?: string;
  states: string[];
  initialState: string;
  transitions: Array<{ from: string; to: string; action: string; guard?: GuardJson }>;
}

export interface RelationTypeSeed {
  code: string;
  name: string;
  description?: string;
  direction?: 'out' | 'both';
  allowedSourceCategories?: string[];
  allowedTargetCategories?: string[];
  cardinality?: 'one' | 'many';
  inverseImplicit?: boolean;
  duplicatesAllowed?: boolean;
}

/** True when the transition keeps the document in the same state. */
export function isStay(from: string, to: string): boolean {
  return from === to;
}

/**
 * Reversal counterparts (§3.6) and reissue counterparts (Phase 6).
 */
export const DMS_REVERSAL_COUNTERPARTS: Record<string, string> = {
  sales_invoice: 'credit_note',
  pos_receipt: 'credit_note',
  school_fee_invoice: 'credit_note',
  rental_deposit: 'credit_note',
  vendor_bill: 'debit_note',
};

/** Phase 6 — reissue reverses a reversal: original → counterpart. */
export const DMS_REISSUE_COUNTERPARTS: Record<string, string> = {
  sales_invoice: 'credit_note',
  pos_receipt: 'credit_note',
  school_fee_invoice: 'credit_note',
  rental_deposit: 'credit_note',
  vendor_bill: 'debit_note',
};

/** DRAFT prefix used by recurring/one-shot writers for placeholder numbers. */
export const DRAFT_NUMBER_PREFIX = 'DRAFT-';

export function validateGuardJson(guard: unknown, context: string): GuardJson {
  if (guard === undefined || guard === null) return {};
  if (typeof guard !== 'object' || Array.isArray(guard)) {
    throw new Error(`DMS seed guard must be an object (${context})`);
  }
  const g = guard as Record<string, unknown>;
  const unknown = Object.keys(g).filter((k) => !(GUARD_VOCABULARY as readonly string[]).includes(k));
  if (unknown.length) {
    throw new Error(
      `DMS seed guard ${context} uses unknown keys [${unknown.join(', ')}] — ` +
        `vocabulary is [${GUARD_VOCABULARY.join(', ')}] (G4: declarative guards only)`,
    );
  }
  for (const k of Object.keys(g)) {
    if (typeof g[k] !== 'boolean' && k !== 'permission') {
      throw new Error(`DMS seed guard ${context}.${k} must be boolean`);
    }
    if (k === 'permission' && g[k] !== null && typeof g[k] !== 'string') {
      throw new Error(`DMS seed guard ${context}.permission must be a string or null`);
    }
  }
  return g as GuardJson;
}

/** Resolve the effective guard for a (lifecycleId, fromState, action). */
export function findTransition(
  transitions: Array<{ from: string; to: string; action: string; guard?: GuardJson }>,
  fromState: string,
  action: string,
) {
  return transitions.find((t) => t.from === fromState && t.action === action);
}