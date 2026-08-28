import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { BroadcastService } from './broadcast.service';
import { AudienceResolverService } from '../audience/audience-resolver.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import {
  CancelBroadcastDto,
  CreateBroadcastDto,
  PreviewAudienceDto,
  SubmitBroadcastDto,
  UpdateBroadcastDto,
} from '../dto/communication.dto';
import type { AudienceSelector } from '../audience/audience-selector';

/**
 * Broadcast console API.
 *
 * Reads are gated on `broadcast:read` and every write on `broadcast:send`,
 * separately from ordinary `message:send`. A clerk who may answer a parent's
 * WhatsApp is not automatically someone who may text 4,000 guardians at the
 * school's expense.
 *
 * Static routes precede `:id` so `audience/preview` is never swallowed by it.
 */
@Controller('communication/broadcasts')
@UseInterceptors(IdempotencyInterceptor)
@ApiTags('communication')
@ApiBearerAuth()
export class BroadcastController {
  constructor(
    private readonly broadcasts: BroadcastService,
    private readonly audience: AudienceResolverService,
    private readonly tenant: TenantContextService,
  ) {}

  /* ── Audience preview (static) ────────────────────────────────────────── */

  /**
   * Count an audience without creating anything. POST rather than GET because
   * the selector is a nested object — and because parent phone numbers must not
   * end up in a query string, a server log or a browser history entry.
   */
  @Post('audience/preview')
  @RequirePermissions(PERMISSIONS.communication.broadcastRead)
  previewAudience(@Body() dto: PreviewAudienceDto) {
    return this.broadcasts.preview({
      audience: dto.audience as unknown as AudienceSelector,
      body: dto.body ?? '',
      channelPolicy: dto.channelPolicy,
    });
  }

  /** Full resolved list, for the "review recipients" screen before sending. */
  @Post('audience/resolve')
  @RequirePermissions(PERMISSIONS.communication.broadcastSend)
  resolveAudience(@Body() dto: PreviewAudienceDto) {
    return this.audience.resolve(this.tenant.organizationId, dto.audience as unknown as AudienceSelector);
  }

  /* ── CRUD ─────────────────────────────────────────────────────────────── */

  @Get()
  @RequirePermissions(PERMISSIONS.communication.broadcastRead)
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.broadcasts.list({ status, limit: limit ? Number(limit) : undefined });
  }

  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.communication.broadcastSend)
  create(@Body() dto: CreateBroadcastDto) {
    return this.broadcasts.create({
      title: dto.title,
      body: dto.body,
      templateKey: dto.templateKey,
      audience: dto.audience as unknown as AudienceSelector,
      channelPolicy: dto.channelPolicy,
      scheduledAt: dto.scheduledAt,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.communication.broadcastRead)
  get(@Param('id') id: string) {
    return this.broadcasts.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.communication.broadcastSend)
  update(@Param('id') id: string, @Body() dto: UpdateBroadcastDto) {
    return this.broadcasts.update(id, {
      ...dto,
      audience: dto.audience as unknown as AudienceSelector | undefined,
    });
  }

  /* ── Lifecycle ────────────────────────────────────────────────────────── */

  /** Hand to the worker. Idempotent — a double-click must not send twice. */
  @Post(':id/submit')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.communication.broadcastSend)
  submit(@Param('id') id: string, @Body() dto: SubmitBroadcastDto) {
    return this.broadcasts.submit(id, dto.scheduledAt);
  }

  /** The stop button: halts pending recipients AND already-queued deliveries. */
  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.communication.broadcastSend)
  cancel(@Param('id') id: string, @Body() dto: CancelBroadcastDto) {
    return this.broadcasts.cancel(id, dto.reason);
  }

  /* ── Report ───────────────────────────────────────────────────────────── */

  @Get(':id/report')
  @RequirePermissions(PERMISSIONS.communication.broadcastRead)
  report(@Param('id') id: string) {
    return this.broadcasts.report(id);
  }

  @Get(':id/recipients')
  @RequirePermissions(PERMISSIONS.communication.broadcastRead)
  recipients(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.broadcasts.recipients(id, {
      status,
      search,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
