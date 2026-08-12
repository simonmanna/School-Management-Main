import { Injectable, Logger } from '@nestjs/common';
import type { NotificationProvider, SendRequest, SendResult } from './notification-provider.interface';

/**
 * ConsoleProvider — logs notifications to stdout. Used as the default
 * in dev / CI. Production deployments swap in TwilioProvider /
 * SendGridProvider / FcmProvider via DI overrides.
 */
@Injectable()
export class ConsoleProvider implements NotificationProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Notification[console]');

  async send(req: SendRequest): Promise<SendResult> {
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `→ [${req.channel}] ${req.recipientType}:${req.recipientId}` +
      (req.subject ? ` · "${req.subject}"` : '') +
      `\n   ${req.body.slice(0, 200)}${req.body.length > 200 ? '…' : ''}`,
    );
    return { id, meta: { provider: 'console', orgId: req.organizationId } };
  }
}

/**
 * TwilioProvider — Twilio SMS gateway.
 *
 * Reads the following env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *
 * The HTTP call goes through fetch (no SDK) so we don't add a dependency.
 * Implementation is intentionally a thin stub — wire the real `fetch`
 * call to https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 * in production. For dev, the ConsoleProvider is used.
 */
@Injectable()
export class TwilioProvider implements NotificationProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger('Notification[twilio]');

  constructor(
    private readonly sid = process.env.TWILIO_ACCOUNT_SID,
    private readonly token = process.env.TWILIO_AUTH_TOKEN,
    private readonly from = process.env.TWILIO_FROM_NUMBER,
  ) {}

  async send(req: SendRequest): Promise<SendResult> {
    if (req.channel !== 'sms') throw new Error(`TwilioProvider only handles SMS, got ${req.channel}`);
    if (!this.sid || !this.token || !this.from) {
      throw new Error('TwilioProvider: missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER');
    }

    // Resolve recipient phone from recipientId. In production this looks up
    // the Partner/Contact and picks the right phone. We assume a phone is
    // passed via payload for now.
    const to = (req.payload as any).phone as string;
    if (!to) throw new Error('TwilioProvider: payload.phone missing');

    const body = new URLSearchParams({ To: to, From: this.from, Body: req.body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    const json: any = await res.json();
    if (!res.ok) {
      throw new Error(`Twilio error ${res.status}: ${json?.message ?? 'unknown'}`);
    }
    return { id: json.sid, meta: { status: json.status, to, from: this.from } };
  }
}

/**
 * SendGridProvider — SendGrid email gateway.
 *
 * Reads SENDGRID_API_KEY. Stubbed: the real `fetch` call to
 * https://api.sendgrid.com/v3/mail/send goes here in production.
 */
@Injectable()
export class SendGridProvider implements NotificationProvider {
  readonly name = 'sendgrid';
  private readonly logger = new Logger('Notification[sendgrid]');

  constructor(private readonly apiKey = process.env.SENDGRID_API_KEY) {}

  async send(req: SendRequest): Promise<SendResult> {
    if (req.channel !== 'email') throw new Error(`SendGridProvider only handles email, got ${req.channel}`);
    if (!this.apiKey) throw new Error('SendGridProvider: SENDGRID_API_KEY missing');

    const to = (req.payload as any).email as string;
    if (!to) throw new Error('SendGridProvider: payload.email missing');

    const body = {
      personalizations: [{ to: [{ email: to }], subject: req.subject ?? '(no subject)' }],
      from: { email: process.env.SENDGRID_FROM ?? 'no-reply@school.ug' },
      content: [{ type: 'text/plain', value: req.body }],
    };
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`SendGrid error ${res.status}: ${await res.text()}`);
    }
    return { id: res.headers.get('x-message-id') ?? `sg-${Date.now()}` };
  }
}