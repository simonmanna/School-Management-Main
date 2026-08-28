import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * Messaging consent / suppression.
 *
 * One rule, enforced in one place: before ANY outbound send leaves the
 * dispatcher, the destination address is checked against this ledger. Putting
 * the check at the dispatcher rather than at each call site means a new feature
 * (broadcast, rule engine, a future chatbot) inherits opt-out handling for free
 * and cannot forget it.
 *
 * The ledger is opt-OUT shaped: no row means "may send". School messaging is
 * transactional — a parent who enrolled a child expects fee notices — so
 * requiring a prior opt-in would suppress everything on day one. What is
 * mandatory is that a STOP is honoured instantly and permanently, and that it is
 * honoured per handset (the normalized address), not per person record we may
 * not have matched yet.
 *
 * Reads go through `prisma.raw` with an explicit organizationId because the hot
 * caller (the dispatch worker) runs outside any request and therefore outside
 * tenant context.
 */

/** Keywords a recipient can text back. Compared case-insensitively, whole-word. */
const OPT_OUT_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt-out'];
const OPT_IN_KEYWORDS = ['start', 'unstop', 'subscribe', 'yes', 'optin', 'opt-in'];

export type ConsentChannel = 'all' | 'sms' | 'whatsapp' | 'telegram' | 'internal';

export interface SuppressionCheck {
  suppressed: boolean;
  /** Which row caused it — 'sms' (channel-specific) or 'all' (blanket). */
  scope?: string;
  reason?: string | null;
}

export interface SetConsentInput {
  organizationId: string;
  address: string;
  channel: ConsentChannel;
  status: 'opted_in' | 'opted_out';
  source?: string;
  reason?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  createdBy?: string | null;
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger('MessagingConsent');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Classify an inbound body as an opt-out / opt-in keyword.
   *
   * Deliberately strict: only a message whose ENTIRE content is the keyword (plus
   * punctuation) counts. "Please stop sending fees reminders to my old number"
   * is a human sentence for a human to read, and silently suppressing that
   * parent would lose them every future notice without anyone noticing.
   */
  static classifyKeyword(body: string): 'opt_out' | 'opt_in' | null {
    const word = (body ?? '')
      .trim()
      .toLowerCase()
      .replace(/[.!,;:'"()\s]+$/g, '')
      .replace(/^[.!,;:'"()\s]+/g, '');
    if (!word || word.includes(' ')) return null;
    if (OPT_OUT_KEYWORDS.includes(word)) return 'opt_out';
    if (OPT_IN_KEYWORDS.includes(word)) return 'opt_in';
    return null;
  }

  /**
   * Is this address suppressed for this channel?
   *
   * Resolution order: a channel-specific row wins over the blanket `all` row, so
   * "opted out of SMS but still on WhatsApp" is expressible and an explicit
   * per-channel opt-in can override a blanket opt-out.
   */
  async isSuppressed(organizationId: string, channel: string, address: string): Promise<SuppressionCheck> {
    if (!address) return { suppressed: false };
    const rows = await this.prisma.raw.messagingConsent.findMany({
      where: { organizationId, address, channel: { in: [channel, 'all'] } },
      select: { channel: true, status: true, reason: true },
    });
    if (rows.length === 0) return { suppressed: false };
    const specific = rows.find((r) => r.channel === channel) ?? rows.find((r) => r.channel === 'all');
    if (!specific) return { suppressed: false };
    return {
      suppressed: specific.status === 'opted_out',
      scope: specific.channel,
      reason: specific.reason,
    };
  }

  /**
   * Bulk variant for broadcast materialization — one query for N addresses
   * instead of N queries. Returns the set of addresses that must NOT be sent to.
   */
  async suppressedAddresses(organizationId: string, channel: string, addresses: string[]): Promise<Set<string>> {
    const unique = [...new Set(addresses.filter(Boolean))];
    if (unique.length === 0) return new Set();
    const rows = await this.prisma.raw.messagingConsent.findMany({
      where: { organizationId, address: { in: unique }, channel: { in: [channel, 'all'] } },
      select: { address: true, channel: true, status: true },
    });
    // Channel-specific rows override the blanket row, matching isSuppressed().
    const byAddress = new Map<string, { channel: string; status: string }>();
    for (const r of rows) {
      const current = byAddress.get(r.address);
      if (!current || (current.channel === 'all' && r.channel === channel)) {
        byAddress.set(r.address, { channel: r.channel, status: r.status });
      }
    }
    const out = new Set<string>();
    for (const [address, row] of byAddress) {
      if (row.status === 'opted_out') out.add(address);
    }
    return out;
  }

  /** Record consent. Idempotent on (org, channel, address) — the last write wins. */
  async set(input: SetConsentInput): Promise<void> {
    await this.prisma.raw.messagingConsent.upsert({
      where: {
        organizationId_channel_address: {
          organizationId: input.organizationId,
          channel: input.channel,
          address: input.address,
        },
      },
      update: {
        status: input.status,
        source: input.source ?? 'api',
        reason: input.reason ?? null,
        subjectType: input.subjectType ?? undefined,
        subjectId: input.subjectId ?? undefined,
        effectiveAt: new Date(),
      },
      create: {
        organizationId: input.organizationId,
        channel: input.channel,
        address: input.address,
        status: input.status,
        source: input.source ?? 'api',
        reason: input.reason ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    this.logger.log(`consent ${input.status} for ${input.address} on '${input.channel}' (${input.source ?? 'api'})`);
  }

  /**
   * Apply an inbound message's keyword, if it is one. Called from the inbound
   * path for every external provider, so STOP works over SMS, WhatsApp and
   * Telegram alike. Returns the action taken so the caller can auto-acknowledge.
   */
  async applyInboundKeyword(
    organizationId: string,
    channel: ConsentChannel,
    address: string,
    body: string,
  ): Promise<'opt_out' | 'opt_in' | null> {
    const action = ConsentService.classifyKeyword(body);
    if (!action || !address) return null;
    await this.set({
      organizationId,
      address,
      channel,
      status: action === 'opt_out' ? 'opted_out' : 'opted_in',
      source: 'inbound_keyword',
      reason: `replied '${body.trim().slice(0, 40)}'`,
    });
    return action;
  }

  /* ── Request-scoped admin surface (tenant client, audited by the caller) ── */

  async list(params: { channel?: string; status?: string; search?: string; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    return this.prisma.client.messagingConsent.findMany({
      where: {
        ...(params.channel ? { channel: params.channel } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.search ? { address: { contains: params.search } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  /** Admin override from the UI. Uses the request's tenant + user for provenance. */
  async setFromRequest(input: {
    address: string;
    channel: ConsentChannel;
    status: 'opted_in' | 'opted_out';
    reason?: string;
    subjectType?: string;
    subjectId?: string;
  }) {
    await this.set({
      organizationId: this.tenant.organizationId,
      address: input.address,
      channel: input.channel,
      status: input.status,
      source: 'admin',
      reason: input.reason ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      createdBy: this.tenant.userId ?? null,
    });
    return { ok: true };
  }
}
