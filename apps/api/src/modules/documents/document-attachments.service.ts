/**
 * DMS — Phase 5 attachments (§5.4). Files stay in the existing File vault
 * (G3 — no second storage system); DocumentAttachment links a File to a
 * document with a ROLE:
 *   ATTACHMENT (user upload) | GENERATED_OUTPUT (engine-rendered output) |
 *   SIGNED_COPY (signature capture) | SOURCE_FILE (origin document).
 * Role whitelist enforced on write; downloads go through the files service's
 * presigned/ownership flow.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { FilesService } from '../../kernel/files/files.service';

export const ATTACHMENT_ROLES = ['ATTACHMENT', 'SIGNED_COPY'] as const;

export interface AttachmentUploadInput {
  orgId: string;
  userId: string;
  documentId: string;
  role?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DocumentAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  /** Store an uploaded buffer as a File with ownerType 'document', then link. */
  async attach(
    input: AttachmentUploadInput,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ): Promise<{ id: string; role: string; fileId: string; fileName: string; size: number }> {
    const role = (input.role ?? 'ATTACHMENT').toUpperCase();
    if (!(ATTACHMENT_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(
        `Attachment role must be one of ${ATTACHMENT_ROLES.join(', ')} (GENERATED_OUTPUT and SOURCE_FILE are engine-managed)`,
      );
    }
    const doc = await this.prisma.client.document.findFirst({
      where: { id: input.documentId, organizationId: input.orgId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const stored = await this.files.upload({
      filename: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
      ownerType: 'document',
      ownerId: input.documentId,
      visibility: 'private',
    });

    const row = await this.prisma.client.documentAttachment.create({
      data: {
        organizationId: input.orgId,
        documentId: input.documentId,
        fileId: stored.id,
        role,
        kind: input.kind ?? null,
        version: 1,
        metadata: (input.metadata ?? {}) as never,
        createdById: input.userId,
      },
    });
    return {
      id: row.id,
      role,
      fileId: stored.id,
      fileName: file.originalname,
      size: file.size,
    };
  }

  async list(orgId: string, documentId: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id: documentId, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const rows = await this.prisma.client.documentAttachment.findMany({
      where: { organizationId: orgId, documentId },
      include: { file: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      kind: r.kind,
      version: r.version,
      createdAt: r.createdAt,
      createdById: r.createdById,
      file: {
        id: r.file.id,
        fileName: r.file.filename,
        contentType: r.file.contentType,
        size: r.file.byteSize,
        storageKey: r.file.storageKey,
        downloadUrl: this.files.signDownload(r.file.id),
      },
    }));
  }

  async remove(orgId: string, documentId: string, attachmentId: string): Promise<{ deleted: boolean }> {
    const rows = await this.prisma.client.documentAttachment.deleteMany({
      where: { id: attachmentId, organizationId: orgId, documentId },
    });
    if (rows.count === 0) throw new NotFoundException('Attachment not found');
    return { deleted: true };
  }
}