import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { ReportCardService } from './examinations.service';
import { ReportCardSettingsService } from './report-card-settings.service';
import type { GenerateReportDocumentsDto, PublishReportDocumentsDto, VoidReportDocumentDto } from './report-document.dto';

/**
 * Phase 5 — reproducible report documents.
 *
 * A `ReportCard` holds a JSON payload and nothing that answers "which results
 * and which template produced this, and has it since been replaced?". A
 * `ReportDocument` does: it pins the result set and revision, the template
 * version, a payload checksum, and a supersession chain. Publishing freezes it —
 * a correction issues revision n+1 and marks the old one superseded, so a parent
 * holding the first copy can still be shown exactly what they were given.
 */
@Injectable()
export class ReportDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly cards: ReportCardService,
    private readonly settings: ReportCardSettingsService,
  ) {}

  private get db(): any { return this.prisma.client; }
  private get org(): string { return this.tenant.organizationId; }

  /**
   * The template version a document was produced under.
   *
   * Report-card layout is settings-driven rather than a row per version, so the
   * version IS the settings: a stable hash over the resolved configuration plus
   * the preset key. Change the layout and the next document records a different
   * template version, which is precisely the question provenance has to answer.
   */
  private async templateVersion(): Promise<{ id: string; key: string }> {
    const resolved: any = await this.settings.get();
    const key = resolved?.presetKey ?? 'custom';
    const id = createHash('sha256').update(JSON.stringify(resolved ?? {})).digest('hex').slice(0, 24);
    return { id, key };
  }

  private checksum(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  }

  // ── generation ─────────────────────────────────────────────────────────────

  /**
   * Issue report documents for a class from a published result set.
   *
   * Only a published set is used: a document generated from a draft calculation
   * is a document that changes after it was handed out. Where a learner already
   * has a published document for the same result set and template, nothing is
   * reissued unless `reissue` is set — and then the old one is superseded, not
   * overwritten.
   */
  async generate(dto: GenerateReportDocumentsDto) {
    const rs = await this.db.resultSet.findFirst({ where: { id: dto.resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${dto.resultSetId} not found`);
    if (!['published', 'locked'].includes(rs.status)) {
      throw new BadRequestException('Report documents are issued from a published result set. Publish the results first.');
    }

    const template = await this.templateVersion();
    const termResults = await this.db.studentTermResult.findMany({
      where: {
        resultSetId: rs.id,
        ...(dto.studentProfileIds?.length ? { studentProfileId: { in: dto.studentProfileIds } } : {}),
      },
    });
    if (!termResults.length) throw new BadRequestException('That result set covers no learners');

    const issued: any[] = [];
    const skipped: Array<{ studentProfileId: string; reason: string }> = [];

    for (const tr of termResults) {
      try {
        // One learner per transaction: a single failing card must not roll back
        // a whole class's issue run.
        const doc = await this.issueOne(rs, tr.studentProfileId, template, dto);
        if (doc) issued.push(doc); else skipped.push({ studentProfileId: tr.studentProfileId, reason: 'already issued for this result set and template' });
      } catch (err: unknown) {
        skipped.push({
          studentProfileId: tr.studentProfileId,
          reason: err instanceof Error ? err.message : 'could not be issued',
        });
      }
    }

    return {
      resultSetId: rs.id,
      resultSetRevision: rs.revision,
      templateVersionId: template.id,
      documentType: dto.documentType ?? 'term_report',
      issued: issued.length,
      skipped,
      documents: issued,
    };
  }

  private async issueOne(rs: any, studentProfileId: string, template: { id: string; key: string }, dto: GenerateReportDocumentsDto) {
    const documentType = dto.documentType ?? 'term_report';

    const existing = await this.db.reportDocument.findFirst({
      where: {
        studentProfileId, termId: rs.termId, documentType,
        resultSetId: rs.id, templateVersionId: template.id,
        status: { in: ['draft', 'generated', 'published'] },
      },
      orderBy: { revision: 'desc' },
    });
    if (existing && !dto.reissue) return null;
    if (existing && !dto.reason?.trim()) {
      throw new BadRequestException('Reissuing a report document needs a reason');
    }

    // The card is the rendered content; the document is its provenance record.
    const card = await this.cards.generate({ studentProfileId, termId: rs.termId } as any);
    const payload = card?.payload ?? {};
    const checksum = this.checksum(payload);

    return this.db.$transaction(async (tx: any) => {
      const revision = (existing?.revision ?? 0) + 1;
      const doc = await tx.reportDocument.create({
        data: {
          organizationId: this.org,
          studentProfileId,
          termId: rs.termId,
          documentType,
          resultSetId: rs.id,
          resultSetRevision: rs.revision,
          reportCardId: card?.id ?? null,
          templateVersionId: template.id,
          templateKey: template.key,
          revision,
          status: 'generated',
          payload: payload as any,
          payloadChecksum: checksum,
          generatedById: this.tenant.userId ?? null,
          supersedesId: existing?.id ?? null,
        },
      });
      if (existing) {
        await tx.reportDocument.updateMany({
          where: { id: existing.id },
          data: { status: 'superseded', supersededById: doc.id },
        });
        await this.events.publishInTx(tx, EVENTS.SchoolReportDocumentSuperseded, {
          organizationId: this.org, reportDocumentId: existing.id, supersededById: doc.id, reason: dto.reason ?? null,
        });
      }
      await this.audit.recordInTx(tx, {
        entity: 'ReportDocument', entityId: doc.id, action: 'create',
        newValues: {
          studentProfileId, termId: rs.termId, documentType, revision,
          resultSetId: rs.id, resultSetRevision: rs.revision,
          templateVersionId: template.id, payloadChecksum: checksum,
          supersedes: existing?.id ?? null, reason: dto.reason ?? null,
        },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolReportDocumentGenerated, {
        organizationId: this.org, reportDocumentId: doc.id, studentProfileId, termId: rs.termId, resultSetId: rs.id,
      });
      return doc;
    });
  }

  // ── publication ────────────────────────────────────────────────────────────

  /** Release documents to families. Publication freezes the payload. */
  async publish(dto: PublishReportDocumentsDto) {
    if (!dto.documentIds?.length) throw new BadRequestException('Choose the documents to release');
    return this.db.$transaction(async (tx: any) => {
      const docs = await tx.reportDocument.findMany({ where: { id: { in: dto.documentIds } } });
      const notReady = docs.filter((d: any) => !['draft', 'generated'].includes(d.status));
      if (notReady.length) {
        throw new BadRequestException(`${notReady.length} document(s) are not in a releasable state`);
      }
      const now = new Date();
      await tx.reportDocument.updateMany({
        where: { id: { in: docs.map((d: any) => d.id) } },
        data: { status: 'published', publishedAt: now, publishedById: this.tenant.userId ?? null },
      });
      // The parent-facing card and the provenance record are released together;
      // one without the other is how a portal shows a card nobody signed off.
      const cardIds = docs.map((d: any) => d.reportCardId).filter(Boolean);
      if (cardIds.length) {
        await tx.reportCard.updateMany({ where: { id: { in: cardIds } }, data: { publishedAt: now } });
      }
      await this.audit.recordInTx(tx, {
        entity: 'ReportDocument', entityId: docs[0]?.id ?? 'batch', action: 'post',
        newValues: { action: 'publish', count: docs.length, documentIds: docs.map((d: any) => d.id) },
      });
      for (const d of docs) {
        await this.events.publishInTx(tx, EVENTS.SchoolReportDocumentPublished, {
          organizationId: this.org, reportDocumentId: d.id, studentProfileId: d.studentProfileId, termId: d.termId,
        });
      }
      return { published: docs.length, publishedAt: now };
    });
  }

  /** Withdraw a document with a stated reason. It stays on the record as void. */
  async void(id: string, dto: VoidReportDocumentDto) {
    if (!dto.reason?.trim()) throw new BadRequestException('Voiding a report document needs a reason');
    return this.db.$transaction(async (tx: any) => {
      const doc = await tx.reportDocument.findFirst({ where: { id } });
      if (!doc) throw new NotFoundException(`ReportDocument ${id} not found`);
      if (doc.status === 'superseded') throw new BadRequestException('This document was already replaced by a newer revision');
      await tx.reportDocument.updateMany({ where: { id }, data: { status: 'void', voidReason: dto.reason } });
      if (doc.reportCardId) {
        await tx.reportCard.updateMany({ where: { id: doc.reportCardId }, data: { publishedAt: null } });
      }
      await this.audit.recordInTx(tx, {
        entity: 'ReportDocument', entityId: id, action: 'cancel',
        oldValues: { status: doc.status }, newValues: { status: 'void', reason: dto.reason },
      });
      return tx.reportDocument.findFirst({ where: { id } });
    });
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async list(query: { termId?: string; resultSetId?: string; studentProfileId?: string; status?: string; documentType?: string }) {
    const docs = await this.db.reportDocument.findMany({
      where: {
        ...(query.termId ? { termId: query.termId } : {}),
        ...(query.resultSetId ? { resultSetId: query.resultSetId } : {}),
        ...(query.studentProfileId ? { studentProfileId: query.studentProfileId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.documentType ? { documentType: query.documentType } : {}),
      },
      orderBy: [{ generatedAt: 'desc' }],
      take: 500,
    });
    const ids = [...new Set(docs.map((d: any) => d.studentProfileId))] as string[];
    const students = ids.length
      ? await this.db.studentProfile.findMany({
          where: { id: { in: ids } },
          select: { id: true, admissionNo: true, partner: { select: { name: true } } },
        })
      : [];
    const byId = new Map<string, any>((students as any[]).map((s: any) => [s.id, s]));
    return docs.map((d: any) => ({
      id: d.id,
      studentProfileId: d.studentProfileId,
      studentName: byId.get(d.studentProfileId)?.partner?.name ?? null,
      admissionNo: byId.get(d.studentProfileId)?.admissionNo ?? null,
      termId: d.termId,
      documentType: d.documentType,
      resultSetId: d.resultSetId,
      resultSetRevision: d.resultSetRevision,
      templateVersionId: d.templateVersionId,
      templateKey: d.templateKey,
      revision: d.revision,
      status: d.status,
      payloadChecksum: d.payloadChecksum,
      reportCardId: d.reportCardId,
      generatedAt: d.generatedAt,
      publishedAt: d.publishedAt,
      supersedesId: d.supersedesId,
      supersededById: d.supersededById,
      voidReason: d.voidReason,
    }));
  }

  /** One document with its full supersession chain — "can this be reproduced?". */
  async detail(id: string) {
    const doc = await this.db.reportDocument.findFirst({ where: { id } });
    if (!doc) throw new NotFoundException(`ReportDocument ${id} not found`);

    const chain: any[] = [];
    let cursor: any = doc;
    while (cursor?.supersedesId) {
      cursor = await this.db.reportDocument.findFirst({ where: { id: cursor.supersedesId } });
      if (!cursor) break;
      chain.push({ id: cursor.id, revision: cursor.revision, status: cursor.status, generatedAt: cursor.generatedAt, payloadChecksum: cursor.payloadChecksum });
    }

    const [student, resultSet]: [any, any] = await Promise.all([
      this.db.studentProfile.findFirst({
        where: { id: doc.studentProfileId },
        select: { id: true, admissionNo: true, partner: { select: { name: true } } },
      }),
      doc.resultSetId ? this.db.resultSet.findFirst({ where: { id: doc.resultSetId } }) : Promise.resolve(null),
    ]);

    return {
      ...doc,
      studentName: student?.partner?.name ?? null,
      admissionNo: student?.admissionNo ?? null,
      /** Recomputed from the stored payload — false means the payload was altered. */
      checksumVerified: this.checksum(doc.payload) === doc.payloadChecksum,
      resultSet: resultSet
        ? { id: resultSet.id, revision: resultSet.revision, status: resultSet.status, publishedAt: resultSet.publishedAt, outputChecksum: resultSet.outputChecksum }
        : null,
      supersedes: chain,
    };
  }
}
