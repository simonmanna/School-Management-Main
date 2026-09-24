import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PushService } from './push.service';

/**
 * F.5 — Multi-channel notifications.
 *
 * Channels:
 *   - in_app: a row in `Notification` is always created (durable record).
 *   - email:  nodemailer SMTP transport (configurable via env).
 *   - sms:    Twilio (optional). If credentials are missing, SMS is logged as
 *             "would-send" but the in-app row is still created.
 *   - push:   placeholder hook; downstream code can register handlers.
 *
 * Delivery model:
 *   - `send(...)` is fire-and-forget. It writes the in-app row immediately
 *     inside an outbox-friendly path so the notification is durable, then
 *     best-effort dispatches the optional channel. The OutboxWorker (or a
 *     dedicated NotificationWorker) re-attempts failed deliveries.
 */

export interface SendInput {
  organizationId: string;
  userId?: string | null;
  channel: 'in_app' | 'email' | 'sms' | 'push';
  category?: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  /**
   * Deliver to this address instead of the user's own. For people who have no
   * login — an applicant family, a guardian — email/SMS used to throw
   * "requires userId" and nothing was ever sent (E2E audit AD5, N1).
   */
  recipient?: { email?: string | null; phone?: string | null };
  /**
   * What the stored Notification row keeps instead of `body`. A body carrying a
   * one-time link must not persist it: anyone who can read notifications could
   * otherwise lift a live reset/access token from the table (E2E audit A2/AD5).
   */
  storedBody?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('NotificationsService');
  private smtpTransport: nodemailer.Transporter | null = null;
  private twilioClient: any | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly push: PushService,
  ) {}

  onModuleInit(): void {
    if (process.env.SMTP_HOST) {
      this.smtpTransport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
          : undefined,
      });
      this.logger.log(`SMTP transport ready (${process.env.SMTP_HOST})`);
    } else {
      this.logger.warn('SMTP_HOST not set — email notifications will be logged but not sent');
    }
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      // Lazy-load to avoid bundling when SMS is unused.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const twilio = require('twilio');
      this.twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      this.logger.log('Twilio client ready');
    }
  }

  async send(input: SendInput): Promise<{ id: string; delivered: boolean }> {
    // Honour per-user opt-out (defaults to enabled when missing).
    let enabled = true;
    if (input.userId) {
      const pref = await this.prisma.raw.notificationPreference.findUnique({
        where: {
          organizationId_userId_channel_category: {
            organizationId: input.organizationId,
            userId: input.userId,
            channel: input.channel,
            category: input.category ?? 'general',
          },
        },
      });
      if (pref && !pref.enabled) enabled = false;
    }

    // Always write the in-app row for durability, regardless of channel.
    const row = await this.prisma.raw.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        channel: input.channel,
        category: input.category ?? 'general',
        title: input.title,
        body: input.storedBody ?? input.body,
        payload: (input.payload ?? {}) as any,
        status: enabled ? 'pending' : 'failed',
      },
    });

    if (!enabled) return { id: row.id, delivered: false };

    try {
      if (input.channel === 'email') await this.sendEmail(input);
      else if (input.channel === 'sms') await this.sendSms(input, row.id);
      else if (input.channel === 'push' && input.userId) {
        await this.push.sendToUser(input.userId, {
          title: input.title,
          body: input.body,
          href: (input.payload as any)?.href,
          tag: (input.payload as any)?.tag,
        });
      } else if (input.channel === 'in_app') {
        // In-app only: mark sent so the UI badge counts it.
      }
      await this.prisma.raw.notification.update({
        where: { id: row.id },
        data: { status: 'sent', sentAt: new Date() },
      });
      return { id: row.id, delivered: true };
    } catch (err) {
      await this.prisma.raw.notification.update({
        where: { id: row.id },
        data: { status: 'failed', error: String(err).slice(0, 500) },
      });
      this.logger.warn(`Notification ${row.id} failed: ${String(err)}`);
      return { id: row.id, delivered: false };
    }
  }

  private async sendEmail(input: SendInput): Promise<void> {
    let to = input.recipient?.email?.trim() || null;
    if (!to) {
      if (!input.userId) throw new Error('email channel requires userId or recipient.email');
      const user = await this.prisma.raw.user.findFirst({ where: { id: input.userId } });
      to = user?.email ?? null;
    }
    if (!to) throw new Error('No email address on file');
    if (!this.smtpTransport) {
      this.logger.warn(`[DEV-EMAIL] to=${to} subject=${input.title} body=${input.body}`);
      return;
    }
    const from = process.env.SMTP_FROM ?? 'no-reply@cafe-pos.local';
    await this.smtpTransport.sendMail({
      from,
      to,
      subject: input.title,
      text: input.body,
      html: `<p>${escapeHtml(input.body)}</p>`,
    });
  }

  private async sendSms(input: SendInput, notificationId: string): Promise<void> {
    const direct = input.recipient?.phone?.trim() || null;
    if (!direct && !input.userId) throw new Error('sms channel requires userId or recipient.phone');
    if (!this.twilioClient) {
      this.logger.warn(`[DEV-SMS] to=${direct ?? `user:${input.userId}`} body=${input.body}`);
      return;
    }
    let phone = direct;
    if (!phone) {
      const user = await this.prisma.raw.user.findFirst({ where: { id: input.userId! } });
      const partner = user?.email
        ? await this.prisma.raw.partner.findFirst({ where: { organizationId: input.organizationId, email: user.email } })
        : null;
      phone = partner?.phone ?? null;
    }
    if (!phone) throw new Error('No phone number on file');
    await this.twilioClient.messages.create({
      from: process.env.TWILIO_FROM ?? '',
      to: phone,
      body: `${input.title}\n${input.body}`,
    });
  }

  private async sendPush(input: SendInput): Promise<void> {
    // Push notifications are out of scope for the v1 surface; the hook exists
    // so future verticals (mobile apps) can subscribe without API churn.
    this.logger.debug(`push notification ${input.title} -> user=${input.userId ?? 'org'}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
