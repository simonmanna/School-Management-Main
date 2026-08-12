import { ForbiddenException, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/** The subset of a conversation the access rule needs. */
export interface AccessibleConversation {
  visibility: string;
  visibleToPermissions: string[];
}

export interface AccessSubject {
  userId: string | undefined;
  permissions: string[];
}

/**
 * The single authorization choke point for conversations. Permissions are
 * CAPABILITIES (can this user use messaging at all); this service decides access
 * to a SPECIFIC conversation. Used by the HTTP controller, the SSE fan-out, and
 * the Android sync-pull filter — three call sites, one rule, so they can never
 * drift.
 */
@Injectable()
export class ConversationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * The pure rule. Deny by default. `isParticipant` is resolved by the caller
   * (it varies by call site: a DB lookup for HTTP, an in-memory set for SSE).
   *
   *   1. active participant                                    → allow
   *   2. visibility='org'  and holds conversation:read         → allow
   *   3. visibility='role' and permissions ∩ visibleToPermissions → allow
   *   4. holds conversation:read_all                           → allow
   *
   * `private` (the default for direct chats) is participants-only: read_all does
   * NOT override it — a manager reading a DM must be added to it.
   */
  static canAccess(conv: AccessibleConversation, isParticipant: boolean, subject: AccessSubject): boolean {
    if (isParticipant) return true;
    if (conv.visibility === 'private') return false;
    const perms = subject.permissions;
    if (perms.includes(PERMISSIONS.communication.conversationReadAll)) return true;
    if (conv.visibility === 'org' && perms.includes(PERMISSIONS.communication.conversationRead)) return true;
    if (
      conv.visibility === 'role' &&
      conv.visibleToPermissions.some((p) => perms.includes(p))
    ) {
      return true;
    }
    return false;
  }

  /** DB-backed check for the current tenant/user. */
  async canRead(conversationId: string): Promise<boolean> {
    const userId = this.tenant.userId;
    if (!userId) return false;
    const conv = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId },
      select: { visibility: true, visibleToPermissions: true },
    });
    if (!conv) return false;
    const isParticipant = await this.isParticipant(conversationId, userId);
    return ConversationAccessService.canAccess(conv, isParticipant, {
      userId,
      permissions: this.tenant.permissions,
    });
  }

  async assertCanRead(conversationId: string): Promise<void> {
    if (!(await this.canRead(conversationId))) {
      throw new ForbiddenException('You do not have access to this conversation.');
    }
  }

  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const p = await this.prisma.client.conversationParticipant.findFirst({
      where: { conversationId, userId, participantType: 'user', leftAt: null },
      select: { id: true },
    });
    return !!p;
  }

  /** The user ids that are active participants of a conversation (for SSE audience). */
  async participantUserIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.client.conversationParticipant.findMany({
      where: { conversationId, participantType: 'user', leftAt: null, userId: { not: null } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId!).filter(Boolean);
  }
}
