import { Body, Controller, Delete, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { PosSplitService } from './pos-split.service';
import { AddBillsDto, AssignItemsDto } from './dto/split.dto';
import { ReceivePaymentDto } from '../order/dto/order.dto';

/**
 * Split-bill endpoints. Table / bill ids travel in the URL only — the DTOs are
 * `forbidNonWhitelisted`, so ids in the body would 400 (see project memory).
 * State + bill creation hang off the tab (`/pos/tabs/:tableId/split`); per-bill
 * ops hang off the bill (`/pos/split-bills/:billId/...`).
 */
@ApiTags('pos/split')
@ApiBearerAuth()
@Controller('pos')
export class PosSplitController {
  constructor(private readonly svc: PosSplitService) {}

  /** The full split workspace for a table. */
  @Get('tabs/:tableId/split')
  @RequirePermissions('tables:split')
  getState(@Param('tableId') tableId: string) {
    return this.svc.getState(tableId);
  }

  /** Create one or more empty bills for the table's open tab. */
  @Post('tabs/:tableId/split/bills')
  @RequirePermissions('tables:split')
  addBills(@Param('tableId') tableId: string, @Body() dto: AddBillsDto) {
    return this.svc.addBills(tableId, dto.count ?? 1);
  }

  /** Abort the split: discard every open (unpaid) bill. */
  @Post('tabs/:tableId/split/cancel')
  @RequirePermissions('tables:split')
  cancelSplit(@Param('tableId') tableId: string) {
    return this.svc.cancelSplit(tableId);
  }

  /** Assign quantity from the unassigned pool into a bill. */
  @Post('split-bills/:billId/assign')
  @RequirePermissions('tables:split')
  assign(@Param('billId') billId: string, @Body() dto: AssignItemsDto) {
    return this.svc.assign(billId, dto.items);
  }

  /** Return quantity from a bill back to the unassigned pool. */
  @Post('split-bills/:billId/unassign')
  @RequirePermissions('tables:split')
  unassign(@Param('billId') billId: string, @Body() dto: AssignItemsDto) {
    return this.svc.unassign(billId, dto.items);
  }

  /** Move quantity from this bill into another open bill. */
  @Post('split-bills/:billId/move/:targetBillId')
  @RequirePermissions('tables:split')
  move(@Param('billId') billId: string, @Param('targetBillId') targetBillId: string, @Body() dto: AssignItemsDto) {
    return this.svc.move(billId, targetBillId, dto.items);
  }

  /** Merge THIS bill (source) into the target bill, then delete this one. */
  @Post('split-bills/:billId/merge/:targetBillId')
  @RequirePermissions('tables:split')
  merge(@Param('billId') billId: string, @Param('targetBillId') targetBillId: string) {
    return this.svc.merge(targetBillId, billId);
  }

  /** Delete an (unpaid) bill, returning its items to the pool. */
  @Delete('split-bills/:billId')
  @RequirePermissions('tables:split')
  deleteBill(@Param('billId') billId: string) {
    return this.svc.deleteBill(billId);
  }

  /** Settle one bill into its own Invoice + Receipt and take payment. */
  @Post('split-bills/:billId/settle')
  @RequirePermissions('pos:checkout')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  settle(@Param('billId') billId: string, @Body() dto: ReceivePaymentDto) {
    return this.svc.settleBill(billId, dto);
  }
}
