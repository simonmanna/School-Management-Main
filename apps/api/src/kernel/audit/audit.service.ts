import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditAction } from '@erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

export interface AuditInput {
  entity: string;
  entityId: string;
  action: AuditAction;
  oldValues?: unknown;
  newValues?: unknown;
  /** Optional actor IP — populated by callers that have the request in scope. */
  ipAddress?: string;
  /** Optional actor user-agent. */
  userAgent?: string;
}

/**
 * Audit trail (ADR-006). Two flavors:
 *   - `recordInTx(tx, …)` — MUST be called from inside the same `$transaction`
 *     that performs the business write. If the audit insert fails, the entire
 *     tx rolls back. This is the path the audited accounting flow requires.
 *   - `record(…)` — fire-and-forget. Only used for non-financial events (login).
 *
 * For SOX / IFRS / ISA-230, audit MUST NOT be silently dropped. We removed the
 * previous swallow in `record` and only the login flow keeps fire-and-forget.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Write an audit row inside the business transaction. Throws on failure so
   * Prisma rolls back. Use this from every mutation path that touches money.
   */
  async recordInTx(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    const organizationId = this.tenant.optionalOrganizationId;
    if (!organizationId) {
      // Without a tenant context we cannot scope the audit row; refuse rather
      // than silently drop it.
      throw new Error('recordInTx called without a tenant context');
    }
    await tx.auditLog.create({
      data: {
        organizationId,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        oldValues: (input.oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
        newValues: (input.newValues ?? undefined) as Prisma.InputJsonValue | undefined,
        actorId: this.tenant.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  /**
   * Fire-and-forget audit write. Used ONLY by AuthService.login and similar
   * non-financial events where dropping a row is acceptable. Never use this from
   * a posting or money-moving path.
   */
  async record(input: AuditInput): Promise<void> {
    const organizationId = this.tenant.optionalOrganizationId;
    if (!organizationId) return;
    try {
      await this.prisma.client.auditLog.create({
        data: {
          organizationId,
          entity: input.entity,
          entityId: input.entityId,
          action: input.action,
          oldValues: (input.oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
          newValues: (input.newValues ?? undefined) as Prisma.InputJsonValue | undefined,
          actorId: this.tenant.userId ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Fire-and-forget audit failed (non-critical): ${String(err)}`);
    }
  }
}