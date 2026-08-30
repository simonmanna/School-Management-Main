import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Logger, Param, Post, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, IsObject, IsOptional } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PushService } from './push.service';
import { Public } from '../auth/decorators/public.decorator';

class PushKeys {
  @ApiProperty() @IsString() p256dh!: string;
  @ApiProperty() @IsString() auth!: string;
}

class SubscribeBody {
  @ApiProperty() @IsString() endpoint!: string;
  @ApiProperty() @IsObject() keys!: PushKeys;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userAgent?: string;
}

@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  private readonly logger = new Logger(PushController.name);

  constructor(private readonly svc: PushService) {}

  /** VAPID public key — exposed so the web client can subscribe. */
  @Public()
  @Get('vapid-public-key')
  publicKey() {
    return { publicKey: this.svc.getPublicKey() };
  }

  @Post('subscribe')
  async subscribe(@CurrentUser() user: AuthUser, @Req() req: Request, @Body() body: SubscribeBody) {
    // Allow staff with notifications:write OR portal users (student/guardian)
    const isPortal = !!user.portal;
    const hasPerm = (user.permissions ?? []).includes('notifications:write');
    if (!isPortal && !hasPerm) {
      throw new ForbiddenException('Missing required permission: notifications:write');
    }

    const ua = body.userAgent ?? req.headers['user-agent'] ?? null;
    try {
      return await this.svc.subscribe({
        organizationId: user.organizationId,
        userId: user.sub,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: typeof ua === 'string' ? ua : null,
      });
    } catch (err: any) {
      // Push subscription failures should not 500 — they're best-effort.
      // Log the real cause, return a structured error the client can handle.
      this.logger?.error?.(`Push subscribe failed: ${err?.message ?? err}`);
      throw new BadRequestException({
        message: 'Could not save push subscription',
        reason: err?.message ?? String(err),
      });
    }
  }

  @Delete('subscribe')
  @HttpCode(204)
  @RequirePermissions('notifications:write')
  async unsubscribe(@Body() body: { endpoint: string }) {
    await this.svc.unsubscribe(body.endpoint);
  }

  @Delete('subscribe/:id')
  @HttpCode(204)
  @RequirePermissions('notifications:write')
  async unsubscribeById(@Param('id') id: string) {
    await this.svc.unsubscribeById(id);
  }
}
