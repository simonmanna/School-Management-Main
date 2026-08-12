/**
 * DMS — Phase 4 render service (§4.1–4.3). Renders a document from a
 * TemplateDefinition (active version for the type+format) against a data
 * context that is either the LATEST SNAPSHOT (issued/posted documents with
 * snapshots — immutable representation) or LIVE document data (drafts).
 *
 * Formats: a4 → HTML → PDF via BrowserPool; html → HTML string; thermal →
 * ESC/POS-style text; plain/email → text. `TemplateDefinition` is global
 * registry data — a new document type = seed rows, zero engine code (G2).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import {
  buildSnapshotData,
  renderTemplate,
  toRenderContext,
  type SnapshotDocumentData,
} from './dms.snapshot';
import { BrowserPoolService } from './browser-pool.service';

export interface RenderOutcome {
  format: string;
  contentType: string;
  content: string; // html / text payload (a4 returns CONTENT_TYPE 'application/pdf' with base64)
  base64?: string;
  templateKey: string;
  templateVersionId: string | null;
  renderedFrom: 'snapshot' | 'live';
  snapshotId: string | null;
  pdf?: boolean;
}

export interface RenderSource {
  doc: any;
  lines: any[];
  type: { code: string; name: string; printProfile?: unknown; snapshotPolicy?: unknown };
}

@Injectable()
export class DocumentRenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: BrowserPoolService,
  ) {}

  /** Resolve the active template for (typeId, format); falls back to defaults. */
  async resolveTemplate(
    orgId: string,
    typeId: string,
    typeCode: string,
    format: string,
  ): Promise<{ templateKey: string; versionId: string | null; content: string | null }> {
    const tpl = await this.prisma.client.templateDefinition.findFirst({
      where: {
        documentTypeId: typeId,
        format,
        isActive: true,
      },
      orderBy: { version: 'desc' },
    });
    if (tpl) return { templateKey: tpl.templateKey, versionId: tpl.id, content: tpl.content };
    // No active template — built-in blank fallback so rendering never crashes.
    if (format === 'thermal') {
      return { templateKey: `${typeCode}:thermal:fallback`, versionId: null, content: null };
    }
    return { templateKey: `${typeCode}:a4:fallback`, versionId: null, content: null };
  }

  /**
   * Assemble the render context: latest snapshot when present AND the doc is
   * issued/posted (immutable representation, §4.3), else live fields.
   */
  async render(
    orgId: string,
    doc: any,
    lines: any[],
    type: { code: string; name: string; id: string },
    format: string,
  ): Promise<RenderOutcome> {
    const tpl = await this.resolveTemplate(orgId, type.id, type.code, format);
    const latest = await this.prisma.client.documentSnapshot.findFirst({
      where: { documentId: doc.id, organizationId: orgId },
      orderBy: { generatedAt: 'desc' },
    });
    const issued = doc.status === 'posted' || doc.status === 'issued' || doc.status === 'active';
    const data: SnapshotDocumentData =
      latest && issued
        ? (latest.data as unknown as SnapshotDocumentData)
        : buildSnapshotData(doc, lines, type);
    const ctx = toRenderContext(data);
    const templateContent = tpl.content ?? this.fallbackTemplate(format);

    if (format === 'a4' || format === 'html') {
      const html = renderTemplate(templateContent ?? '', { ...ctx, companyName: 'POS-CAFE' });
      if (format === 'html') {
        return {
          format,
          contentType: 'text/html',
          content: html,
          templateKey: tpl.templateKey,
          templateVersionId: tpl.versionId,
          renderedFrom: latest && issued ? 'snapshot' : 'live',
          snapshotId: latest && issued ? latest.id : null,
        };
      }
      const { pdf } = await this.pool.renderHtmlToPdf(html);
      return {
        format,
        contentType: 'application/pdf',
        content: `PDF ${pdf.length} bytes (seal-reproducible)`,
        base64: pdf.toString('base64'),
        pdf: true,
        templateKey: tpl.templateKey,
        templateVersionId: tpl.versionId,
        renderedFrom: latest && issued ? 'snapshot' : 'live',
        snapshotId: latest && issued ? latest.id : null,
      };
    }
    // thermal / plain / email
    const text = renderTemplate(templateContent ?? '', { ...ctx, companyName: 'POS-CAFE' });
    return {
      format,
      contentType: format === 'thermal' ? 'text/plain; charset=escpos' : 'text/plain',
      content: text,
      templateKey: tpl.templateKey,
      templateVersionId: tpl.versionId,
      renderedFrom: latest && issued ? 'snapshot' : 'live',
      snapshotId: latest && issued ? latest.id : null,
    };
  }

  private fallbackTemplate(format: string): string {
    if (format === 'thermal') {
      return `{{companyName}}\n{{documentTypeName}}\n{{documentNumber}}\n--------------------------------\nTOTAL {{totalAmount}}\n`;
    }
    return `<html><body><h1>{{documentTypeName}}</h1><pre>{{documentNumber}}</pre></body></html>`;
  }

  assertFormat(format: string): void {
    const ok = ['a4', 'thermal', 'html', 'plain', 'email'];
    if (!ok.includes(format)) {
      throw new BadRequestException(`Unsupported format '${format}' (a4|thermal|html|plain|email)`);
    }
  }

  assertEngine(engine: string): void {
    const ok = ['puppeteer', 'escpos', 'handlebars', 'plain'];
    if (!ok.includes(engine)) {
      throw new BadRequestException(`Unsupported template engine '${engine}'`);
    }
  }
}