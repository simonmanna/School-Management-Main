import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PaymentTermMethod } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

export interface PaymentTermDto {
  code: string;
  name: string;
  method?: PaymentTermMethod;
  netDays?: number;
  discountDays?: number | null;
  discountPercent?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

/** Built-in terms seeded for an org the first time it lists payment terms. */
const DEFAULT_TERMS: Array<{
  code: string;
  name: string;
  method: PaymentTermMethod;
  netDays: number;
  sortOrder: number;
}> = [
  { code: 'immediate', name: 'Immediate Payment', method: 'immediate', netDays: 0, sortOrder: 10 },
  { code: 'net-7', name: '7 Days', method: 'net_days', netDays: 7, sortOrder: 20 },
  { code: 'net-15', name: '15 Days', method: 'net_days', netDays: 15, sortOrder: 30 },
  { code: 'net-30', name: '30 Days', method: 'net_days', netDays: 30, sortOrder: 40 },
  { code: 'net-45', name: '45 Days', method: 'net_days', netDays: 45, sortOrder: 50 },
  { code: 'eom', name: 'End of Following Month', method: 'end_of_following_month', netDays: 0, sortOrder: 60 },
  { code: 'eom-10', name: '10 Days after End of Next Month', method: 'end_of_following_month', netDays: 10, sortOrder: 70 },
];

/**
 * Payment terms (Odoo-style due-date computation). Org-scoped by the tenancy
 * extension; soft-deleted (deletedAt). Referenced by Partner.paymentTermId
 * and Document.paymentTermId — `dueDateFor` derives the invoice due date so AR
 * aging / dunning have a real date instead of a null.
 */
@Injectable()
export class PaymentTermService {
  private readonly logger = new Logger(PaymentTermService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** List active terms for pickers; lazy-seeds built-in defaults when the org has none. */
  async list() {
    await this.ensureDefaults(this.tenant.organizationId);
    return this.prisma.client.paymentTerm.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  /** Archived (soft-deleted) terms, for the restore UI. */
  deleted() {
    return this.prisma.client.paymentTerm.findMany({
      where: { deletedAt: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async get(id: string) {
    const term = await this.prisma.client.paymentTerm.findFirst({ where: { id } });
    if (!term) throw new NotFoundException('Payment term not found');
    return term;
  }

  create(dto: PaymentTermDto) {
    return this.prisma.client.paymentTerm.create({
      data: {
        organizationId: this.tenant.organizationId,
        code: dto.code,
        name: dto.name,
        method: dto.method ?? 'net_days',
        netDays: dto.netDays ?? 0,
        discountDays: dto.discountDays ?? null,
        discountPercent: dto.discountPercent ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: Partial<PaymentTermDto>) {
    await this.get(id);
    return this.prisma.client.paymentTerm.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.netDays !== undefined ? { netDays: dto.netDays } : {}),
        ...(dto.discountDays !== undefined ? { discountDays: dto.discountDays } : {}),
        ...(dto.discountPercent !== undefined ? { discountPercent: dto.discountPercent } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  /** Soft-delete. Referencing documents keep their paymentTermName snapshot. */
  async remove(id: string) {
    await this.get(id);
    return this.prisma.client.paymentTerm.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Restore an archived term. Uses updateMany with an explicit `deletedAt`
   * filter so the tenancy SOFT_DELETE extension's implicit `deletedAt: null`
   * injection (which would P2025 on an archived row) is skipped.
   */
  async restore(id: string) {
    const res = await this.prisma.client.paymentTerm.updateMany({
      where: { id, organizationId: this.tenant.organizationId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (res.count === 0) throw new NotFoundException('Archived payment term not found');
    return this.prisma.client.paymentTerm.findFirst({ where: { id } });
  }

  /** Net days / offset for a term id (0 when none/absent). */
  async netDaysFor(paymentTermId: string | null | undefined): Promise<number> {
    if (!paymentTermId) return 0;
    const term = await this.prisma.client.paymentTerm.findFirst({ where: { id: paymentTermId } });
    return term?.netDays ?? 0;
  }

  /**
   * Due date for a term, computed from its method:
   * - immediate              → base
   * - net_days               → base + netDays
   * - end_of_following_month → end of the month AFTER base's month, + netDays
   *   (covers "End of the following month" and "N days after end of next month").
   * Falls back to the term name's absence → plain base + netDays for unknown ids.
   */
  async dueDateFor(paymentTermId: string | null | undefined, base: Date = new Date()): Promise<Date> {
    if (!paymentTermId) return new Date(base);
    const term = await this.prisma.client.paymentTerm.findFirst({ where: { id: paymentTermId } });
    if (!term) return new Date(base);
    return computeDueDate(term.method, term.netDays, base);
  }

  /**
   * Credit-control check for a credit sale. Throws when the partner is on hold or
   * the new balance would exceed their credit limit (0 = unlimited).
   */
  async assertCreditOk(
    partner: { creditHold?: boolean; creditLimit?: unknown } | null,
    currentBalance: number,
    addAmount: number,
  ): Promise<void> {
    if (!partner) return;
    if (partner.creditHold) throw new BadRequestException('Customer is on credit hold.');
    const limit = Number(partner.creditLimit ?? 0);
    if (limit > 0 && currentBalance + addAmount > limit) {
      throw new BadRequestException(
        `Credit limit exceeded: limit ${limit}, would become ${currentBalance + addAmount}.`,
      );
    }
  }

  /** Idempotent: inserts the built-in default terms when the org has zero rows. */
  async ensureDefaults(organizationId: string): Promise<void> {
    const count = await this.prisma.client.paymentTerm.count({
      where: { organizationId },
    });
    if (count > 0) return;
    try {
      await this.prisma.client.paymentTerm.createMany({
        data: DEFAULT_TERMS.map((t) => ({
          organizationId,
          code: t.code,
          name: t.name,
          method: t.method,
          netDays: t.netDays,
          sortOrder: t.sortOrder,
          isActive: true,
        })),
        skipDuplicates: true,
      });
    } catch (e) {
      // Concurrent org bootstrap — another request likely won the race.
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`PaymentTerm defaults seed skipped for org ${organizationId}: ${msg}`);
    }
  }
}

/** Pure due-date computation — mirrors Odoo's "Due" methods. Exported for tests. */
export function computeDueDate(method: PaymentTermMethod, netDays: number, base: Date): Date {
  const due = new Date(base);
  due.setHours(0, 0, 0, 0);
  if (method === 'immediate') return due;
  if (method === 'end_of_following_month') {
    // End of the month AFTER base's month, then + netDays.
    const eom = new Date(due.getFullYear(), due.getMonth() + 2, 0); // last day of next month
    eom.setDate(eom.getDate() + netDays);
    return eom;
  }
  // net_days (default)
  due.setDate(due.getDate() + netDays);
  return due;
}