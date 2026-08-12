/**
 * Bootstrap hooks a feature module can register so `core` can seed it for a new
 * organization without importing it.
 *
 * The architecture rules (ADR-011) make `core` a lower layer than `accounting`,
 * so `OrganizationsService` may not reach into the accounting module directly.
 * The token lives in `kernel` — which both layers may import — the accounting
 * module supplies the implementation, and core injects it optionally so the API
 * still boots if the accounting module is not loaded.
 */
export const ACCOUNTING_BOOTSTRAP = Symbol('ACCOUNTING_BOOTSTRAP');

export interface AccountingBootstrap {
  /**
   * Create the accounting core for one organization: account categories, the
   * chart of accounts including its hierarchy, journals, and every
   * account-determination mapping. Idempotent.
   */
  seedOrganization(organizationId: string): Promise<void>;
}
