/**
 * POS P5 — KDS controller. Kitchen board access via pos:kds (Chef/Kitchen role);
 * cashier "send to kitchen" via pos:checkout. Never exposes prices/payments.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosKdsService } from './pos-kds.service';

class KdsModifierDto {
  @IsString() name!: string;
  @IsOptional() @IsString() kitchenPrintName?: string;
  @IsOptional() @IsNumber() priceDelta?: number;
}

class SendToKitchenItemDto {
  @IsString() productId!: string;
  @IsString() productName!: string;
  @IsOptional() @IsNumber() @Min(1) quantity?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() variantName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) accompanimentNames?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => KdsModifierDto)
  modifiers?: KdsModifierDto[];
}

class SendToKitchenDto {
  @IsString() label!: string;
  @IsOptional() @IsString() tableId?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SendToKitchenItemDto)
  items!: SendToKitchenItemDto[];
}

class KdsTransitionDto {
  @IsIn(['start', 'ready', 'serve', 'cancel', 'recall'])
  action!: 'start' | 'ready' | 'serve' | 'cancel' | 'recall';
  @IsOptional() @IsString() reason?: string;
}

class KdsBulkTransitionDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsIn(['start', 'ready', 'serve', 'cancel', 'recall'])
  action!: 'start' | 'ready' | 'serve' | 'cancel' | 'recall';
  @IsOptional() @IsString() reason?: string;
}

class KdsPriorityDto {
  @IsIn(['normal', 'rush', 'vip'])
  priority!: 'normal' | 'rush' | 'vip';
}

class KdsAssignDto {
  @IsOptional() @IsString() chefUserId?: string | null;
}

@ApiTags('pos/kds')
@ApiBearerAuth()
@Controller('pos/kds')
export class PosKdsController {
  constructor(private readonly svc: PosKdsService) {}

  @Get('tickets')
  @RequirePermissions('pos:kds')
  list(
    @Query('station') station?: string,
    @Query('status') status?: 'new' | 'preparing' | 'ready' | 'served' | 'cancelled',
  ) {
    return this.svc.listTickets(station, status);
  }

  @Get('stream')
  @RequirePermissions('pos:kds')
  stream(@Res() res: Response, @Query('station') station?: string) {
    return this.svc.streamTickets(res, station);
  }

  @Get('tickets/:id')
  @RequirePermissions('pos:kds')
  get(@Param('id') id: string) {
    return this.svc.getTicket(id);
  }

  @Post('tickets/bulk-transition')
  @RequirePermissions('pos:kds')
  bulkTransition(@Body() body: KdsBulkTransitionDto) {
    return this.svc.bulkTransition(body.ids, body.action, body.reason);
  }

  @Post('tickets/:id/transition')
  @RequirePermissions('pos:kds')
  transition(@Param('id') id: string, @Body() body: KdsTransitionDto) {
    return this.svc.transition(id, body.action, body.reason);
  }

  @Post('tickets/:id/priority')
  @RequirePermissions('pos:kds')
  priority(@Param('id') id: string, @Body() body: KdsPriorityDto) {
    return this.svc.setPriority(id, body.priority);
  }

  @Post('tickets/:id/assign')
  @RequirePermissions('pos:kds')
  assign(@Param('id') id: string, @Body() body: KdsAssignDto) {
    return this.svc.assignChef(id, body.chefUserId ?? null);
  }

  @Post('send-to-kitchen')
  @RequirePermissions('pos:checkout')
  sendToKitchen(@Body() dto: SendToKitchenDto) {
    return this.svc.createTicketsFromCart({
      label: dto.label,
      tableId: dto.tableId,
      items: dto.items,
    });
  }
}
