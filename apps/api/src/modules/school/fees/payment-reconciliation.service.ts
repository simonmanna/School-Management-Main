import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SchoolPaymentService } from './billing.service';

/**
 * B4 — mobile-money / bank statement reconciliation intake (P1-11).
 *
 * A bursar uploads a provider statement (MTN MoMo, Airtel Money, bank). The
 * batch is fingerprinted (fileHash) so re-uploading the same statement is
 * rejected before parsing. Each row is matched to a student by CONFIDENCE:
 *
 *   HIGH   exact admission number in the narration / provider reference
 *   MEDIUM (reserved) exact payer + amount + date
 *   LOW    fuzzy name — MANUAL REVIEW ONLY, never auto-posts
 *
 * A row only reaches `posted` when the canonical payment engine
 * (SchoolPaymentService.collect) actually created Payment + Allocation +
 * Receipt + CashMovement + GL — never merely because matching succeeded. The
 * externalRef unique index makes re-import idempotent at the row level too.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly payments: SchoolPaymentService,
  ) {}

  async importBatch(dto: {
    provider: string;
    filename: string;
    statementPeriod?: string;
    rows: Array<{ externalRef: string; payerPhone?: string; payerName?: string; amount: number; transactionDate?: string; narration?: string }>;
  }) {
    const organizationId = this.tenant.organizationId;
    if (!['mtn_momo', 'airtel_money', 'bank'].includes(dto.provider)) {
      throw new BadRequestException(`Unknown provider '${dto.provider}'`);
    }
    if (!dto.rows?.length) throw new BadRequestException('No rows to import');

    const fileHash = createHash('sha256')
      .update(JSON.stringify(dto.rows.map((r) => [r.externalRef, r.amount, r.transactionDate ?? '', r.narration ?? ''])))
      .digest('hex');

    // Batch-level dup guard (before parsing).
    const dup = await this.prisma.client.paymentImportBatch.findFirst({
      where: { organizationId, provider: dto.provider, statementPeriod: dto.statementPeriod ?? null, fileHash },
    });
    if (dup) {
      throw new ConflictException(`This statement was already imported (batch ${dup.id}). Duplicate rejected.`);
    }

    const totalAmount = dto.rows.reduce((s, r) => s + Number(r.amount), 0);

    // Preload students for matching (admission number).
    const students = await this.prisma.client.studentProfile.findMany({
      where: { organizationId },
      select: { id: true, admissionNo: true },
    });
    const byAdmission = new Map<string, string>();
    for (const s of students) if (s.admissionNo) byAdmission.set(s.admissionNo.toUpperCase(), s.id);

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
      const { studentId, confidence } = this.match(r, byAdmission);
      const matchStatus = confidence === 'high' ? 'matched' : 'unmatched';
      if (confidence === 'high') matched++;
      try {
        await this.prisma.client.paymentImportRow.create({
          data: {
            organizationId,
            batchId: batch.id,
            externalRef: r.externalRef,
            payerPhone: r.payerPhone ?? null,
            payerName: r.payerName ?? null,
            amount: r.amount,
            transactionDate: r.transactionDate ? new Date(r.transactionDate) : null,
            narration: r.narration ?? null,
            matchStatus,
            matchConfidence: confidence,
            matchedStudentProfileId: studentId ?? null,
          },
        });
      } catch (err: any) {
        // externalRef already imported in another batch — mark this row a dup.
        if (err?.code === 'P2002') {
          await this.prisma.client.paymentImportRow.create({
            data: {
              organizationId, batchId: batch.id, externalRef: `${r.externalRef}#${batch.id.slice(0, 6)}`,
              amount: r.amount, matchStatus: 'duplicate', matchConfidence: 'none',
              narration: `Duplicate of ${r.externalRef}`,
            },
          }).catch(() => undefined);
        } else throw err;
      }
    }

    await this.prisma.client.paymentImportBatch.update({
      where: { id: batch.id },
      data: { matchedCount: matched },
    });
    return this.getBatch(batch.id);
  }

  /** HIGH only when the narration/ref carries an exact admission number. */
  private match(
    r: { externalRef: string; narration?: string; payerName?: string },
    byAdmission: Map<string, string>,
  ): { studentId?: string; confidence: 'high' | 'medium' | 'low' | 'none' } {
    const hay = `${r.narration ?? ''} ${r.externalRef}`.toUpperCase();
    for (const [adm, id] of byAdmission) {
      if (adm.length >= 3 && hay.includes(adm)) return { studentId: id, confidence: 'high' };
    }
    // A fuzzy payer-name signal is LOW and never auto-posts — surfaced for
    // manual assignment only.
    if (r.payerName) return { confidence: 'low' };
    return { confidence: 'none' };
  }

  list() {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.paymentImportBatch.findMany({
      where: { organizationId },
      orderBy: { uploadedAt: 'desc' },
      take: 50,
    });
  }

  async getBatch(id: string) {
    const organizationId = this.tenant.organizationId;
    const batch = await this.prisma.client.paymentImportBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new NotFoundException(`Import batch ${id} not found`);
    const rows = await this.prisma.client.paymentImportRow.findMany({
      where: { organizationId, batchId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { batch, rows };
  }

  /**
   * Confirm a matched (or manually assigned) row and post it through the
   * canonical payment engine. `studentProfileId` overrides/sets the match for a
   * LOW/unmatched row — the human assignment a fuzzy match requires.
   */
  async confirmRow(batchId: string, rowId: string, studentProfileId?: string) {
    const organizationId = this.tenant.organizationId;
    const row = await this.prisma.client.paymentImportRow.findFirst({ where: { id: rowId, organizationId, batchId } });
    if (!row) throw new NotFoundException(`Import row ${rowId} not found`);
    if (row.matchStatus === 'posted') return row;

    const targetStudent = studentProfileId ?? row.matchedStudentProfileId;
    if (!targetStudent) {
      throw new BadRequestException('This row has no matched student — assign one before confirming.');
    }

    // Post through the engine with reference = externalRef, so a re-confirm or
    // re-import replays the original receipt rather than paying twice.
    const receipt = await this.payments.collect({
      studentProfileId: targetStudent,
      amount: Number(row.amount),
      paymentMethod: row.batchId ? 'mobile_money' : 'bank',
      reference: row.externalRef,
      paymentDate: row.transactionDate?.toISOString(),
    } as any);

    const updated = await this.prisma.client.paymentImportRow.update({
      where: { id: row.id },
      data: {
        matchStatus: 'posted',
        matchedStudentProfileId: targetStudent,
        paymentId: (receipt as any)?.payment?.id ?? null,
      },
    });

    const posted = await this.prisma.client.paymentImportRow.count({
      where: { organizationId, batchId, matchStatus: 'posted' },
    });
    await this.prisma.client.paymentImportBatch.update({ where: { id: batchId }, data: { postedCount: posted } });

    this.events.publish('school.fee.import.batch.posted', {
      organizationId, batchId, postedCount: posted, totalAmount: row.amount.toString(),
    });
    return updated;
  }
}
