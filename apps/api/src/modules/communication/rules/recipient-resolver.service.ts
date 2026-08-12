import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TemplateRenderService } from './template-render.service';

/** A resolved recipient. Exactly one identity field is set. */
export interface Recipient {
  kind: 'user' | 'partner' | 'external';
  userId?: string;
  partnerId?: string;
  externalIdentityId?: string;
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
 */
@Injectable()
export class RecipientResolverService {
  private readonly logger = new Logger('RecipientResolver');

  constructor(private readonly prisma: PrismaService) {}

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

  private async byRole(organizationId: string, roleName: string): Promise<Recipient[]> {
    if (!roleName) return [];
    const users = await this.prisma.raw.user.findMany({
      where: { organizationId, roles: { some: { name: roleName } } },
      select: { id: true },
    });
    return users.map((u) => ({ kind: 'user', userId: u.id }));
  }
}
