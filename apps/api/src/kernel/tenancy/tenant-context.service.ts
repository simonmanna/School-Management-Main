import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PortalClaim } from '../auth/portal-identity.types';

export interface TenantStore {
  organizationId: string;
  userId?: string;
  /** Correlation id assigned at the HTTP boundary; persisted with audit rows. */
  requestId?: string;
  permissions?: string[];
  /** Verified portal subject, copied from the access token. Absent for staff. */
  portal?: PortalClaim;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage (ADR-004).
 * Set once per request (see main.ts middleware) and read everywhere — the
 * Prisma extension uses it to auto-scope every query to the current tenant.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  run<T>(store: TenantStore, callback: () => T): T {
    return this.als.run(store, callback);
  }

  get store(): TenantStore | undefined {
    return this.als.getStore();
  }

  /** Throws if there is no tenant context — fail loud rather than leak across tenants. */
  get organizationId(): string {
    const store = this.als.getStore();
    if (!store?.organizationId) {
      throw new Error('No tenant context: an organizationId is required for this operation.');
    }
    return store.organizationId;
  }

  get optionalOrganizationId(): string | undefined {
    return this.als.getStore()?.organizationId;
  }

  get userId(): string | undefined {
    return this.als.getStore()?.userId;
  }

  get requestId(): string | undefined {
    return this.als.getStore()?.requestId;
  }

  get permissions(): string[] {
    return this.als.getStore()?.permissions ?? [];
  }

  /**
   * The verified portal (student/guardian) claim for this request, if any.
   * Populated from the signed access token by the middleware in main.ts — never
   * from a query parameter or request body.
   */
  get portal(): PortalClaim | undefined {
    return this.als.getStore()?.portal;
  }
}
