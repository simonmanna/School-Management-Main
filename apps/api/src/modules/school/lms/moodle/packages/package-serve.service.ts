import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { extname, join, normalize, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { FilesService } from '../../../../../kernel/files/files.service';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { CapabilityService } from '../context/capability.service';
import { CAP } from '../capabilities';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain', '.vtt': 'text/vtt', '.pdf': 'application/pdf',
};

/**
 * Serves the contents of an uploaded SCORM / H5P package (L8).
 *
 * A package is a zip of ordinary web assets that must be reachable by URL for the
 * player iframe to run it. Two things make that risky, and both are handled here:
 *
 *  1. **Path traversal.** Zip entries are attacker-controlled strings, and a
 *     malicious package can contain `../../../.env`. Every requested path is
 *     normalised and confirmed to stay inside the archive before a byte is read.
 *  2. **Access control.** These are course materials, so the same course-level
 *     check as any other LMS file applies; the kernel file service only checks
 *     the tenant.
 *
 * Entries are read straight from the zip rather than extracted to disk, so an
 * uploaded package never becomes executable content in the storage directory.
 */
@Injectable()
export class PackageServeService {
  private readonly logger = new Logger('LmsPackageServe');
  /** Small LRU so a page of assets does not re-open the zip for every request. */
  private readonly cache = new Map<string, AdmZip>();
  private static readonly CACHE_MAX = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly files: FilesService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly caps: CapabilityService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * One asset from inside a package.
   *
   * `entryPath` comes from the URL, so it is treated as hostile: normalised,
   * stripped of any leading separator, and rejected if it escapes the root.
   */
  async read(fileId: string, entryPath: string): Promise<{ body: Buffer; contentType: string }> {
    const file = await this.prisma.client.file.findFirst({
      where: { id: fileId, organizationId: this.org, deletedAt: null },
    });
    if (!file) throw new NotFoundException('Package not found');
    await this.assertMayRead(file.ownerId ?? '');

    const safe = this.safeEntry(entryPath);
    const zip = this.open(file.id, file.storageKey);
    const entry = zip.getEntry(safe) ?? zip.getEntry(`${safe}/index.html`);
    if (!entry || entry.isDirectory) throw new NotFoundException(`No entry '${safe}' in this package`);

    return {
      body: entry.getData(),
      contentType: MIME[extname(safe).toLowerCase()] ?? 'application/octet-stream',
    };
  }

  /**
   * Parse `imsmanifest.xml` far enough to find the launch page.
   *
   * Deliberately shallow: a full manifest parse would pull in an XML dependency to
   * learn one attribute, and the rest of the manifest is only meaningful to a
   * sequencing engine we do not implement.
   */
  async entryPointOf(fileId: string): Promise<string> {
    const file = await this.prisma.client.file.findFirst({
      where: { id: fileId, organizationId: this.org, deletedAt: null },
    });
    if (!file) throw new NotFoundException('Package not found');
    const zip = this.open(file.id, file.storageKey);
    const manifest = zip.getEntry('imsmanifest.xml');
    if (manifest) {
      const xml = manifest.getData().toString('utf8');
      const href = /<resource\b[^>]*\bhref="([^"]+)"/i.exec(xml)?.[1];
      if (href) return this.safeEntry(href);
    }
    // H5P and hand-rolled packages: fall back to the conventional entry point.
    for (const candidate of ['index.html', 'story.html', 'scormcontent/index.html']) {
      if (zip.getEntry(candidate)) return candidate;
    }
    throw new BadRequestException('Could not find a launch page in this package');
  }

  // ── internals ──

  /**
   * Reject anything that climbs out of the archive root. `../` in a zip entry is
   * the classic "zip slip", and the path here comes straight off the URL.
   */
  private safeEntry(entryPath: string): string {
    const cleaned = decodeURIComponent(entryPath || 'index.html').replace(/^\/+/, '');
    if (cleaned.includes('\0')) throw new BadRequestException('Invalid path');
    const normalised = normalize(cleaned).split(sep).join('/');
    if (normalised.startsWith('../') || normalised === '..' || normalised.startsWith('/')) {
      throw new ForbiddenException('Path escapes the package');
    }
    return normalised;
  }

  private open(fileId: string, storageKey: string): AdmZip {
    const hit = this.cache.get(fileId);
    if (hit) return hit;
    const root = resolve(process.env.STORAGE_LOCAL_DIR ?? './var/uploads');
    const full = join(root, storageKey);
    // The storage key is ours, but confirm it stays inside the storage root
    // regardless — a corrupted row must not become an arbitrary file read.
    if (!resolve(full).startsWith(root)) throw new ForbiddenException('Invalid storage key');
    let zip: AdmZip;
    try {
      zip = new AdmZip(full);
    } catch (err) {
      this.logger.warn(`Package ${fileId} is not a readable zip: ${String(err)}`);
      throw new BadRequestException('This package could not be opened. Re-upload it as a .zip.');
    }
    if (this.cache.size >= PackageServeService.CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(fileId, zip);
    return zip;
  }

  /** Same course gate as any other LMS file. */
  private async assertMayRead(ownerId: string): Promise<void> {
    const courseOfferingId = ownerId.split(':')[0];
    if (!courseOfferingId) throw new ForbiddenException('Package is not attached to a course');
    const p = this.portalIdentity.principal();
    const principal = p.kind === 'student' ? { studentProfileId: p.studentProfileId } : { userId: p.userId };
    if (await this.caps.canAtCourse(principal, CAP.courseView, courseOfferingId)) return;
    if (p.kind === 'guardian') {
      const children = await this.portalIdentity.accessibleStudents();
      const enrolled = children.length
        ? await this.prisma.client.courseEnrolment.findFirst({
            where: { organizationId: this.org, courseOfferingId, studentProfileId: { in: children }, status: 'active' },
            select: { id: true },
          })
        : null;
      if (enrolled) return;
    }
    throw new ForbiddenException('Not permitted to open this package');
  }
}
