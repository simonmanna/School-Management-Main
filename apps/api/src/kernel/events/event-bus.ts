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
   * Fire-and-forget publish. No tx handle is available here, so the row is
   * written immediately in its own transaction and the OutboxWorker ships it.
   *
   * **If the caller's business write subsequently rolls back, the row stays.**
   * That is tolerable for a notification but wrong for a recorded fact, so
   * anything that emits a declared business event (`EVENT_SUBJECT`) must call
   * `EventOutboxService.publish(tx, …)` with its transaction instead — see
   * `WorkflowService.transition`. Consumers must be idempotent either way.
   *
   * Delegates rather than writing the outbox row itself, so a fact published
   * through this path still reaches `DomainEventLog` (just not atomically)
   * instead of silently skipping the ledger.
   */
  publish<K extends DomainEventName>(eventName: K, payload: DomainEventMap[K]): void {
    void this.outbox.publish(undefined, eventName, payload).catch((err) => {
      this.logger.error(`Failed to publish ${eventName}: ${String(err)}`);
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