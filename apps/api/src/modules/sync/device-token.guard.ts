import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';

export interface RequestDevice {
  id: string;
  organizationId: string;
  branchId: string | null;
}

/**
 * P1 offline sync — transport auth for /sync/pull and /sync/push.
 *
 * The tenant middleware in main.ts already resolved `X-Device-Token` (sha256
 * lookup against PosDevice.tokenHash) and attached the device to the request
 * + established the org-scoped AsyncLocalStorage context. This guard only
 * verifies that actually happened — an absent/invalid/revoked token means the
 * middleware attached nothing → 401.
 *
 * Routes using this guard are @Public() (no user JWT); identity is carried
 * per-op in the push payload, never on the transport.
 */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const device: RequestDevice | undefined = req.posDevice;
    if (!device) {
      throw new UnauthorizedException('A valid X-Device-Token is required');
    }
    // Heartbeat — fire-and-forget; a failed update must not block a sync.
    this.prisma.raw.posDevice
      .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    return true;
  }
}
