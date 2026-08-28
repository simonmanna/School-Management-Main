import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { CommSecretService } from './providers/whatsapp/comm-secret.service';
import { parseGatewayConfig } from './providers/sms/sms-gateway.config';
import { randomBytes } from 'node:crypto';

export interface CreateChannelInput {
  providerId: string;
  name: string;
  transport?: string;
  config?: Record<string, unknown>;
  /**
   * Plaintext gateway credentials, referenced from the config as
   * `{{secret.<name>}}`. Encrypted on write and NEVER returned by any read —
   * `list()` strips the ciphertext too, so a compromised read permission does
   * not become an offline cracking target.
   */
  secrets?: Record<string, string>;
}

export interface UpdateChannelInput {
  name?: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

/**
 * Config keys that must never leave the server. `secretsEnc` is ciphertext, but
 * ciphertext handed to every user with channel:read is still an exfiltration
 * primitive — strip it at the boundary rather than trusting each caller.
 */
const SECRET_CONFIG_KEYS = new Set(['secretsEnc']);

function sanitizeConfig(config: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((config ?? {}) as Record<string, unknown>)) {
    if (SECRET_CONFIG_KEYS.has(k)) continue;
    out[k] = k === 'webhookSecret' ? '••••••' : v;
  }
  return out;
}

const VALID_PROVIDERS = new Set(['whatsapp', 'telegram', 'internal', 'sms']);

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
    private readonly secrets: CommSecretService,
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
        config: sanitizeConfig(r.config),
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
      (input.providerId === 'whatsapp'
        ? (process.env.WHATSAPP_TRANSPORT ?? 'cloud')
        : input.providerId === 'telegram'
          ? 'bot'
          : input.providerId === 'sms'
            ? 'http'
            : 'internal');

    const config = this.prepareConfig(input.providerId, input.config ?? {}, input.secrets, null);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const c = await tx.communicationChannel.create({
        data: {
          organizationId: orgId,
          providerId: input.providerId,
          transport,
          name: input.name,
          config: config as object,
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
    return { ...created, config: sanitizeConfig(created.config) };
  }

  /**
   * Edit a channel's configuration. Separate from `create` because a gateway is
   * retuned far more often than it is created (new sender id, rotated API key,
   * a DLR path the aggregator changed), and re-creating the channel would orphan
   * every conversation bound to it.
   *
   * Secrets are merge-on-write: omitting `secrets` keeps the stored bag, so the
   * UI can round-trip a config it was never allowed to read.
   */
  async update(id: string, input: UpdateChannelInput) {
    const existing = await this.require(id);
    const previousConfig = (existing.config ?? {}) as Record<string, unknown>;

    const config =
      input.config === undefined && input.secrets === undefined
        ? previousConfig
        : this.prepareConfig(
            existing.providerId,
            input.config ?? { ...previousConfig, secretsEnc: undefined },
            input.secrets,
            previousConfig,
          );

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const c = await tx.communicationChannel.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          config: config as object,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'CommunicationChannel',
        entityId: id,
        action: 'update',
        // Audit records THAT config changed, never WHAT — the values include
        // credentials, and the audit log has a wider read audience.
        newValues: { name: input.name ?? existing.name, configChanged: input.config !== undefined, secretsRotated: input.secrets !== undefined },
      });
      return c;
    });
    return { ...updated, config: sanitizeConfig(updated.config) };
  }

  /**
   * Validate a provider's config and fold plaintext secrets into an encrypted
   * bag. Validation happens HERE, at the write boundary, so a gateway that could
   * never work is rejected while an operator is watching — not at 6am when a fee
   * broadcast fans out to 400 parents and every delivery fails identically.
   */
  private prepareConfig(
    providerId: string,
    incoming: Record<string, unknown>,
    plaintextSecrets: Record<string, string> | undefined,
    previousConfig: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = { ...incoming };
    delete config.secretsEnc;

    if (plaintextSecrets && Object.keys(plaintextSecrets).length > 0) {
      config.secretsEnc = this.secrets.encrypt(JSON.stringify(plaintextSecrets));
    } else if (previousConfig?.secretsEnc) {
      config.secretsEnc = previousConfig.secretsEnc;
    }

    if (providerId === 'sms') {
      // A webhook with no secret is an unauthenticated write into this org's
      // message history, so one is minted rather than left optional.
      if (!config.webhookSecret || config.webhookSecret === '••••••') {
        config.webhookSecret = (previousConfig?.webhookSecret as string) ?? randomBytes(24).toString('base64url');
      }
      parseGatewayConfig(config);
    }
    return config;
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
