import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

/**
 * P1 offline sync — device registry.
 *
 * A device is enrolled once by a manager (JWT-authed). The response carries
 * the opaque token EXACTLY ONCE; only its sha256 is stored (same pattern as
 * RefreshToken). The device presents it as `X-Device-Token` on /sync/*.
 * Revocation kills sync on the device's next contact.
 */
@Injectable()
export class SyncDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async register(input: { name: string; platform?: string; branchId?: string }) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('A device name is required');

    // Opaque 256-bit token; the hash is the only thing persisted.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Next free provisional-number prefix: D1, D2, … (unique per org).
    const count = await this.prisma.client.posDevice.count();
    let prefix = `D${count + 1}`;
    for (let i = 0; i < 20; i += 1) {
      const clash = await this.prisma.client.posDevice.findFirst({ where: { prefix } });
      if (!clash) break;
      prefix = `D${count + 2 + i}`;
    }

    const device = await this.prisma.client.posDevice.create({
      data: {
        organizationId: this.tenant.organizationId,
        name,
        platform: input.platform ?? 'android',
        branchId: input.branchId ?? null,
        tokenHash,
        prefix,
        registeredById: this.tenant.userId ?? null,
      },
    });

    await this.audit.record({
      entity: 'PosDevice',
      entityId: device.id,
      action: 'create',
      newValues: { name: device.name, platform: device.platform, prefix: device.prefix },
    });

    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      prefix: device.prefix,
      /** Shown once — the device stores it; the server keeps only the hash. */
      deviceToken: token,
    };
  }

  async list() {
    const devices = await this.prisma.client.posDevice.findMany({ orderBy: { createdAt: 'asc' } });
    return devices.map((d: any) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      prefix: d.prefix,
      branchId: d.branchId,
      lastSeenAt: d.lastSeenAt,
      lastPushSeq: d.lastPushSeq,
      revokedAt: d.revokedAt,
      createdAt: d.createdAt,
    }));
  }

  async revoke(id: string) {
    const device = await this.prisma.client.posDevice.findFirst({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (device.revokedAt) return { id, revokedAt: device.revokedAt };
    const updated = await this.prisma.client.posDevice.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      entity: 'PosDevice',
      entityId: id,
      action: 'update',
      newValues: { revoked: true },
    });
    return { id, revokedAt: updated.revokedAt };
  }
}
