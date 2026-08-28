import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TemplateRenderService } from './template-render.service';
import { AudienceResolverService } from '../audience/audience-resolver.service';

/**
 * A resolved recipient. Exactly one identity field is set.
 *
 * `contact` exists for school guardians: a parent is a Contact hanging off the
 * student's guardianship, not a Partner and not a User. Before this, a rule could
 * only ever address staff (`user`) or a billing account (`partner`), which is why
 * "text the parent when their child is marked absent" was not expressible.
 *
 * `phone`/`email`/`userId` are carried alongside the identity so the fan-out does
 * not have to re-query for an address it already resolved — the audience resolver
 * has already normalized the phone number and applied the reachability rules.
 */
export interface Recipient {
  kind: 'user' | 'partner' | 'external' | 'contact' | 'student';
  userId?: string;
  partnerId?: string;
  externalIdentityId?: string;
  contactId?: string;
  studentProfileId?: string;
  displayName?: string;
  phone?: string | null;
  email?: string | null;
}

/**
 * Turns a rule's `recipientResolver` string into a concrete recipient list,
 * against the event payload. Runs in the outbox-dispatch context (no request), so
 * every query is `prisma.raw` filtered by an explicit `organizationId`.
 *
 * Supported forms (extend by adding a case):
 *   permission:<perm>   every user in the org holding <perm> (via their roles)
 *   role:<roleName>     every user with the named role
 *   user:<payloadPath>  the single user id at payload.<path> (e.g. user:actorId)
 *   partner:<payloadPath> the partner id at payload.<path> (default: partnerId)
 *   partner:context     the partner id at payload.partnerId
 *   guardian:<payloadPath>  the guardians of the student at payload.<path>
 *                           (default: studentProfileId). Primary guardian only,
 *                           falling back to all when none is flagged primary —
 *                           the same reachability rules the broadcast composer
 *                           uses, so a rule and a broadcast reach the same people.
 *   student:<payloadPath>   the student at payload.<path>, addressed directly
 */
@Injectable()
export class RecipientResolverService {
  private readonly logger = new Logger('RecipientResolver');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceResolverService,
  ) {}

  async resolve(
    organizationId: string,
    resolver: string,
    payload: Record<string, unknown>,
  ): Promise<Recipient[]> {
    const [scheme, ...rest] = resolver.split(':');
    const arg = rest.join(':');
    switch (scheme) {
      case 'permission':
        return this.byPermission(organizationId, arg);
      case 'role':
        return this.byRole(organizationId, arg);
      case 'user': {
        const id = TemplateRenderService.resolvePath(payload, arg || 'userId');
        return typeof id === 'string' && id ? [{ kind: 'user', userId: id }] : [];
      }
      case 'partner': {
        const path = !arg || arg === 'context' ? 'partnerId' : arg;
        const id = TemplateRenderService.resolvePath(payload, path);
        return typeof id === 'string' && id ? [{ kind: 'partner', partnerId: id }] : [];
      }
      case 'guardian':
      case 'student':
        return this.bySchoolAudience(organizationId, scheme, arg, payload);
      default:
        this.logger.warn(`unknown recipient resolver '${resolver}'`);
        return [];
    }
  }

  private async byPermission(organizationId: string, permission: string): Promise<Recipient[]> {
    if (!permission) return [];
    const users = await this.prisma.raw.user.findMany({
      where: { organizationId, roles: { some: { permissions: { has: permission } } } },
      select: { id: true },
    });
    return users.map((u) => ({ kind: 'user', userId: u.id }));
  }

  /**
   * School-aware resolvers, delegated to the SAME audience resolver the broadcast
   * composer uses. Sharing it is the point: an event rule and a hand-composed
   * broadcast aimed at one student's family must not disagree about who that
   * family is, or about which phone number reaches them.
   */
  private async bySchoolAudience(
    organizationId: string,
    scheme: 'guardian' | 'student',
    arg: string,
    payload: Record<string, unknown>,
  ): Promise<Recipient[]> {
    const path = !arg || arg === 'context' ? 'studentProfileId' : arg;
    const studentProfileId = TemplateRenderService.resolvePath(payload, path);
    if (typeof studentProfileId !== 'string' || !studentProfileId) {
      this.logger.warn(`resolver '${scheme}:${arg}' found no student id at payload.${path}`);
      return [];
    }
    const resolved = await this.audience.resolve(organizationId, {
      scope: 'students',
      ids: [studentProfileId],
      recipients: scheme === 'guardian' ? 'guardians' : 'students',
      // A rule fires about one child, so the message is about that child.
      dedupe: 'per_student',
      // An inactive student can still have an outstanding balance to chase.
      studentStatus: ['active', 'inactive', 'suspended', 'graduated', 'transferred', 'withdrawn'],
    });
    return resolved.members.map((m) => ({
      kind: m.kind === 'guardian' ? ('contact' as const) : ('student' as const),
      contactId: m.kind === 'guardian' ? m.subjectId : undefined,
      studentProfileId: m.studentProfileId ?? undefined,
      userId: m.userId ?? undefined,
      displayName: m.displayName,
      phone: m.phone,
      email: m.email,
    }));
  }

  private async byRole(organizationId: string, roleName: string): Promise<Recipient[]> {
    if (!roleName) return [];
    const users = await this.prisma.raw.user.findMany({
      where: { organizationId, roles: { some: { name: roleName } } },
      select: { id: true },
    });
    return users.map((u) => ({ kind: 'user', userId: u.id }));
  }
}
