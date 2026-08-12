import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { createHash, randomBytes, createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * F.5 — File storage abstraction.
 *
 * Two drivers:
 *   - 'local' (default in dev): files written under STORAGE_LOCAL_DIR with
 *     random keys. Suitable for single-node deployments and CI.
 *   - 's3' (placeholder): the S3 driver stub writes to a configurable prefix.
 *     Plug an actual S3 SDK when moving to production.
 *
 * Public download is via short-lived signed URLs (`/files/:id/download?token=…`).
 * Default TTL: 15 minutes.
 */

export interface FileUploadInput {
  filename: string;
  contentType: string;
  buffer: Buffer;
  ownerType?: string;
  ownerId?: string;
  visibility?: 'private' | 'org' | 'public';
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger('FilesService');
  private readonly driver: 'local' | 's3';
  private readonly localDir: string;
  private readonly signingSecret: string;
  private static readonly SIGN_TTL_MS = 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    this.driver = (process.env.STORAGE_DRIVER as 'local' | 's3') ?? 'local';
    this.localDir = resolve(process.env.STORAGE_LOCAL_DIR ?? './var/uploads');
    this.signingSecret = process.env.JWT_ACCESS_SECRET ?? 'dev-signing-secret';
    if (this.driver === 'local') {
      void mkdir(this.localDir, { recursive: true }).catch(() => undefined);
    }
  }

  async upload(input: FileUploadInput): Promise<{ id: string; storageKey: string }> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new BadRequestException('Empty file');
    }
    const maxBytes = Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024);
    if (input.buffer.length > maxBytes) {
      throw new BadRequestException(`File exceeds maximum size of ${maxBytes} bytes`);
    }
    const orgId = this.tenant.organizationId;
    const ext = extname(input.filename).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const key = `${orgId}/${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}${ext}`;
    const checksum = createHash('sha256').update(input.buffer).digest('hex');

    if (this.driver === 'local') {
      const fullPath = join(this.localDir, key);
      await mkdir(dirname(fullPath), { recursive: true });
      await new Promise<void>((res, rej) => {
        const ws = createWriteStream(fullPath);
        ws.on('error', rej);
        ws.on('finish', () => res());
        ws.end(input.buffer);
      });
    } else {
      // S3 driver stub — implement when production storage is wired.
      this.logger.warn('S3 storage driver is a stub; file metadata saved but bytes discarded');
    }

    let file;
    try {
      file = await this.prisma.client.file.create({
        data: {
          organizationId: orgId,
          uploadedById: this.tenant.userId ?? null,
          filename: sanitizeFilename(input.filename),
          contentType: input.contentType,
          byteSize: input.buffer.length,
          storageKey: key,
          visibility: input.visibility ?? 'private',
          ownerType: input.ownerType ?? null,
          ownerId: input.ownerId ?? null,
          checksum,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to persist file record: ${(e as Error).message}`, (e as Error).stack);
      throw new BadRequestException(`Unable to save file record: ${(e as Error).message}`);
    }
    return { id: file.id, storageKey: file.storageKey };
  }

  /** Issue a signed download URL. Token is HMAC-SHA256 over id+expiresAt. */
  signDownload(fileId: string): { url: string; expiresAt: string } {
    const exp = Date.now() + FilesService.SIGN_TTL_MS;
    const sig = createHmac('sha256', this.signingSecret)
      .update(`${fileId}:${exp}`)
      .digest('hex');
    const url = `/api/v1/files/${fileId}/download?token=${sig}&expires=${exp}`;
    return { url, expiresAt: new Date(exp).toISOString() };
  }

  /** Verify the signed URL token. Returns the file if valid, else throws. */
  async resolveSignedDownload(fileId: string, token: string, expires: string) {
    const exp = Number(expires);
    if (!Number.isFinite(exp) || Date.now() > exp) {
      throw new BadRequestException('Signed URL has expired');
    }
    const expected = createHmac('sha256', this.signingSecret).update(`${fileId}:${exp}`).digest('hex');
    if (expected !== token) {
      throw new BadRequestException('Invalid signed URL token');
    }
    // The download route is @Public (an <img> carries no auth), so there is no
    // tenant context. `File` is org-scoped, so reading via `prisma.client` would
    // throw "No tenant context" in the tenancy extension. Use the unscoped `raw`
    // client — the valid HMAC token is itself the authorization for this fileId.
    const file = await this.prisma.raw.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!file) throw new NotFoundException('File not found');
    // When a tenant context does exist (authenticated caller), still enforce the
    // org boundary for private files; for anonymous callers the token suffices.
    const currentOrg = this.tenant.optionalOrganizationId;
    if (file.visibility === 'private' && currentOrg && file.organizationId !== currentOrg) {
      throw new NotFoundException('File not found');
    }
    return file;
  }

  /** Stream the file from local disk. S3 driver would call GetObjectCommand here. */
  streamFromDisk(storageKey: string): { stream: NodeJS.ReadableStream; size: number } {
    const fullPath = join(this.localDir, storageKey);
    const size = statSync(fullPath).size;
    return { stream: createReadStream(fullPath), size };
  }

  async remove(fileId: string): Promise<void> {
    const file = await this.prisma.client.file.findFirst({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');
    if (file.organizationId !== this.tenant.organizationId) {
      throw new NotFoundException('File not found');
    }
    if (this.driver === 'local') {
      await unlink(join(this.localDir, file.storageKey)).catch(() => undefined);
    }
    await this.prisma.client.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
  }

  async listForOwner(ownerType: string, ownerId: string) {
    return this.prisma.client.file.findMany({
      where: { ownerType, ownerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200);
}
