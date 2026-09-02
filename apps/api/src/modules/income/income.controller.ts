import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { IncomeService } from './income.service';
import { CancelIncomeDto, CreateIncomeDto, UpdateIncomeDto } from './dto/income.dto';

/**
 * Other revenue.
 *
 * Phase 7 hardening: as with income heads, every handler was undecorated and
 * therefore open to any authenticated account — including `create`, which posts
 * to the ledger, and `cancel`, which reverses it. Gated on the grants the
 * catalogue already defined.
 */
@Controller('income')
export class IncomeController {
  constructor(private readonly income: IncomeService) {}

  // ── Static routes first so they don't get swallowed by `:id` ──
  @Get('stats')
  @RequirePermissions(PERMISSIONS.income.read)
  stats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.income.stats(dateFrom, dateTo);
  }

  @Get('meta/accounts')
  @RequirePermissions(PERMISSIONS.income.read)
  accounts() {
    return this.income.receiptAccounts();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.income.read)
  list(@Query() query: any) {
    return this.income.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.income.read)
  findOne(@Param('id') id: string) {
    return this.income.findOne(id);
  }

  @Get(':id/audit')
  @RequirePermissions(PERMISSIONS.income.read)
  audit(@Param('id') id: string) {
    return this.income.getAudit(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.income.create)
  create(@Body() dto: CreateIncomeDto) {
    return this.income.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.income.update)
  update(@Param('id') id: string, @Body() dto: UpdateIncomeDto) {
    return this.income.update(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.income.cancel)
  cancel(@Param('id') id: string, @Body() dto: CancelIncomeDto) {
    return this.income.cancel(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.income.cancel)
  remove(@Param('id') id: string) {
    return this.income.remove(id);
  }
}
