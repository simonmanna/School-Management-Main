import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { IncomeHeadsService } from './income-heads.service';
import { CreateIncomeHeadDto, UpdateIncomeHeadDto } from './dto/income.dto';

/**
 * Income heads — the categories other revenue is booked against.
 *
 * Phase 7 hardening: every handler here was undecorated, and PermissionsGuard
 * fails OPEN on an undecorated handler, so any authenticated account could
 * rename or delete a revenue category. The grants already existed in the
 * catalogue; nothing but the decorators was missing.
 */
@Controller('income-heads')
export class IncomeHeadsController {
  constructor(private readonly heads: IncomeHeadsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.income.read)
  list() {
    return this.heads.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.income.read)
  findOne(@Param('id') id: string) {
    return this.heads.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.income.create)
  create(@Body() dto: CreateIncomeHeadDto) {
    return this.heads.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.income.update)
  update(@Param('id') id: string, @Body() dto: UpdateIncomeHeadDto) {
    return this.heads.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.income.cancel)
  remove(@Param('id') id: string) {
    return this.heads.remove(id);
  }
}
