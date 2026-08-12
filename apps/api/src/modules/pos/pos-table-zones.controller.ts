/**
 * POS Tables Management — zones (categories) controller (ADR-012 extension).
 *
 * Route order matters: this controller MUST be registered BEFORE
 * PosTablesController in pos.module.ts — `@Get(':id')` there would otherwise
 * swallow `GET /pos/tables/zones` as `id='zones'`.
 *
 * Reads require `tables:view`; mutations require the dedicated `tables:zones`
 * key (catalog management, like Menu Category management).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import {
  PosTableZonesService,
  type CreateZoneDto,
  type UpdateZoneDto,
} from './pos-table-zones.service';

class CreateZoneBody implements CreateZoneDto {
  @ApiProperty({ required: false, description: 'Stable slug; auto-derived from name when omitted' })
  @IsOptional() @IsString() @MaxLength(40)
  key?: string;

  @ApiProperty() @IsString() @MaxLength(80)
  name!: string;

  @ApiProperty({ required: false }) @IsOptional() @IsInt()
  sortOrder?: number;

  @ApiProperty({ required: false, example: '#10b981' })
  @IsOptional() @IsString() @MaxLength(9)
  color?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean()
  active?: boolean;
}

class UpdateZoneBody implements UpdateZoneDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40)
  key?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(9)
  color?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean()
  active?: boolean;
}

@ApiTags('pos/tables/zones')
@ApiBearerAuth()
@Controller('pos/tables/zones')
export class PosTableZonesController {
  constructor(private readonly svc: PosTableZonesService) {}

  @Get()
  @RequirePermissions('tables:view')
  list() {
    return this.svc.list();
  }

  @Get('deleted')
  @RequirePermissions('tables:view')
  listDeleted() {
    return this.svc.listDeleted();
  }

  @Post()
  @RequirePermissions('tables:zones')
  create(@Body() dto: CreateZoneBody) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('tables:zones')
  update(@Param('id') id: string, @Body() dto: UpdateZoneBody) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tables:zones')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Patch(':id/restore')
  @RequirePermissions('tables:zones')
  restore(@Param('id') id: string) {
    return this.svc.restore(id);
  }
}
