import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { LifecycleRegistry } from './lifecycle.registry';

/**
 * LifecycleService — guarded state transitions with an append-only event log.
 *
 * `transition` writes the `LifecycleEvent` row INSIDE the caller's transaction
 * (pass `tx`), so a business write and its history commit or roll back
 * together. Events are org-scoped and immutable by construction (append-only).
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: LifecycleRegistry,
  ) {}

  assertTransition(defKey: string, from: string | null, to: string, action: string): void {
    this.registry.assertTransition(defKey, from, to, action);
  }

  /**
   * Transition an entity and record the event. Use the transaction client when
   * called inside a `$transaction` (recommended — money paths must be in-tx so
   * a failure rolls back); otherwise the standalone scoped client.
   */
  async transition(params: {
    defKey: string;
    entityType: string;
    entityId: string;
    from: string | null;
    to: string;
    action: string;
    refType?: string;
    refId?: string;
    metadata?: Record<string, unknown>;
    tx?: any;
  }): Promise<{ id: string }> {
    this.registry.assertTransition(params.defKey, params.from, params.to, params.action);
    const client = params.tx ?? this.prisma.client;
    const event = await client.lifecycleEvent.create({
      data: {
        organizationId: this.tenant.organizationId,
        defKey: params.defKey,
        entityType: params.entityType,
        entityId: params.entityId,
        fromState: params.from,
        toState: params.to,
        action: params.action,
        refType: params.refType ?? null,
        refId: params.refId ?? null,
        byUserId: this.tenant.userId ?? null,
        metadata: (params.metadata ?? {}) as any,
      },
    });
    return { id: event.id };
  }
}
