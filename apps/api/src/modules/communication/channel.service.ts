import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ProviderRegistryService } from './providers/provider-registry.service';

export interface CreateChannelInput {
  providerId: string;
  name: string;
  transport?: string;
  config?: Record<string, unknown>;
}

const VALID_PROVIDERS = new Set(['whatsapp', 'telegram', 'internal']);

/**
 * Admin management of CommunicationChannels (configured provider accounts —
 * "WhatsApp Support", "Telegram Sales"). Channel CONFIG changes are the only part
 * of the communication domain that is audited; the messages themselves are their
 * own append-only record.
 */
@Injectable()
export class ChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly providers: ProviderRegistryService,
  ) {}

  /** All channels for the org, each with best-effort live health from its provider. */
  async list(): Promise<unknown[]> {
    const rows = await this.prisma.client.communicationChannel.findMany({
      where: { disabledAt: null },
      orderBy: [{ providerId: 'asc' }, { name: 'asc' }],
    });
    const out = [];
    for (const r of rows) {
      let health: unknown = null;
      if (this.providers.has(r.providerId)) {
        health = await this.providers
          .for(r.providerId)
          .health(r.id)
          .catch(() => null);
      }
      out.push({
        id: r.id,
        providerId: r.providerId,
        transport: r.transport,
        name: r.name,
        status: r.status,
        desiredState: r.desiredState,
        pairedAt: r.pairedAt,
        lastConnectedAt: r.lastConnectedAt,
        lastError: r.lastError,
        leaseHeartbeatAt: r.leaseHeartbeatAt,
        dailySentCount: r.dailySentCount,
        providerEnabled: this.providers.has(r.providerId),
        health,
      });
    }
    return out;
  }

  async create(input: CreateChannelInput) {
    const orgId = this.tenant.organizationId;
    if (!VALID_PROVIDERS.has(input.providerId)) {
      throw new BadRequestException(`Unknown provider '${input.providerId}'.`);
    }
    const transport =
      input.transport ??
      (input.providerId === 'whatsapp' ? (process.env.WHATSAPP_TRANSPORT ?? 'cloud') : input.providerId === 'telegram' ? 'bot' : 'internal');

    const created = await this.prisma.client.$transaction(async (tx) => {
      const c = await tx.communicationChannel.create({
        data: {
          organizationId: orgId,
          providerId: input.providerId,
          transport,
          name: input.name,
          config: (input.config ?? {}) as object,
          createdBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'CommunicationChannel',
        entityId: c.id,
        action: 'create',
        newValues: { providerId: input.providerId, transport, name: input.name },
      });
      return c;
    });
    return created;
  }

  async connect(id: string) {
    const channel = await this.require(id);
    if (!this.providers.has(channel.providerId)) {
      throw new BadRequestException(`Provider '${channel.providerId}' is not enabled on this server.`);
    }
    await this.providers.for(channel.providerId).connect(id);
    await this.audit.record({ entity: 'CommunicationChannel', entityId: id, action: 'update', newValues: { action: 'connect' } });
    return { ok: true };
  }

  async disconnect(id: string, logout: boolean) {
    const channel = await this.require(id);
    if (this.providers.has(channel.providerId)) {
      await this.providers.for(channel.providerId).disconnect(id, { logout });
    } else {
      await this.prisma.client.communicationChannel.update({
        where: { id },
        data: { desiredState: 'disconnected', status: 'disconnected' },
      });
    }
    await this.audit.record({ entity: 'CommunicationChannel', entityId: id, action: 'update', newValues: { action: 'disconnect', logout } });
    return { ok: true };
  }

  /** The current pairing QR (raw) + status — SSE-independent fallback for the UI. */
  async pairingState(id: string) {
    const c = await this.require(id);
    return { status: c.status, pairingQr: c.pairingQr, pairingQrExpiresAt: c.pairingQrExpiresAt };
  }

  async remove(id: string) {
    await this.require(id);
    await this.prisma.client.communicationChannel.update({
      where: { id },
      data: { disabledAt: new Date(), desiredState: 'disconnected', status: 'disconnected' },
    });
    await this.audit.record({ entity: 'CommunicationChannel', entityId: id, action: 'delete' });
    return { ok: true };
  }

  private async require(id: string) {
    const c = await this.prisma.client.communicationChannel.findFirst({ where: { id, disabledAt: null } });
    if (!c) throw new NotFoundException('Channel not found.');
    return c;
  }
}
