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
import { ExpensesService } from './expenses.service';
import {
  ApproveExpenseDto,
  CreateExpenseDto,
  PayExpenseDto,
  RejectExpenseDto,
  UpdateExpenseDto,
  VoidExpenseDto,
} from './dto/expense.dto';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // ── Static routes first so they don't get swallowed by `:id` ──
  @Get('stats')
  @RequirePermissions(PERMISSIONS.expense.read)
  stats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.expenses.stats(dateFrom, dateTo);
  }

  @Get('meta/accounts')
  @RequirePermissions(PERMISSIONS.expense.read)
  accounts() {
    return this.expenses.paymentAccounts();
  }

  @Get('meta/suppliers')
  @RequirePermissions(PERMISSIONS.expense.read)
  suppliers() {
    return this.expenses.suppliers();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.expense.read)
  list(@Query() query: any) {
    return this.expenses.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.expense.read)
  findOne(@Param('id') id: string) {
    return this.expenses.findOne(id);
  }

  @Get(':id/audit')
  @RequirePermissions(PERMISSIONS.expense.read)
  audit(@Param('id') id: string) {
    return this.expenses.getAudit(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.expense.create)
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.expense.update)
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(id, dto);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.expense.approve)
  approve(@Param('id') id: string, @Body() dto: ApproveExpenseDto) {
    return this.expenses.approve(id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.expense.approve)
  reject(@Param('id') id: string, @Body() dto: RejectExpenseDto) {
    return this.expenses.reject(id, dto.reason);
  }

  @Post(':id/pay')
  @RequirePermissions(PERMISSIONS.expense.post)
  pay(@Param('id') id: string, @Body() dto: PayExpenseDto) {
    return this.expenses.pay(id, dto);
  }

  @Post(':id/void')
  @RequirePermissions(PERMISSIONS.expense.cancel)
  voidExpense(@Param('id') id: string, @Body() dto: VoidExpenseDto) {
    return this.expenses.void(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.expense.cancel)
  remove(@Param('id') id: string) {
    return this.expenses.remove(id);
  }
}
