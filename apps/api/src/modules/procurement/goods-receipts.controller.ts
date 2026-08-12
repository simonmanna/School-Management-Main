import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { GoodsReceiptsService } from './goods-receipts.service';

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('procurement/goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly svc: GoodsReceiptsService) {}

  @Post('adhoc')
  @RequirePermissions('goods_receipt:create')
  createAdhoc(
    @Body()
    body: {
      warehouseId: string;
      branchId?: string;
      partnerId?: string;
      receivedAt?: string;
      notes?: string;
      lines: Array<{
        productId?: string;
        description: string;
        quantity: number;
        unitCost?: number;
        batchNumber?: string;
        expiryDate?: string;
        notes?: string;
      }>;
    },
  ) {
    return this.svc.createAdhoc(body);
  }

  /**
   * Draft-only GRN. Creates the paper record and stops — stock does NOT move and
   * nothing posts to the GL until {@link post} is called. Kept as a distinct
   * endpoint because a receiving clerk capturing a delivery note is a real step,
   * but it is no longer a third posting path: `create` cannot post, only `post`
   * can, and `post` is the single audited draft→posted transition.
   */
  @Post()
  @RequirePermissions('goods_receipt:create')
  createDraft(
    @Body()
    body: {
      purchaseOrderId?: string;
      warehouseId: string;
      branchId?: string;
      partnerId?: string;
      receivedAt?: string;
      notes?: string;
      lines: Array<{
        purchaseOrderLineId?: string;
        productId?: string;
        description: string;
        quantity: number;
        unitCost?: number;
        batchNumber?: string;
        expiryDate?: string;
        notes?: string;
      }>;
    },
  ) {
    return this.svc.createDraft(body);
  }

  @Patch(':id/post')
  @RequirePermissions('goods_receipt:create')
  post(@Param('id') id: string) {
    return this.svc.post(id);
  }

  @Get()
  @RequirePermissions('goods_receipt:read')
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.list({ page: Number(page), pageSize: Number(pageSize), search, status });
  }

  @Get(':id')
  @RequirePermissions('goods_receipt:read')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
}
