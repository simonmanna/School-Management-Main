import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SchoolPaymentService } from './billing.service';
import { SchoolFinanceQueryService } from './school-finance-query.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Live mobile-money collection — MTN MoMo and Airtel Money.
 *
 * In a Ugandan school this changes the cash cycle more than any other feature:
 * a parent pays from a phone in the village and the pupil's balance moves
 * immediately, instead of the parent travelling to the school with cash or
 * bringing a printed bank slip days later.
 *
 * ─── What this service is, and is not ───
 *
 * It is the school's side of the conversation: a request-to-pay that names the
 * pupil, a callback that posts the money, and a status query for reconciliation.
 * The provider HTTP calls sit behind `MobileMoneyProvider` so MTN, Airtel and a
 * sandbox all look the same to the rest of the module.
 *
 * It deliberately does NOT introduce a second way to record money. Every
 * successful callback funnels into `SchoolPaymentService.collect`, the same
 * path a bursar's cash receipt takes — so a MoMo payment gets the same
 * allocation rules, the same GL posting, the same period control, and the same
 * receipt. There is one payment writer, and this is not it.
 *
 * ─── Why replay safety is already solved ───
 *
 * Providers retry callbacks aggressively and deliver at-least-once; a timeout on
 * their side means the same payment arrives two or three times. The provider's
 * transaction id goes in as `externalReference` with the matching
 * `externalReferenceType`, which carries a database unique index
 * (organizationId, type, value, direction). A replayed callback therefore
 * cannot create a second payment — the database refuses it, not an application
 * check that two concurrent callbacks would both pass
 * (FINANCIAL_INVARIANTS §Idempotency, §Concurrency).
 */
export type MobileMoneyProviderName = 'mtn' | 'airtel';

export interface CollectionRequest {
  studentProfileId: string;
  amount: number;
  /** The payer's phone, in any local format — normalised before it is sent. */
  phone: string;
  note?: string;
}

export interface ProviderChargeResult {
  /** The provider's own id for this request. Becomes `externalReference`. */
  providerRef: string;
  status: 'pending' | 'succeeded' | 'failed';
  message?: string;
}

/** What a provider adapter must do. Keeps MTN/Airtel differences out of here. */
export interface MobileMoneyProvider {
  readonly name: MobileMoneyProviderName;
  requestToPay(input: { amountMinor: number; msisdn: string; reference: string; note?: string }): Promise<ProviderChargeResult>;
  verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean;
  parseCallback(body: any): { providerRef: string; status: 'succeeded' | 'failed' | 'pending'; amount: number; msisdn?: string };
}

/* ───────────────────────── Provider adapters ───────────────────────── */

/**
 * MTN MoMo Collections. Signature is an HMAC-SHA256 of the raw body, which is
 * why the controller must hand us the RAW string — re-serialising the parsed
 * object changes key order and the signature stops matching.
 */
class MtnProvider implements MobileMoneyProvider {
  readonly name = 'mtn' as const;

  constructor(private readonly log: Logger) {}

  async requestToPay(input: { amountMinor: number; msisdn: string; reference: string; note?: string }) {
    const base = process.env.MTN_MOMO_BASE_URL;
    const key = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
    const token = process.env.MTN_MOMO_ACCESS_TOKEN;
    if (!base || !key || !token) {
      throw new BadRequestException(
        'MTN MoMo is not configured. Set MTN_MOMO_BASE_URL, MTN_MOMO_SUBSCRIPTION_KEY and ' +
          'MTN_MOMO_ACCESS_TOKEN, or use the bank/MoMo statement import instead.',
      );
    }
    const res = await fetch(`${base}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Reference-Id': input.reference,
        'X-Target-Environment': process.env.MTN_MOMO_ENVIRONMENT ?? 'sandbox',
        'Ocp-Apim-Subscription-Key': key,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        // MoMo takes the major unit as a string; UGX has no minor unit.
        amount: String(Math.round(input.amountMinor)),
        currency: process.env.MTN_MOMO_CURRENCY ?? 'UGX',
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
    // 202 Accepted: the parent has been prompted; the callback tells us what happened.
    return { providerRef: input.reference, status: 'pending' as const };
  }

  verifySignature(rawBody: string, signature: string | undefined, secret: string) {
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
  }

  parseCallback(body: any) {
    const status = String(body?.status ?? '').toUpperCase();
    return {
      providerRef: String(body?.externalId ?? body?.referenceId ?? ''),
      status: status === 'SUCCESSFUL' ? ('succeeded' as const) : status === 'PENDING' ? ('pending' as const) : ('failed' as const),
      amount: Number(body?.amount ?? 0),
      msisdn: body?.payer?.partyId,
    };
  }
}

/** Airtel Money Collections. Same shape, different field names. */
class AirtelProvider implements MobileMoneyProvider {
  readonly name = 'airtel' as const;

  constructor(private readonly log: Logger) {}

  async requestToPay(input: { amountMinor: number; msisdn: string; reference: string; note?: string }) {
    const base = process.env.AIRTEL_BASE_URL;
    const token = process.env.AIRTEL_ACCESS_TOKEN;
    if (!base || !token) {
      throw new BadRequestException(
        'Airtel Money is not configured. Set AIRTEL_BASE_URL and AIRTEL_ACCESS_TOKEN, or use ' +
          'the bank/MoMo statement import instead.',
      );
    }
    const res = await fetch(`${base}/merchant/v1/payments/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Country': process.env.AIRTEL_COUNTRY ?? 'UG',
        'X-Currency': process.env.AIRTEL_CURRENCY ?? 'UGX',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reference: input.note?.slice(0, 60) ?? 'School fees',
        subscriber: { country: process.env.AIRTEL_COUNTRY ?? 'UG', currency: process.env.AIRTEL_CURRENCY ?? 'UGX', msisdn: input.msisdn },
        transaction: { amount: Math.round(input.amountMinor), country: process.env.AIRTEL_COUNTRY ?? 'UG', currency: process.env.AIRTEL_CURRENCY ?? 'UGX', id: input.reference },
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

  parseCallback(body: any) {
    const t = body?.transaction ?? body;
    const status = String(t?.status ?? t?.status_code ?? '').toUpperCase();
    return {
      providerRef: String(t?.id ?? t?.airtel_money_id ?? ''),
      status: status === 'TS' || status === 'SUCCESS' ? ('succeeded' as const) : status === 'TIP' ? ('pending' as const) : ('failed' as const),
      amount: Number(t?.amount ?? 0),
      msisdn: t?.msisdn,
    };
  }
}

/** Constant-time compare that cannot throw on a length mismatch. */
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
  ) {
    this.providers = {
      mtn: new MtnProvider(this.log),
      airtel: new AirtelProvider(this.log),
    };
  }

  /** Which providers are configured, so the UI can offer only those. */
  availability() {
    return {
      mtn: Boolean(process.env.MTN_MOMO_BASE_URL && process.env.MTN_MOMO_SUBSCRIPTION_KEY),
      airtel: Boolean(process.env.AIRTEL_BASE_URL && process.env.AIRTEL_ACCESS_TOKEN),
    };
  }

  /**
   * Normalise a Ugandan phone number to the MSISDN the providers expect
   * (256XXXXXXXXX). Parents type `0772…`, `+256772…` and `256772…`
   * interchangeably, and a provider that receives the wrong shape simply
   * reports "payer not found" with no clue why.
   */
  private toMsisdn(phone: string): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.startsWith('256')) return digits;
    if (digits.startsWith('0')) return `256${digits.slice(1)}`;
    if (digits.length === 9) return `256${digits}`;
    throw new BadRequestException(
      `'${phone}' is not a recognisable Ugandan mobile number. Use 07XXXXXXXX or +2567XXXXXXXX.`,
    );
  }

  private providerFor(name: string): MobileMoneyProvider {
    const p = this.providers[name as MobileMoneyProviderName];
    if (!p) throw new BadRequestException(`Unknown mobile-money provider '${name}'. Use 'mtn' or 'airtel'.`);
    return p;
  }

  /**
   * Ask the parent's phone to approve a payment.
   *
   * Nothing is recorded as money here — a request-to-pay is a prompt, not a
   * receipt. The `MobileMoneyRequest` row exists so the school can see what was
   * asked for and chase it; the money only becomes a Payment when the provider
   * confirms, in `handleCallback`.
   */
  async requestPayment(providerName: string, dto: CollectionRequest) {
    const organizationId = this.tenant.organizationId;
    const provider = this.providerFor(providerName);

    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: dto.studentProfileId, organizationId },
      include: { partner: true },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
    if (!(Number(dto.amount) > 0)) throw new BadRequestException('Amount must be above zero');

    const msisdn = this.toMsisdn(dto.phone);
    // Our reference IS the idempotency key. Generated here so a provider that
    // echoes it back lets the callback find its way home.
    const reference = `SCH-${organizationId.slice(0, 6)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

    const row = await this.prisma.client.mobileMoneyRequest.create({
      data: {
        organizationId,
        studentProfileId: student.id,
        provider: provider.name,
        providerRef: reference,
        msisdn,
        amount: Number(dto.amount),
        status: 'pending',
        note: dto.note ?? null,
        requestedById: this.tenant.userId ?? null,
      },
    });

    try {
      const result = await provider.requestToPay({
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
   * A provider callback. This is the only place mobile money becomes a receipt.
   *
   * Security: the signature is verified against the RAW body before anything is
   * read from it. An unsigned or mis-signed callback is rejected outright —
   * this endpoint is public by necessity and a forged callback would otherwise
   * credit a pupil's account with money nobody paid.
   *
   * Safety: the provider's transaction id is passed as `externalReference`,
   * which carries a unique index, so the at-least-once retries every provider
   * performs collapse into exactly one Payment.
   */
  async handleCallback(providerName: string, rawBody: string, signature: string | undefined) {
    const provider = this.providerFor(providerName);
    const secret =
      providerName === 'mtn' ? process.env.MTN_MOMO_CALLBACK_SECRET : process.env.AIRTEL_CALLBACK_SECRET;

    if (!secret) {
      // Refusing is the safe default: without a secret we cannot tell a genuine
      // callback from a forged one, and crediting fees on an unverified request
      // is worse than not collecting at all.
      throw new BadRequestException(
        `No callback secret configured for ${providerName}. Set ${providerName.toUpperCase()}_CALLBACK_SECRET ` +
          'before enabling live collection.',
      );
    }
    if (!provider.verifySignature(rawBody, signature, secret)) {
      this.log.warn(`Rejected ${providerName} callback: bad signature`);
      throw new BadRequestException('Invalid callback signature.');
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Callback body is not valid JSON.');
    }
    const parsed = provider.parseCallback(body);
    if (!parsed.providerRef) throw new BadRequestException('Callback carries no transaction reference.');

    const request = await this.prisma.client.mobileMoneyRequest.findFirst({
      where: { providerRef: parsed.providerRef },
      include: { studentProfile: true },
    });
    if (!request) {
      // Not an error worth failing the provider's retry loop over — log it and
      // acknowledge, or they will hammer us forever for a payment we cannot place.
      this.log.warn(`${providerName} callback for unknown reference ${parsed.providerRef}`);
      return { matched: false, status: parsed.status };
    }

    if (parsed.status !== 'succeeded') {
      await this.prisma.client.mobileMoneyRequest.update({
        where: { id: request.id },
        data: { status: parsed.status, failureReason: body?.reason ?? null },
      });
      return { matched: true, status: parsed.status, posted: false };
    }

    // Succeeded. Post it through the SAME writer a cash receipt uses, so the
    // allocation rules, GL posting, period control and receipt are identical.
    const collected: any = await this.payments.collect({
      studentProfileId: request.studentProfileId,
      amount: Number(request.amount),
      paymentMethod: 'mobile_money',
      reference: `${provider.name.toUpperCase()} ${parsed.providerRef}`,
      externalReference: parsed.providerRef,
      externalReferenceType: 'mobile_money_txn',
      // A parent paying from a phone is usually paying the balance; anything
      // over it is held as credit rather than rejected.
      convertOverpaymentToCredit: true,
    } as any);

    await this.prisma.client.mobileMoneyRequest.update({
      where: { id: request.id },
      data: {
        status: 'succeeded',
        paymentId: collected?.payment?.id ?? null,
        settledAt: new Date(),
      },
    });

    this.events.publish('school.fee.momo.settled', {
      organizationId: request.organizationId,
      requestId: request.id,
      studentProfileId: request.studentProfileId,
      provider: provider.name,
      amount: String(request.amount),
      paymentId: collected?.payment?.id ?? null,
      replayed: Boolean(collected?.replayed),
    });

    return {
      matched: true,
      status: 'succeeded',
      posted: true,
      replayed: Boolean(collected?.replayed),
      paymentNumber: collected?.payment?.paymentNumber,
    };
  }

  /** What a bursar sees: recent requests and where each one got to. */
  async listRequests(params: { studentProfileId?: string; status?: string; limit?: number }) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.mobileMoneyRequest.findMany({
      where: {
        organizationId,
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
