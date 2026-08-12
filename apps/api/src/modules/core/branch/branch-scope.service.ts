import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Phase F: branch scoping for queries.
 *
 * - A user with `defaultBranchId = null` has org-wide access (subject to RBAC).
 * - A user with `defaultBranchId = <X>` is scoped to that branch on every
 *   transactional query (Document, Payment, CashSession, StockItem, etc.).
 *
 * `branchFilter(model)` returns a Prisma `where` fragment that callers AND
 * into their queries. For users with no branch restriction it returns
 * `undefined` (no filter applied).
 *
 * Combined with the existing tenancy extension, this gives multi-tenant +
 * multi-branch isolation in a single composed `where`.
 */
@Injectable()
export class BranchScopeService {
  private readonly logger = new Logger('BranchScopeService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Returns a `where` fragment that constrains the query to the user's branch.
   * Callers AND it into their existing where clause.
   */
  async branchFilter(model: 'Document' | 'Payment' | 'CashSession' | 'StockItem' | 'StockMovement' = 'Document'): Promise<Record<string, unknown> | undefined> {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!userId) return undefined;

    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
      select: { defaultBranchId: true },
    });
    if (!user || !user.defaultBranchId) return undefined; // org-wide access

    switch (model) {
      case 'Document':
      case 'Payment':
      case 'CashSession':
      case 'StockItem':
        return { branchId: user.defaultBranchId };
      default:
        return { branchId: user.defaultBranchId };
    }
  }

  /**
   * Compose branch scope with an existing where. Convenience helper for
   * service code.
   */
  async scopeWhere<T extends Record<string, unknown>>(
    existing: T,
    model: 'Document' | 'Payment' | 'CashSession' | 'StockItem' = 'Document',
  ): Promise<T & Record<string, unknown>> {
    const filter = await this.branchFilter(model);
    return { ...existing, ...(filter ?? {}) } as T & Record<string, unknown>;
  }
}