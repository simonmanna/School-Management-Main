import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { FilesService } from '../../../../../kernel/files/files.service';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { CapabilityService } from '../context/capability.service';
import { CAP } from '../capabilities';
import { LmsEventService } from '../lms-event.service';

/**
 * File areas an LMS file can belong to (ADR-014 §3.7).
 *
 * The area is not decoration — it decides who may read the file. A `submission`
 * belongs to one pupil and their markers; `content` belongs to everyone on the
 * course. Getting this wrong means one student downloading another's homework.
 */
export type LmsFileArea =
  | 'intro'        // activity description attachments — any course participant
  | 'content'      // page/label body images — any course participant
  | 'resource'     // mod_resource payload — any course participant
  | 'folder'       // mod_folder contents — any course participant
  | 'submission'   // a pupil's own work — that pupil + markers ONLY
  | 'feedback'     // a marker's response — the pupil it is about + markers
  | 'scorm_package'; // packaged content — any course participant

/** Areas whose contents are private to one student. */
const PRIVATE_AREAS: LmsFileArea[] = ['submission', 'feedback'];

export interface LmsFileRef {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
}

/**
 * LMS file handling (L2.1).
 *
 * Wraps `kernel/files` rather than building a second store — it already does
 * storage drivers, checksums, size limits and signed URLs. What it does NOT do is
 * know about courses: `signDownloadForCaller` checks only the tenant, so any
 * authenticated user in the organization could mint a working link for any file
 * id. Everything here exists to add the missing question: may THIS caller read a
 * file belonging to THIS course, in THIS area?
 *
 * Addressing convention: `ownerType = 'lms'`,
 * `ownerId = '<courseOfferingId>:<area>:<itemId>'`.
 */
@Injectable()
export class LmsFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly files: FilesService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly caps: CapabilityService,
    private readonly events: LmsEventService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  static ownerId(courseOfferingId: string, area: LmsFileArea, itemId: string): string {
    return `${courseOfferingId}:${area}:${itemId}`;
  }

  private static parse(ownerId: string): { courseOfferingId: string; area: LmsFileArea; itemId: string } | null {
    const [courseOfferingId, area, ...rest] = ownerId.split(':');
    if (!courseOfferingId || !area) return null;
    return { courseOfferingId, area: area as LmsFileArea, itemId: rest.join(':') };
  }

  /**
   * Attach an uploaded file to a course area.
   *
   * The file must already exist (uploaded through `POST /files/upload`); this
   * re-homes it under the LMS owner convention after checking the caller may
   * write to that area. A pupil may only ever write into their OWN submission.
   */
  async attach(input: {
    fileId: string;
    courseOfferingId: string;
    area: LmsFileArea;
    itemId: string;
    /** Required for `submission` / `feedback`: whose work this concerns. */
    studentProfileId?: string;
  }): Promise<LmsFileRef> {
    const file = await this.prisma.client.file.findFirst({
      where: { id: input.fileId, organizationId: this.org, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');

    await this.assertMayWrite(input.courseOfferingId, input.area, input.studentProfileId);

    await this.prisma.client.file.update({
      where: { id: file.id },
      data: {
        ownerType: 'lms',
        ownerId: LmsFileService.ownerId(input.courseOfferingId, input.area, input.itemId),
        // A course file is never world-readable; every read goes through the
        // capability check below and a short-lived signed URL.
        visibility: 'private',
      },
    });
    await this.events.log({
      eventName: 'core_files.attached', component: 'core_files', action: 'created', target: 'file',
      courseOfferingId: input.courseOfferingId, objectId: file.id,
      other: { area: input.area, itemId: input.itemId },
    });
    return this.toRef(file);
  }

  /** Files in one area, filtered to what the caller may see. */
  async list(courseOfferingId: string, area: LmsFileArea, itemId: string): Promise<LmsFileRef[]> {
    await this.assertMayRead(courseOfferingId, area, undefined);
    const rows = await this.prisma.client.file.findMany({
      where: {
        organizationId: this.org,
        ownerType: 'lms',
        ownerId: LmsFileService.ownerId(courseOfferingId, area, itemId),
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toRef(r));
  }

  /**
   * A short-lived download URL, issued only after the course-level check.
   *
   * This is the method that closes the hole: the kernel signer will happily sign
   * any file id in the tenant, so an LMS file must never be signed through it
   * directly.
   */
  async signDownload(fileId: string): Promise<{ url: string; expiresAt: string; filename: string }> {
    const file = await this.prisma.client.file.findFirst({
      where: { id: fileId, organizationId: this.org, deletedAt: null },
    });
    if (!file) throw new NotFoundException('File not found');
    if (file.ownerType !== 'lms' || !file.ownerId) {
      throw new BadRequestException('Not an LMS file');
    }
    const parsed = LmsFileService.parse(file.ownerId);
    if (!parsed) throw new BadRequestException('Malformed LMS file reference');

    await this.assertMayRead(parsed.courseOfferingId, parsed.area, parsed.itemId);

    const signed = await this.files.signDownloadForCaller(fileId);
    await this.events.log({
      eventName: 'core_files.downloaded', component: 'core_files', action: 'viewed', target: 'file',
      courseOfferingId: parsed.courseOfferingId, objectId: fileId,
      other: { area: parsed.area },
    });
    return { ...signed, filename: file.filename };
  }

  /** Detach a file from an activity. Removes the row; storage cleanup is the kernel's. */
  async remove(fileId: string): Promise<{ ok: true }> {
    const file = await this.prisma.client.file.findFirst({
      where: { id: fileId, organizationId: this.org, ownerType: 'lms', deletedAt: null },
    });
    if (!file?.ownerId) throw new NotFoundException('File not found');
    const parsed = LmsFileService.parse(file.ownerId);
    if (!parsed) throw new BadRequestException('Malformed LMS file reference');
    await this.assertMayWrite(parsed.courseOfferingId, parsed.area, parsed.itemId);
    await this.files.remove(fileId);
    return { ok: true };
  }

  // ── access rules ──

  /**
   * Read access.
   *
   * Public areas: anyone who can view the course. Private areas: the pupil the
   * file is about, or a marker. A guardian may read their child's submissions and
   * feedback — that is the point of the parent portal — but nothing of anyone else's.
   */
  private async assertMayRead(courseOfferingId: string, area: LmsFileArea, itemId?: string): Promise<void> {
    const p = this.portalIdentity.principal();

    if (PRIVATE_AREAS.includes(area)) {
      const owner = itemId ? await this.submissionOwner(itemId) : null;
      if (owner) {
        if (await this.portalIdentity.canAccessStudent(owner)) {
          // Staff reach here too; narrow them to actual markers.
          if (p.kind !== 'staff') return;
        }
        const mayMark = await this.caps.canAtCourse(
          { userId: p.userId }, CAP.assignViewSubmissions, courseOfferingId,
        );
        if (!mayMark) throw new ForbiddenException('Not permitted to read this submission');
        return;
      }
      // Unknown owner — refuse rather than guess. A private file with no
      // resolvable subject is a bug, and defaulting to "allow" leaks work.
      if (p.kind !== 'staff') throw new ForbiddenException('Not permitted to read this file');
      const mayMark = await this.caps.canAtCourse(
        { userId: p.userId }, CAP.assignViewSubmissions, courseOfferingId,
      );
      if (!mayMark) throw new ForbiddenException('Not permitted to read this file');
      return;
    }

    const principal = p.kind === 'student' ? { studentProfileId: p.studentProfileId } : { userId: p.userId };
    const mayView = await this.caps.canAtCourse(principal, CAP.courseView, courseOfferingId);
    if (mayView) return;
    // A guardian is not enrolled, so they hold no course capability; allow them
    // through only when one of their children is on the course.
    if (p.kind === 'guardian' && (await this.guardianHasChildOn(courseOfferingId))) return;
    throw new ForbiddenException('Not permitted to read files on this course');
  }

  /** Write access: teachers author content; a pupil writes only their own submission. */
  private async assertMayWrite(courseOfferingId: string, area: LmsFileArea, studentProfileId?: string): Promise<void> {
    const p = this.portalIdentity.principal();
    if (area === 'submission') {
      if (p.kind === 'student') {
        if (studentProfileId && studentProfileId !== p.studentProfileId) {
          throw new ForbiddenException('You may only attach files to your own submission');
        }
        const maySubmit = await this.caps.canAtCourse(
          { studentProfileId: p.studentProfileId }, CAP.assignSubmit, courseOfferingId,
        );
        if (!maySubmit) throw new ForbiddenException('You cannot submit to this activity');
        return;
      }
      // Guardians never submit on a pupil's behalf — it would corrupt the record.
      if (p.kind === 'guardian') throw new ForbiddenException('Guardians cannot submit work');
    }
    if (p.kind !== 'staff') throw new ForbiddenException('Not permitted to add files to this course');
    const mayEdit = await this.caps.canAtCourse(
      { userId: p.userId }, CAP.courseManageActivities, courseOfferingId,
    );
    const mayMark = area === 'feedback'
      ? await this.caps.canAtCourse({ userId: p.userId }, CAP.assignGrade, courseOfferingId)
      : false;
    if (!mayEdit && !mayMark) throw new ForbiddenException('Not permitted to add files to this course');
  }

  /** Whose submission an item id refers to, when the area is student-private. */
  private async submissionOwner(itemId: string): Promise<string | null> {
    const row = await this.prisma.client.modAssignSubmission.findFirst({
      where: { id: itemId, organizationId: this.org },
      select: { studentProfileId: true },
    });
    return row?.studentProfileId ?? null;
  }

  private async guardianHasChildOn(courseOfferingId: string): Promise<boolean> {
    const children = await this.portalIdentity.accessibleStudents();
    if (children.length === 0) return false;
    const enrolled = await this.prisma.client.courseEnrolment.findFirst({
      where: { organizationId: this.org, courseOfferingId, studentProfileId: { in: children }, status: 'active' },
      select: { id: true },
    });
    return enrolled !== null;
  }

  private toRef(f: { id: string; filename: string; contentType: string; byteSize: number; createdAt: Date }): LmsFileRef {
    return {
      id: f.id,
      filename: f.filename,
      contentType: f.contentType,
      byteSize: f.byteSize,
      uploadedAt: f.createdAt.toISOString(),
    };
  }
}
