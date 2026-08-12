/**
 * NotificationProvider — pluggable transport for outbound notifications.
 * Implementations live in /lib/notification-providers/. The default
 * implementation is the `ConsoleProvider` (logs to stdout, useful in dev).
 *
 * Production deployments register a Twilio / SendGrid / FCM provider in
 * NotificationModule based on env vars:
 *   - SMS_PROVIDER=twilio  → TwilioProvider
 *   - EMAIL_PROVIDER=sendgrid → SendGridProvider
 *   - PUSH_PROVIDER=fcm → FcmProvider
 */
export type NotificationChannel = 'sms' | 'email' | 'push' | 'in_app';
export type RecipientType = 'partner' | 'contact' | 'user';

export interface SendRequest {
  organizationId: string;
  channel: NotificationChannel;
  recipientType: RecipientType;
  recipientId: string;
  /** Email subject (email only). */
  subject?: string;
  /** Body content — already templated with variables substituted. */
  body: string;
  /** Raw payload for the provider (provider-specific metadata). */
  payload: Record<string, unknown>;
}

export interface SendResult {
  /** Provider-side message id for de-dup / tracing. */
  id: string;
  /** Provider-specific metadata (status, delivery attempt, etc). */
  meta?: Record<string, unknown>;
}

export interface NotificationProvider {
  readonly name: string;
  send(req: SendRequest): Promise<SendResult>;
}