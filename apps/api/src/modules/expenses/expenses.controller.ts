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

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // ── Static routes first so they don't get swallowed by `:id` ──
  @Get('stats')
  stats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.expenses.stats(dateFrom, dateTo);
  }

  @Get('meta/accounts')
  accounts() {
    return this.expenses.paymentAccounts();
  }

  @Get('meta/suppliers')
  suppliers() {
    return this.expenses.suppliers();
  }

  @Get()
  list(@Query() query: any) {
    return this.expenses.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expenses.findOne(id);
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.expenses.getAudit(id);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(id, dto);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveExpenseDto) {
    return this.expenses.approve(id, dto);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectExpenseDto) {
    return this.expenses.reject(id, dto.reason);
  }

  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() dto: PayExpenseDto) {
    return this.expenses.pay(id, dto);
  }

  @Post(':id/void')
  voidExpense(@Param('id') id: string, @Body() dto: VoidExpenseDto) {
    return this.expenses.void(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.expenses.remove(id);
  }
}
