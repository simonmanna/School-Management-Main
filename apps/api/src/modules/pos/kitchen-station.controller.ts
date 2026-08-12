/**
 * POS KDS — kitchen station admin. Reads via pos:read (the terminal + KDS need
 * the station list); writes via pos:override (a manager-level config task).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { KitchenStationService } from './kitchen-station.service';

class CreateStationDto {
  @IsString() @MaxLength(60) name!: string;
  @IsString() @MaxLength(32) code!: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() displayOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() printerId?: string;
}

class UpdateStationDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsString() icon?: string | null;
  @IsOptional() @IsInt() displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() printerId?: string | null;
}

class ReorderDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
}

@ApiTags('pos/kitchen-stations')
@ApiBearerAuth()
@Controller('pos/kitchen-stations')
export class KitchenStationController {
  constructor(private readonly svc: KitchenStationService) {}

  @Get()
  @RequirePermissions('pos:read')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.svc.list(includeInactive !== 'false');
  }

  @Post('seed-defaults')
  @RequirePermissions('pos:override')
  async seedDefaults() {
    await this.svc.ensureDefaults();
    return this.svc.list();
  }

  @Post()
  @RequirePermissions('pos:override')
  create(@Body() dto: CreateStationDto) {
    return this.svc.create(dto);
  }

  @Patch('reorder')
  @RequirePermissions('pos:override')
  reorder(@Body() dto: ReorderDto) {
    return this.svc.reorder(dto.ids);
  }

  @Patch(':id')
  @RequirePermissions('pos:override')
  update(@Param('id') id: string, @Body() dto: UpdateStationDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('pos:override')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
