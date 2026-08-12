import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PushService } from './push.service';
import { Public } from '../auth/decorators/public.decorator';

class SubscribeBody {
  endpoint!: string;
  keys!: { p256dh: string; auth: string };
  userAgent?: string;
}

@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly svc: PushService) {}

  /** VAPID public key — exposed so the web client can subscribe. */
  @Public()
  @Get('vapid-public-key')
  publicKey() {
    return { publicKey: this.svc.getPublicKey() };
  }

  @Post('subscribe')
  @RequirePermissions('notifications:write')
  async subscribe(@CurrentUser() user: AuthUser, @Req() req: Request, @Body() body: SubscribeBody) {
    const ua = body.userAgent ?? req.headers['user-agent'] ?? null;
    return this.svc.subscribe({
      organizationId: user.organizationId,
      userId: user.sub,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: typeof ua === 'string' ? ua : null,
    });
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
