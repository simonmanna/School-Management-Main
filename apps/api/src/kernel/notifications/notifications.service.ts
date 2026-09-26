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
 *   - sms:    the school's own SMS gateway (communication module, registered
 *             at boot via `registerSmsTransport`), else Twilio from env.
 *   - With no provider for a channel the row is marked `failed` with the
 *     reason — never `sent`. A parent told nothing must not look told
 *     (re-audit P1-2).
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
  /**
   * Idempotency for event-driven sends. Unique per (organization, channel) at
   * the database, so a re-emitted event, a retried outbox row or a second
   * reminder run produces no second message (E2E audit N1).
   */
  dedupeKey?: string;
}

/**
 * A per-school SMS transport supplied by a feature module (the communication
 * module's configured gateway). Registered at boot so the kernel never imports
 * a module (ADR-011). `not_configured` means this school has no gateway and the
 * next transport may be tried.
 */
export interface SmsTransport {
  send(input: { organizationId: string; to: string; body: string; reference: string }): Promise<'sent' | 'not_configured'>;
}

/** Nothing could carry this message. Recorded as a failure with the reason. */
export class NoProviderError extends Error {}

/**
 * E.164 for a human-typed number. "0772 123456" in Uganda is +256772123456;
 * Twilio and every gateway reject the national form.
 */
export function toE164(raw: string, defaultCountryCode = process.env.SMS_DEFAULT_COUNTRY_CODE ?? '+256'): string {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+')) {
    const cc = defaultCountryCode.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = cc + digits.replace(/^0+/, '');
    else if (!digits.startsWith(cc)) digits = cc + digits;
  }
  if (digits.length < 8 || digits.length > 15) throw new Error(`'${raw}' is not a valid phone number`);
  return `+${digits}`;
}

/** A person to reach by their contact details — a guardian has no staff login. */
export interface ContactRecipient {
  id: string;
  email?: string | null;
  phone?: string | null;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('NotificationsService');
  private smtpTransport: nodemailer.Transporter | null = null;
  private twilioClient: any | null = null;
  private smsTransport: SmsTransport | null = null;

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

  /** Called once at boot by the module that owns the school's SMS gateway. */
  registerSmsTransport(transport: SmsTransport): void {
    this.smsTransport = transport;
  }

  async send(input: SendInput): Promise<{ id: string; delivered: boolean; duplicate?: boolean }> {
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
    let row: { id: string };
    try {
      row = await this.prisma.raw.notification.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          channel: input.channel,
          category: input.category ?? 'general',
          title: input.title,
          body: input.storedBody ?? input.body,
          payload: (input.payload ?? {}) as any,
          status: enabled ? 'pending' : 'failed',
          dedupeKey: input.dedupeKey ?? null,
        },
      });
    } catch (err: any) {
      // The partial unique index on (organizationId, channel, dedupeKey): this
      // exact message already went out. Not an error — the point of the key.
      if (input.dedupeKey && err?.code === 'P2002') return { id: '', delivered: false, duplicate: true };
      throw err;
    }

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
      // Release the dedupe key: it exists so a message is not SENT twice, and
      // this one was not sent. Keeping it made every failure permanent — the
      // next reminder run or re-emitted event was discarded as a duplicate.
      await this.prisma.raw.notification.update({
        where: { id: row.id },
        data: { status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 500), dedupeKey: null },
      });
      this.logger.warn(`Notification ${row.id} failed: ${String(err)}`);
      return { id: row.id, delivered: false };
    }
  }

  /**
   * Reach a guardian (or any contact) on every channel they can receive: the
   * portal inbox of the login linked to them, SMS to their phone, email to
   * their address. Returns how many messages were actually delivered — a
   * duplicate or a failed provider call is not a send.
   *
   * The fee, attendance and admissions subscribers used to call `send()` with
   * no userId: SMS and email threw "requires userId", and an in-app row with a
   * null user is shown to nobody, so no parent was ever told anything (N1).
   */
  async notifyContact(input: {
    organizationId: string;
    contact: ContactRecipient;
    category: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    /** Per-message base key; the contact id and channel are appended. */
    dedupeKey: string;
  }): Promise<number> {
    const { contact } = input;
    const key = `${input.dedupeKey}:${contact.id}`;
    const base = {
      organizationId: input.organizationId,
      category: input.category,
      title: input.title,
      body: input.body,
      payload: { ...(input.payload ?? {}), contactId: contact.id },
      dedupeKey: key,
    };
    let delivered = 0;
    const portal = await this.prisma.raw.portalIdentity.findFirst({
      where: { organizationId: input.organizationId, guardianContactId: contact.id, revokedAt: null },
      select: { userId: true },
    });
    const attempts: SendInput[] = [];
    if (portal?.userId) attempts.push({ ...base, channel: 'in_app', userId: portal.userId });
    if (contact.phone) attempts.push({ ...base, channel: 'sms', recipient: { phone: contact.phone } });
    if (contact.email) attempts.push({ ...base, channel: 'email', recipient: { email: contact.email } });
    for (const a of attempts) {
      const res = await this.send(a).catch((err) => {
        this.logger.warn(`notifyContact ${a.channel} to contact ${contact.id} failed: ${String(err)}`);
        return null;
      });
      if (res?.delivered) delivered += 1;
    }
    return delivered;
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
      this.logger.warn(`[NO-SMTP] email to=${to} subject=${input.title} not sent`);
      throw new NoProviderError('Not sent: no email server is configured (SMTP_HOST).');
    }
    // The café-POS default leaked into school mail headers; set SMTP_FROM per deployment.
    const from = process.env.SMTP_FROM ?? 'no-reply@school.local';
    await this.smtpTransport.sendMail({
      from,
      to,
      subject: input.title,
      text: input.body,
      html: `<p>${escapeHtml(input.body)}</p>`,
    });
  }

  private async sendSms(input: SendInput, notificationId: string): Promise<void> {
    let phone = input.recipient?.phone?.trim() || null;
    if (!phone && !input.userId) throw new Error('sms channel requires userId or recipient.phone');
    if (!phone) {
      const user = await this.prisma.raw.user.findFirst({ where: { id: input.userId! } });
      const partner = user?.email
        ? await this.prisma.raw.partner.findFirst({ where: { organizationId: input.organizationId, email: user.email } })
        : null;
      phone = partner?.phone ?? null;
    }
    if (!phone) throw new Error('No phone number on file');
    const to = toE164(phone);
    const text = `${input.title}
${input.body}`;

    // 1. The school's own gateway, configured under Communication → Channels.
    if (this.smsTransport) {
      const res = await this.smsTransport.send({
        organizationId: input.organizationId,
        to,
        body: text,
        reference: `notification:${notificationId}`,
      });
      if (res === 'sent') return;
    }
    // 2. A deployment-wide Twilio account.
    if (this.twilioClient) {
      await this.twilioClient.messages.create({ from: process.env.TWILIO_FROM ?? '', to, body: text });
      return;
    }
    this.logger.warn(`[NO-SMS] to=${to} not sent: no SMS gateway configured`);
    throw new NoProviderError('Not sent: no SMS gateway is configured for this school.');
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
