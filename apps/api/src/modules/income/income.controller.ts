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
import { IncomeService } from './income.service';
import { CancelIncomeDto, CreateIncomeDto, UpdateIncomeDto } from './dto/income.dto';

@Controller('income')
export class IncomeController {
  constructor(private readonly income: IncomeService) {}

  // ── Static routes first so they don't get swallowed by `:id` ──
  @Get('stats')
  stats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.income.stats(dateFrom, dateTo);
  }

  @Get('meta/accounts')
  accounts() {
    return this.income.receiptAccounts();
  }

  @Get()
  list(@Query() query: any) {
    return this.income.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.income.findOne(id);
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.income.getAudit(id);
  }

  @Post()
  create(@Body() dto: CreateIncomeDto) {
    return this.income.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIncomeDto) {
    return this.income.update(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelIncomeDto) {
    return this.income.cancel(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.income.remove(id);
  }
}
