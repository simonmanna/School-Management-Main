import { loadSchemaModels, parseSchemaModels } from './schema-model-index';
import { ORG_SCOPED, SOFT_DELETE } from './tenancy.extension';

/**
 * ADR-004 makes tenant isolation depend on two hand-maintained sets in
 * `tenancy.extension.ts`. Adding a table to schema.prisma and forgetting to
 * register it does not throw, does not warn, and does not fail a type-check —
 * it silently returns other tenants' rows.
 *
 * These specs make that failure mode mechanical: schema and code must agree, in
 * both directions, or the build is red.
 */

/**
 * Models with a non-null `organizationId` that are deliberately NOT auto-scoped.
 * Every entry needs a reason. Keep this list as short as it can honestly be.
 */
const ORG_SCOPED_EXCEPTIONS = new Map<string, string>([
  // Nullable organizationId (global defaults + per-org overrides); scoped by
  // hand in SettingsService. Documented at tenancy.extension.ts:6.
  ['Setting', 'nullable organizationId — SettingsService scopes manually'],
]);

/**
 * PRE-EXISTING DEBT — models that carry a non-null organizationId, are not in
 * ORG_SCOPED, and are not scoped by hand either. These are live cross-tenant
 * read paths, e.g.:
 *
 *   asset-acquisition.service.ts:20
 *     prisma.client.asset.findFirst({ where: { id: assetId } })
 *
 * With `Asset` absent from ORG_SCOPED nothing injects organizationId, so one
 * tenant can read another tenant's row by id.
 *
 * This list was captured when the check was introduced (school vertical port,
 * P0). It exists so the check can be enforcing from day one rather than being
 * disabled until the backlog clears. It is **shrink-only**: the spec below
 * fails if anything is added, and equally if an entry is fixed but left here.
 *
 * Do not add to this list. A new model goes in ORG_SCOPED.
 */
const ORG_SCOPED_BASELINE = new Set<string>([
  // Accounting / treasury
  'FxRevaluation',
  'BankStatementLine',
  'BankReconciliationRun',
  'CostCenter',
  'PurchasePayment',
  // Documents / POS
  'DocumentPrintLog',
  'DocumentLineModifier',
  'PosReportSnapshot',
  'InventoryPostingRule',
  // Fixed assets (whole vertical)
  'AssetCategory',
  'Asset',
  'AssetAcquisition',
  'AssetAssignment',
  'AssetTransfer',
  'AssetDepreciation',
  'AssetMaintenance',
  'AssetRepair',
  'AssetWarranty',
  'AssetInsurance',
  'AssetInspection',
  'AssetDisposal',
  'AssetRevaluation',
  'AssetCheckInOut',
  'AssetDocument',
  // Tasks (whole vertical)
  'Task',
  'TaskChecklistItem',
  'TaskComment',
  'TaskActivityLog',
  'TaskLabel',
  'TaskAutoRule',
  'TaskRecurringTemplate',
]);

/** `deletedAt` present but soft-delete filtering intentionally off. */
const SOFT_DELETE_EXCEPTIONS = new Map<string, string>([
  // Organization is the tenant itself; it is never auto-filtered by the
  // extension because there is no outer scope to filter it against.
  ['Organization', 'is the tenant root, not a tenant-scoped row'],
]);

/** Same shrink-only contract as ORG_SCOPED_BASELINE, for soft deletes. */
const SOFT_DELETE_BASELINE = new Set<string>([
  'CostCenter',
  'AccountCategory',
  'File',
  'AssetCategory',
  'Asset',
  'Task',
  'TaskComment',
  'TaskRecurringTemplate',
  'HrTaxBracket',
  'HrPayrollAllowance',
  'HrPayrollDeduction',
  'HrBankPaymentLine',
]);

describe('tenancy registration (schema.prisma ↔ tenancy.extension.ts)', () => {
  const models = loadSchemaModels();

  it('parses the schema', () => {
    expect(models.length).toBeGreaterThan(200);
    const partner = models.find((m) => m.name === 'Partner');
    expect(partner?.fields.has('organizationId')).toBe(true);
  });

  const unscoped = () =>
    models
      .filter(
        (m) =>
          m.fields.has('organizationId') &&
          !m.optionalFields.has('organizationId') &&
          !ORG_SCOPED.has(m.name) &&
          !ORG_SCOPED_EXCEPTIONS.has(m.name),
      )
      .map((m) => m.name);

  it('registers every model that has a non-null organizationId in ORG_SCOPED', () => {
    // Anything not already accounted for in the frozen baseline is a new leak.
    expect(unscoped().filter((n) => !ORG_SCOPED_BASELINE.has(n))).toEqual([]);
  });

  it('keeps the unscoped baseline shrink-only', () => {
    // An entry that no longer leaks must be deleted from the baseline, so the
    // list stays an honest measure of the remaining debt.
    const stillUnscoped = new Set(unscoped());
    expect([...ORG_SCOPED_BASELINE].filter((n) => !stillUnscoped.has(n))).toEqual([]);
  });

  it('has no ORG_SCOPED entry that is not a real model with organizationId', () => {
    const byName = new Map(models.map((m) => [m.name, m]));
    const bogus = [...ORG_SCOPED].filter((name) => {
      const model = byName.get(name);
      return model === undefined || !model.fields.has('organizationId');
    });

    expect(bogus).toEqual([]);
  });

  const unfiltered = () =>
    models
      .filter(
        (m) =>
          m.fields.has('deletedAt') &&
          !SOFT_DELETE.has(m.name) &&
          !SOFT_DELETE_EXCEPTIONS.has(m.name),
      )
      .map((m) => m.name);

  it('registers every model that has deletedAt in SOFT_DELETE', () => {
    expect(unfiltered().filter((n) => !SOFT_DELETE_BASELINE.has(n))).toEqual([]);
  });

  it('keeps the soft-delete baseline shrink-only', () => {
    const stillUnfiltered = new Set(unfiltered());
    expect([...SOFT_DELETE_BASELINE].filter((n) => !stillUnfiltered.has(n))).toEqual([]);
  });

  it('has no SOFT_DELETE entry that is not a real model with deletedAt', () => {
    const byName = new Map(models.map((m) => [m.name, m]));
    const bogus = [...SOFT_DELETE].filter((name) => {
      const model = byName.get(name);
      return model === undefined || !model.fields.has('deletedAt');
    });

    expect(bogus).toEqual([]);
  });
});

describe('schema parser', () => {
  it('ignores // inside a quoted default', () => {
    const [model] = parseSchemaModels(`
model Widget {
  id  String @id
  url String @default("https://example.test/a//b")
}
`);
    expect([...model.fields]).toEqual(['id', 'url']);
  });

  it('ignores line and doc comments, and block attributes', () => {
    const [model] = parseSchemaModels(`
model Widget {
  /// the id
  id             String @id
  // organizationId String  <- commented out, not a real field
  organizationId String
  @@index([organizationId])
}
`);
    expect(model.fields.has('organizationId')).toBe(true);
    expect(model.fields.has('@@index')).toBe(false);
    expect(model.fields.size).toBe(2);
  });

  it('distinguishes optional from required fields', () => {
    const [model] = parseSchemaModels(`
model Widget {
  organizationId String?
  name           String
  tags           String[]
}
`);
    expect(model.optionalFields.has('organizationId')).toBe(true);
    expect(model.optionalFields.has('name')).toBe(false);
    expect(model.fields.has('tags')).toBe(true);
  });
});
