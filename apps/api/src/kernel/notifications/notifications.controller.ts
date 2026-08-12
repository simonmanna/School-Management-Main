import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class ListNotificationsDto {
  @ApiProperty({ required: false, default: '1' })
  @IsOptional() @IsString() page?: string;
  @ApiProperty({ required: false, default: '25' })
  @IsOptional() @IsString() pageSize?: string;
  @ApiProperty({ required: false, enum: ['all', 'unread'] })
  @IsOptional() @IsIn(['all', 'unread']) filter?: 'all' | 'unread';
}

class UpdatePreferenceDto {
  @ApiProperty({ enum: ['in_app', 'email', 'sms', 'push'] })
  @IsIn(['in_app', 'email', 'sms', 'push']) channel!: 'in_app' | 'email' | 'sms' | 'push';
  @ApiProperty({ required: false, default: 'general' })
  @IsOptional() @IsString() category?: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  /** List the current user's in-app notifications. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 25)));
    const where: any = { userId: user.sub, channel: 'in_app' };
    if (query.filter === 'unread') where.status = { in: ['pending', 'sent'] };
    const [data, total, unread] = await Promise.all([
      this.prisma.client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.notification.count({ where }),
      this.prisma.client.notification.count({
        where: { userId: user.sub, channel: 'in_app', status: { in: ['pending', 'sent'] } },
      }),
    ]);
    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      unread,
    };
  }

  /** Mark one notification as read. */
  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.client.notification.updateMany({
      where: { id, userId: user.sub },
      data: { status: 'read', readAt: new Date() },
    });
    return { ok: true };
  }

  /** Mark all as read. */
  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    const r = await this.prisma.client.notification.updateMany({
      where: { userId: user.sub, status: { in: ['pending', 'sent'] } },
      data: { status: 'read', readAt: new Date() },
    });
    return { ok: true, count: r.count };
  }

  /** Delete one of the current user's notifications. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.client.notification.deleteMany({ where: { id, userId: user.sub } });
    return { ok: true };
  }

  /** Per-channel, per-category opt-out. */
  @Get('preferences')
  async prefs(@CurrentUser() user: AuthUser) {
    return this.prisma.client.notificationPreference.findMany({
      where: { userId: user.sub },
      orderBy: [{ channel: 'asc' }, { category: 'asc' }],
    });
  }

  @Patch('preferences')
  async setPref(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferenceDto) {
    return this.prisma.client.notificationPreference.upsert({
      where: {
        organizationId_userId_channel_category: {
          organizationId: user.organizationId,
          userId: user.sub,
          channel: dto.channel,
          category: dto.category ?? 'general',
        },
      },
      update: { enabled: dto.enabled },
      create: {
        organizationId: user.organizationId,
        userId: user.sub,
        channel: dto.channel,
        category: dto.category ?? 'general',
        enabled: dto.enabled,
      },
    });
  }

  /** Manual trigger for testing (admin only). */
  @Post('test')
  async test(@CurrentUser() user: AuthUser) {
    return this.notifications.send({
      organizationId: user.organizationId,
      userId: user.sub,
      channel: 'in_app',
      category: 'general',
      title: 'Hello from ERP',
      body: 'This is a test notification.',
    });
  }
}
