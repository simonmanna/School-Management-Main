import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase F.6 — Web Push (VAPID) delivery.
 *
 * Two runtime modes:
 *   - VAPID keys configured (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT):
 *     real web push delivery via web-push library.
 *   - VAPID keys missing: service generates an ephemeral VAPID keypair at boot
 *     so the subscription API still works (returns the public key to clients)
 *     but delivery is best-effort logged to the console. This is intentional:
 *     dev environments don't need real push, and forcing operators to set VAPID
 *     secrets adds friction.
 *
 * Push subscriptions are persisted in `PushSubscription` (per-user × endpoint).
 * Expired/invalid subscriptions are auto-cleaned on delivery failure.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger('PushService');
  private publicKey = '';
  private privateKey = '';
  private subject = 'mailto:admin@cafe-pos.local';

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? this.subject;
    if (pub && priv) {
      this.publicKey = pub;
      this.privateKey = priv;
      this.subject = subject;
      try {
        webpush.setVapidDetails(subject, pub, priv);
        this.logger.log(`Web Push enabled (subject=${subject})`);
      } catch (err) {
        this.logger.warn(`Invalid VAPID keys, falling back to ephemeral: ${String(err)}`);
        this.generateEphemeral();
      }
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — using ephemeral keypair. Push delivery will be logged, not sent.',
      );
      this.generateEphemeral();
    }
  }

  private generateEphemeral() {
    // web-push exposes generateVAPIDKeys() since v3.
    try {
      const keys = webpush.generateVAPIDKeys();
      if (keys?.publicKey && keys?.privateKey) {
        this.publicKey = keys.publicKey;
        this.privateKey = keys.privateKey;
        webpush.setVapidDetails(this.subject, keys.publicKey, keys.privateKey);
      }
    } catch {
      // No-op — push delivery will be no-op when send() is called without keys.
    }
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  async subscribe(input: {
    organizationId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }) {
    const row = await this.prisma.client.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        organizationId: input.organizationId,
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
    });
    return { id: row.id };
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.raw.pushSubscription.updateMany({
      where: { endpoint },
      data: { revokedAt: new Date() },
    });
  }

  async unsubscribeById(id: string) {
    await this.prisma.raw.pushSubscription.updateMany({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Deliver a payload to all active subscriptions for the given user. Called by
   * NotificationsService whenever a 'push' channel send is requested. Best-effort:
   * on 404/410, the subscription is marked revoked.
   */
  async sendToUser(userId: string, payload: { title: string; body: string; href?: string; tag?: string }) {
    const subs = await this.prisma.raw.pushSubscription.findMany({
      where: { userId, revokedAt: null },
    });
    if (subs.length === 0) return { delivered: 0 };
    if (!this.publicKey || !this.privateKey) {
      // No VAPID configured → log and move on.
      this.logger.debug(`[DEV-PUSH] user=${userId} title=${payload.title} body=${payload.body}`);
      return { delivered: 0, reason: 'no-vapid' as any };
    }
    const json = JSON.stringify(payload);
    let delivered = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            json,
            { TTL: 60 * 60, headers: { Urgency: 'normal' } },
          );
          delivered++;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.prisma.raw.pushSubscription.update({
              where: { id: sub.id },
              data: { revokedAt: new Date() },
            });
          } else {
            this.logger.warn(`Push delivery to ${sub.endpoint.slice(0, 60)} failed: ${String(err)}`);
          }
          failed++;
        }
      }),
    );
    return { delivered, failed };
  }
}
