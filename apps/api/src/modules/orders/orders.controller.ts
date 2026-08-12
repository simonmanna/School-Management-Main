import {
  Body, Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../kernel/idempotency/idempotency.interceptor';
import { OrdersService } from './orders.service';
import {
  AddOrderItemsDto, BillOrderDto, CancelOrderDto, CreateOrderDto,
  SaveOrderItemsDto, UpdateOrderHeaderDto, UpdateOrderSettingsDto,
} from './dto/orders.dto';

/**
 * Generic back-office Orders CRUD — POS-independent operational orders over the
 * shared `Order` aggregate. Static routes (`/orders/settings`) are declared
 * BEFORE the `:id` routes so `:id` never swallows `settings`.
 *
 * Permission note: cancel/reopen drive the shared `order` workflow whose
 * transitions are declared with `pos:checkout` / `pos:override`. Administrator
 * holds both; a role with only `orders:*` gets a workflow 403 on those two
 * actions by design (the workflow definition is shared, not duplicated).
 */
@Controller('orders')
@UseInterceptors(IdempotencyInterceptor)
@ApiTags('orders')
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /* ── Settings (static — MUST stay above `:id` routes) ─────────────────── */

  @Get('settings')
  @RequirePermissions(PERMISSIONS.orders.read)
  getSettings() {
    return this.orders.getOrderSettings();
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.orders.update)
  updateSettings(@Body() dto: UpdateOrderSettingsDto) {
    return this.orders.updateOrderSettings(dto);
  }

  /* ── CRUD ─────────────────────────────────────────────────────────────── */

  @Get()
  @RequirePermissions(PERMISSIONS.orders.read)
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(25), ParseIntPipe) pageSize: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('orderType') orderType?: string,
    @Query('transactionKind') transactionKind?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.orders.list({ page, pageSize, search, status, orderType, transactionKind, dateFrom, dateTo });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.orders.read)
  findOne(@Param('id') id: string) {
    return this.orders.getOrder(id);
  }

  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.orders.create)
  create(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.orders.update)
  updateHeader(@Param('id') id: string, @Body() dto: UpdateOrderHeaderDto) {
    return this.orders.updateHeader(id, dto);
  }

  @Put(':id/items')
  @RequirePermissions(PERMISSIONS.orders.update)
  saveItems(@Param('id') id: string, @Body() dto: SaveOrderItemsDto) {
    return this.orders.saveItems(id, dto);
  }

  @Post(':id/items')
  @RequirePermissions(PERMISSIONS.orders.update)
  addItems(@Param('id') id: string, @Body() dto: AddOrderItemsDto) {
    return this.orders.addItems(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.orders.cancel)
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto = {}) {
    return this.orders.cancelOrder(id, dto.reason);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.orders.update)
  reopen(@Param('id') id: string) {
    return this.orders.reopenOrder(id);
  }

  @Post(':id/invoice')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.orders.invoice)
  generateInvoice(@Param('id') id: string, @Body() dto: BillOrderDto = {}) {
    return this.orders.generateInvoice(id, dto);
  }
}