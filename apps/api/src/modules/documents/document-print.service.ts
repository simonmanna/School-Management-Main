/**
 * DMS — Phase 4 print orchestration (§4.3).
 *
 *   - `print` permission required (resolved through the same fallback chain).
 *   - Print-log idempotency: DocumentPrintLog.idempotencyKey is UNIQUE — a
 *     retry replays the stored result without re-rendering.
 *   - No per-print snapshot by default: reprints render from the latest
 *     snapshot (issued/posted) or live data (drafts). `snapshotOnPrint` is
 *     opt-in per type (snapshotPolicy) — it captures a `print` snapshot.
 *   - REPRINT (any prior print log on the document) requires a reason.
 *   - Log type = document type code (uppercased) so the timeline stays
 *     per-document and filters can group by family.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { DocumentPermissionsService, toPermissionSubject } from './document-permissions.service';
import { DocumentRenderService, type RenderOutcome } from './document-render.service';
import { buildSnapshotData } from './dms.snapshot';

export interface PrintInput {
  orgId: string;
  userId: string;
  userPermissions: string[];
  documentId: string;
  format: string;
  copies?: number;
  printer?: string;
  reason?: string;
  idempotencyKey: string;
}

export interface PrintOutcome extends RenderOutcome {
  printLogId: string;
  action: 'PRINT' | 'REPRINT';
  replayed: boolean;
  copies: number;
}

@Injectable()
export class DocumentPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: DocumentPermissionsService,
    private readonly render: DocumentRenderService,
  ) {}

  async print(input: PrintInput): Promise<PrintOutcome> {
    if (!input.idempotencyKey?.trim()) {
      throw new BadRequestException('idempotencyKey is required');
    }
    const idempotencyKey = input.idempotencyKey.trim();
    this.render.assertFormat(input.format);

    const doc = await this.prisma.client.document.findFirst({
      where: { id: input.documentId, organizationId: input.orgId },
      include: { documentTypeDef: true, lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const def = doc.documentTypeDef;

    // Print permission through the same fallback chain.
    const effectiveKey = this.permissions.resolveKey(
      input.userPermissions,
      toPermissionSubject(def),
      'print',
    );
    if (!effectiveKey) {
      throw new ForbiddenException(`Missing permission to print '${def.code}' documents`);
    }

    // Idempotency replay (§4.3): same (org, document, idempotencyKey) returns the
    // stored log. A cross-document key reuse (same key, different doc) hits the
    // global unique index — convert that into a replay of the existing row.
    const prior = await this.prisma.client.documentPrintLog.findFirst({
      where: { idempotencyKey, organizationId: input.orgId, documentId: doc.id },
    });
    if (prior) {
      return {
        printLogId: prior.id,
        action: prior.action as 'PRINT' | 'REPRINT',
        replayed: true,
        copies: prior.copies,
        format: input.format,
        contentType: 'text/plain',
        content: `Replayed print ${prior.id} (${prior.type}, ${prior.action}) — no re-render`,
        templateKey: '',
        templateVersionId: null,
        renderedFrom: 'snapshot',
        snapshotId: null,
      };
    }

    // Reprints (any existing log for this document) require a reason.
    const priorLogs = await this.prisma.client.documentPrintLog.count({
      where: { documentId: doc.id, organizationId: input.orgId },
    });
    const action: 'PRINT' | 'REPRINT' = priorLogs > 0 ? 'REPRINT' : 'PRINT';
    if (action === 'REPRINT' && !input.reason?.trim()) {
      throw new BadRequestException('A reprint requires a reason');
    }

    const copies = Math.max(1, Math.min(input.copies ?? 1, 5));

    // snapshotOnPrint opt-in: capture a `print` snapshot before rendering so
    // the printed artifact is reproducible even for drafts.
    const sp = (def.snapshotPolicy ?? {}) as { snapshotOnPrint?: boolean; captureOn?: string[] };
    if (sp.snapshotOnPrint) {
      const existing = await this.prisma.client.documentSnapshot.count({
        where: { documentId: doc.id, organizationId: input.orgId, reason: 'print' },
      });
      if (existing === 0) {
        const snapData = buildSnapshotData(doc as never, doc.lines ?? [], {
          code: def.code,
          name: def.name,
        });
        await this.prisma.client.documentSnapshot.create({
          data: {
            organizationId: input.orgId,
            documentId: doc.id,
            state: doc.status,
            data: snapData as never,
            reason: 'print',
            createdById: input.userId,
          },
        });
      }
    }

    const outcome = await this.render.render(input.orgId, doc, doc.lines ?? [], def, input.format);
    let log;
    try {
      log = await this.prisma.client.documentPrintLog.create({
        data: {
          organizationId: input.orgId,
          documentId: doc.id,
          type: def.code.replace(/_/g, '-').toUpperCase(),
          action,
          copies,
          printedById: input.userId,
          reason: input.reason ?? null,
          printer: input.printer ?? null,
          idempotencyKey,
        },
      });
    } catch (err: unknown) {
      // Global unique index on idempotencyKey — another document used this key first.
      // Replay the existing log row (P2005 → idempotent replay per §4.3).
      if ((err as { code?: string }).code === 'P2005' || /(Unique constraint)/i.test(String(err))) {
        const existing = await this.prisma.client.documentPrintLog.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          log = existing;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    return {
      printLogId: log.id,
      action: log.action as 'PRINT' | 'REPRINT',
      replayed: log.idempotencyKey === idempotencyKey && action === 'PRINT' ? false : true,
      copies,
      ...outcome,
    };
  }
}