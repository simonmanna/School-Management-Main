/**
 * Architecture-boundary enforcement (ADR-011 + ADR-001).
 *
 * Rules:
 *   - `kernel` is the root: no module/* imports.
 *   - `core` depends only on `kernel`.
 *   - `accounting` depends on `core` + `kernel` (NOT invoicing/inventory/procurement/vertical).
 *   - `invoicing` depends on `accounting` + `core` + `kernel` (NOT inventory/procurement/vertical).
 *   - `inventory` depends on `core` + `kernel` (NOT invoicing/procurement/vertical).
 *   - `procurement` depends on `core` + `accounting` + `inventory` + `invoicing` + `kernel` (NOT vertical).
 *   - Verticals (`pos/`, `school/`, future) may depend on
 *     accounting/invoicing/inventory/core/kernel, but NEVER on another vertical.
 *
 * Run via: pnpm lint:arch  →  depcruise apps/api/src --config .dependency-cruiser.cjs
 */
/** @type {import('dependency-cruiser').IConfiguration} */

// Each vertical lives at `apps/api/src/modules/<vertical>/`. Add new verticals
// here as they are scaffolded. This list drives BOTH the vertical-to-vertical
// isolation rules and the `<layer>-must-not-import-vertical` rules, so a vertical
// missing from here is silently unenforced.
const VERTICALS = [
  'pos',
  'school',
  'manufacturing',
  'rental',
  'repair',
  'hr',
  'crm',
  'fixed-asset',
  'task',
  'beverage',
  'communication',
];
const verticalAlt = VERTICALS.join('|');
const verticalGroup = `(?:${verticalAlt})`;

// Sanctioned cross-vertical entry points, keyed `from->to`.
//
// KNOWN DEBT: `rental` and `repair` bill through `PosInvoiceService`, which is
// the Order→Invoice spine rather than café-specific code — it only lives under
// `modules/pos/` for historical reasons. Until that spine is extracted into a
// non-vertical `sales` module, these two edges are allowed, narrowed to the
// billing service + the module barrel so nothing else can cross.
// Remove this map once the extraction lands; the rules below need no change.
const CROSS_VERTICAL_EXCEPTIONS = {
  'rental->pos': [
    '^apps/api/src/modules/pos/billing/pos-invoice\\.service',
    '^apps/api/src/modules/pos/pos\\.module',
  ],
  'repair->pos': [
    '^apps/api/src/modules/pos/billing/pos-invoice\\.service',
    '^apps/api/src/modules/pos/pos\\.module',
  ],
};
const NON_VERTICAL = 'core|accounting|invoicing|inventory|procurement|kernel|auth|settings|audit|tenancy|prisma|events|sequence|workflow|module-loader|common';

module.exports = {
  forbidden: [
    // ─── Kernel is the root ──────────────────────────────────────────────
    {
      name: 'kernel-must-not-import-modules',
      severity: 'error',
      comment: 'Kernel may not import any feature module.',
      from: { path: '^apps/api/src/kernel' },
      to: { path: '^apps/api/src/modules' },
    },

    // ─── Core layer ──────────────────────────────────────────────────────
    {
      name: 'core-must-not-import-accounting',
      severity: 'error',
      comment: 'Core may not import accounting.',
      from: { path: '^apps/api/src/modules/core' },
      to: { path: '^apps/api/src/modules/accounting' },
    },
    {
      name: 'core-must-not-import-invoicing',
      severity: 'error',
      comment: 'Core may not import invoicing.',
      from: { path: '^apps/api/src/modules/core' },
      to: { path: '^apps/api/src/modules/invoicing' },
    },
    {
      name: 'core-must-not-import-inventory',
      severity: 'error',
      comment: 'Core may not import inventory.',
      from: { path: '^apps/api/src/modules/core' },
      to: { path: '^apps/api/src/modules/inventory' },
    },
    {
      name: 'core-must-not-import-procurement',
      severity: 'error',
      comment: 'Core may not import procurement.',
      from: { path: '^apps/api/src/modules/core' },
      to: { path: '^apps/api/src/modules/procurement' },
    },
    {
      name: 'core-must-not-import-vertical',
      severity: 'error',
      comment: 'Core may not import verticals.',
      from: { path: '^apps/api/src/modules/core' },
      to: { path: `^apps/api/src/modules/(?!${NON_VERTICAL}|${verticalAlt}/)` },
    },

    // ─── Accounting layer ────────────────────────────────────────────────
    {
      name: 'accounting-must-not-import-invoicing',
      severity: 'error',
      comment: 'Accounting may not import invoicing (downward only).',
      from: { path: '^apps/api/src/modules/accounting' },
      to: { path: '^apps/api/src/modules/invoicing' },
    },
    {
      name: 'accounting-must-not-import-inventory',
      severity: 'error',
      comment: 'Accounting may not import inventory (downward only).',
      from: { path: '^apps/api/src/modules/accounting' },
      to: { path: '^apps/api/src/modules/inventory' },
    },
    {
      name: 'accounting-must-not-import-procurement',
      severity: 'error',
      comment: 'Accounting may not import procurement.',
      from: { path: '^apps/api/src/modules/accounting' },
      to: { path: '^apps/api/src/modules/procurement' },
    },
    {
      name: 'accounting-must-not-import-vertical',
      severity: 'error',
      comment: 'Accounting may not import verticals.',
      from: { path: '^apps/api/src/modules/accounting' },
      to: { path: `^apps/api/src/modules/(?!${NON_VERTICAL}|${verticalAlt}/)` },
    },

    // ─── Invoicing layer ─────────────────────────────────────────────────
    {
      name: 'invoicing-must-not-import-procurement',
      severity: 'error',
      comment: 'Invoicing may not import procurement (avoid cycle: procurement depends on invoicing for vendor_bill, not vice versa).',
      from: { path: '^apps/api/src/modules/invoicing' },
      to: { path: '^apps/api/src/modules/procurement' },
    },
    {
      name: 'invoicing-must-not-import-vertical',
      severity: 'error',
      comment: 'Invoicing may not import verticals.',
      from: { path: '^apps/api/src/modules/invoicing' },
      to: { path: `^apps/api/src/modules/(?!${NON_VERTICAL}|${verticalAlt}/)` },
    },

    // ─── Inventory layer ─────────────────────────────────────────────────
    {
      name: 'inventory-must-not-import-invoicing',
      severity: 'error',
      comment: 'Inventory may not import invoicing.',
      from: { path: '^apps/api/src/modules/inventory' },
      to: { path: '^apps/api/src/modules/invoicing' },
    },
    {
      name: 'inventory-must-not-import-procurement',
      severity: 'error',
      comment: 'Inventory may not import procurement.',
      from: { path: '^apps/api/src/modules/inventory' },
      to: { path: '^apps/api/src/modules/procurement' },
    },
    {
      name: 'inventory-must-not-import-vertical',
      severity: 'error',
      comment: 'Inventory may not import verticals.',
      from: { path: '^apps/api/src/modules/inventory' },
      to: { path: `^apps/api/src/modules/(?!${NON_VERTICAL}|${verticalAlt}/)` },
    },

    // ─── Vertical-to-vertical isolation ─────────────────────────────────
    // A vertical may not import code from a DIFFERENT vertical. Intra-vertical
    // and core-layer imports are fine. We check each (fromVertical → otherVertical)
    // pair explicitly so depcruise doesn't need cross-segment backreferences.
    ...VERTICALS.flatMap((fromV) =>
      VERTICALS.filter((toV) => toV !== fromV).map((toV) => {
        const allowed = CROSS_VERTICAL_EXCEPTIONS[`${fromV}->${toV}`];
        return {
          name: `vertical-${fromV}-may-not-reach-vertical-${toV}`,
          severity: 'error',
          comment: allowed
            ? `Vertical '${fromV}' may only reach the sanctioned '${toV}' entry points (see CROSS_VERTICAL_EXCEPTIONS). Everything else must go through the event bus or shared core types.`
            : `Vertical '${fromV}' may not import from vertical '${toV}'. Use the event bus or shared core types.`,
          from: { path: `^apps/api/src/modules/${fromV}/` },
          to: {
            path: `^apps/api/src/modules/${toV}/`,
            ...(allowed ? { pathNot: allowed } : {}),
          },
        };
      }),
    ),

    // ─── No deep imports into a peer's internals ─────────────────────────
    {
      name: 'no-not-internal',
      severity: 'warn',
      comment: "Avoid deep imports past a module's public surface; expose what you need through the module barrel.",
      from: { path: '^apps/api/src' },
      to: { path: '\\.not-internal(/|$)' },
    },

    // ─── No orphan modules ───────────────────────────────────────────────
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Every file must be reachable from AppModule (type-only files excluded).',
      from: { path: '^apps/api/src', orphan: true, pathNot: '\\.(spec|dto|types|interface|d)\\.ts$' },
      to: { path: '^apps/api/src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
