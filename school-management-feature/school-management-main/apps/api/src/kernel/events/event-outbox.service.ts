import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Prisma, PrismaClient } from '@prisma/client';
import type { DomainEventMap, DomainEventName } from '@erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * D4-3: Transactional event outbox.
 *
 * Replaces the previous in-process Node EventEmitter bus. `publish` writes a
 * row to `EventOutbox` inside the active `$transaction` (or a fresh one if
 * no tx was passed). The OutboxWorker polls pending rows and dispatches them
 * to handlers in the same process.
 *
 * Survival: pending rows survive a process restart because they live in
 * Postgres. The worker drains them on next boot.
 *
 * Delivery: at-least-once. Consumers must be idempotent on `(eventName, id)`.
 *
 * Use `publish` from inside a transaction:
 *   await prisma.$transaction(async (tx) => {
 *     await tx.invoice.create(...);
 *     await outbox.publish(tx, 'invoice.created', { ... });
 *   });
 * Or without a tx:
 *   await outbox.publish(undefined, 'invoice.created', { ... });
 */
@Injectable()
export class EventOutboxService {
  private readonly logger = new Logger('EventOutboxService');
  private readonly localEmitter = new EventEmitter();
  private readonly maxListeners = 200;
  private handlers = new Map<string, ((payload: any) => void | Promise<void>)[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    this.localEmitter.setMaxListeners(this.maxListeners);
  }

  /**
   * Write an outbox row. Pass the active tx so the event is atomic with the
   * business write; pass `undefined` to write in a fresh tx (fire-and-forget).
   */
  async publish<K extends DomainEventName>(
    tx: Prisma.TransactionClient | undefined,
    eventName: K,
    payload: DomainEventMap[K],
  ): Promise<void> {
    const organizationId = this.tenant.optionalOrganizationId ?? '';
    const data = {
      organizationId,
      eventName,
      payload: payload as unknown as Prisma.InputJsonValue,
    };
    if (tx) {
      await tx.eventOutbox.create({ data });
    } else {
      await this.prisma.client.eventOutbox.create({ data });
    }
  }

  /** Subscribe to events for in-process consumers. */
  on<K extends DomainEventName>(
    eventName: K,
    handler: (payload: DomainEventMap[K]) => void | Promise<void>,
  ): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as any);
    this.handlers.set(eventName, list);
  }

  /** Dispatch a single outbox row to in-process subscribers. */
  async dispatch(row: { id: string; eventName: string; payload: unknown }): Promise<void> {
    const handlers = this.handlers.get(row.eventName) ?? [];
    if (handlers.length === 0) {
      // No handler — silently mark shipped (the row is still durably stored
      // for forensic replay if needed).
      return;
    }
    for (const h of handlers) {
      try {
        await h(row.payload);
      } catch (err) {
        this.logger.error(`Handler for ${row.eventName} failed: ${String(err)}`);
        throw err;
      }
    }
  }
}