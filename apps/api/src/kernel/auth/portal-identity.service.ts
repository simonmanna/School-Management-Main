import { ForbiddenException, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { PortalClaim, SchoolPrincipal } from './portal-identity.types';

/**
 * Resolves and enforces portal (student / guardian) identity.
 *
 * This is the ONLY sanctioned answer to "which student is this caller?". Before
 * it existed, `User` had no relation to `StudentProfile`, so endpoints read the
 * subject id off the URL and trusted it — meaning any authenticated caller could
 * read another family's data by editing a query parameter. Nothing outside this
 * service may derive a subject from request input.
 */
@Injectable()
export class PortalIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Untyped delegate for `PortalIdentity`. The generated Prisma client is
   * regenerated out-of-band (the dev API server holds the query engine open on
   * Windows), so this mirrors the existing polymorphic-table idiom in
   * `plugin-base.ts` rather than blocking on codegen.
   */
  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  /** Build the token claim for a user at login. Returns undefined for staff accounts. */
  async claimFor(userId: string, organizationId: string): Promise<PortalClaim | undefined> {
    const rows: Array<{ subjectType: string; studentProfileId: string | null; guardianContactId: string | null }> =
      await this.prisma.raw.portalIdentity.findMany({
        where: { userId, organizationId, revokedAt: null },
        select: { subjectType: true, studentProfileId: true, guardianContactId: true },
      });
    if (rows.length === 0) return undefined;

    const student = rows.find((r) => r.subjectType === 'student' && r.studentProfileId);
    if (student) return { kind: 'student', studentProfileId: student.studentProfileId! };

    const guardianContactIds = rows
      .filter((r) => r.subjectType === 'guardian' && r.guardianContactId)
      .map((r) => r.guardianContactId!);
    if (guardianContactIds.length > 0) return { kind: 'guardian', guardianContactIds };

    return undefined;
  }

  /** The caller, derived from the verified token only. Never from request input. */
  principal(): SchoolPrincipal {
    const userId = this.tenant.userId ?? '';
    const claim = this.tenant.portal;
    if (claim?.kind === 'student' && claim.studentProfileId) {
      return { kind: 'student', userId, studentProfileId: claim.studentProfileId };
    }
    if (claim?.kind === 'guardian' && claim.guardianContactIds?.length) {
      return { kind: 'guardian', userId, guardianContactIds: claim.guardianContactIds };
    }
    // No claim used to mean "staff", and staff pass every per-student gate. A
    // parent whose portal identity was revoked still holds the Parent role, signs
    // in with no claim, and so became staff — able to read every pupil. A family
    // account (portal grant, no staff read authority) without a live claim is
    // nobody, not staff.
    if (isFamilyOnlyAccount(this.tenant.permissions ?? [])) {
      throw new ForbiddenException('This portal account is not linked to a student or guardian');
    }
    return { kind: 'staff', userId };
  }

  /**
   * May this caller act on this student's data?
   *
   * Staff are allowed here and gated by their own coarse permissions + LMS
   * capabilities upstream; this method exists to stop one FAMILY reading
   * another's. A guardian's children are looked up live so that removing a
   * guardianship revokes access at once.
   */
  async canAccessStudent(studentProfileId: string): Promise<boolean> {
    const p = this.principal();
    if (p.kind === 'staff') return true;
    if (p.kind === 'student') return p.studentProfileId === studentProfileId;
    const link = await this.prisma.client.studentGuardian.findFirst({
      where: {
        studentProfileId,
        guardianContactId: { in: p.guardianContactIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    return link !== null;
  }

  /** Narrow a requested set of students to the ones this caller may actually see. */
  async filterAccessibleStudents(requested: string[]): Promise<string[]> {
    const p = this.principal();
    if (p.kind === 'staff') return requested;
    if (p.kind === 'student') return requested.filter((id) => id === p.studentProfileId);
    if (requested.length === 0) return [];
    const links = await this.prisma.client.studentGuardian.findMany({
      where: {
        studentProfileId: { in: requested },
        guardianContactId: { in: p.guardianContactIds },
        deletedAt: null,
      },
      select: { studentProfileId: true },
    });
    return [...new Set(links.map((l) => l.studentProfileId))];
  }

  /** Every student this caller may see, without them having to name any. */
  async accessibleStudents(): Promise<string[]> {
    const p = this.principal();
    if (p.kind === 'student') return [p.studentProfileId];
    if (p.kind === 'guardian') {
      const links = await this.prisma.client.studentGuardian.findMany({
        where: { guardianContactId: { in: p.guardianContactIds }, deletedAt: null },
        select: { studentProfileId: true },
      });
      return [...new Set(links.map((l) => l.studentProfileId))];
    }
    return [];
  }
}

/**
 * True for an account whose only school authority is the family portal: it holds
 * the parent or student portal grant and nothing that lets staff read the school.
 * Administrators hold every grant (including the portal ones) plus `school:read`,
 * so they are never family-only.
 */
export function isFamilyOnlyAccount(permissions: readonly string[]): boolean {
  if (permissions.includes('*') || permissions.includes(PERMISSIONS.school.read)) return false;
  return permissions.includes(PERMISSIONS.school.parentPortal) || permissions.includes(PERMISSIONS.school.studentPortal);
}
