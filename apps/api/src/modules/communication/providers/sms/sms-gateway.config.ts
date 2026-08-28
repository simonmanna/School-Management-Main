import { BadRequestException } from '@nestjs/common';

/**
 * The pluggable SMS gateway contract.
 *
 * There is no dominant SMS API the way there is for WhatsApp — every school's
 * aggregator (Africa's Talking, Twilio, Infobip, a national telco's bulk portal,
 * an on-prem SMPP bridge with an HTTP shim) speaks its own JSON. Writing one
 * adapter class per vendor would mean a code change and a redeploy every time a
 * school switches supplier, which is exactly the thing schools do when rates
 * change.
 *
 * So the vendor lives in DATA: `CommunicationChannel.config` holds a declarative
 * description of the gateway's HTTP shape, and ONE provider class drives it.
 * Adding a gateway is a config row, not a pull request.
 *
 * What is deliberately NOT configurable: retry policy, idempotency, tenancy,
 * consent enforcement and status ranking. Those are correctness properties owned
 * by the dispatcher — a bad config must not be able to weaken them.
 */

/** How the request body is encoded. `query` puts params on the URL (GET-style APIs). */
export type SmsBodyEncoding = 'json' | 'form' | 'query';

export interface SmsResponseMapping {
  /**
   * Optional success predicate evaluated against the parsed response. Omit when
   * the HTTP status alone is authoritative. Many gateways return 200 with
   * `{"status":"failed"}`, which is the case this exists for.
   */
  successWhen?: { path: string; equals?: string | number | boolean; in?: (string | number)[] };
  /** Where the gateway's own message id lives. Falls back to our providerRequestId. */
  messageIdPath?: string;
  errorCodePath?: string;
  errorMessagePath?: string;
  /** Gateway error codes worth retrying (throttles, transient upstream faults). */
  retryableErrorCodes?: string[];
}

export interface SmsDlrMapping {
  /** Where the delivery receipt carries the id we can match a delivery on. */
  messageIdPath: string;
  statusPath: string;
  /** Gateway status token -> our canonical status. Unmapped tokens are ignored. */
  statusMap: Record<string, 'sent' | 'delivered' | 'read' | 'failed'>;
  errorCodePath?: string;
  timestampPath?: string;
}

export interface SmsInboundMapping {
  fromPath: string;
  textPath: string;
  messageIdPath?: string;
  /** The gateway short code / sender id the message was sent TO. */
  toPath?: string;
  timestampPath?: string;
}

export interface SmsGatewayConfig {
  endpoint: string;
  method: 'POST' | 'GET';
  bodyEncoding: SmsBodyEncoding;
  /** Alphanumeric sender id or short code presented to the handset. */
  senderId?: string;
  headers?: Record<string, string>;
  /** Request parameters; values may contain placeholders (see PLACEHOLDER doc). */
  params: Record<string, string>;
  response: SmsResponseMapping;
  dlr?: SmsDlrMapping;
  inbound?: SmsInboundMapping;
  /**
   * Shared secret the gateway must echo on DLR/MO callbacks (header
   * `x-sms-webhook-secret` or a `secret` query param). Without it the webhook is
   * an unauthenticated write into the org's message history.
   */
  webhookSecret?: string;
  /** E.164 country code applied to bare local numbers, e.g. "+256". */
  defaultCountryCode?: string;
  /** Refuse to send a body longer than this many segments. 0/undefined = no cap. */
  maxSegments?: number;
  /** Cost accounting, in micro-units of the billing currency, per segment. */
  costPerSegmentMicros?: number;
  /** Rewrite smart quotes/dashes to ASCII equivalents to stay on GSM-7. */
  transliterate?: boolean;
  /** HTTP status codes to treat as retryable beyond the defaults (429, 5xx). */
  retryableStatusCodes?: number[];
  requestTimeoutMs?: number;
  /** AES-256-GCM blob holding `{ "<name>": "<secret>" }` for {{secret.<name>}}. */
  secretsEnc?: string;
}

/**
 * Placeholders usable inside `params` and `headers` values.
 *
 *   {{to}}        normalized E.164 destination
 *   {{toLocal}}   destination without the leading '+' (many gateways demand this)
 *   {{from}}      senderId
 *   {{text}}      the message body
 *   {{requestId}} our deterministic providerRequestId — pass it through so the
 *                 gateway's own dedupe (where it has one) sees a stable key, and
 *                 so DLRs match even when the gateway echoes it back rather than
 *                 minting an id of its own
 *   {{secret.X}}  a decrypted entry from secretsEnc
 */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface SmsRenderContext {
  to: string;
  from: string;
  text: string;
  requestId: string;
  secrets: Record<string, string>;
}

/**
 * Substitute placeholders in a template string.
 *
 * An unknown placeholder throws rather than rendering empty: silently sending
 * `apiKey=` to a gateway produces an opaque 401 that looks like a network fault
 * and gets retried six times. Failing at render time names the missing key.
 */
export function renderTemplate(template: string, ctx: SmsRenderContext): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (key.startsWith('secret.')) {
      const name = key.slice('secret.'.length);
      const value = ctx.secrets[name];
      if (value === undefined) {
        throw new BadRequestException(`SMS gateway config references missing secret '${name}'.`);
      }
      return value;
    }
    switch (key) {
      case 'to':
        return ctx.to;
      case 'toLocal':
        return ctx.to.replace(/^\+/, '');
      case 'from':
        return ctx.from;
      case 'text':
        return ctx.text;
      case 'requestId':
        return ctx.requestId;
      default:
        throw new BadRequestException(`Unknown SMS gateway placeholder '{{${key}}}'.`);
    }
  });
}

/**
 * Read a dotted path out of an arbitrary parsed payload, tolerating array hops
 * (`SMSMessageData.Recipients.0.messageId`). Returns undefined rather than
 * throwing — a gateway omitting an optional field is normal.
 */
export function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = source;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Evaluate the config's success predicate. No predicate => HTTP status decides. */
export function isSuccessResponse(body: unknown, mapping: SmsResponseMapping): boolean {
  const when = mapping.successWhen;
  if (!when) return true;
  const actual = readPath(body, when.path);
  if (when.in) return when.in.some((v) => String(v) === String(actual));
  if (when.equals !== undefined) return String(when.equals) === String(actual);
  // A bare path means "this field must be present and truthy".
  return actual !== undefined && actual !== null && actual !== '' && actual !== false;
}

/**
 * Normalize a raw phone number to E.164.
 *
 * School rosters are typed by humans: "0772 123456", "+256-772-123456",
 * "256772123456" and "(0772) 123 456" all mean the same handset. They must
 * normalize to ONE string, because that string is the consent key, the delivery
 * idempotency key and the conversation binding. Two spellings of one parent
 * would mean two conversations and an opt-out that only half works.
 */
export function normalizeE164(raw: string, defaultCountryCode?: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new BadRequestException('Empty phone number.');

  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) throw new BadRequestException(`'${raw}' contains no digits.`);

  if (!hadPlus) {
    const cc = (defaultCountryCode ?? '').replace(/\D/g, '');
    if (digits.startsWith('0') && cc) {
      // National trunk prefix — 0772... in Uganda is +256772..., not +2560772...
      digits = cc + digits.replace(/^0+/, '');
    } else if (cc && !digits.startsWith(cc)) {
      digits = cc + digits;
    }
  }

  if (digits.length < 8 || digits.length > 15) {
    throw new BadRequestException(`'${raw}' is not a valid phone number (E.164 is 8-15 digits).`);
  }
  return `+${digits}`;
}

/**
 * Validate a config coming from the admin UI. Runs at channel-write time so a
 * broken gateway is rejected while an operator is looking at the screen, not at
 * 6am when a fee-reminder broadcast fans out to 400 parents.
 */
export function parseGatewayConfig(input: unknown): SmsGatewayConfig {
  const c = (input ?? {}) as Partial<SmsGatewayConfig>;
  const errors: string[] = [];

  if (!c.endpoint || typeof c.endpoint !== 'string') {
    errors.push('endpoint is required');
  } else if (!/^https:\/\//i.test(c.endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(c.endpoint)) {
    // Credentials and parent phone numbers travel in this request.
    errors.push('endpoint must be https:// (plain http is allowed only for localhost)');
  }

  const method = (c.method ?? 'POST').toUpperCase();
  if (method !== 'POST' && method !== 'GET') errors.push("method must be 'POST' or 'GET'");

  const bodyEncoding = c.bodyEncoding ?? (method === 'GET' ? 'query' : 'json');
  if (!['json', 'form', 'query'].includes(bodyEncoding)) {
    errors.push("bodyEncoding must be 'json', 'form' or 'query'");
  }

  if (!c.params || typeof c.params !== 'object' || Object.keys(c.params).length === 0) {
    errors.push('params must be a non-empty object');
  } else {
    for (const [k, v] of Object.entries(c.params)) {
      if (typeof v !== 'string') errors.push(`params.${k} must be a string template`);
    }
    const rendered = JSON.stringify(c.params);
    if (!rendered.includes('{{to}}') && !rendered.includes('{{toLocal}}')) {
      errors.push('params must reference {{to}} or {{toLocal}} — otherwise the gateway has no destination');
    }
    if (!rendered.includes('{{text}}')) {
      errors.push('params must reference {{text}} — otherwise the gateway has no body');
    }
  }

  if (c.headers) {
    for (const [k, v] of Object.entries(c.headers)) {
      if (typeof v !== 'string') errors.push(`headers.${k} must be a string template`);
    }
  }
  if (c.dlr) {
    if (!c.dlr.messageIdPath) errors.push('dlr.messageIdPath is required when dlr is configured');
    if (!c.dlr.statusPath) errors.push('dlr.statusPath is required when dlr is configured');
    if (!c.dlr.statusMap || Object.keys(c.dlr.statusMap).length === 0) {
      errors.push('dlr.statusMap must map at least one gateway status');
    }
  }
  if (c.inbound) {
    if (!c.inbound.fromPath) errors.push('inbound.fromPath is required when inbound is configured');
    if (!c.inbound.textPath) errors.push('inbound.textPath is required when inbound is configured');
  }
  if (c.defaultCountryCode && !/^\+?\d{1,4}$/.test(c.defaultCountryCode)) {
    errors.push("defaultCountryCode must look like '+256'");
  }

  if (errors.length > 0) {
    throw new BadRequestException(`Invalid SMS gateway config: ${errors.join('; ')}`);
  }

  return {
    ...c,
    endpoint: c.endpoint!,
    method: method as 'POST' | 'GET',
    bodyEncoding: bodyEncoding as SmsBodyEncoding,
    params: c.params!,
    response: c.response ?? {},
    requestTimeoutMs: c.requestTimeoutMs ?? 20_000,
  };
}
