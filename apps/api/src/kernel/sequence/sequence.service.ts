import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

export interface SequenceOptions {
  prefix?: string;
  padding?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_PADDING = 5;
const SAFE_IDENT = /[^a-zA-Z0-9_]/g;

/**
 * Native Postgres SEQUENCE-backed numbering (M3 Day-1 replacement).
 *
 * Why this exists: the previous implementation used a `Sequence` row with an
 * `upsert({ ..., update: { nextValue: { increment: 1 } } })`. On a fresh tenant
 * (or when the row was deleted) two concurrent first-time callers both miss the
 * SELECT inside Prisma's upsert, both attempt INSERT, and the loser throws a
 * `unique violation on (organizationId, key)` — a 500 crash at the worst
 * possible moment.
 *
 * Native `nextval()` is a single atomic Postgres operation with no row lock
 * and no upsert race. It is also dramatically faster under load because there
 * is no row to lock.
 *
 * Sequences are namespaced per-organization (`seq_<orgShort>_<key>`) so a
 * shared database cluster can host multiple tenants without collisions. The
 * sequence is created lazily on first use and cached in-memory so the
 * `CREATE SEQUENCE IF NOT EXISTS` only runs once per process per (org, key).
 */
@Injectable()
export class SequenceService implements OnApplicationBootstrap {
  private readonly logger = new Logger('SequenceService');
  private readonly ensured = new Set<string>();
  /** All logical sequence keys known to the platform. Boot-time warm-up uses this list. */
  static readonly KNOWN_KEYS = [
    'stock_move',
    // F.8 — stock document wrappers
    'stock_out',
    'waste_doc',
    'stock_adj',
    'stock_transfer',
    // Manufacturing — BOM + production orders
    'bom',
    'production_order',
    'production_request',
    'production_plan',
    // Direct Stock In/Out
    'direct_stock_in',
    'direct_stock_out',
    'invoice',
    'creditnote',
    'vendorbill',
    'payment_inbound',
    'payment_outbound',
    'receipt',
    'cashsession',
    'journal_sales',
    'journal_purch',
    'journal_cash',
    'journal_bank',
    'journal_inv',
    'journal_adj',
    // Fixed Assets
    'asset',
    // Repair & Maintenance (RMMS)
    'repair_order',
    'repair_quotation',
    'repair_job',
    'repair_contract',
    'repair_technician',
    // Workforce Management (HR)
        'hr_employee',
        'hr_timesheet',
        'hr_leave_request',
        'hr_payroll_period',
        'hr_payroll_run',
        'hr_payslip',
        'hr_advance',
        'hr_loan',
        'hr_bank_payment',
        // DMS — generic document registry (Phase 2 numbering; invoice/creditnote/
        // vendorbill already above). Keys compose with ':YYYY' + yyyy- prefix in the
        // engine, matching the legacy builder convention (INV-2026-00001).
        'debitnote',
        'proforma',
        'posreceipt',
        'deliverynote',
        'quotation',
        'rentalagreement',
        'rentalreturn',
        'rentaldeposit',
        'rentalserviceorder',
        'feeinvoice',
        'feereceipt',
        'admission',
        'certificate',
        'reportcard',
      ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Pre-create every sequence for every tenant. Runs once at boot. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const orgs = await this.prisma.raw.organization.findMany({ select: { id: true } });
      for (const org of orgs) {
        for (const key of SequenceService.KNOWN_KEYS) {
          await this.ensure(org.id, key);
        }
      }
      this.logger.log(`Warmed up ${orgs.length * SequenceService.KNOWN_KEYS.length} sequences`);
    } catch (err) {
      this.logger.warn(`Sequence warm-up failed (will lazy-create on first use): ${String(err)}`);
    }
  }

  /**
   * Allocate the next number for `key`. Pass the active transaction client `tx`
   * so the number is reserved in the same atomic unit as the consuming write —
   * if the consuming write rolls back, the sequence advances anyway (a small
   * gap, never a duplicate).
   */
  async next(key: string, options: SequenceOptions = {}, tx?: any): Promise<string> {
    const organizationId = this.tenant.organizationId;
    const client = tx ?? this.prisma.client;

    await this.ensure(organizationId, key);

    const seqName = this.seqName(organizationId, key);
    const rows = (await client.$queryRawUnsafe(
      `SELECT nextval('"${seqName}"') AS nextval`,
    )) as Array<{ nextval: string | number }>;
    const reserved = Number(rows[0].nextval);
    const padding = options.padding ?? DEFAULT_PADDING;
    return `${options.prefix ?? ''}${String(reserved).padStart(padding, '0')}`;
  }

  /** Idempotent per (org, key). Safe under concurrent calls. */
  private async ensure(organizationId: string, key: string): Promise<void> {
    const seqName = this.seqName(organizationId, key);
    if (this.ensured.has(seqName)) return;
    // CREATE SEQUENCE IF NOT EXISTS is atomic at the catalog level.
    // Two concurrent first-time callers race here, but only one wins; the
    // loser gets a `relation already exists` notice which we swallow.
    try {
      await this.prisma.raw.$executeRawUnsafe(
        `CREATE SEQUENCE IF NOT EXISTS "${seqName}" INCREMENT BY 1 START WITH 1`,
      );
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('already exists')) throw err;
    }
    this.ensured.add(seqName);
  }

  /** `seq_<sanitizedOrgId>_<sanitizedKey>`. Postgres identifier limit is 63 chars. */
  private seqName(organizationId: string, key: string): string {
    const orgShort = organizationId.replace(/-/g, '').slice(0, 8);
    const keySafe = key.replace(SAFE_IDENT, '_');
    return `seq_${orgShort}_${keySafe}`;
  }
}