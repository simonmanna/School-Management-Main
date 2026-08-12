import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { IdempotencyService } from '../../kernel/idempotency/idempotency.service';
import { resolveOccurredAt } from '../../kernel/common/occurred-at';
import { PosService } from '../pos/pos.service';
import { PosInvoiceService } from '../pos/billing/pos-invoice.service';
import { PosReservationsService } from '../pos/pos-reservations.service';
import { CashSessionService } from '../accounting/treasury/cash-session.service';
import { CashRegisterService } from '../accounting/treasury/cash-register.service';
import { ProductService } from '../core/product/product.service';
import type { RequestDevice } from './device-token.guard';
import type { SyncOpDto, SyncOpResult, SyncPushDto, SyncPushResult } from './dto/sync.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * P1 offline sync — batch op processor.
 *
 * An offline device pushes its op queue in deviceSeq order. Each op:
 *   1. Runs inside a per-op TenantContext with identity = op.actorUserId, so
 *      audit trails / cashier attribution / drawer ownership are correct even
 *      though the transport auth is the device token, not a user JWT.
 *   2. Runs under IdempotencyService.executeWithKey(opId) — a re-pushed batch
 *      (dropped response, app restart) replays the cached result; nothing
 *      double-posts.
 *   3. On failure: the op is dead-lettered (SyncOpDeadLetter) and processing
 *      CONTINUES with independent ops, but ops that reference the failed op's
 *      clientId fail-fast too. Owner rule: never block sales; never lose them.
 */
@Injectable()
export class SyncPushService {
  private readonly logger = new Logger('SyncPushService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly idempotency: IdempotencyService,
    private readonly pos: PosService,
    private readonly billing: PosInvoiceService,
    private readonly reservations: PosReservationsService,
    private readonly cashSessions: CashSessionService,
    private readonly cashRegisters: CashRegisterService,
    private readonly products: ProductService,
  ) {}

  async push(device: RequestDevice, dto: SyncPushDto): Promise<SyncPushResult> {
    const ops = [...dto.ops].sort((a, b) => a.deviceSeq - b.deviceSeq);
    const results: SyncOpResult[] = [];
    /** clientId → server id, resolved as ops apply (session open → sales). */
    const clientIdMap = new Map<string, string>();
    /** clientIds owned by ops that failed — dependents must fail too. */
    const failedClientIds = new Set<string>();
    let lastAppliedSeq = 0;

    for (const op of ops) {
      const result = await this.applyOp(device, op, clientIdMap, failedClientIds);
      results.push(result);
      if (result.status !== 'failed') lastAppliedSeq = op.deviceSeq;
    }

    // Track sync progress on the device row (monotonic).
    await this.prisma.raw.posDevice
      .updateMany({
        where: { id: device.id, lastPushSeq: { lt: lastAppliedSeq } },
        data: { lastPushSeq: lastAppliedSeq },
      })
      .catch((e: unknown) => this.logger.warn(`lastPushSeq update failed: ${String(e)}`));

    return { results, lastPushSeq: lastAppliedSeq, serverTime: new Date().toISOString() };
  }

  private async applyOp(
    device: RequestDevice,
    op: SyncOpDto,
    clientIdMap: Map<string, string>,
    failedClientIds: Set<string>,
  ): Promise<SyncOpResult> {
    // Dependency check: an op whose payload references a clientId owned by a
    // FAILED op cannot be applied meaningfully (e.g. a sale against a cash
    // session whose open op was rejected).
    const referenced = this.referencedClientIds(op);
    const brokenDep = referenced.find((id) => failedClientIds.has(id));
    if (brokenDep) {
      await this.deadLetter(device, op, `Depends on failed op (clientId ${brokenDep})`, 424);
      if (op.payload?.clientId) failedClientIds.add(String(op.payload.clientId));
      return { opId: op.opId, status: 'failed', httpStatus: 424, error: `Depends on failed op (clientId ${brokenDep})` };
    }

    try {
      // Per-op identity: everything the handler writes (createdBy, audit,
      // drawer ownership) is attributed to the cashier who did it offline.
      const outcome = await this.tenant.run(
        { organizationId: device.organizationId, userId: op.actorUserId },
        () =>
          this.idempotency.executeWithKey({
            key: op.opId,
            requestHash: this.idempotency.hashPayload({ type: op.type, payload: op.payload }),
            method: 'SYNC',
            path: op.type,
            runHandler: async () => {
              const body = await this.runOp(device, op, clientIdMap);
              return { statusCode: 201, body };
            },
          }),
      );

      const body = outcome.body as any;
      // Re-establish the clientId mapping on replays too, so a re-pushed batch
      // resolves later ops' references identically.
      if (op.payload?.clientId && body?.id) {
        clientIdMap.set(String(op.payload.clientId), String(body.id));
      }

      return {
        opId: op.opId,
        status: outcome.replayed ? 'replayed' : 'applied',
        httpStatus: outcome.statusCode,
        error: null,
        mapping: body?.mapping,
        finalNumbers: body?.finalNumbers,
      };
    } catch (err: any) {
      const httpStatus = err instanceof HttpException ? err.getStatus() : 500;
      const message = err?.message ?? 'unknown error';
      this.logger.warn(`sync op ${op.opId} (${op.type}) failed: ${message}`);
      await this.deadLetter(device, op, message, httpStatus);
      if (op.payload?.clientId) failedClientIds.add(String(op.payload.clientId));
      return { opId: op.opId, status: 'failed', httpStatus, error: message };
    }
  }

  /** clientIds this op depends on (references created by earlier ops). */
  private referencedClientIds(op: SyncOpDto): string[] {
    const refs: string[] = [];
    const sessionRef = op.payload?.cashSessionId ?? op.payload?.sessionId;
    if (typeof sessionRef === 'string' && sessionRef) refs.push(sessionRef);
    // A sale against a customer whose upsert op dead-lettered must fail-fast
    // with a clear 424 instead of an opaque FK error at Order create.
    const partnerRef = op.payload?.partnerId;
    if (typeof partnerRef === 'string' && partnerRef) refs.push(partnerRef);
    // A refund/void of a sale whose sale.checkout op dead-lettered (or hasn't
    // synced yet) must fail-fast 424 rather than hit an opaque "invoice not
    // found". When invoiceId is a real server id it's never in failedClientIds,
    // so this only bites the genuine same-batch broken-dependency case.
    const invoiceRef = op.payload?.invoiceId;
    if (typeof invoiceRef === 'string' && invoiceRef) refs.push(invoiceRef);
    // A seat/cancel/no-show of a reservation created earlier in the same batch
    // references it by client id — fail fast if that create dead-lettered.
    const reservationRef = op.payload?.reservationId;
    if (typeof reservationRef === 'string' && reservationRef) refs.push(reservationRef);
    return refs;
  }

  /** Swap client-minted ids for the server ids created earlier in the batch. */
  private resolveRefs(payload: Record<string, any>, clientIdMap: Map<string, string>): Record<string, any> {
    const out = { ...payload };
    // invoiceId: a refund/void may reference the sale by its client-minted id
    // when the sale.checkout applied earlier in THIS batch (device hasn't seen
    // the server invoice id yet). sale.checkout maps clientId → server invoiceId.
    for (const key of ['cashSessionId', 'sessionId', 'invoiceId', 'reservationId']) {
      const v = out[key];
      if (typeof v === 'string' && clientIdMap.has(v)) out[key] = clientIdMap.get(v);
    }
    return out;
  }

  private async runOp(
    device: RequestDevice,
    op: SyncOpDto,
    clientIdMap: Map<string, string>,
  ): Promise<any> {
    // Validate the device timestamp once, up front.
    resolveOccurredAt(op.occurredAt);
    const payload = this.resolveRefs(op.payload ?? {}, clientIdMap);
    const occurredAt = op.occurredAt;

    switch (op.type) {
      case 'cash_session.open': {
        const session = await this.cashSessions.open({
          cashRegisterId: payload.cashRegisterId,
          openingFloat: payload.openingFloat,
          notes: payload.notes,
          openingDenomination: payload.openingDenomination,
          occurredAt,
        });
        if (payload.clientId) clientIdMap.set(String(payload.clientId), session.id);
        await this.stampDevice('cashSession', session.id, device.id);
        return { id: session.id, mapping: { [String(payload.clientId ?? 'sessionId')]: session.id } };
      }
      case 'cash_session.close': {
        const closed = await this.cashSessions.close({
          closingCounted: payload.closingCounted,
          notes: payload.notes,
          varianceReason: payload.varianceReason,
          varianceStatus: payload.varianceStatus,
          approvedById: payload.approvedById,
          approverEmail: payload.approverEmail,
          managerPin: payload.managerPin,
          closingDenomination: payload.closingDenomination,
          occurredAt,
        });
        return { id: (closed as any)?.id ?? null };
      }
      case 'cash_session.movement': {
        const movement = await this.cashSessions.recordMovement(payload.sessionId, {
          movementType: payload.movementType,
          amount: payload.amount,
          reason: payload.reason,
          approvedById: payload.approvedById,
          approverEmail: payload.approverEmail,
          managerPin: payload.managerPin,
          occurredAt,
        });
        return { id: movement.id };
      }
      case 'sale.checkout': {
        const { clientId: _c, provisionalNumber, ...checkout } = payload;
        const res = await this.pos.checkout({ ...checkout, occurredAt } as any);
        await this.stampSale(res, device.id, provisionalNumber);
        return {
          id: res.invoiceId,
          mapping: { invoiceId: res.invoiceId, orderId: res.orderId, receiptId: res.receiptId ?? '' },
          finalNumbers: { invoiceNumber: res.invoiceNumber, orderNumber: res.orderNumber },
        };
      }
      case 'tab.settle': {
        const { clientId: _c2, provisionalNumber, tableId, ...settle } = payload;
        const res = await this.pos.settleTab({ tableId, ...settle, occurredAt } as any);
        await this.stampSale(res as any, device.id, provisionalNumber);
        return {
          id: (res as any).invoiceId,
          mapping: { invoiceId: (res as any).invoiceId },
          finalNumbers: { invoiceNumber: (res as any).invoiceNumber ?? '' },
        };
      }
      case 'sale.refund': {
        // Offline refund of a synced (or same-batch) sale. `invoiceId` is the
        // server invoice id, or the sale's client id resolved via clientIdMap.
        // `lines` (optional) carries server invoice-item ids for a partial
        // refund; omit for a full refund.
        if (!payload.invoiceId) throw new HttpException('sale.refund requires an invoiceId', 400);
        const res: any = await this.billing.refund(String(payload.invoiceId), payload.reason, {
          overrideById: payload.overrideById,
          cashSessionId: payload.cashSessionId,
          lines: Array.isArray(payload.lines) && payload.lines.length ? payload.lines : undefined,
        });
        const invId = res?.invoiceId ?? String(payload.invoiceId);
        return { id: invId, mapping: { invoiceId: invId } };
      }
      case 'sale.void': {
        // A void is a full refund with a MANDATORY manager override — the same
        // rule the online POST /pos/sales/:id/void enforces.
        if (!payload.invoiceId) throw new HttpException('sale.void requires an invoiceId', 400);
        const res: any = await this.billing.refund(
          String(payload.invoiceId),
          `VOID: ${payload.reason ?? ''}`,
          {
            overrideById: payload.overrideById,
            cashSessionId: payload.cashSessionId,
            requireOverride: true,
          },
        );
        const invId = res?.invoiceId ?? String(payload.invoiceId);
        return { id: invId, mapping: { invoiceId: invId } };
      }
      case 'reservation.create': {
        // clientId maps to the new server reservation id (applyOp records it),
        // so later seat/cancel ops in the batch resolve their reservationId.
        const { clientId: _rc, ...dto } = payload;
        const r: any = await this.reservations.create(dto as any);
        return { id: r.id, mapping: { reservationId: r.id } };
      }
      case 'reservation.seat': {
        if (!payload.reservationId) throw new HttpException('reservation.seat requires a reservationId', 400);
        const r: any = await this.reservations.seat(String(payload.reservationId), { orderId: payload.orderId });
        return { id: r.id, mapping: { reservationId: r.id } };
      }
      case 'reservation.cancel': {
        if (!payload.reservationId) throw new HttpException('reservation.cancel requires a reservationId', 400);
        const r: any = await this.reservations.cancel(String(payload.reservationId));
        return { id: r.id, mapping: { reservationId: r.id } };
      }
      case 'reservation.noShow': {
        if (!payload.reservationId) throw new HttpException('reservation.noShow requires a reservationId', 400);
        const r: any = await this.reservations.markNoShow(String(payload.reservationId));
        return { id: r.id, mapping: { reservationId: r.id } };
      }
      case 'customer.upsert': {
        // Device-created customer: the client-minted uuid IS the Partner id,
        // so sale.checkout ops can reference it with no id remapping.
        const id = String(payload.id ?? payload.clientId ?? '');
        if (!id) throw new HttpException('customer.upsert requires an id', 400);
        if (!payload.name || typeof payload.name !== 'string') {
          throw new HttpException('customer.upsert requires a name', 400);
        }
        const partner = await this.upsertPartner(device, id, payload);
        return { id: partner, mapping: { customerId: partner } };
      }
      case 'customer.delete': {
        const id = String(payload.id ?? '');
        if (!id) throw new HttpException('customer.delete requires an id', 400);
        // Soft delete — the tombstone reaches other devices via the partners
        // pull scope instead of resurrecting the customer on the next pull.
        await this.prisma.client.partner.updateMany({
          where: { id, isCustomer: true },
          data: { deletedAt: new Date() },
        });
        return { id };
      }
      case 'setting.set': {
        // Devices hold only an X-Device-Token, so org settings they may write
        // are tunneled through the op queue against a strict whitelist.
        const key = String(payload.key ?? '');
        const value = payload.value;
        if (key !== 'pos.mode') throw new HttpException(`Device may not set setting '${key}'`, 400);
        if (value !== 'cafe' && value !== 'retail') {
          throw new HttpException(`Invalid pos.mode value: ${String(value)}`, 400);
        }
        // Single source of truth: OrganizationModule config + mirrored Setting.
        await this.pos.updatePosSettings({ posMode: value });
        return { id: key };
      }
      // ───────────── Master-data authoring (both modes) ─────────────
      // The device mints the row UUID and it IS the server id (no remap,
      // like customer.upsert). Thin catalog rows are written directly (the
      // pull reads them raw); side-effect entities (product, cashRegister)
      // go through their services so GL/audit/events still fire.
      case 'menuCategory.upsert': {
        const id = this.requireId(payload);
        await this.thinUpsert('menuCategory', id, {
          name: payload.name,
          parentId: payload.parentId ?? null,
          image: payload.image ?? null,
          icon: payload.icon ?? null,
          displayOrder: payload.displayOrder ?? 0,
          isActive: payload.isActive ?? true,
        });
        return { id, mapping: { menuCategoryId: id } };
      }
      case 'menuCategory.delete': {
        const id = this.requireId(payload);
        await this.prisma.client.menuCategory.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
        return { id };
      }
      case 'menuItem.upsert':
        return this.upsertMenuItem(payload);
      case 'menuItem.delete': {
        const id = this.requireId(payload);
        // MenuItem has no deletedAt — the "delete" is isAvailable=false (matches pull).
        await this.prisma.client.menuItem.updateMany({ where: { id }, data: { isAvailable: false } });
        return { id };
      }
      case 'modifierGroup.upsert':
        return this.upsertModifierGroup(payload);
      case 'modifierGroup.delete': {
        const id = this.requireId(payload);
        await this.prisma.client.modifierGroup.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
        return { id };
      }
      case 'accompanimentGroup.upsert':
        return this.upsertAccompanimentGroup(payload);
      case 'accompanimentGroup.delete': {
        const id = this.requireId(payload);
        await this.prisma.client.accompanimentGroup.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
        return { id };
      }
      case 'tax.upsert': {
        const id = this.requireId(payload);
        await this.thinUpsert('tax', id, {
          name: payload.name,
          rate: payload.rate ?? 0,
          isInclusive: payload.isInclusive ?? false,
          isActive: payload.isActive ?? true,
          ...(payload.code !== undefined ? { code: payload.code } : {}),
        });
        return { id, mapping: { taxId: id } };
      }
      case 'tax.delete': {
        const id = this.requireId(payload);
        await this.prisma.client.tax.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
        return { id };
      }
      case 'productCategory.upsert': {
        const id = this.requireId(payload);
        await this.thinUpsert('productCategory', id, {
          name: payload.name,
          parentId: payload.parentId ?? null,
        });
        return { id, mapping: { productCategoryId: id } };
      }
      case 'productCategory.delete': {
        const id = this.requireId(payload);
        await this.prisma.client.productCategory.updateMany({ where: { id }, data: { deletedAt: new Date() } });
        return { id };
      }
      case 'posTable.upsert': {
        const id = this.requireId(payload);
        await this.thinUpsert('posTable', id, {
          name: payload.name ?? String(payload.number ?? ''),
          number: Number(payload.number ?? 0),
          sortOrder: payload.sortOrder ?? 0,
          ...(payload.seats !== undefined ? { seats: Number(payload.seats) } : {}),
          ...(payload.zone !== undefined ? { zone: payload.zone } : {}),
          active: payload.active ?? true,
        });
        return { id, mapping: { posTableId: id } };
      }
      case 'posTable.delete': {
        const id = this.requireId(payload);
        // PosTable has no deletedAt — deactivate via `active`.
        await this.prisma.client.posTable.updateMany({ where: { id }, data: { active: false } });
        return { id };
      }
      case 'product.upsert': {
        const id = this.requireId(payload);
        const existing = await this.prisma.client.product.findFirst({ where: { id } });
        const fields: Record<string, any> = {
          name: payload.name,
          sku: payload.sku ?? null,
          barcode: payload.barcode ?? null,
          description: payload.description ?? null,
          categoryId: payload.categoryId ?? null,
          taxId: payload.taxId ?? null,
          salesPrice: payload.salesPrice ?? null,
          costPrice: payload.costPrice ?? null,
          image: payload.image ?? null,
          isActive: payload.isActive ?? true,
          ...(payload.productType ? { productType: payload.productType } : {}),
        };
        if (existing) await this.products.update(id, fields as any);
        else await this.products.create({ id, code: payload.code ?? this.deriveCode('P', id), ...fields } as any);
        return { id, mapping: { productId: id } };
      }
      case 'product.delete': {
        const id = this.requireId(payload);
        await this.products.remove(id);
        return { id };
      }
      case 'cashRegister.upsert': {
        const id = this.requireId(payload);
        const existing = await this.prisma.client.cashRegister.findFirst({ where: { id } });
        if (existing) {
          await this.prisma.client.cashRegister.updateMany({
            where: { id },
            data: { name: payload.name ?? existing.name },
          });
        } else {
          // Service create also provisions the GL cash-drawer account.
          await this.cashRegisters.create({ id, code: payload.code ?? this.deriveCode('REG', id), name: payload.name ?? 'Register' });
        }
        return { id, mapping: { cashRegisterId: id } };
      }
      case 'cashRegister.delete': {
        const id = this.requireId(payload);
        await this.cashRegisters.remove(id);
        return { id };
      }
      case 'staff.pinChange': {
        // Self-service PIN change from an enrolled device. The device hashes
        // the new PIN with bcrypt (same cost as the server) and sends the hash
        // — the server never sees the plaintext. Only the actor's own row is
        // touched, scoped to the tenant the device is enrolled in. The next
        // pull delivers the updated pinHash to every device.
        const userId = payload.userId ? String(payload.userId) : '';
        const newPinHash = payload.newPinHash ? String(payload.newPinHash) : '';
        if (!userId || !newPinHash) {
          throw new HttpException('staff.pinChange requires userId and newPinHash', 400);
        }
        const actorId = op.actorUserId ? String(op.actorUserId) : '';
        if (actorId && actorId !== userId) {
          throw new HttpException('staff.pinChange may only change the actor\'s own PIN', 403);
        }
        const orgId = this.tenant.organizationId;
        const updated = await this.prisma.client.user.updateMany({
          where: { id: userId, organizationId: orgId, isActive: true, deletedAt: null },
          data: { pinHash: newPinHash },
        });
        if (updated.count === 0) {
          throw new HttpException('User not found in this organization', 404);
        }
        return { id: userId };
      }
      // ───────────── Communication (Phase 5) — offline staff messaging ─────────
      // Deliberately prisma-direct (no MessageService dep): the communication
      // module is flag-gated, and sync must boot whether or not it is enabled.
      // Other devices receive the message via the `messages` pull scope; web via
      // its next poll. The client-minted id IS the server id, so a replay upserts.
      case 'message.send': {
        const messageId = String(payload.clientId ?? payload.id ?? '');
        const conversationId = String(payload.conversationId ?? '');
        const body = String(payload.body ?? '').trim();
        if (!messageId) throw new HttpException('message.send requires a clientId', 400);
        if (!conversationId || !body) throw new HttpException('message.send requires conversationId and body', 400);
        const conv = await this.prisma.client.conversation.findFirst({
          where: { id: conversationId, deletedAt: null },
          select: { syncToDevices: true },
        });
        if (!conv) throw new HttpException('Conversation not found', 404);
        // A till may only post to device-visible channels — never a DM/customer thread.
        if (!conv.syncToDevices) throw new HttpException('Conversation is not device-visible', 403);
        try {
          const m = await this.prisma.client.message.create({
            data: {
              id: messageId,
              organizationId: this.tenant.organizationId,
              conversationId,
              senderType: 'user',
              senderUserId: op.actorUserId,
              contentType: 'text',
              body,
              occurredAt: new Date(occurredAt),
            },
            select: { id: true, seq: true },
          });
          await this.prisma.client.conversation.updateMany({ where: { id: conversationId }, data: { updatedAt: new Date() } });
          // seq as string — a BigInt in the cached idempotency body would not serialize.
          return { id: m.id, mapping: { messageId: m.id }, syncSequence: m.seq.toString() };
        } catch (e: any) {
          if (e?.code === 'P2002') {
            const existing = await this.prisma.client.message.findFirst({ where: { id: messageId }, select: { id: true } });
            if (existing) return { id: existing.id, mapping: { messageId: existing.id } };
          }
          throw e;
        }
      }
      case 'message.markRead': {
        const conversationId = String(payload.conversationId ?? '');
        const messageId = payload.messageId ? String(payload.messageId) : '';
        if (!conversationId || !messageId) throw new HttpException('message.markRead requires conversationId and messageId', 400);
        await this.prisma.client.conversationParticipant.updateMany({
          where: { conversationId, userId: op.actorUserId, participantType: 'user' },
          data: { lastReadMessageId: messageId },
        });
        return { id: conversationId };
      }
      default:
        throw new HttpException(`Unsupported sync op type: ${op.type}`, 400);
    }
  }

  /** A master-data op must carry the client-minted row id (== server id). */
  private requireId(payload: Record<string, any>): string {
    const id = payload.id ? String(payload.id) : '';
    if (!id) throw new HttpException('Master-data op requires an id', 400);
    return id;
  }

  /** Deterministic unique code from a uuid (Partner/Product/Register style). */
  private deriveCode(prefix: string, id: string): string {
    return `${prefix}-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  }

  /** find-then-create/update keyed by the client id, on a tenant-scoped delegate. */
  private async thinUpsert(model: string, id: string, data: Record<string, any>): Promise<void> {
    const delegate = (this.prisma.client as any)[model];
    const existing = await delegate.findFirst({ where: { id } });
    if (existing) await delegate.updateMany({ where: { id }, data });
    else await delegate.create({ data: { id, ...data } });
  }

  /** Menu item as a full aggregate: item row + variants + group assignments. */
  private async upsertMenuItem(payload: Record<string, any>): Promise<any> {
    const id = this.requireId(payload);
    await this.thinUpsert('menuItem', id, {
      code: payload.code ?? null,
      name: payload.name,
      description: payload.description ?? null,
      categoryId: payload.categoryId ?? null,
      // basePrice arrives server-shaped (MINOR units) — stored verbatim.
      basePrice: payload.basePrice ?? null,
      taxId: payload.taxId ?? null,
      image: payload.image ?? null,
      isAvailable: payload.isAvailable ?? true,
      displayOrder: payload.displayOrder ?? 0,
      ...(payload.isInventoryTracked !== undefined ? { isInventoryTracked: !!payload.isInventoryTracked } : {}),
    });
    if (Array.isArray(payload.variants)) {
      const keep = payload.variants.map((v: any) => String(v.id)).filter(Boolean);
      await this.prisma.client.menuItemVariant.updateMany({
        where: { menuItemId: id, ...(keep.length ? { id: { notIn: keep } } : {}) },
        data: { deletedAt: new Date(), isActive: false },
      });
      for (const v of payload.variants) {
        const vid = v.id ? String(v.id) : '';
        if (!vid) continue;
        await this.thinUpsert('menuItemVariant', vid, {
          menuItemId: id,
          name: v.name,
          price: v.price ?? 0,
          sortOrder: v.sortOrder ?? 0,
          isActive: true,
          deletedAt: null,
        });
      }
    }
    if (Array.isArray(payload.modifierGroupIds)) {
      await this.reconcileGroupJoin('menuItemModifierGroup', 'modifierGroupId', id, payload.modifierGroupIds);
    }
    if (Array.isArray(payload.accompanimentGroupIds)) {
      await this.reconcileGroupJoin('menuItemAccompanimentGroup', 'accompanimentGroupId', id, payload.accompanimentGroupIds);
    }
    return { id, mapping: { menuItemId: id } };
  }

  /** Reconcile a menu-item→group join table against the supplied id list. */
  private async reconcileGroupJoin(model: string, fkField: string, menuItemId: string, entries: any[]): Promise<void> {
    const delegate = (this.prisma.client as any)[model];
    const norm = entries.map((e) => (typeof e === 'string' ? { id: e, sortOrder: 0 } : { id: String(e[fkField] ?? e.id ?? ''), sortOrder: e.sortOrder ?? 0 }));
    const ids = norm.map((e) => e.id).filter(Boolean);
    await delegate.updateMany({
      where: { menuItemId, ...(ids.length ? { [fkField]: { notIn: ids } } : {}) },
      data: { deletedAt: new Date() },
    });
    for (const e of norm) {
      if (!e.id) continue;
      const existing = await delegate.findFirst({ where: { menuItemId, [fkField]: e.id } });
      if (existing) await delegate.updateMany({ where: { id: existing.id }, data: { deletedAt: null, sortOrder: e.sortOrder } });
      else await delegate.create({ data: { menuItemId, [fkField]: e.id, sortOrder: e.sortOrder } });
    }
  }

  /** Modifier group as an aggregate (group row + its modifiers). */
  private async upsertModifierGroup(payload: Record<string, any>): Promise<any> {
    const id = this.requireId(payload);
    await this.thinUpsert('modifierGroup', id, {
      name: payload.name,
      groupType: payload.groupType ?? 'ADD_ON',
      minSelect: payload.minSelect ?? 0,
      maxSelect: payload.maxSelect ?? 1,
      sortOrder: payload.sortOrder ?? 0,
      isActive: payload.isActive ?? true,
    });
    if (Array.isArray(payload.modifiers)) {
      const keep = payload.modifiers.map((m: any) => String(m.id)).filter(Boolean);
      await this.prisma.client.modifier.updateMany({
        where: { groupId: id, ...(keep.length ? { id: { notIn: keep } } : {}) },
        data: { deletedAt: new Date(), isActive: false },
      });
      for (const m of payload.modifiers) {
        const mid = m.id ? String(m.id) : '';
        if (!mid) continue;
        await this.thinUpsert('modifier', mid, {
          groupId: id,
          name: m.name,
          kitchenPrintName: m.kitchenPrintName ?? null,
          priceDelta: m.priceDelta ?? 0,
          isDefault: m.isDefault ?? false,
          sortOrder: m.sortOrder ?? 0,
          isActive: true,
          deletedAt: null,
        });
      }
    }
    return { id, mapping: { modifierGroupId: id } };
  }

  /** Accompaniment group as an aggregate (group row + its options). */
  private async upsertAccompanimentGroup(payload: Record<string, any>): Promise<any> {
    const id = this.requireId(payload);
    await this.thinUpsert('accompanimentGroup', id, {
      name: payload.name,
      isRequired: payload.isRequired ?? true,
      minSelect: payload.minSelect ?? 1,
      maxSelect: payload.maxSelect ?? 1,
      sortOrder: payload.sortOrder ?? 0,
      isActive: payload.isActive ?? true,
    });
    if (Array.isArray(payload.options)) {
      const keep = payload.options.map((o: any) => String(o.id)).filter(Boolean);
      await this.prisma.client.accompanimentOption.updateMany({
        where: { groupId: id, ...(keep.length ? { id: { notIn: keep } } : {}) },
        data: { deletedAt: new Date(), isActive: false },
      });
      for (const o of payload.options) {
        const oid = o.id ? String(o.id) : '';
        if (!oid) continue;
        await this.thinUpsert('accompanimentOption', oid, {
          groupId: id,
          name: o.name,
          priceImpact: o.priceImpact ?? 0,
          isDefault: o.isDefault ?? false,
          sortOrder: o.sortOrder ?? 0,
          isActive: true,
          deletedAt: null,
        });
      }
    }
    return { id, mapping: { accompanimentGroupId: id } };
  }

  /**
   * Idempotent create-or-update of a POS customer with a client-supplied id.
   * Loyalty points live in customFields.loyaltyPoints (Partner has no column).
   */
  private async upsertPartner(
    device: RequestDevice,
    id: string,
    payload: Record<string, any>,
  ): Promise<string> {
    const existing = await this.prisma.client.partner.findFirst({ where: { id } });
    const loyalty =
      typeof payload.loyaltyPoints === 'number' ? { loyaltyPoints: payload.loyaltyPoints } : {};
    if (existing) {
      await this.prisma.client.partner.updateMany({
        where: { id },
        data: {
          name: payload.name,
          phone: payload.phone ?? null,
          email: payload.email ?? null,
          notes: payload.note ?? null,
          isCustomer: true,
          customFields: { ...((existing.customFields as Record<string, any>) ?? {}), ...loyalty },
        },
      });
      return id;
    }
    // Partner.code is @@unique([organizationId, code]); derive it from the
    // uuid so collisions are effectively impossible — retry longer on P2002.
    const idHex = id.replace(/-/g, '').toUpperCase();
    for (const len of [8, 16]) {
      try {
        await this.prisma.client.partner.create({
          data: {
            id,
            organizationId: device.organizationId,
            code: `POS-${idHex.slice(0, len)}`,
            name: payload.name,
            phone: payload.phone ?? null,
            email: payload.email ?? null,
            notes: payload.note ?? null,
            isCustomer: true,
            isCompany: false,
            customFields: loyalty,
          },
        });
        return id;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        // Another op may have created this exact partner id concurrently.
        const raced = await this.prisma.client.partner.findFirst({ where: { id } });
        if (raced) return id;
      }
    }
    throw new HttpException(`Could not allocate a unique code for customer ${id}`, 409);
  }

  /** Record which device captured the sale + the number it printed offline. */
  private async stampSale(
    res: { invoiceId?: string; orderId?: string; receiptId?: string },
    deviceId: string,
    provisionalNumber?: string,
  ): Promise<void> {
    const c = this.prisma.raw as any;
    try {
      if (res.invoiceId) {
        await c.invoice.updateMany({
          where: { id: res.invoiceId },
          data: { deviceId, ...(provisionalNumber ? { provisionalNumber } : {}) },
        });
      }
      if (res.orderId) {
        await c.order.updateMany({
          where: { id: res.orderId },
          data: { deviceId, ...(provisionalNumber ? { provisionalNumber } : {}) },
        });
      }
      if (res.receiptId) {
        await c.receipt.updateMany({
          where: { id: res.receiptId },
          data: { deviceId, ...(provisionalNumber ? { provisionalNumber } : {}) },
        });
      }
    } catch (e) {
      // Metadata only — never fail a recorded sale over it.
      this.logger.warn(`stampSale failed: ${String(e)}`);
    }
  }

  private async stampDevice(model: 'cashSession', id: string, deviceId: string): Promise<void> {
    try {
      await (this.prisma.raw as any)[model].updateMany({ where: { id }, data: { deviceId } });
    } catch (e) {
      this.logger.warn(`stampDevice failed: ${String(e)}`);
    }
  }

  private async deadLetter(device: RequestDevice, op: SyncOpDto, error: string, httpStatus: number): Promise<void> {
    try {
      await this.prisma.raw.syncOpDeadLetter.upsert({
        where: { organizationId_opId: { organizationId: device.organizationId, opId: op.opId } },
        create: {
          organizationId: device.organizationId,
          deviceId: device.id,
          opId: op.opId,
          deviceSeq: op.deviceSeq,
          opType: op.type,
          actorUserId: op.actorUserId ?? null,
          occurredAt: op.occurredAt ? new Date(op.occurredAt) : null,
          payload: op.payload as any,
          error,
          httpStatus,
        },
        update: { error, httpStatus },
      });
    } catch (e) {
      // Losing the dead-letter row would silently lose a money op — log loud.
      this.logger.error(`FAILED TO DEAD-LETTER sync op ${op.opId}: ${String(e)}`);
    }
  }
}
