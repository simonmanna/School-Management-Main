import { BadRequestException, Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EncryptionService } from '../../../kernel/encryption/encryption.service';
import { dec, round, sum, ZERO } from '../../../kernel/common/money';
import { PostingService } from '../../accounting/posting/posting.service';
import {
  AccountDeterminationService,
  GATEWAY_CHARGES_ACCOUNT,
} from '../../accounting/posting/account-determination.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { SchoolPaymentService } from './billing.service';
import { SchoolFinanceQueryService } from './school-finance-query.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Live mobile-money collection — MTN MoMo and Airtel Money.
 *
 * It deliberately does NOT introduce a second way to record money. Every
 * successful callback funnels into `SchoolPaymentService.collect`, the same
 * path a bursar's cash receipt takes — same allocation rules, GL posting,
 * period control and receipt.
 *
 * ─── Tenancy ───
 *
 * The callback is public (no JWT), so there is no tenant context on arrival.
 * The request row is found by its globally-unique `providerRef` on the unscoped
 * client, its organization's gateway secret verifies the signature, and only
 * then does processing enter that tenant's context. Nothing tenant-scoped is
 * read or written before the signature checks out.
 *
 * ─── Where the money lands ───
 *
 * Collections debit the gateway's clearing account (Dr MoMo Clearing / Cr AR),
 * never cash in hand. A provider payout is recorded as a settlement:
 * Dr Bank (net) + Dr Gateway Charges / Cr MoMo Clearing (gross).
 *
 * ─── Replay safety ───
 *
 * Providers deliver at-least-once. The request row's status transition is
 * claimed with a conditional update under a row lock, and the provider
 * reference goes in as `Payment.externalReference`, which carries a database
 * unique index. The request update and the payment commit in ONE transaction.
 */

export type MobileMoneyProviderName = 'mtn' | 'airtel';
export const MOBILE_MONEY_PROVIDERS: readonly MobileMoneyProviderName[] = ['mtn', 'airtel'];

export interface CollectionRequest {
  studentProfileId: string;
  amount: number;
  /** The payer's phone, in any local format — normalised before it is sent. */
  phone: string;
  note?: string;
}

export interface ProviderChargeResult {
  providerRef: string;
  status: 'pending' | 'succeeded' | 'failed';
  message?: string;
}

/** Resolved, decrypted gateway configuration handed to an adapter. */
export interface GatewayConfig {
  baseUrl?: string | null;
  environment: string;
  currency: string;
  credentials: Record<string, string>;
}

export interface ParsedCallback {
  providerRef: string;
  status: 'succeeded' | 'failed' | 'pending';
  amount: number;
  currency?: string;
  msisdn?: string;
  reason?: string;
}

/** What a provider adapter must do. Keeps MTN/Airtel differences out of here. */
export interface MobileMoneyProvider {
  readonly name: MobileMoneyProviderName;
  requestToPay(
    cfg: GatewayConfig,
    input: { amountMinor: number; msisdn: string; reference: string; note?: string },
  ): Promise<ProviderChargeResult>;
  verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean;
  parseCallback(body: any): ParsedCallback;
}

/* ───────────────────────── Provider adapters ───────────────────────── */

/** MTN MoMo Collections. Signature: hex HMAC-SHA256 of the raw body. */
class MtnProvider implements MobileMoneyProvider {
  readonly name = 'mtn' as const;
  constructor(private readonly log: Logger) {}

  async requestToPay(cfg: GatewayConfig, input: { amountMinor: number; msisdn: string; reference: string; note?: string }) {
    const base = cfg.baseUrl;
    const key = cfg.credentials.subscriptionKey;
    const token = cfg.credentials.accessToken;
    if (!base || !key || !token) {
      throw new BadRequestException(
        'MTN MoMo gateway is missing its base URL, subscription key or access token. ' +
          'Complete it under Fees › Mobile money › Gateways.',
      );
    }
    const res = await fetch(`${base}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Reference-Id': input.reference,
        'X-Target-Environment': cfg.environment,
        'Ocp-Apim-Subscription-Key': key,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: String(Math.round(input.amountMinor)),
        currency: cfg.currency,
        externalId: input.reference,
        payer: { partyIdType: 'MSISDN', partyId: input.msisdn },
        payerMessage: input.note?.slice(0, 160) ?? 'School fees',
        payeeNote: 'School fees',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.warn(`MTN requestToPay ${res.status}: ${text}`);
      return { providerRef: input.reference, status: 'failed' as const, message: `MTN refused the request (${res.status})` };
    }
    return { providerRef: input.reference, status: 'pending' as const };
  }

  verifySignature(rawBody: string, signature: string | undefined, secret: string) {
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
  }

  parseCallback(body: any): ParsedCallback {
    const status = String(body?.status ?? '').toUpperCase();
    return {
      providerRef: String(body?.externalId ?? body?.referenceId ?? ''),
      status: status === 'SUCCESSFUL' ? 'succeeded' : status === 'PENDING' ? 'pending' : 'failed',
      amount: Number(body?.amount ?? 0),
      currency: body?.currency ? String(body.currency) : undefined,
      msisdn: body?.payer?.partyId,
      reason: body?.reason ? String(body.reason?.message ?? body.reason) : undefined,
    };
  }
}

/** Airtel Money Collections. Signature: base64 HMAC-SHA256 of the raw body. */
class AirtelProvider implements MobileMoneyProvider {
  readonly name = 'airtel' as const;
  constructor(private readonly log: Logger) {}

  async requestToPay(cfg: GatewayConfig, input: { amountMinor: number; msisdn: string; reference: string; note?: string }) {
    const base = cfg.baseUrl;
    const token = cfg.credentials.accessToken;
    const country = cfg.credentials.country || 'UG';
    if (!base || !token) {
      throw new BadRequestException(
        'Airtel Money gateway is missing its base URL or access token. ' +
          'Complete it under Fees › Mobile money › Gateways.',
      );
    }
    const res = await fetch(`${base}/merchant/v1/payments/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Country': country,
        'X-Currency': cfg.currency,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reference: input.note?.slice(0, 60) ?? 'School fees',
        subscriber: { country, currency: cfg.currency, msisdn: input.msisdn },
        transaction: { amount: Math.round(input.amountMinor), country, currency: cfg.currency, id: input.reference },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.warn(`Airtel payment ${res.status}: ${text}`);
      return { providerRef: input.reference, status: 'failed' as const, message: `Airtel refused the request (${res.status})` };
    }
    return { providerRef: input.reference, status: 'pending' as const };
  }

  verifySignature(rawBody: string, signature: string | undefined, secret: string) {
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
    return safeEqualUtf8(expected, signature);
  }

  parseCallback(body: any): ParsedCallback {
    const t = body?.transaction ?? body;
    const status = String(t?.status ?? t?.status_code ?? '').toUpperCase();
    return {
      providerRef: String(t?.id ?? t?.airtel_money_id ?? ''),
      status: status === 'TS' || status === 'SUCCESS' ? 'succeeded' : status === 'TIP' ? 'pending' : 'failed',
      amount: Number(t?.amount ?? 0),
      currency: t?.currency ? String(t.currency) : undefined,
      msisdn: t?.msisdn,
      reason: t?.message ? String(t.message) : undefined,
    };
  }
}

function safeEqualHex(a: string, b: string) {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function safeEqualUtf8(a: string, b: string) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Request lifecycle on the callback path. `succeeded` and `needs_review` are
 * terminal: a replayed success returns the original payment, and a late
 * failure can never un-post money already collected.
 */
export const CALLBACK_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['succeeded', 'failed', 'pending', 'needs_review'],
  failed: ['succeeded', 'failed', 'needs_review'],
  succeeded: [],
  needs_review: [],
};

export interface UpsertGatewayDto {
  label?: string;
  environment?: 'sandbox' | 'production';
  merchantCode?: string | null;
  baseUrl?: string | null;
  currency?: string;
  /** Provider credentials; omitted keys keep their stored value, empty string clears. */
  credentials?: Record<string, string>;
  /** Omit to keep, empty string to clear. */
  callbackSecret?: string;
  clearingAccountId?: string | null;
  isActive?: boolean;
}

export interface RecordSettlementDto {
  provider: MobileMoneyProviderName;
  reference: string;
  settlementDate?: string;
  grossAmount: number;
  charges?: number;
  /** GL bank account the net payout landed in. */
  bankAccountId: string;
  /** Collections this payout covers; they are marked settled. */
  requestIds?: string[];
  notes?: string;
}

/* ───────────────────────── The service ───────────────────────── */

@Injectable()
export class MobileMoneyService {
  private readonly log = new Logger('MobileMoney');
  private readonly providers: Record<MobileMoneyProviderName, MobileMoneyProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly payments: SchoolPaymentService,
    private readonly finance: SchoolFinanceQueryService,
    private readonly encryption: EncryptionService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly resolver: AccountResolverService,
  ) {
    this.providers = {
      mtn: new MtnProvider(this.log),
      airtel: new AirtelProvider(this.log),
    };
  }

  /* ─────────────── Gateway accounts ─────────────── */

  async listGateways() {
    const rows = await this.prisma.client.paymentGatewayAccount.findMany({ orderBy: { provider: 'asc' } });
    return Promise.all(rows.map((r) => this.presentGateway(r)));
  }

  async upsertGateway(providerName: string, dto: UpsertGatewayDto) {
    const provider = this.providerFor(providerName).name;
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.paymentGatewayAccount.findFirst({ where: { provider } });

    if (dto.clearingAccountId) {
      const acct = await this.prisma.client.account.findFirst({ where: { id: dto.clearingAccountId } });
      if (!acct) throw new BadRequestException('Clearing account not found in this organization.');
    }

    const credentials: Record<string, string> = existing ? this.decryptCredentials(existing) : {};
    for (const [k, v] of Object.entries(dto.credentials ?? {})) {
      if (v === '') delete credentials[k];
      else if (typeof v === 'string') credentials[k] = v;
    }
    const credEnc = Object.keys(credentials).length ? this.encryption.encrypt(JSON.stringify(credentials)) : null;

    const data: any = {
      label: dto.label ?? existing?.label ?? (provider === 'mtn' ? 'MTN MoMo' : 'Airtel Money'),
      environment: dto.environment ?? existing?.environment ?? 'sandbox',
      merchantCode: dto.merchantCode !== undefined ? dto.merchantCode : (existing?.merchantCode ?? null),
      baseUrl: dto.baseUrl !== undefined ? dto.baseUrl : (existing?.baseUrl ?? null),
      currency: dto.currency ?? existing?.currency ?? 'UGX',
      clearingAccountId:
        dto.clearingAccountId !== undefined ? dto.clearingAccountId : (existing?.clearingAccountId ?? null),
      isActive: dto.isActive ?? existing?.isActive ?? true,
      credentialsCipher: credEnc?.ciphertext ?? null,
      credentialsIv: credEnc?.iv ?? null,
      credentialsTag: credEnc?.tag ?? null,
      updatedBy: this.tenant.userId ?? null,
    };
    if (dto.callbackSecret !== undefined) {
      const secretEnc = dto.callbackSecret === '' ? null : this.encryption.encrypt(dto.callbackSecret);
      data.callbackSecretCipher = secretEnc?.ciphertext ?? null;
      data.callbackSecretIv = secretEnc?.iv ?? null;
      data.callbackSecretTag = secretEnc?.tag ?? null;
    }
    const row = existing
      ? await this.prisma.client.paymentGatewayAccount.update({ where: { id: existing.id }, data })
      : await this.prisma.client.paymentGatewayAccount.create({
          data: { ...data, organizationId, provider, createdBy: this.tenant.userId ?? null },
        });
    return this.presentGateway(row);
  }

  /** Never returns secrets — only which ones are set. */
  private async presentGateway(r: any) {
    const creds = this.decryptCredentials(r);
    const clearing = r.clearingAccountId
      ? await this.prisma.client.account.findFirst({
          where: { id: r.clearingAccountId },
          select: { id: true, code: true, name: true },
        })
      : null;
    return {
      id: r.id,
      provider: r.provider,
      label: r.label,
      environment: r.environment,
      merchantCode: r.merchantCode,
      baseUrl: r.baseUrl,
      currency: r.currency,
      isActive: r.isActive,
      credentialKeys: Object.keys(creds),
      hasCallbackSecret: Boolean(r.callbackSecretCipher),
      clearingAccount: clearing,
      callbackPath: `/school/mobile-money/${r.provider}/callback`,
      updatedAt: r.updatedAt,
    };
  }

  private decryptCredentials(r: any): Record<string, string> {
    if (!r?.credentialsCipher) return {};
    try {
      return JSON.parse(
        this.encryption.decrypt({ ciphertext: r.credentialsCipher, iv: r.credentialsIv, tag: r.credentialsTag }) ?? '{}',
      );
    } catch {
      this.log.error(`Gateway ${r.id} credentials could not be decrypted`);
      return {};
    }
  }

  private decryptSecret(r: any): string | null {
    if (!r?.callbackSecretCipher) return null;
    try {
      return this.encryption.decrypt({ ciphertext: r.callbackSecretCipher, iv: r.callbackSecretIv, tag: r.callbackSecretTag });
    } catch {
      return null;
    }
  }

  private configOf(r: any): GatewayConfig {
    return { baseUrl: r.baseUrl, environment: r.environment, currency: r.currency, credentials: this.decryptCredentials(r) };
  }

  /** Clearing account for a gateway: its own, else the org's mobile-money clearing mapping. */
  private async clearingAccount(gateway: any, tx?: any): Promise<string> {
    return gateway?.clearingAccountId ?? this.determination.settlementAccount('mobile_money', tx);
  }

  /** Which providers have an active, complete gateway, so the UI offers only those. */
  /**
   * ADR-032 P6 / audit F13: live collection is OFF unless the operator enables
   * it after the provider contract (UUID reference, polling, sandbox proof) is
   * accepted. Recording a receipt the family already paid stays available.
   */
  static liveCollectionEnabled(): boolean {
    return process.env.ENABLE_LIVE_MOBILE_MONEY === 'true';
  }

  private assertLiveCollectionEnabled(): void {
    if (!MobileMoneyService.liveCollectionEnabled()) {
      throw new ForbiddenException(
        'Live mobile-money collection is not enabled for this school. Record a payment the family has already made with method "mobile money" instead.',
      );
    }
  }

  async availability() {
    if (!MobileMoneyService.liveCollectionEnabled()) return { mtn: false, airtel: false, liveCollection: false };
    const rows = await this.prisma.client.paymentGatewayAccount.findMany({ where: { isActive: true } });
    const ready = (p: MobileMoneyProviderName) => {
      const r = rows.find((x) => x.provider === p);
      if (!r || !r.callbackSecretCipher || !r.baseUrl) return false;
      const c = this.decryptCredentials(r);
      return p === 'mtn' ? Boolean(c.subscriptionKey && c.accessToken) : Boolean(c.accessToken);
    };
    return { mtn: ready('mtn'), airtel: ready('airtel'), liveCollection: true };
  }

  /** Normalise a Ugandan phone number to the MSISDN providers expect (256XXXXXXXXX). */
  private toMsisdn(phone: string): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.startsWith('256')) return digits;
    if (digits.startsWith('0')) return `256${digits.slice(1)}`;
    if (digits.length === 9) return `256${digits}`;
    throw new BadRequestException(`'${phone}' is not a recognisable Ugandan mobile number. Use 07XXXXXXXX or +2567XXXXXXXX.`);
  }

  private providerFor(name: string): MobileMoneyProvider {
    const p = this.providers[name as MobileMoneyProviderName];
    if (!p) throw new BadRequestException(`Unknown mobile-money provider '${name}'. Use 'mtn' or 'airtel'.`);
    return p;
  }

  /**
   * Ask the parent's phone to approve a payment. Nothing is recorded as money
   * here; the money only becomes a Payment when the provider confirms.
   */
  async requestPayment(providerName: string, dto: CollectionRequest) {
    this.assertLiveCollectionEnabled();
    const organizationId = this.tenant.organizationId;
    const provider = this.providerFor(providerName);
    const gateway = await this.prisma.client.paymentGatewayAccount.findFirst({
      where: { provider: provider.name, isActive: true },
    });
    if (!gateway) {
      throw new BadRequestException(`No active ${provider.name.toUpperCase()} gateway is configured for this school.`);
    }
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: dto.studentProfileId },
      include: { partner: true },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
    if (!(Number(dto.amount) > 0)) throw new BadRequestException('Amount must be above zero');

    const msisdn = this.toMsisdn(dto.phone);
    const reference = `SCH-${organizationId.slice(0, 6)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

    const row = await this.prisma.client.mobileMoneyRequest.create({
      data: {
        organizationId,
        studentProfileId: student.id,
        provider: provider.name,
        providerRef: reference,
        msisdn,
        amount: round(dec(dto.amount), 6),
        currency: gateway.currency,
        status: 'pending',
        note: dto.note ?? null,
        requestedById: this.tenant.userId ?? null,
        gatewayAccountId: gateway.id,
      },
    });

    try {
      const result = await provider.requestToPay(this.configOf(gateway), {
        amountMinor: Number(dto.amount),
        msisdn,
        reference,
        note: dto.note ?? `Fees for ${student.partner?.name ?? student.admissionNo}`,
      });
      await this.prisma.client.mobileMoneyRequest.update({
        where: { id: row.id },
        data: { status: result.status, failureReason: result.message ?? null },
      });
      return { id: row.id, reference, provider: provider.name, status: result.status, message: result.message };
    } catch (err: any) {
      await this.prisma.client.mobileMoneyRequest.update({
        where: { id: row.id },
        data: { status: 'failed', failureReason: err?.message ?? String(err) },
      });
      throw err;
    }
  }

  /**
   * Provider callback. Resolve the tenant from the request row and its gateway,
   * verify the signature with that gateway's secret, and only then enter the
   * tenant and touch money.
   */
  async handleCallback(providerName: string, rawBody: string | undefined, signature: string | undefined) {
    this.assertLiveCollectionEnabled();
    const provider = this.providerFor(providerName);
    if (typeof rawBody !== 'string' || rawBody.length === 0) {
      // Re-serialising a parsed body changes its bytes; refuse rather than guess.
      throw new BadRequestException('Callback raw body unavailable; cannot verify signature.');
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Callback body is not valid JSON.');
    }
    const parsed = provider.parseCallback(body);
    if (!parsed.providerRef) throw new BadRequestException('Callback carries no transaction reference.');

    const request = await this.prisma.raw.mobileMoneyRequest.findFirst({
      where: { providerRef: parsed.providerRef, provider: provider.name },
    });
    if (!request) {
      // Unknown reference: nothing to verify against and nothing to write. 2xx
      // so the provider stops retrying a reference that will never be known.
      this.log.warn(`${provider.name} callback for unknown reference ${parsed.providerRef}`);
      return { matched: false, status: parsed.status };
    }

    const gateway = request.gatewayAccountId
      ? await this.prisma.raw.paymentGatewayAccount.findFirst({
          where: { id: request.gatewayAccountId, organizationId: request.organizationId },
        })
      : await this.prisma.raw.paymentGatewayAccount.findFirst({
          where: { organizationId: request.organizationId, provider: provider.name },
        });
    const secret = this.decryptSecret(gateway);
    if (!secret) {
      throw new BadRequestException(`No callback secret configured for this school's ${provider.name} gateway.`);
    }
    if (!provider.verifySignature(rawBody, signature, secret)) {
      this.log.warn(`Rejected ${provider.name} callback for ${parsed.providerRef}: bad signature`);
      throw new BadRequestException('Invalid callback signature.');
    }

    return this.tenant.run({ organizationId: request.organizationId }, () =>
      this.applyCallback(request.id, gateway, parsed),
    );
  }

  private async applyCallback(requestId: string, gateway: any, parsed: ParsedCallback) {
    const outcome = await this.prisma.client.$transaction(async (tx: any) => {
      const request = await tx.mobileMoneyRequest.findFirst({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Mobile-money request not found.');

      let target: string = parsed.status;
      let reason: string | null = parsed.reason ?? null;
      const received = parsed.amount > 0 ? round(dec(parsed.amount), 6) : dec(request.amount);
      const currency = parsed.currency ?? request.currency ?? gateway?.currency ?? null;
      if (target === 'succeeded' && currency && gateway?.currency && currency !== gateway.currency) {
        // Money in a currency the books are not kept in: record, do not post.
        target = 'needs_review';
        reason = `Received ${currency}, gateway is ${gateway.currency}`;
      }

      if (!(CALLBACK_TRANSITIONS[request.status] ?? []).includes(target)) {
        return { replayed: true, request, payment: null as any, status: request.status as string };
      }

      // Claim the transition under a row lock; a concurrent duplicate callback
      // re-evaluates the predicate after we commit and matches nothing.
      const claimed = await tx.mobileMoneyRequest.updateMany({
        where: { id: request.id, status: request.status },
        data: {
          status: target,
          failureReason: target === 'succeeded' ? null : reason,
          ...(target === 'pending' ? {} : { receivedAmount: received }),
          currency,
        },
      });
      if (claimed.count !== 1) {
        return { replayed: true, request, payment: null as any, status: 'raced' };
      }
      if (target !== 'succeeded') return { replayed: false, request, payment: null as any, status: target };

      const collected: any = await this.payments.collect(
        {
          studentProfileId: request.studentProfileId,
          amount: received.toNumber(),
          paymentMethod: 'mobile_money',
          reference: `${request.provider.toUpperCase()} ${request.providerRef}`,
          externalReference: request.providerRef,
          externalReferenceType: 'mobile_money_txn',
          convertOverpaymentToCredit: true,
        } as any,
        { tx, settlementAccountId: await this.clearingAccount(gateway, tx) },
      );
      await tx.mobileMoneyRequest.update({
        where: { id: request.id },
        data: { paymentId: collected?.payment?.id ?? null, settledAt: new Date() },
      });
      return { replayed: Boolean(collected?.replayed), request, payment: collected?.payment, status: 'succeeded' };
    });

    if (outcome.status === 'succeeded' && !outcome.replayed) {
      this.events.publish('school.fee.momo.settled' as any, {
        organizationId: outcome.request.organizationId,
        requestId: outcome.request.id,
        studentProfileId: outcome.request.studentProfileId,
        provider: outcome.request.provider,
        amount: String(outcome.payment?.amount ?? outcome.request.amount),
        paymentId: outcome.payment?.id ?? null,
        replayed: false,
      } as any);
    }
    return {
      matched: true,
      status: outcome.status,
      posted: outcome.status === 'succeeded' && !outcome.replayed,
      replayed: outcome.replayed,
      paymentNumber: outcome.payment?.paymentNumber,
    };
  }

  /* ─────────────── Settlement (provider payout) ─────────────── */

  /** Dr Bank (net) + Dr Gateway Charges / Cr Clearing (gross). */
  async recordSettlement(dto: RecordSettlementDto) {
    const provider = this.providerFor(dto.provider).name;
    const organizationId = this.tenant.organizationId;
    const gross = round(dec(dto.grossAmount), 6);
    const charges = round(dec(dto.charges ?? 0), 6);
    if (gross.lessThanOrEqualTo(ZERO)) throw new BadRequestException('Gross amount must be above zero.');
    if (charges.lessThan(ZERO) || charges.greaterThanOrEqualTo(gross)) {
      throw new BadRequestException('Charges must be zero or more and less than the gross amount.');
    }
    const net = gross.minus(charges);
    const reference = dto.reference?.trim();
    if (!reference) throw new BadRequestException('Settlement reference is required.');

    return this.prisma.client.$transaction(async (tx: any) => {
      const gateway = await tx.paymentGatewayAccount.findFirst({ where: { provider } });
      if (!gateway) throw new BadRequestException(`No ${provider.toUpperCase()} gateway configured.`);
      const bank = await tx.account.findFirst({ where: { id: dto.bankAccountId } });
      if (!bank) throw new BadRequestException('Bank account not found in this organization.');

      const dup = await tx.mobileMoneySettlement.findFirst({ where: { provider, reference } });
      if (dup) throw new BadRequestException(`Settlement ${reference} is already recorded.`);

      let requests: any[] = [];
      if (dto.requestIds?.length) {
        requests = await tx.mobileMoneyRequest.findMany({
          where: { id: { in: dto.requestIds }, provider, status: 'succeeded', settlementId: null },
        });
        if (requests.length !== new Set(dto.requestIds).size) {
          throw new BadRequestException(
            'Some selected collections are not succeeded, belong to another provider, or are already settled.',
          );
        }
        const covered = sum(requests.map((r) => dec(r.receivedAmount ?? r.amount)));
        if (!covered.equals(gross)) {
          throw new BadRequestException(
            `Selected collections total ${covered.toString()} but the settlement gross is ${gross.toString()}.`,
          );
        }
      }

      const clearing = await this.clearingAccount(gateway, tx);
      const date = dto.settlementDate ? new Date(dto.settlementDate) : new Date();
      const tag = provider.toUpperCase();
      const lines: any[] = [{ accountId: bank.id, debit: net.toString(), description: `${tag} payout ${reference}` }];
      if (charges.greaterThan(ZERO)) {
        const chargesAccount = await this.resolver.ensureByCode(GATEWAY_CHARGES_ACCOUNT.code, GATEWAY_CHARGES_ACCOUNT, tx);
        lines.push({ accountId: chargesAccount, debit: charges.toString(), description: `${tag} charges` });
      }
      lines.push({ accountId: clearing, credit: gross.toString(), description: `${tag} clearing swept` });

      const settlement = await tx.mobileMoneySettlement.create({
        data: {
          organizationId,
          gatewayAccountId: gateway.id,
          provider,
          reference,
          settlementDate: date,
          grossAmount: gross,
          charges,
          netAmount: net,
          bankAccountId: bank.id,
          notes: dto.notes ?? null,
          createdBy: this.tenant.userId ?? null,
        },
      });
      const entry = await this.posting.post(
        {
          journalCode: 'BANK',
          date,
          description: `${tag} settlement ${reference}`,
          sourceType: 'mobile_money_settlement',
          sourceId: settlement.id,
          postingKey: `momo_settlement:${settlement.id}`,
          lines,
        },
        tx,
      );
      if (requests.length) {
        await tx.mobileMoneyRequest.updateMany({
          where: { id: { in: requests.map((r) => r.id) } },
          data: { settlementId: settlement.id },
        });
      }
      return tx.mobileMoneySettlement.update({ where: { id: settlement.id }, data: { journalEntryId: entry.id } });
    });
  }

  listSettlements() {
    return this.prisma.client.mobileMoneySettlement.findMany({ orderBy: { settlementDate: 'desc' }, take: 200 });
  }

  /**
   * What each provider still holds: the clearing account's GL balance next to
   * the operational figure (succeeded collections not yet settled).
   */
  async clearingPosition() {
    const gateways = await this.prisma.client.paymentGatewayAccount.findMany();
    const out: any[] = [];
    for (const gateway of gateways) {
      const accountId = await this.clearingAccount(gateway);
      const [gl, unsettled] = await Promise.all([
        this.prisma.client.journalLine.aggregate({
          where: { accountId, entry: { status: { in: ['posted', 'reversed'] } } },
          _sum: { baseDebit: true, baseCredit: true },
        }),
        this.prisma.client.mobileMoneyRequest.findMany({
          where: { provider: gateway.provider, status: 'succeeded', settlementId: null },
          select: {
            id: true,
            amount: true,
            receivedAmount: true,
            providerRef: true,
            settledAt: true,
            msisdn: true,
            studentProfileId: true,
            paymentId: true,
          },
          orderBy: { settledAt: 'asc' },
        }),
      ]);
      const glBalance = dec(gl._sum?.baseDebit ?? 0).minus(dec(gl._sum?.baseCredit ?? 0));
      const operational = sum(unsettled.map((r) => dec(r.receivedAmount ?? r.amount)));
      out.push({
        provider: gateway.provider,
        clearingAccountId: accountId,
        glBalance: glBalance.toNumber(),
        unsettledCollections: operational.toNumber(),
        variance: glBalance.minus(operational).toNumber(),
        unsettled: unsettled.map((r) => ({ ...r, amount: Number(r.receivedAmount ?? r.amount), receivedAmount: undefined })),
      });
    }
    return out;
  }

  /** What a bursar sees: recent requests and where each one got to. */
  async listRequests(params: { studentProfileId?: string; status?: string; limit?: number }) {
    return this.prisma.client.mobileMoneyRequest.findMany({
      where: {
        ...(params.studentProfileId ? { studentProfileId: params.studentProfileId } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, params.limit ?? 50),
      include: { studentProfile: { include: { partner: true } } },
    });
  }

  /** The balance a parent is being asked to clear, for the payment prompt. */
  async quoteFor(studentProfileId: string) {
    const balance = await this.finance.studentBalance(studentProfileId);
    return { studentProfileId, outstanding: balance.balance, billed: balance.billed, collected: balance.collected };
  }
}
