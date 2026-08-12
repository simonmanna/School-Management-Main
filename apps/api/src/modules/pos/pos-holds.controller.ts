/**
 * POS Phase A — Held-orders controller. Permission-gated.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosHoldsService, type PosHoldLineInput } from './pos-holds.service';

class PosHoldLineDto implements PosHoldLineInput {
  @ApiProperty({ required: false }) @IsOptional() @IsString() productId?: string;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty() @IsNumber() unitPrice!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() discountPercent?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() taxId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() note?: string;
}

class CreatePosHoldDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() cashSessionId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [PosHoldLineDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosHoldLineDto)
  lines!: PosHoldLineDto[];
}

@ApiTags('pos/holds')
@ApiBearerAuth()
@Controller('pos/holds')
export class PosHoldsController {
  constructor(private readonly svc: PosHoldsService) {}

  @Post()
  @RequirePermissions('pos:hold')
  create(@Body() dto: CreatePosHoldDto) {
    return this.svc.create(dto);
  }

  @Get()
  @RequirePermissions('pos:read')
  list(
    @Query('status') status?: 'open' | 'recalled' | 'cancelled',
    @Query('branchId') branchId?: string,
    @Query('cashSessionId') cashSessionId?: string,
  ) {
    return this.svc.list({ status, branchId, cashSessionId });
  }

  @Get(':id')
  @RequirePermissions('pos:read')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post(':id/recall')
  @RequirePermissions('pos:hold')
  recall(@Param('id') id: string) {
    return this.svc.recall(id);
  }

  @Delete(':id')
  @RequirePermissions('pos:hold')
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }

  @Patch(':id/notes')
  @RequirePermissions('pos:hold')
  updateNotes(@Param('id') id: string, @Body() body: { notes: string }) {
    return this.svc.updateNotes(id, body.notes);
  }
}