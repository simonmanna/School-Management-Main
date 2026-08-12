import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  MessageThreadService,
  NotificationService,
  NotificationTemplateService,
} from './communication.service';
import type {
  CreateMessageThreadDto,
  CreateNotificationTemplateDto,
  EnqueueNotificationDto,
  PostMessageDto,
  UpdateNotificationTemplateDto,
} from './dto.types';

@Controller('school/notification-templates')
export class NotificationTemplateController {
  constructor(private readonly service: NotificationTemplateService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.communicate)
  create(@Body() dto: CreateNotificationTemplateDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.communicate)
  update(@Param('id') id: string, @Body() dto: UpdateNotificationTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.communicate)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Post('enqueue')
  @RequirePermissions(PERMISSIONS.school.communicate)
  enqueue(@Body() dto: EnqueueNotificationDto) {
    return this.service.enqueue(dto);
  }

  @Get('inbox')
  @RequirePermissions(PERMISSIONS.school.read)
  inbox(@Query('recipientType') rt: string, @Query('recipientId') rid: string) {
    return this.service.inbox(rt, rid);
  }

  @Post('mark-sent')
  @RequirePermissions(PERMISSIONS.school.communicate)
  markSent(@Body() body: { ids: string[]; providerMessageId?: string }) {
    return this.service.markSent(body.ids, body.providerMessageId);
  }

  @Post('mark-failed')
  @RequirePermissions(PERMISSIONS.school.communicate)
  markFailed(@Body() body: { ids: string[]; error: string }) {
    return this.service.markFailed(body.ids, body.error);
  }
}

@Controller('school/messages')
export class MessageController {
  constructor(private readonly service: MessageThreadService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('mine')
  @RequirePermissions(PERMISSIONS.school.read)
  mine(@Query('participantId') id: string) {
    return this.service.forParticipant(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.communicate)
  createThread(@Body() dto: CreateMessageThreadDto) {
    return this.service.createThread(dto);
  }

  @Post('post')
  @RequirePermissions(PERMISSIONS.school.communicate)
  postMessage(@Body() dto: PostMessageDto) {
    return this.service.postMessage(dto);
  }
}