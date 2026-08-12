import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * F.5 — Outbound webhooks.
 *
 * Subscribers register an endpoint URL + a list of events (or empty for "all").
 * Deliveries are signed with HMAC-SHA256 over the raw body using the
 * endpoint's signing secret; receivers verify by recomputing.
 *
 * Retry policy: exponential backoff (1m, 5m, 30m, 2h, 12h) up to 6 attempts,
 * then status = 'dead'. Operator must re-enable or delete the endpoint.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('WebhooksService');
  private static readonly MAX_ATTEMPTS = 6;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  createEndpoint(params: { url: string; events: string[]; description?: string }) {
    const signingSecret = `whsec_${randomBytes(32).toString('base64url')}`;
    return this.prisma.client.webhookEndpoint.create({
      data: {
        organizationId: this.tenant.organizationId,
        url: params.url,
        events: params.events,
        signingSecret,
        description: params.description ?? null,
        createdById: this.tenant.userId ?? null,
      },
    });
  }

  listEndpoints() {
    return this.prisma.client.webhookEndpoint.findMany({
      where: { organizationId: this.tenant.organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  rotateSecret(id: string) {
    const newSecret = `whsec_${randomBytes(32).toString('base64url')}`;
    return this.prisma.client.webhookEndpoint.update({
      where: { id },
      data: { signingSecret: newSecret },
    });
  }

  deleteEndpoint(id: string) {
    return this.prisma.client.webhookEndpoint.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /** Enqueue a delivery for every matching active endpoint. Called from the
   * outbox worker after a domain event fires. */
  async enqueue(eventName: string, payload: Record<string, unknown>) {
    const orgId = this.tenant.organizationId;
    const endpoints = await this.prisma.raw.webhookEndpoint.findMany({
      where: { organizationId: orgId, isActive: true, deletedAt: null },
    });
    const matched = endpoints.filter((e) => e.events.length === 0 || e.events.includes(eventName));
    if (matched.length === 0) return { queued: 0 };
    await this.prisma.raw.webhookDelivery.createMany({
      data: matched.map((e) => ({
        organizationId: orgId,
        endpointId: e.id,
        eventName,
        payload: payload as any,
        status: 'pending',
        nextAttemptAt: new Date(),
      })),
    });
    return { queued: matched.length };
  }

  /** Sign a body for delivery. Receivers verify by recomputing. */
  signBody(secret: string, body: string, timestamp: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  /** Tick the delivery queue. Called by cron. */
  async tick(): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const now = new Date();
    const due = await this.prisma.raw.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      include: { endpoint: true },
      take: 100,
    });
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    for (const d of due) {
      if (!d.endpoint.isActive) continue;
      attempted++;
      const ok = await this.deliver(d);
      if (ok) succeeded++;
      else failed++;
    }
    return { attempted, succeeded, failed };
  }

  private async deliver(d: any): Promise<boolean> {
    const body = JSON.stringify({
      id: d.id,
      event: d.eventName,
      createdAt: d.createdAt,
      data: d.payload,
    });
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = this.signBody(d.endpoint.signingSecret, body, ts);
    try {
      const res = await fetch(d.endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ERP-Event': d.eventName,
          'X-ERP-Delivery': d.id,
          'X-ERP-Timestamp': ts,
          'X-ERP-Signature': `t=${ts},v1=${sig}`,
          'User-Agent': 'ERP-Webhooks/1.0',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const attempts = d.attempts + 1;
      const text = (await res.text()).slice(0, 2000);
      if (res.ok) {
        await this.prisma.raw.webhookDelivery.update({
          where: { id: d.id },
          data: {
            status: 'succeeded',
            attempts,
            succeededAt: new Date(),
            responseStatus: res.status,
            responseBody: text,
            lastAttemptAt: new Date(),
            nextAttemptAt: null,
          },
        });
        return true;
      }
      await this.scheduleRetry(d.id, attempts, res.status, text, `HTTP ${res.status}`);
      return false;
    } catch (err) {
      await this.scheduleRetry(d.id, d.attempts + 1, null, null, String(err));
      return false;
    }
  }

  private async scheduleRetry(id: string, attempts: number, status: number | null, body: string | null, error: string) {
    const dead = attempts >= WebhooksService.MAX_ATTEMPTS;
    const backoffMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000][attempts - 1] ?? 60_000;
    await this.prisma.raw.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        status: dead ? 'dead' : 'failed',
        responseStatus: status,
        responseBody: body,
        error,
        lastAttemptAt: new Date(),
        nextAttemptAt: dead ? null : new Date(Date.now() + backoffMs),
      },
    });
  }

  listDeliveries(endpointId?: string) {
    const where: any = { organizationId: this.tenant.organizationId };
    if (endpointId) where.endpointId = endpointId;
    return this.prisma.raw.webhookDelivery.findMany({
      where,
      include: { endpoint: true },
      orderBy: { id: 'desc' },
      take: 200,
    });
  }
}
