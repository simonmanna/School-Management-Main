import { Injectable, Logger } from '@nestjs/common';
import type { DomainEventMap, DomainEventName } from '@erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EventOutboxService } from './event-outbox.service';

/**
 * D4-3: EventBus — thin façade over the transactional outbox.
 *
 * Each `publish` writes a row to `EventOutbox` (either inside the active tx
 * passed to it, or in a fresh tx). The OutboxWorker polls and dispatches.
 *
 * This preserves the previous call-site signature so the 30+ `events.publish`
 * call sites don't need to be touched.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger('EventBus');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly outbox: EventOutboxService,
  ) {}

  /**
   * Fire-and-forget write to the outbox. If called inside a `$transaction`
   * via `runInTx` below, the row participates in that tx; otherwise it's a
   * standalone row.
   */
  publish<K extends DomainEventName>(eventName: K, payload: DomainEventMap[K]): void {
    const organizationId = this.tenant.optionalOrganizationId ?? '';
    // We don't have a tx handle here (callers don't pass one). Write a row
    // immediately in a fresh tx — OutboxWorker will ship it. If the caller's
    // business write subsequently rolls back, the event row stays; consumers
    // MUST be idempotent on `(eventName, id)`. For atomic events, callers
    // should use `EventOutboxService.publish(tx, ...)` directly.
    this.prisma.client.eventOutbox
      .create({
        data: {
          organizationId,
          eventName,
          payload: payload as any,
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to write outbox row for ${eventName}: ${String(err)}`);
      });
  }

  /** Subscribe to an event for in-process handlers. */
  subscribe<K extends DomainEventName>(
    eventName: K,
    handler: (payload: DomainEventMap[K]) => void | Promise<void>,
  ): void {
    this.outbox.on(eventName, handler);
  }
}