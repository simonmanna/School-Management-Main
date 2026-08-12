import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Prisma, PrismaClient } from '@prisma/client';
import { EVENT_SUBJECT, type DomainEventMap, type DomainEventName } from '@erp/shared';
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
   * Write an outbox row, plus a `DomainEventLog` row when the event is a
   * declared business fact (see `EVENT_SUBJECT`).
   *
   * The two tables have different jobs and must not be conflated:
   *   - `EventOutbox`   — TRANSPORT. Rows are claimed, dispatched and marked
   *                       shipped. At-least-once; consumers must be idempotent.
   *   - `DomainEventLog` — LEDGER. Append-only (enforced by DB triggers), keyed
   *                       by `(entityType, entityId)` so an entity's history can
   *                       be queried and milestones projected from it.
   *
   * Pass the active tx so both rows are atomic with the business write; pass
   * `undefined` to write in a fresh tx. **A ledger row must never outlive a
   * rolled-back business write**, so anything that records a fact should pass
   * its tx — see the warning on `EventBus.publish`.
   */
  async publish<K extends DomainEventName>(
    tx: Prisma.TransactionClient | undefined,
    eventName: K,
    payload: DomainEventMap[K],
  ): Promise<void> {
    const organizationId = this.tenant.optionalOrganizationId ?? '';
    const db = tx ?? this.prisma.client;
    await db.eventOutbox.create({
      data: {
        organizationId,
        eventName,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    await this.recordFact(db, organizationId, eventName, payload);
  }

  /**
   * Append the immutable business fact. Silent no-op for events with no
   * `EVENT_SUBJECT` entry — an event is only part of the permanent record if it
   * declares what it is about.
   */
  private async recordFact(
    db: Prisma.TransactionClient | PrismaClient,
    organizationId: string,
    eventName: DomainEventName,
    payload: unknown,
  ): Promise<void> {
    const subject = EVENT_SUBJECT[eventName];
    if (!subject || !organizationId) return;
    const entityId = (payload as Record<string, unknown> | null)?.[subject.idField];
    if (typeof entityId !== 'string' || !entityId) {
      this.logger.warn(
        `Event '${eventName}' declares subject field '${subject.idField}' but the payload has no such string — no ledger row written.`,
      );
      return;
    }
    await db.domainEventLog.create({
      data: {
        organizationId,
        eventName,
        entityType: subject.entityType,
        entityId,
        actorId: this.tenant.userId ?? null,
        payload: payload as Prisma.InputJsonValue,
      },
    });
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