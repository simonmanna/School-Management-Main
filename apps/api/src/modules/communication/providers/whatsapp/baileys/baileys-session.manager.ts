import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { CommunicationStreamService } from '../../../communication-stream.service';
import { NotificationsService } from '../../../../../kernel/notifications/notifications.service';
import { InboundMessageService } from '../../../inbound/inbound-message.service';
import { DeliveryStatusService } from '../../../inbound/delivery-status.service';
import { CommSecretService } from '../comm-secret.service';
import { ProviderSendError } from '../../messaging-provider.interface';
import { loadBaileys, type Baileys } from './baileys-lib';
import { useDbAuthState } from './baileys-auth-state';
import { mapWaMessage, jidToPhone } from './baileys-mapper';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 60_000];

interface Session {
  organizationId: string;
  sock: Baileys | null;
  status: string;
  tail: Promise<void>;
  backoffIdx: number;
  closing: boolean;
}

/**
 * Owns the live Baileys sockets. EXPERIMENTAL transport — unofficial, ToS/ban
 * risk; the Cloud provider is the production target. Gated behind
 * ENABLE_COMMUNICATION_WHATSAPP + WHATSAPP_TRANSPORT=baileys, and independently
 * disablable.
 *
 * Single-writer by DB lease (not a sidecar): two sockets on one WhatsApp account
 * is a fast ban, so exactly one process may own a channel's socket. The lease is
 * claimed with the same FOR UPDATE SKIP LOCKED pattern as the outbox worker; a
 * replica that loses the lease closes its socket, and onModuleDestroy releases it
 * so failover is seconds.
 *
 * Every Baileys emitter callback is wrapped — an unhandled rejection from the
 * library would take down the whole API process.
 */
@Injectable()
export class BaileysSessionManager implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BaileysSession');
  private readonly processToken = randomUUID();
  private readonly sessions = new Map<string, Session>();
  private leaseTimer: NodeJS.Timeout | null = null;
  private readonly leaseIntervalMs = 10_000;
  private readonly staleLeaseMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly secret: CommSecretService,
    private readonly stream: CommunicationStreamService,
    private readonly notifications: NotificationsService,
    private readonly inbound: InboundMessageService,
    private readonly deliveryStatus: DeliveryStatusService,
  ) {}

  private get enabled(): boolean {
    return process.env.ENABLE_COMMUNICATION_WHATSAPP === 'true' && process.env.WHATSAPP_TRANSPORT === 'baileys';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Baileys transport disabled — session manager idle.');
      return;
    }
    this.logger.warn('Baileys (EXPERIMENTAL WhatsApp transport) enabled.');
    this.scheduleLease();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    // Release leases we own so another replica can take over quickly.
    await this.prisma.raw.communicationChannel
      .updateMany({ where: { leaseOwnerToken: this.processToken }, data: { leaseOwnerToken: null, leaseHeartbeatAt: null } })
      .catch(() => undefined);
    for (const [, s] of this.sessions) {
      try {
        s.sock?.end?.(undefined);
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }

  /* ── Lease election ────────────────────────────────────────────────────── */

  private scheduleLease(): void {
    void this.leaseTick();
    this.leaseTimer = setInterval(() => void this.guard('leaseTick', () => this.leaseTick()), this.leaseIntervalMs);
  }

  private async leaseTick(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.staleLeaseMs);
    const claimed = await this.prisma.raw.$queryRaw<{ id: string; organization_id: string }[]>`
      UPDATE "CommunicationChannel"
      SET "leaseOwnerToken" = ${this.processToken}, "leaseHeartbeatAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "CommunicationChannel"
        WHERE "providerId" = 'whatsapp' AND "transport" = 'baileys'
          AND "desiredState" = 'connected' AND "disabledAt" IS NULL
          AND ("leaseOwnerToken" = ${this.processToken}
               OR "leaseHeartbeatAt" IS NULL
               OR "leaseHeartbeatAt" < ${staleBefore})
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "organizationId" AS organization_id
    `;
    const claimedIds = new Set(claimed.map((c) => c.id));

    // Open any newly-claimed channel we are not already running.
    for (const c of claimed) {
      if (!this.sessions.has(c.id)) {
        await this.guard('openSession', () => this.openSession(c.id, c.organization_id));
      }
    }
    // Close any session whose lease we no longer hold (migrated / desired=disconnected).
    for (const id of [...this.sessions.keys()]) {
      if (!claimedIds.has(id)) await this.closeSession(id, false);
    }
  }

  /* ── Session lifecycle ─────────────────────────────────────────────────── */

  private async openSession(channelId: string, organizationId: string): Promise<void> {
    if (this.sessions.has(channelId)) return;
    const entry: Session = { organizationId, sock: null, status: 'connecting', tail: Promise.resolve(), backoffIdx: 0, closing: false };
    this.sessions.set(channelId, entry);
    await this.setStatus(channelId, 'connecting');

    let baileys: Baileys;
    try {
      baileys = await loadBaileys();
    } catch (err) {
      this.logger.error(`Baileys load failed: ${String(err)}`);
      this.sessions.delete(channelId);
      await this.setStatus(channelId, 'error', { lastError: String(err).slice(0, 300) });
      return;
    }

    const { state, saveCreds } = await useDbAuthState(this.prisma, this.secret, organizationId, channelId);
    // makeWASocket is the default export; some builds also expose it by name.
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const sock: Baileys = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: ['POS-CAFE', 'Chrome', '1.0.0'],
      getMessage: async () => undefined,
    });
    entry.sock = sock;

    sock.ev.on('creds.update', () => void this.guard('saveCreds', () => saveCreds()));
    sock.ev.on('connection.update', (u: Record<string, unknown>) =>
      void this.guard('connectionUpdate', () => this.onConnectionUpdate(channelId, u)),
    );
    sock.ev.on('messages.upsert', (ev: Record<string, unknown>) => this.onInbound(channelId, ev));
    sock.ev.on('messages.update', (updates: unknown[]) =>
      void this.guard('receipts', () => this.onReceipts(channelId, updates)),
    );
    sock.ev.on('message-receipt.update', (updates: unknown[]) =>
      void this.guard('receipts', () => this.onReceipts(channelId, updates)),
    );
  }

  private async closeSession(channelId: string, logout: boolean): Promise<void> {
    const entry = this.sessions.get(channelId);
    if (!entry) return;
    entry.closing = true;
    try {
      if (logout) await entry.sock?.logout?.();
      else entry.sock?.end?.(undefined);
    } catch {
      /* ignore */
    }
    this.sessions.delete(channelId);
  }

  private async onConnectionUpdate(channelId: string, u: Record<string, unknown>): Promise<void> {
    const entry = this.sessions.get(channelId);
    if (!entry) return;
    const baileys = await loadBaileys();
    const DisconnectReason = baileys.DisconnectReason as Record<string, number>;

    if (u.qr) {
      await this.publishQr(channelId, entry.organizationId, String(u.qr));
      return;
    }
    if (u.connection === 'open') {
      entry.backoffIdx = 0;
      entry.status = 'connected';
      await this.setStatus(channelId, 'connected', {
        lastConnectedAt: new Date(),
        pairingQr: null,
        pairingQrExpiresAt: null,
        consecutiveFailures: 0,
        pairedAt: undefined, // set below only if first pairing
      });
      await this.markPairedIfNeeded(channelId);
      return;
    }
    if (u.connection !== 'close') return;

    const statusCode = extractStatusCode(u);
    switch (statusCode) {
      case DisconnectReason?.loggedOut:
      case DisconnectReason?.badSession:
        await this.purgeAuthState(channelId);
        await this.closeSession(channelId, false);
        await this.setStatus(channelId, 'logged_out', { desiredState: 'disconnected', lastError: 'logged_out' });
        await this.notifyAdmins(channelId, entry.organizationId, 'WhatsApp disconnected — re-scan the QR to reconnect.');
        return;
      case DisconnectReason?.connectionReplaced:
        // Another client took the session. Do NOT auto-reconnect — it fights the
        // other client and is a reliable way to get flagged.
        await this.closeSession(channelId, false);
        await this.setStatus(channelId, 'logged_out', { desiredState: 'disconnected', lastError: 'connection_replaced' });
        await this.notifyAdmins(channelId, entry.organizationId, 'WhatsApp session was taken over by another device.');
        return;
      case DisconnectReason?.restartRequired:
        await this.reconnect(channelId, 0);
        return;
      default:
        await this.reconnect(channelId, this.nextBackoff(entry));
    }
  }

  private async reconnect(channelId: string, delayMs: number): Promise<void> {
    const entry = this.sessions.get(channelId);
    if (!entry || entry.closing) return;
    entry.status = 'connecting';
    await this.setStatus(channelId, 'connecting', { consecutiveFailures: { increment: 1 } });
    // Drop the current socket and re-open after the delay; the lease loop would
    // also re-open, but an explicit timer keeps reconnect latency low.
    this.sessions.delete(channelId);
    setTimeout(() => void this.guard('reopen', () => this.openSession(channelId, entry.organizationId)), delayMs);
  }

  private nextBackoff(entry: Session): number {
    const idx = Math.min(entry.backoffIdx, BACKOFF_MS.length - 1);
    entry.backoffIdx = idx + 1;
    const base = BACKOFF_MS[idx];
    return base + base * (Math.random() * 0.4 - 0.2);
  }

  /* ── Inbound + receipts ────────────────────────────────────────────────── */

  private onInbound(channelId: string, ev: Record<string, unknown>): void {
    const entry = this.sessions.get(channelId);
    if (!entry) return;
    if (ev.type !== 'notify') return; // 'append' = history backfill, ignore
    const messages = (ev.messages as Record<string, unknown>[]) ?? [];
    // Serialize per channel so two messages from a new contact cannot race on
    // conversation creation.
    entry.tail = entry.tail
      .then(() =>
        this.tenant.run({ organizationId: entry.organizationId }, async () => {
          for (const m of messages) {
            const mapped = mapWaMessage(m);
            if (!mapped) continue;
            await this.inbound.ingest({
              organizationId: entry.organizationId,
              channelId,
              providerId: 'whatsapp',
              externalConversationId: mapped.remoteJid,
              externalMessageId: mapped.id,
              externalSenderId: mapped.senderJid,
              senderAddress: jidToPhone(mapped.senderJid),
              senderDisplayName: mapped.pushName,
              body: mapped.text,
              contentType: mapped.contentType,
              occurredAt: mapped.timestamp,
              raw: m,
            });
          }
        }),
      )
      .catch((e) => this.logger.error(`inbound ingest failed: ${String(e)}`));
  }

  private async onReceipts(channelId: string, updates: unknown[]): Promise<void> {
    const entry = this.sessions.get(channelId);
    if (!entry) return;
    await this.tenant.run({ organizationId: entry.organizationId }, async () => {
      for (const u of updates as Record<string, any>[]) {
        const id = u?.key?.id as string | undefined;
        if (!id) continue;
        const status = mapReceiptStatus(u);
        if (!status) continue;
        await this.deliveryStatus
          .applyProviderStatus({ providerId: 'whatsapp', providerMessageId: id, status, at: new Date() })
          .catch((e) => this.logger.warn(`receipt apply failed: ${String(e)}`));
      }
    });
  }

  /* ── Outbound (called by the provider) ─────────────────────────────────── */

  isReady(channelId: string): boolean {
    const s = this.sessions.get(channelId);
    return !!s && s.status === 'connected' && !!s.sock;
  }

  async send(channelId: string, toJid: string, body: string, messageId: string): Promise<string> {
    const entry = this.sessions.get(channelId);
    if (!entry || entry.status !== 'connected' || !entry.sock) {
      throw new ProviderSendError('WhatsApp channel not connected', 'channel_not_ready', true, false);
    }
    const sock = entry.sock;
    try {
      // Human-like presence before sending — part of the anti-ban posture.
      await sock.presenceSubscribe?.(toJid).catch(() => undefined);
      await sock.sendPresenceUpdate?.('composing', toJid).catch(() => undefined);
      await sleep(Math.min(3_000, 40 * body.length) + Math.random() * 400);
      await sock.sendPresenceUpdate?.('paused', toJid).catch(() => undefined);
      // WhatsApp dedupes on (remoteJid, id, fromMe); supplying our id makes a
      // retry after an ambiguous timeout effectively-once.
      await sock.sendMessage(toJid, { text: body }, { messageId });
      return messageId;
    } catch (err) {
      // We cannot always tell whether the message left — treat as ambiguous so
      // the dispatcher clamps retries.
      throw new ProviderSendError(String(err), 'send_failed', true, true);
    }
  }

  async markRead(channelId: string, remoteJid: string, externalMessageId: string): Promise<void> {
    const entry = this.sessions.get(channelId);
    if (!entry?.sock) return;
    try {
      await entry.sock.readMessages?.([{ remoteJid, id: externalMessageId, participant: undefined }]);
    } catch {
      /* best effort */
    }
  }

  normalizeAddress(raw: string): string {
    // E.164 phone → WhatsApp jid. Already-jid strings pass through.
    if (raw.includes('@')) return raw;
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) throw new Error(`Invalid WhatsApp address '${raw}'`);
    return `${digits}@s.whatsapp.net`;
  }

  async requestConnect(channelId: string): Promise<void> {
    await this.prisma.raw.communicationChannel.update({
      where: { id: channelId },
      data: { desiredState: 'connected', status: 'connecting', lastError: null },
    });
    // Try to claim + open immediately rather than waiting for the next lease tick.
    if (this.enabled) await this.guard('leaseTick', () => this.leaseTick());
  }

  async requestDisconnect(channelId: string, logout: boolean): Promise<void> {
    await this.prisma.raw.communicationChannel.update({
      where: { id: channelId },
      data: { desiredState: 'disconnected', status: 'disconnected' },
    });
    if (logout) await this.purgeAuthState(channelId);
    await this.closeSession(channelId, logout);
  }

  channelHealth(channelId: string): { ownedByThisProcess: boolean; status: string } {
    const s = this.sessions.get(channelId);
    return { ownedByThisProcess: !!s, status: s?.status ?? 'disconnected' };
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  private async publishQr(channelId: string, organizationId: string, qr: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 55_000);
    await this.setStatus(channelId, 'pairing', { pairingQr: qr, pairingQrExpiresAt: expiresAt });
    let pngDataUrl = '';
    try {
      pngDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 264 });
    } catch (e) {
      this.logger.warn(`QR render failed: ${String(e)}`);
    }
    this.stream.emitToPermission(organizationId, 'communication:channel:read', {
      type: 'channel.status',
      channelId,
      status: 'pairing',
      qrPngDataUrl: pngDataUrl,
      expiresAt: expiresAt.toISOString(),
    });
  }

  private async markPairedIfNeeded(channelId: string): Promise<void> {
    const row = await this.prisma.raw.communicationChannel.findUnique({ where: { id: channelId }, select: { pairedAt: true } });
    if (!row?.pairedAt) {
      await this.prisma.raw.communicationChannel.update({ where: { id: channelId }, data: { pairedAt: new Date() } });
    }
  }

  private async purgeAuthState(channelId: string): Promise<void> {
    await this.prisma.raw.whatsAppAuthState.deleteMany({ where: { channelId } }).catch(() => undefined);
  }

  private async setStatus(channelId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
    const s = this.sessions.get(channelId);
    if (s) s.status = status;
    // Strip a sentinel `undefined` (used to mean "don't touch").
    const data: Record<string, unknown> = { status };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) data[k] = v;
    await this.prisma.raw.communicationChannel.update({ where: { id: channelId }, data }).catch(() => undefined);
    const org = s?.organizationId;
    if (org) {
      this.stream.emitToPermission(org, 'communication:channel:read', { type: 'channel.status', channelId, status });
    }
  }

  private async notifyAdmins(channelId: string, organizationId: string, message: string): Promise<void> {
    const admins = await this.prisma.raw.user.findMany({
      where: { organizationId, roles: { some: { permissions: { has: 'communication:channel:manage' } } } },
      select: { id: true },
    });
    for (const a of admins) {
      await this.notifications
        .send({
          organizationId,
          userId: a.id,
          channel: 'in_app',
          category: 'communication',
          title: 'WhatsApp channel needs attention',
          body: message,
          payload: { dedupeKey: `comm.channel:${channelId}:${message}`, href: '/communication/channels' },
        })
        .catch(() => undefined);
    }
  }

  /** Wrap a fallible async op so a Baileys throw never escapes to the process. */
  private async guard(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`${label} failed: ${String(err)}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Baileys nests the DisconnectReason status code under lastDisconnect.error.output.statusCode. */
function extractStatusCode(u: Record<string, unknown>): number | undefined {
  const lastDisconnect = u.lastDisconnect as { error?: { output?: { statusCode?: number } } } | undefined;
  return lastDisconnect?.error?.output?.statusCode;
}

/** Map a Baileys receipt/update to our monotonic delivery status, if any. */
function mapReceiptStatus(u: Record<string, any>): 'sent' | 'delivered' | 'read' | null {
  // messages.update carries an enum `status` (2=server ack,3=delivered,4=read,5=played).
  const status = u?.update?.status ?? u?.status;
  if (status === 2) return 'sent';
  if (status === 3) return 'delivered';
  if (status === 4 || status === 5) return 'read';
  // message-receipt.update carries a receipt.receiptTimestamp / readTimestamp.
  if (u?.receipt?.readTimestamp) return 'read';
  if (u?.receipt?.receiptTimestamp) return 'delivered';
  return null;
}
