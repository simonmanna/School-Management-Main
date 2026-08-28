import { BadRequestException } from '@nestjs/common';

/**
 * How a message chooses its transport, and what happens when that transport
 * fails.
 *
 * A school does not think "send by WhatsApp". It thinks "reach this parent" —
 * WhatsApp if they are on it, SMS if not, and the parent portal for the ones who
 * have an account. Encoding that as an ordered chain, rather than a single
 * `providerId`, is the difference between a 62%-delivered fee reminder and a
 * 98%-delivered one.
 *
 * Two distinct mechanisms, deliberately separated:
 *
 *   SELECTION happens once, before sending: walk the steps and take the first
 *   whose channel exists, is enabled, and can actually address this recipient
 *   (an SMS step is useless for someone with no phone number).
 *
 *   ESCALATION happens after a terminal failure: the remaining steps travel with
 *   the delivery, and the dispatcher enqueues the next one. Each escalation
 *   consumes a step, so a chain is strictly finite and cannot loop.
 *
 * `transport` distinguishes the two WhatsApp implementations, which share the
 * `whatsapp` providerId by design (swapping them must not rewrite message
 * history). A step of `{providerId:'whatsapp', transport:'cloud'}` therefore
 * means the Cloud API specifically, and falls through to a Baileys step below it.
 */

export interface ChannelPolicyStep {
  providerId: string;
  /** cloud | baileys | bot | http | internal. Omit to accept any transport. */
  transport?: string;
  /** Pin an exact channel. Omit to pick the org's first healthy one. */
  channelId?: string;
}

export interface ChannelPolicy {
  steps: ChannelPolicyStep[];
  /**
   * Escalate to the next step when a delivery ends `failed`. Default true.
   *
   * Never applies to `cancelled` — an opt-out is a decision, not a fault, and
   * retrying it on SMS because WhatsApp "did not work" would be precisely the
   * abuse the consent ledger exists to prevent.
   */
  fallbackOnFailure?: boolean;
}

/**
 * The default chain, and why it is in this order:
 *   1. WhatsApp Cloud — official, template-approved, safe for cold outbound.
 *   2. WhatsApp Baileys — works without Meta onboarding; last resort on WA
 *      because bulk cold sends risk the number.
 *   3. SMS — reaches any handset, costs money, so it sits below the free paths.
 *   4. Internal — the portal inbox. Always available, never enough on its own:
 *      a parent who does not open the portal has not been told.
 */
export const DEFAULT_CHANNEL_POLICY: ChannelPolicy = {
  steps: [
    { providerId: 'whatsapp', transport: 'cloud' },
    { providerId: 'whatsapp', transport: 'baileys' },
    { providerId: 'sms' },
    { providerId: 'internal' },
  ],
  fallbackOnFailure: true,
};

const KNOWN_PROVIDERS = new Set(['internal', 'whatsapp', 'telegram', 'sms']);

export function parseChannelPolicy(input: unknown): ChannelPolicy {
  if (input === undefined || input === null) return DEFAULT_CHANNEL_POLICY;

  // Accept the shorthand the UI sends for a simple chain: ['whatsapp','sms'].
  const raw: ChannelPolicy = Array.isArray(input)
    ? { steps: input.map((p) => ({ providerId: String(p) })) }
    : (input as ChannelPolicy);
  if (!raw.steps || !Array.isArray(raw.steps) || raw.steps.length === 0) {
    return DEFAULT_CHANNEL_POLICY;
  }

  const steps: ChannelPolicyStep[] = [];
  const seen = new Set<string>();
  for (const s of raw.steps) {
    const providerId = String((s as ChannelPolicyStep).providerId ?? '');
    if (!KNOWN_PROVIDERS.has(providerId)) {
      throw new BadRequestException(
        `channelPolicy: unknown provider '${providerId}' (expected ${[...KNOWN_PROVIDERS].join(', ')})`,
      );
    }
    const transport = (s as ChannelPolicyStep).transport;
    const channelId = (s as ChannelPolicyStep).channelId;
    // A repeated step can only waste an escalation on a transport that just
    // failed for the same reason.
    const key = `${providerId}|${transport ?? ''}|${channelId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push({ providerId, ...(transport ? { transport } : {}), ...(channelId ? { channelId } : {}) });
  }
  if (steps.length === 0) throw new BadRequestException('channelPolicy: no usable steps');

  return { steps, fallbackOnFailure: raw.fallbackOnFailure ?? true };
}

/**
 * Can this step address this recipient at all?
 *
 * Checked before selection so an unusable step is skipped rather than becoming a
 * queued delivery that fails at the gateway. `internal` needs a login account;
 * every external transport needs a phone-shaped address.
 */
export function stepCanAddress(
  step: ChannelPolicyStep,
  recipient: { address?: string | null; userId?: string | null },
): boolean {
  if (step.providerId === 'internal') return !!recipient.userId;
  return !!recipient.address;
}

/** Human summary for the composer and the audit log. */
export function describePolicy(policy: ChannelPolicy): string {
  const names = policy.steps.map((s) => (s.transport ? `${s.providerId}/${s.transport}` : s.providerId));
  return policy.fallbackOnFailure ? names.join(' → ') : names[0] ?? 'none';
}
