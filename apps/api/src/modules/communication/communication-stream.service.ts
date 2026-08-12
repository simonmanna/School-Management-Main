import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import { ConversationAccessService, type AccessibleConversation } from './conversation-access.service';

interface StreamConnection {
  res: Response;
  userId: string;
  permissions: string[];
}

/** Who is allowed to receive an event about a conversation. */
export interface StreamAudience {
  conversation: AccessibleConversation;
  participantUserIds: string[];
}

export interface StreamEvent {
  type: string;
  conversationId?: string;
  messageId?: string;
  /** BigInt seq rendered as a string — never a number (precision) nor a BigInt (JSON). */
  syncSequence?: string;
  [key: string]: unknown;
}

/**
 * Per-organization SSE fan-out for the unified inbox.
 *
 * The registry is `Map<organizationId, Set<connection>>` — deliberately NOT the
 * single global `Set<Response>` the POS tables stream uses, which broadcasts to
 * every connected client with no org predicate. Every push is addressed to one
 * org's connections, and further filtered by the SAME access rule the HTTP layer
 * uses (`ConversationAccessService.canAccess`), so a cashier's stream never
 * carries a manager's DM.
 *
 * The connection's org/user/permissions come from the authenticated token at
 * subscribe time — never from a client-supplied payload.
 */
@Injectable()
export class CommunicationStreamService implements OnModuleDestroy {
  private readonly logger = new Logger('CommunicationStream');
  private readonly clients = new Map<string, Set<StreamConnection>>();
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly heartbeatMs = 25_000;

  subscribe(res: Response, ctx: { organizationId: string; userId: string; permissions: string[] }, origin = ''): void {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 5000\n\n`);

    const conn: StreamConnection = { res, userId: ctx.userId, permissions: ctx.permissions };
    const set = this.clients.get(ctx.organizationId) ?? new Set<StreamConnection>();
    set.add(conn);
    this.clients.set(ctx.organizationId, set);
    this.ensureHeartbeat();

    res.on('close', () => {
      const s = this.clients.get(ctx.organizationId);
      s?.delete(conn);
      if (s && s.size === 0) this.clients.delete(ctx.organizationId);
      if (this.totalConnections() === 0 && this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    });
  }

  /**
   * Push an event to every connection in the org that is allowed to see the
   * conversation. Filtering is a pure in-memory check per connection (no DB per
   * event) — the connection already carries the user's permissions.
   */
  emit(organizationId: string, audience: StreamAudience, event: StreamEvent): void {
    const set = this.clients.get(organizationId);
    if (!set || set.size === 0) return;
    const participantSet = new Set(audience.participantUserIds);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const conn of set) {
      const allowed = ConversationAccessService.canAccess(
        audience.conversation,
        participantSet.has(conn.userId),
        { userId: conn.userId, permissions: conn.permissions },
      );
      if (!allowed) continue;
      try {
        conn.res.write(payload);
      } catch {
        set.delete(conn);
      }
    }
  }

  /** A lightweight event with no conversation scoping (e.g. channel status for admins). */
  emitToPermission(organizationId: string, requiredPermission: string, event: StreamEvent): void {
    const set = this.clients.get(organizationId);
    if (!set || set.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const conn of set) {
      if (!conn.permissions.includes(requiredPermission)) continue;
      try {
        conn.res.write(payload);
      } catch {
        set.delete(conn);
      }
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) {
        for (const conn of set) {
          try {
            conn.res.write(`: ping\n\n`);
          } catch {
            set.delete(conn);
          }
        }
      }
    }, this.heartbeatMs);
  }

  private totalConnections(): number {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const set of this.clients.values()) {
      for (const conn of set) {
        try {
          conn.res.end();
        } catch {
          /* ignore */
        }
      }
    }
    this.clients.clear();
  }
}
