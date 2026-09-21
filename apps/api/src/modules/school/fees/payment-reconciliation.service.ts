import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { SchoolPaymentService } from './billing.service';

type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ImportRowInput {
  externalRef: string;
  payerPhone?: string;
  payerName?: string;
  amount: number;
  transactionDate?: string;
  narration?: string;
}

interface MatchIndex {
  byAdmission: Map<string, string>;
  byPhone: Map<string, Set<string>>;
  byName: Map<string, Set<string>>;
  byRequestRef: Map<string, { studentProfileId: string; paymentId: string | null }>;
  existingRefs: Set<string>;
}

const PROVIDERS = ['mtn_momo', 'airtel_money', 'bank'] as const;

/**
 * Mobile-money / bank statement reconciliation intake.
 *
 * Each row is matched to a student by a confidence hierarchy:
 *
 *   HIGH    the row's reference is one of our own MoMo request references
 *   HIGH    an exact admission number appears as a whole token in the narration
 *   MEDIUM  the payer phone belongs to the guardians of exactly one student
 *   MEDIUM  the payer name is exactly one student's or guardian's full name
 *   LOW     a partial name signal — manual assignment only
 *
 * Nothing posts on import. A row reaches `posted` only through `confirmRow`,
 * which runs the canonical payment engine and the row update in one
 * transaction. `confirmHighConfidence` posts only HIGH rows. A reference that
 * is already a Payment's external reference is flagged `already_received`
 * instead of being posted a second time under a different key.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly payments: SchoolPaymentService,
    private readonly determination: AccountDeterminationService,
  ) {}

  async importBatch(dto: { provider: string; filename: string; statementPeriod?: string; rows: ImportRowInput[] }) {
    const organizationId = this.tenant.organizationId;
    if (!(PROVIDERS as readonly string[]).includes(dto.provider)) {
      throw new BadRequestException(`Unknown provider '${dto.provider}'`);
    }
    if (!dto.rows?.length) throw new BadRequestException('No rows to import');
    for (const r of dto.rows) {
      if (!r.externalRef?.trim()) throw new BadRequestException('Every row needs a transaction reference.');
      if (!(Number(r.amount) > 0)) throw new BadRequestException(`Row ${r.externalRef} has no positive amount.`);
    }

    const fileHash = createHash('sha256')
      .update(JSON.stringify(dto.rows.map((r) => [r.externalRef, r.amount, r.transactionDate ?? '', r.narration ?? ''])))
      .digest('hex');

    const dup = await this.prisma.client.paymentImportBatch.findFirst({
      where: { provider: dto.provider, statementPeriod: dto.statementPeriod ?? null, fileHash },
    });
    if (dup) throw new ConflictException(`This statement was already imported (batch ${dup.id}). Duplicate rejected.`);

    const index = await this.buildIndex(dto.rows.map((r) => r.externalRef.trim()));
    const totalAmount = dto.rows.reduce((s, r) => s + Number(r.amount), 0);

    const batch = await this.prisma.client.paymentImportBatch.create({
      data: {
        organizationId,
        provider: dto.provider,
        originalFilename: dto.filename,
        fileHash,
        statementPeriod: dto.statementPeriod ?? null,
        rowCount: dto.rows.length,
        totalAmount,
        uploadedById: this.tenant.userId ?? null,
      },
    });

    let matched = 0;
    for (const r of dto.rows) {
      const externalRef = r.externalRef.trim();
      const m = this.match({ ...r, externalRef }, index);
      if (m.status === 'matched') matched++;
      try {
        await this.prisma.client.paymentImportRow.create({
          data: {
            organizationId,
            batchId: batch.id,
            externalRef,
            payerPhone: r.payerPhone ?? null,
            payerName: r.payerName ?? null,
            amount: r.amount,
            transactionDate: r.transactionDate ? new Date(r.transactionDate) : null,
            narration: r.narration ?? null,
            matchStatus: m.status,
            matchConfidence: m.confidence,
            matchReason: m.reason,
            matchedStudentProfileId: m.studentId ?? null,
          },
        });
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
        // externalRef already imported in another batch.
        await this.prisma.client.paymentImportRow.create({
          data: {
            organizationId,
            batchId: batch.id,
            externalRef: `${externalRef}#${batch.id.slice(0, 6)}`,
            amount: r.amount,
            matchStatus: 'duplicate',
            matchConfidence: 'none',
            matchReason: 'reference_already_imported',
            narration: `Duplicate of ${externalRef}`,
          },
        });
      }
    }

    await this.prisma.client.paymentImportBatch.update({ where: { id: batch.id }, data: { matchedCount: matched } });
    return this.getBatch(batch.id);
  }

  private normPhone(p?: string | null): string | null {
    const d = (p ?? '').replace(/\D/g, '');
    if (d.length < 9) return null;
    return d.slice(-9);
  }

  private normName(n?: string | null): string {
    return (n ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  }

  private add(map: Map<string, Set<string>>, key: string | null, id: string) {
    if (!key) return;
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  }

  private async buildIndex(refs: string[]): Promise<MatchIndex> {
    const [students, guardians, requests, payments] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        select: { id: true, admissionNo: true, partner: { select: { name: true } } },
      }),
      this.prisma.client.studentGuardian.findMany({
        where: { deletedAt: null },
        select: { studentProfileId: true, guardianContact: { select: { firstName: true, lastName: true, phone: true } } },
      }),
      this.prisma.client.mobileMoneyRequest.findMany({
        where: { providerRef: { in: refs } },
        select: { providerRef: true, studentProfileId: true, paymentId: true },
      }),
      this.prisma.client.payment.findMany({
        where: { externalReference: { in: refs }, direction: 'inbound' },
        select: { externalReference: true },
      }),
    ]);
    const index: MatchIndex = {
      byAdmission: new Map(),
      byPhone: new Map(),
      byName: new Map(),
      byRequestRef: new Map(requests.map((r) => [r.providerRef, { studentProfileId: r.studentProfileId, paymentId: r.paymentId }])),
      existingRefs: new Set(payments.map((p) => p.externalReference!).filter(Boolean)),
    };
    for (const s of students) {
      if (s.admissionNo && s.admissionNo.trim().length >= 3) index.byAdmission.set(s.admissionNo.trim().toUpperCase(), s.id);
      this.add(index.byName, this.normName(s.partner?.name) || null, s.id);
    }
    for (const g of guardians) {
      const c = g.guardianContact;
      this.add(index.byPhone, this.normPhone(c?.phone), g.studentProfileId);
      this.add(index.byName, this.normName(`${c?.firstName ?? ''} ${c?.lastName ?? ''}`) || null, g.studentProfileId);
    }
    return index;
  }

  private match(
    r: ImportRowInput,
    index: MatchIndex,
  ): { studentId?: string; confidence: Confidence; reason: string | null; status: string } {
    const request = index.byRequestRef.get(r.externalRef);
    if (request?.paymentId || index.existingRefs.has(r.externalRef)) {
      return { studentId: request?.studentProfileId, confidence: 'high', reason: 'already_received', status: 'already_received' };
    }
    if (request) return { studentId: request.studentProfileId, confidence: 'high', reason: 'momo_request', status: 'matched' };

    const tokens = new Set(`${r.narration ?? ''} ${r.externalRef}`.toUpperCase().split(/[^A-Z0-9/-]+/).filter(Boolean));
    const byAdm = [...new Set([...tokens].map((t) => index.byAdmission.get(t)).filter((x): x is string => !!x))];
    if (byAdm.length === 1) return { studentId: byAdm[0], confidence: 'high', reason: 'admission_no', status: 'matched' };

    const phoneHits = index.byPhone.get(this.normPhone(r.payerPhone) ?? '');
    if (phoneHits?.size === 1) {
      return { studentId: [...phoneHits][0], confidence: 'medium', reason: 'guardian_phone', status: 'review' };
    }
    const nameHits = index.byName.get(this.normName(r.payerName));
    if (r.payerName && nameHits?.size === 1) {
      return { studentId: [...nameHits][0], confidence: 'medium', reason: 'exact_name', status: 'review' };
    }
    if (r.payerName || phoneHits?.size) return { confidence: 'low', reason: 'ambiguous', status: 'unmatched' };
    return { confidence: 'none', reason: null, status: 'unmatched' };
  }

  list() {
    return this.prisma.client.paymentImportBatch.findMany({ orderBy: { uploadedAt: 'desc' }, take: 50 });
  }

  async getBatch(id: string) {
    const batch = await this.prisma.client.paymentImportBatch.findFirst({ where: { id } });
    if (!batch) throw new NotFoundException(`Import batch ${id} not found`);
    const rows = await this.prisma.client.paymentImportRow.findMany({
      where: { batchId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { batch, rows };
  }

  /**
   * Confirm a matched (or manually assigned) row and post it through the
   * canonical payment engine, in the same transaction as the row update.
   */
  async confirmRow(batchId: string, rowId: string, studentProfileId?: string) {
    const batch = await this.prisma.client.paymentImportBatch.findFirst({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.paymentImportRow.findFirst({ where: { id: rowId, batchId } });
      if (!row) throw new NotFoundException(`Import row ${rowId} not found`);
      if (row.matchStatus === 'posted') return row;
      if (['duplicate', 'already_received'].includes(row.matchStatus)) {
        throw new BadRequestException(`Row ${row.externalRef} is ${row.matchStatus.replace('_', ' ')} and cannot be posted.`);
      }
      const target = studentProfileId ?? row.matchedStudentProfileId;
      if (!target) throw new BadRequestException('This row has no matched student — assign one before confirming.');

      // Claim the row so a concurrent confirm cannot post it twice.
      const claimed = await tx.paymentImportRow.updateMany({
        where: { id: row.id, matchStatus: row.matchStatus },
        data: { matchStatus: 'posting' },
      });
      if (claimed.count !== 1) throw new ConflictException('Row is being confirmed by someone else.');

      const isBank = batch.provider === 'bank';
      const receipt: any = await this.payments.collect(
        {
          studentProfileId: target,
          amount: Number(row.amount),
          paymentMethod: isBank ? 'bank' : 'mobile_money',
          externalReference: row.externalRef,
          externalReferenceType: 'import_row',
          reference: `${batch.provider.toUpperCase()} ${row.externalRef}`,
          paymentDate: row.transactionDate?.toISOString(),
          convertOverpaymentToCredit: true,
        } as any,
        { tx, settlementAccountId: await this.determination.settlementAccount(isBank ? 'bank' : 'mobile_money', tx) },
      );

      return tx.paymentImportRow.update({
        where: { id: row.id },
        data: {
          matchStatus: 'posted',
          matchedStudentProfileId: target,
          matchReason: studentProfileId && studentProfileId !== row.matchedStudentProfileId ? 'manual' : row.matchReason,
          paymentId: receipt?.payment?.id ?? null,
          error: null,
        },
      });
    });

    const posted = await this.prisma.client.paymentImportRow.count({ where: { batchId, matchStatus: 'posted' } });
    await this.prisma.client.paymentImportBatch.update({ where: { id: batchId }, data: { postedCount: posted } });
    this.events.publish('school.fee.import.batch.posted', {
      organizationId: this.tenant.organizationId,
      batchId,
      postedCount: posted,
      totalAmount: updated.amount.toString(),
    });
    return updated;
  }

  /** Post every HIGH-confidence matched row; each row commits independently. */
  async confirmHighConfidence(batchId: string) {
    const rows = await this.prisma.client.paymentImportRow.findMany({
      where: { batchId, matchStatus: 'matched', matchConfidence: 'high' },
      select: { id: true, externalRef: true },
    });
    const results: Array<{ rowId: string; externalRef: string; status: 'posted' | 'failed'; error?: string }> = [];
    for (const r of rows) {
      try {
        await this.confirmRow(batchId, r.id);
        results.push({ rowId: r.id, externalRef: r.externalRef, status: 'posted' });
      } catch (err: any) {
        const error = err?.message ?? String(err);
        await this.prisma.client.paymentImportRow.update({ where: { id: r.id }, data: { error } });
        results.push({ rowId: r.id, externalRef: r.externalRef, status: 'failed', error });
      }
    }
    return { attempted: rows.length, posted: results.filter((r) => r.status === 'posted').length, results };
  }
}
