/**
 * POS F — Digital Menu admin controller.
 * Requires cashier/admin auth (not public).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { DigitalMenuService } from './digital-menu.service';

class CreateSessionDto {
  @ApiProperty() @IsString() branchId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() tableNumber?: string;
  @ApiProperty({ required: false, default: 6 }) @IsOptional() @IsNumber() @Min(0.5) expiresInHours?: number;
}

class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['received', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'] })
  status!: 'received' | 'accepted' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
}

@ApiTags('pos/menu')
@ApiBearerAuth()
@Controller('pos/menu')
export class DigitalMenuController {
  constructor(private readonly svc: DigitalMenuService) {}

  @Post('sessions')
  @RequirePermissions('pos:checkout')
  createSession(@Body() dto: CreateSessionDto) {
    return this.svc.createSession(dto);
  }

  @Get('sessions')
  @RequirePermissions('pos:read')
  listSessions(@Query('branchId') branchId?: string) {
    return this.svc.listSessions(branchId);
  }

  @Delete('sessions/:id')
  @RequirePermissions('pos:checkout')
  revokeSession(@Param('id') id: string) {
    return this.svc.revokeSession(id).then(() => ({ ok: true }));
  }

  @Get('orders')
  @RequirePermissions('pos:read')
  listOrders(@Query('status') status?: string) {
    return this.svc.listOnlineOrders(status);
  }

  @Patch('orders/:id/status')
  @RequirePermissions('pos:checkout')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.svc.updateOrderStatus(id, dto.status);
  }
}