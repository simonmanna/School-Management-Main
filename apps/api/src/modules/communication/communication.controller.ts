import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import type { AuthUser } from '../../kernel/auth/jwt-token.service';
import { Idempotent } from '../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../kernel/idempotency/idempotency.interceptor';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { CommunicationStreamService } from './communication-stream.service';
import { CommunicationConfigService } from './rules/communication-config.service';
import { ChannelService } from './channel.service';
import {
  CreateChannelDto,
  CreateConversationDto,
  DisconnectChannelDto,
  MarkReadDto,
  ResolveContextDto,
  SendMessageDto,
  SetEnabledDto,
  UpsertRuleDto,
  UpsertTemplateDto,
} from './dto/communication.dto';

/**
 * Unified inbox API. Static routes (`/stream`, `/conversations/resolve-context`)
 * are declared BEFORE `/conversations/:id` so `:id` never swallows them.
 *
 * Per-conversation access is enforced by ConversationAccessService inside the
 * services — the `@RequirePermissions` here is only the capability gate.
 */
@Controller('communication')
@UseInterceptors(IdempotencyInterceptor)
@ApiTags('communication')
@ApiBearerAuth()
export class CommunicationController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly stream: CommunicationStreamService,
    private readonly config: CommunicationConfigService,
    private readonly channels: ChannelService,
  ) {}

  /* ── SSE (static) ─────────────────────────────────────────────────────── */

  /** Live inbox stream. Auth via query token (see EVENT_STREAM_PATHS in main.ts). */
  @Get('stream')
  @RequirePermissions(PERMISSIONS.communication.conversationRead)
  streamInbox(@CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response): void {
    const origin = (req.headers.origin as string) ?? '';
    this.stream.subscribe(
      res,
      { organizationId: user.organizationId, userId: user.sub, permissions: user.permissions },
      origin,
    );
  }

  /* ── Conversations ────────────────────────────────────────────────────── */

  @Get('conversations')
  @RequirePermissions(PERMISSIONS.communication.conversationRead)
  list() {
    return this.conversations.list();
  }

  @Post('conversations')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.communication.conversationWrite)
  create(@Body() dto: CreateConversationDto) {
    return this.conversations.create(dto);
  }

  /** Chatter: get-or-create the conversation attached to a business record. */
  @Post('conversations/resolve-context')
  @RequirePermissions(PERMISSIONS.communication.conversationWrite)
  resolveContext(@Body() dto: ResolveContextDto) {
    return this.conversations.getOrCreateForContext(dto.contextType, dto.contextId);
  }

  @Get('conversations/:id')
  @RequirePermissions(PERMISSIONS.communication.conversationRead)
  get(@Param('id') id: string) {
    return this.conversations.get(id);
  }

  @Get('conversations/:id/messages')
  @RequirePermissions(PERMISSIONS.communication.conversationRead)
  listMessages(
    @Param('id') id: string,
    @Query('beforeSeq') beforeSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list(id, { beforeSeq, limit: limit ? Number(limit) : undefined });
  }

  @Post('conversations/:id/messages')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.communication.messageSend)
  send(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messages.send({ conversationId: id, ...dto });
  }

  @Post('conversations/:id/read')
  @RequirePermissions(PERMISSIONS.communication.conversationRead)
  markRead(@Param('id') id: string, @Body() dto: MarkReadDto) {
    return this.conversations.markRead(id, dto.messageId);
  }

  /* ── Templates (admin) ────────────────────────────────────────────────── */

  @Get('templates')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  listTemplates() {
    return this.config.listTemplates();
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  upsertTemplate(@Body() dto: UpsertTemplateDto) {
    return this.config.upsertTemplate(dto);
  }

  /* ── Rules (admin) ────────────────────────────────────────────────────── */

  /** Static — must precede `rules/:id`. */
  @Get('rules/eventable')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  eventable() {
    return this.config.eventableEvents();
  }

  @Get('rules')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  listRules() {
    return this.config.listRules();
  }

  @Post('rules')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  upsertRule(@Body() dto: UpsertRuleDto) {
    return this.config.upsertRule(dto);
  }

  @Patch('rules/:id/enabled')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  setRuleEnabled(@Param('id') id: string, @Body() dto: SetEnabledDto) {
    return this.config.setRuleEnabled(id, dto.enabled);
  }

  @Delete('rules/:id')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  deleteRule(@Param('id') id: string) {
    return this.config.deleteRule(id);
  }

  /* ── Channels (admin) ─────────────────────────────────────────────────── */

  @Get('channels')
  @RequirePermissions(PERMISSIONS.communication.channelRead)
  listChannels() {
    return this.channels.list();
  }

  @Post('channels')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  createChannel(@Body() dto: CreateChannelDto) {
    return this.channels.create(dto);
  }

  @Get('channels/:id/pairing')
  @RequirePermissions(PERMISSIONS.communication.channelRead)
  pairingState(@Param('id') id: string) {
    return this.channels.pairingState(id);
  }

  @Post('channels/:id/connect')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  connectChannel(@Param('id') id: string) {
    return this.channels.connect(id);
  }

  @Post('channels/:id/disconnect')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  disconnectChannel(@Param('id') id: string, @Body() dto: DisconnectChannelDto) {
    return this.channels.disconnect(id, dto.logout ?? false);
  }

  @Delete('channels/:id')
  @RequirePermissions(PERMISSIONS.communication.channelManage)
  removeChannel(@Param('id') id: string) {
    return this.channels.remove(id);
  }
}
