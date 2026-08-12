/**
 * POS P7 — Loyalty + Store Credit + Customer Tabs controller.
 *
 * Loyalty and store-credit redemption endpoints are pos:checkout (used at
 * sale time). Program / credit / tab management is partner:read (any user
 * with a customer record).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosLoyaltyService } from './pos-loyalty.service';

class EarnPointsDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty() @IsString() documentId!: string;
  @ApiProperty() @IsNumber() @Min(0) amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}
class RedeemPointsDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty() @IsNumber() @Min(1) points!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() documentId?: string;
}
class IssueCreditDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount!: number;
  @ApiProperty() @IsString() source!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}
class RedeemCreditDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() documentId?: string;
}
class ChargeTabDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty() @IsString() documentId!: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}
class SettleTabDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() paymentId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}
class OpenTabDto {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() creditLimit?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() cashSessionId?: string;
}

@ApiTags('pos/loyalty')
@ApiBearerAuth()
@Controller('pos/loyalty')
export class PosLoyaltyController {
  constructor(private readonly svc: PosLoyaltyService) {}

  /* ============== Loyalty ============== */

  @Get('program')
  @RequirePermissions('partner:read')
  getProgram() {
    return this.svc.getProgram();
  }

  @Post('program/ensure')
  @RequirePermissions('partner:read')
  ensure() {
    return this.svc.ensureProgram();
  }

  @Get('balance/:partnerId')
  @RequirePermissions('partner:read')
  balance(@Param('partnerId') partnerId: string) {
    return this.svc.getBalance(partnerId);
  }

  @Get('earned/:partnerId')
  @RequirePermissions('partner:read')
  earned(@Param('partnerId') partnerId: string) {
    return this.svc.getEarnedLifetime(partnerId);
  }

  @Post('earn')
  @RequirePermissions('pos:checkout')
  earn(@Body() dto: EarnPointsDto) {
    return this.svc.earnPoints(dto);
  }

  @Post('redeem')
  @RequirePermissions('pos:checkout')
  redeem(@Body() dto: RedeemPointsDto) {
    return this.svc.redeemPoints(dto);
  }

  /* ============== Store credit ============== */

  @Get('credit/:partnerId')
  @RequirePermissions('partner:read')
  credit(@Param('partnerId') partnerId: string) {
    return this.svc.getCredit(partnerId);
  }

  @Post('credit/issue')
  @RequirePermissions('partner:read')
  issueCredit(@Body() dto: IssueCreditDto) {
    return this.svc.issueCredit(dto);
  }

  @Post('credit/redeem')
  @RequirePermissions('pos:checkout')
  redeemCredit(@Body() dto: RedeemCreditDto) {
    return this.svc.redeemCredit(dto);
  }

  /* ============== Tabs ============== */

  @Get('tab/:partnerId')
  @RequirePermissions('partner:read')
  tab(@Param('partnerId') partnerId: string) {
    return this.svc.getTab(partnerId);
  }

  @Post('tab/open')
  @RequirePermissions('partner:read')
  openTab(@Body() dto: OpenTabDto) {
    return this.svc.openTab(dto);
  }

  @Post('tab/charge')
  @RequirePermissions('pos:checkout')
  chargeTab(@Body() dto: ChargeTabDto) {
    return this.svc.chargeTab(dto);
  }

  @Post('tab/settle')
  @RequirePermissions('pos:checkout')
  settleTab(@Body() dto: SettleTabDto) {
    return this.svc.settleTab(dto);
  }
}