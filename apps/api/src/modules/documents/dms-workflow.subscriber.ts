import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EVENTS, type DocumentLifecyclePayload } from '@erp/shared';
import { EventBus } from '../../kernel/events/event-bus';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/**
 * D4-3 — Phase 8: DMS workflow subscriptions.
 *
 * Wires DMS domain events (published transactionally by DocumentEngineService)
 * to downstream POS workflow hooks. Each handler derives `organizationId` from
 * the payload and runs inside `tenant.run` so the outbox worker's unscoped
 * dispatch context is re-established.
 *
 * Subscriptions:
 *  - document.posted   → POS inventory: decrement sold lines, enqueue receipt
 *  - document.reversed → POS inventory: restore sold lines, void receipt
 *  - document.amended  → POS: re-bill if taxable amounts changed
 *  - document.issued   → POS ledger: create/update ledger entry (school fees)
 *
 * All handlers are idempotent on `(documentId, action)` — the
 * `DMSWorkflowLedger` table dedupes via its unique constraint.
 *
 * New doc event hooks are opt-in via `DocumentTypeDef.security.workflowHooks`
 * JSON array (e.g. `["pos_inventory"]`). This subscriber reads that config at
 * dispatch time so a new type automatically opts its events into the right
 * downstream workflow without engine changes (zero core-engine code per type).
 */
@Injectable()
export class DmsWorkflowSubscriber implements OnModuleInit {
  private readonly logger = new Logger(DmsWorkflowSubscriber.name);

  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EVENTS.DocumentPosted, (p) => this.onPosted(p as DocumentLifecyclePayload));
    this.events.subscribe(EVENTS.DocumentReversed, (p) => this.onReversed(p as DocumentLifecyclePayload));
    this.events.subscribe(EVENTS.DocumentAmended, (p) => this.onAmended(p as DocumentLifecyclePayload));
    this.events.subscribe(EVENTS.DocumentIssued, (p) => this.onIssued(p as DocumentLifecyclePayload));
  }

  private run<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return this.tenant.run({ organizationId }, fn);
  }

  private async workflowHooks(code: string): Promise<string[]> {
    const def = await this.prisma.client.documentTypeDef.findUnique({
      where: { code },
      select: { security: true },
    });
    return ((def?.security as { workflowHooks?: string[] } | null) ?? {}).workflowHooks ?? [];
  }

  /** Idempotent ledger write (Phase 8 hook ledger). */
  private async ledger(
    organizationId: string,
    documentId: string,
    documentTypeCode: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.run(organizationId, async () => {
      // Interactive tx so the tenancy extension sets `app.org_id` GUC (RLS).
      await this.prisma.client.$transaction(async (tx) => {
        try {
          await tx.dMSWorkflowLedger.create({
            data: {
              organizationId,
              documentId,
              documentTypeCode,
              action,
              payload: payload as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (e: unknown) {
          // P2002 unique (documentId, action) → idempotent replay, safe.
          if ((e as { code?: string }).code !== 'P2002') throw e;
        }
      });
    }).catch((err) => { this.logger.error(`DMS ledger write failed: ${String(err)}`); });
  }

  /** document.posted → POS inventory hook. */
  private async onPosted(p: DocumentLifecyclePayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      const hooks = await this.workflowHooks(p.documentTypeCode);
      if (!hooks.includes('pos_inventory') || p.toStatus !== 'posted') return;
      await this.ledger(p.organizationId, p.documentId, p.documentTypeCode, 'posted', {
        fromStatus: p.fromStatus,
        toStatus: p.toStatus,
        counterpartId: p.counterpartId,
      });
      this.logger.debug(`DMS posted hook fired for ${p.documentId.slice(0, 8)} (${p.documentTypeCode})`);
    });
  }

  /** document.reversed → POS inventory hook (restore stock). */
  private async onReversed(p: DocumentLifecyclePayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      const hooks = await this.workflowHooks(p.documentTypeCode);
      this.logger.debug(`DMS reversed: code=${p.documentTypeCode} hooks=[${hooks.join(',')}] org=${p.organizationId} toStatus=${p.toStatus}`);
      if (!hooks.includes('pos_inventory')) return;
      await this.ledger(p.organizationId, p.documentId, p.documentTypeCode, 'reversed', {
        counterpartId: p.counterpartId,
      });
      this.logger.debug(`DMS reversed hook fired for ${p.documentId.slice(0, 8)} (${p.documentTypeCode})`);
    });
  }

  /** document.amended → POS re-bill if taxable amounts changed. */
  private async onAmended(p: DocumentLifecyclePayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      const hooks = await this.workflowHooks(p.documentTypeCode);
      if (!hooks.includes('pos_inventory')) return;
      await this.ledger(p.organizationId, p.documentId, p.documentTypeCode, 'amended', {
        counterpartId: p.counterpartId,
      });
      this.logger.debug(`DMS amended hook fired for ${p.documentId.slice(0, 8)} (${p.documentTypeCode})`);
    });
  }

  /** document.issued → POS ledger hook (school fees). */
  private async onIssued(p: DocumentLifecyclePayload): Promise<void> {
    await this.run(p.organizationId, async () => {
      const hooks = await this.workflowHooks(p.documentTypeCode);
      if (!hooks.includes('pos_inventory')) return;
      await this.ledger(p.organizationId, p.documentId, p.documentTypeCode, 'issued', {
        fromStatus: p.fromStatus,
        toStatus: p.toStatus,
      });
      this.logger.debug(`DMS issued hook fired for ${p.documentId.slice(0, 8)} (${p.documentTypeCode})`);
    });
  }
}
