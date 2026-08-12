import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { Public } from '../../kernel/auth/decorators/public.decorator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { DeviceTokenGuard, type RequestDevice } from './device-token.guard';
import { SyncDevicesService } from './sync-devices.service';
import { SyncPullService } from './sync-pull.service';
import { SyncPushService } from './sync-push.service';
import { SyncDeadLetterService } from './sync-dead-letter.service';
import { RegisterDeviceDto, SyncPushDto } from './dto/sync.dto';

class ResolveDeadLetterDto {
  @IsIn(['resolved', 'discarded']) status!: 'resolved' | 'discarded';
  @IsString() note!: string;
}

/**
 * P1 offline sync.
 *
 * Device management (JWT + manager permission):
 *   POST /sync/devices/register  → one-time device token (store it on device)
 *   GET  /sync/devices           → registry list
 *   POST /sync/devices/:id/revoke
 *
 * Device data plane (X-Device-Token; @Public because there is no user JWT —
 * the token itself is the transport credential, validated by the tenant
 * middleware + DeviceTokenGuard):
 *   GET  /sync/pull?cursor=&scopes=
 *   POST /sync/push
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly devices: SyncDevicesService,
    private readonly pullSvc: SyncPullService,
    private readonly pushSvc: SyncPushService,
    private readonly deadLetters: SyncDeadLetterService,
  ) {}

  @Post('devices/register')
  @ApiBearerAuth()
  @RequirePermissions('organization:update')
  register(@Body() dto: RegisterDeviceDto) {
    return this.devices.register(dto);
  }

  @Get('devices')
  @ApiBearerAuth()
  @RequirePermissions('organization:read')
  list() {
    return this.devices.list();
  }

  @Post('devices/:id/revoke')
  @ApiBearerAuth()
  @RequirePermissions('organization:update')
  revoke(@Param('id') id: string) {
    return this.devices.revoke(id);
  }

  /** Offline ops the server refused — money awaiting a human decision. */
  @Get('dead-letters')
  @ApiBearerAuth()
  @RequirePermissions('pos:reports')
  listDeadLetters(@Query('status') status?: string) {
    return this.deadLetters.list(status ?? 'open');
  }

  @Get('dead-letters/counts')
  @ApiBearerAuth()
  @RequirePermissions('pos:reports')
  deadLetterCounts() {
    return this.deadLetters.counts();
  }

  @Post('dead-letters/:id/resolve')
  @ApiBearerAuth()
  @RequirePermissions('pos:override')
  resolveDeadLetter(@Param('id') id: string, @Body() dto: ResolveDeadLetterDto) {
    return this.deadLetters.resolve(id, dto.status, dto.note);
  }

  @Get('pull')
  @Public()
  @UseGuards(DeviceTokenGuard)
  @ApiHeader({ name: 'X-Device-Token', required: true })
  pull(@Query('cursor') cursor?: string, @Query('scopes') scopes?: string) {
    return this.pullSvc.pull(cursor, scopes);
  }

  @Post('push')
  @Public()
  @UseGuards(DeviceTokenGuard)
  @ApiHeader({ name: 'X-Device-Token', required: true })
  push(@Req() req: { posDevice: RequestDevice }, @Body() dto: SyncPushDto) {
    return this.pushSvc.push(req.posDevice, dto);
  }
}
