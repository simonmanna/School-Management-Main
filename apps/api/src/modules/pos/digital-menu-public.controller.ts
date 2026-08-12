/**
 * POS F — Digital Menu public controller.
 *
 * No auth. The customer-facing menu page calls these. Auth is implicit in
 * the QR session token passed as a query/body parameter.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DigitalMenuService } from './digital-menu.service';

class PublicOrderLineDto {
  @IsString() productId!: string;
  @IsNumber() @Min(1) quantity!: number;
  @IsNumber() @Min(0) unitPrice!: number;
  @IsString() description!: string;
  @IsOptional() @IsArray() modifiers?: any[];
  @IsOptional() @IsString() comboId?: string;
}

class PublicTenderDto {
  @IsIn(['mobile_money', 'card', 'cash_on_pickup', 'wallet', 'qr'])
  method!: 'mobile_money' | 'card' | 'cash_on_pickup' | 'wallet' | 'qr';
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() reference?: string;
}

class PlaceOrderDto {
  @IsString() token!: string;
  @IsString() customerName!: string;
  @IsOptional() @IsString() customerPhone?: string;
  @IsOptional() @IsString() customerEmail?: string;
  @IsOptional() @IsIn(['dine_in', 'takeaway', 'pickup']) orderType?: 'dine_in' | 'takeaway' | 'pickup';
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PublicOrderLineDto)
  lines!: PublicOrderLineDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => PublicTenderDto)
  tenders!: PublicTenderDto[];
}

@ApiTags('menu/public')
@Controller('menu/public')
export class DigitalMenuPublicController {
  constructor(private readonly svc: DigitalMenuService) {}

  @Get('catalog')
  async catalog(@Query('token') token: string) {
    return this.svc.getPublicCatalog(token);
  }

  @Post('orders')
  async placeOrder(@Body() dto: PlaceOrderDto) {
    return this.svc.placeOrder(dto);
  }

  @Get('orders/:id/track')
  async track(@Param('id') id: string, @Query('token') token: string) {
    return this.svc.trackOrder(id, token);
  }
}