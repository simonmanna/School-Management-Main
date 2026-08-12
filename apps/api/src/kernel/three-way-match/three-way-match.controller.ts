import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ThreeWayMatchService } from './three-way-match.service';

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('procurement/three-way-match')
export class ThreeWayMatchController {
  constructor(private readonly svc: ThreeWayMatchService) {}

  @Get()
  @RequirePermissions('three_way_match:read')
  list(@Query('status') status?: string, @Query('purchaseOrderId') poId?: string) {
    return this.svc.list({ status, purchaseOrderId: poId });
  }

  @Post('recompute/:orderId')
  @RequirePermissions('three_way_match:read')
  recompute(@Param('orderId') orderId: string) {
    return this.svc.recomputeForOrder(orderId);
  }

  @Post('validate-bill/:billId')
  @RequirePermissions('three_way_match:read')
  validateBill(@Param('billId') billId: string) {
    return this.svc.validateBillForPosting(billId);
  }
}
