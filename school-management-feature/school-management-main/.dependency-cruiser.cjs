/**
 * Architecture-boundary enforcement (ADR-011 + ADR-001).
 *
 * Rules:
 *   - `kernel` is the root: no module/* imports.
 *   - `core` depends only on `kernel`.
 *   - `accounting` depends on `core` + `kernel` (NOT invoicing/inventory/vertical).
 *   - `invoicing` depends on `accounting` + `core` + `kernel` (NOT inventory/vertical).
 *   - `inventory` depends on `core` + `kernel` (NOT invoicing/vertical).
 *   - Any `modules/<vertical>/` may depend on accounting/invoicing/inventory/core/kernel
 *     but NEVER on another vertical.
 *
 * "Vertical" = any folder directly under `apps/api/src/modules/` that is NOT one
 * of the four core layer folders (core, accounting, invoicing, inventory).
 *
 * Run via: pnpm lint:arch  →  depcruise apps/api/src --config .dependency-cruiser.cjs
 */
/** @type {import('dependency-cruiser').IConfiguration} */
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
      name: 'core-must-not-import-vertical',
      severity: 'error',
      comment: 'Core may not import verticals.',
      from: { path: '^apps/api/src/modules/core' },
      to: {
        path: '^apps/api/src/modules/(?!core/|accounting/|invoicing/|inventory/|school/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)',
      },
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
      name: 'accounting-must-not-import-vertical',
      severity: 'error',
      comment: 'Accounting may not import verticals.',
      from: { path: '^apps/api/src/modules/accounting' },
      to: {
        path: '^apps/api/src/modules/(?!core/|accounting/|invoicing/|inventory/|school/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)',
      },
    },

    // ─── Invoicing layer ─────────────────────────────────────────────────
    {
      name: 'invoicing-must-not-import-vertical',
      severity: 'error',
      comment: 'Invoicing may not import verticals.',
      from: { path: '^apps/api/src/modules/invoicing' },
      to: {
        path: '^apps/api/src/modules/(?!core/|accounting/|invoicing/|inventory/|school/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)',
      },
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
      name: 'inventory-must-not-import-vertical',
      severity: 'error',
      comment: 'Inventory may not import verticals.',
      from: { path: '^apps/api/src/modules/inventory' },
      to: {
        path: '^apps/api/src/modules/(?!core/|accounting/|invoicing/|inventory/|school/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)',
      },
    },

    // ─── Vertical-to-vertical isolation ─────────────────────────────────
    {
      name: 'no-vertical-cross-imports',
      severity: 'error',
      comment: 'Verticals must not import each other. Each vertical lives in apps/api/src/modules/<name>/ and may only import core/accounting/invoicing/inventory/kernel.',
      from: {
        path: '^apps/api/src/modules/(?!core/|accounting/|invoicing/|inventory/|school/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)([^/]+)',
      },
      to: {
        path: '^apps/api/src/modules/(?!core/|accounting/|invoicing/|inventory/|school/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)([^/]+)',
      },
    },

    // ─── No deep imports into a peer's internals ─────────────────────────
    {
      name: 'no-not-internal',
      severity: 'warn',
      comment: 'Avoid deep imports past a module\'s public surface; expose what you need through the module barrel.',
      from: { path: '^apps/api/src' },
      to: { path: '\\.not-internal(/|$)' },
    },

    // ─── No orphan modules ───────────────────────────────────────────────
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Every file must be reachable from AppModule (type-only files excluded).',
      from: { path: '^apps/api/src', orphan: true, pathNot: '\\.(spec|dto|types|interface|module)\\.ts$' },
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
