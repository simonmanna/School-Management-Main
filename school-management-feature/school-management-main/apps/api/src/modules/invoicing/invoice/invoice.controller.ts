import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/invoice.dto';

@Controller('invoices')
@UseInterceptors(IdempotencyInterceptor)
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.invoice.read)
  list(@Query() query: PaginationDto) {
    return this.invoices.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.invoice.read)
  findOne(@Param('id') id: string) {
    return this.invoices.findOne(id);
  }

  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.invoice.create)
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.invoice.update)
  update(@Param('id') id: string, @Body() dto: CreateInvoiceDto) {
    return this.invoices.update(id, dto);
  }

  @Post(':id/post')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.invoice.post)
  post(@Param('id') id: string) {
    return this.invoices.post(id);
  }

  @Post(':id/cancel')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.invoice.cancel)
  cancel(@Param('id') id: string) {
    return this.invoices.cancel(id);
  }
}
