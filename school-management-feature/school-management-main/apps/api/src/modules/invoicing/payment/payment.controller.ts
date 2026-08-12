import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/payment.dto';

@Controller()
@UseInterceptors(IdempotencyInterceptor)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  // ---- Customer receipts (inbound) ----
  @Get('payments')
  @RequirePermissions(PERMISSIONS.payment.read)
  listReceipts(@Query() query: PaginationDto) {
    return this.payments.list(query, 'inbound');
  }

  @Get('payments/:id')
  @RequirePermissions(PERMISSIONS.payment.read)
  findOne(@Param('id') id: string) {
    return this.payments.findOne(id);
  }

  @Post('payments')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.payment.create)
  createReceipt(@Body() dto: CreatePaymentDto) {
    return this.payments.createReceipt(dto);
  }

  @Post('payments/:id/void')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.payment.void)
  voidPayment(@Param('id') id: string) {
    return this.payments.void(id);
  }

  // ---- Supplier payments (outbound) ----
  @Get('supplier-payments')
  @RequirePermissions(PERMISSIONS.payment.read)
  listSupplierPayments(@Query() query: PaginationDto) {
    return this.payments.list(query, 'outbound');
  }

  @Post('supplier-payments')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.payment.create)
  createSupplierPayment(@Body() dto: CreatePaymentDto) {
    return this.payments.createSupplierPayment(dto);
  }
}
