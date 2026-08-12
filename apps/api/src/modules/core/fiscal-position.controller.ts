import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { FiscalPositionService } from './fiscal-position.service';

class UpsertFiscalPositionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

@Controller('fiscal-positions')
export class FiscalPositionController {
  constructor(private readonly positions: FiscalPositionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.account.read)
  list() {
    return this.positions.list();
  }

  /** MUST be declared before @Get(':id') — a later :id route would swallow 'deleted'. */
  @Get('deleted')
  @RequirePermissions(PERMISSIONS.account.read)
  deleted() {
    return this.positions.deleted();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.account.read)
  get(@Param('id') id: string) {
    return this.positions.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.account.create)
  create(@Body() dto: UpsertFiscalPositionDto) {
    return this.positions.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.account.update)
  update(@Param('id') id: string, @Body() dto: Partial<UpsertFiscalPositionDto>) {
    return this.positions.update(id, dto);
  }

  @Patch(':id/restore')
  @RequirePermissions(PERMISSIONS.account.update)
  restore(@Param('id') id: string) {
    return this.positions.restore(id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.account.delete)
  remove(@Param('id') id: string) {
    return this.positions.remove(id);
  }
}