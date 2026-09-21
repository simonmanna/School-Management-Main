import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Public } from '../../../kernel/auth/decorators/public.decorator';
import { MobileMoneyService } from './mobile-money.service';
import { MobileMoneyRequestDto, RecordSettlementBody, UpsertGatewayBody } from './dto.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Live mobile-money collection endpoints.
 *
 * The callback is deliberately PUBLIC — a provider cannot present a bearer
 * token — and is authenticated instead by an HMAC signature over the raw body.
 * That is why the handler reads `req.rawBody` rather than the parsed `@Body`:
 * re-serialising a parsed object reorders keys and the signature stops
 * matching, which would look like an attack and reject every genuine payment.
 */
@Controller('school/mobile-money')
export class MobileMoneyController {
  constructor(private readonly momo: MobileMoneyService) {}

  /** Which providers are configured, so the UI offers only those. */
  @Get('availability')
  @RequirePermissions(PERMISSIONS.school.read)
  availability() {
    return this.momo.availability();
  }

  /** What the parent is being asked to clear. */
  @Get('quote/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  quote(@Param('studentProfileId') studentProfileId: string) {
    return this.momo.quoteFor(studentProfileId);
  }

  /**
   * Prompt a parent's phone to approve a payment. Records nothing as money —
   * a request-to-pay is a prompt, and the callback is what settles it.
   */
  @Post(':provider/request')
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  request(
    @Param('provider') provider: string,
    @Body() dto: MobileMoneyRequestDto,
  ) {
    return this.momo.requestPayment(provider, dto);
  }

  @Get('gateways')
  @RequirePermissions(PERMISSIONS.school.read)
  gateways() {
    return this.momo.listGateways();
  }

  /** Create or update this school's gateway. Secrets are write-only. */
  @Put('gateways/:provider')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  upsertGateway(@Param('provider') provider: string, @Body() dto: UpsertGatewayBody) {
    return this.momo.upsertGateway(provider, dto);
  }

  /** Clearing balance per provider: GL vs unsettled collections. */
  @Get('clearing')
  @RequirePermissions(PERMISSIONS.school.read)
  clearing() {
    return this.momo.clearingPosition();
  }

  @Get('settlements')
  @RequirePermissions(PERMISSIONS.school.read)
  settlements() {
    return this.momo.listSettlements();
  }

  /** Record a provider payout: Dr Bank + Dr Charges / Cr Clearing. */
  @Post('settlements')
  @RequirePermissions(PERMISSIONS.school.reconcilePayments)
  recordSettlement(@Body() dto: RecordSettlementBody) {
    return this.momo.recordSettlement(dto);
  }

  @Get('requests')
  @RequirePermissions(PERMISSIONS.school.read)
  list(
    @Query('studentProfileId') studentProfileId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.momo.listRequests({ studentProfileId, status, limit: limit ? Number(limit) : undefined });
  }

  /**
   * The provider callback. Public by necessity, HMAC-verified before anything
   * in the body is trusted.
   *
   * Always answers 2xx once the signature checks out, even for a payment we
   * cannot place — a provider that receives an error retries indefinitely, and
   * an unknown reference will never become known by being resent.
   */
  @Public()
  @HttpCode(200)
  @Post(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Req() req: any,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-authorization') xAuthorization?: string,
  ) {
    // Only the bytes the provider signed; never a re-serialised body.
    const raw: string | undefined =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req.rawBody)
          ? req.rawBody.toString('utf8')
          : undefined;

    return this.momo.handleCallback(provider, raw, xSignature ?? xAuthorization);
  }
}
