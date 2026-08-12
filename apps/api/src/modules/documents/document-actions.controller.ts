/**
 * DMS — Phase 2 action surface.
 *
 * POST /api/v1/documents/:id/actions/:action
 *
 * Requires an `Idempotency-Key` header: engine-level dedupe (DocumentAction
 * table, G6) makes retries replay the original result instead of re-executing
 * side effects. Permission is enforced inside the engine per
 * (type, action) — doc:<type>:<action> → doc:<category>:<action> → doc:<action>.
 */
import { BadRequestException, Body, Controller, Headers, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../../kernel/auth/jwt-token.service';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import { DocumentEngineService, EngineActionResult } from './document-engine.service';

export interface DocumentActionBody {
  reason?: string;
  note?: string;
  /** amend payload (§5.3) — document-owned content keys (terms/clauses/conditions/notes). */
  data?: Record<string, unknown>;
}

@Controller('documents')
export class DocumentActionsController {
  constructor(private readonly engine: DocumentEngineService) {}

  @Post(':id/actions/:action')
  async run(
    @Param('id') documentId: string,
    @Param('action') action: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: DocumentActionBody,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<EngineActionResult> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required for lifecycle actions');
    }
    return this.engine.runAction({
      orgId: user?.organizationId ?? '',
      userId: user?.sub ?? '',
      userPermissions: user?.permissions ?? [],
      documentId,
      action,
      idempotencyKey,
      reason: body?.reason,
      note: body?.note,
      data: body?.data,
    });
  }
}