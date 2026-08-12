import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { VendorBillService } from './vendor-bill.service';
import { CreateVendorBillDto } from './dto/vendor-bill.dto';

class PostOptionsDto {
  @ApiProperty({ required: false, default: false })
  @IsOptional() @IsBoolean() override3WM?: boolean;
  @ApiProperty({ required: false, default: false })
  @IsOptional() @IsBoolean() overrideApproval?: boolean;
}

// Vendor bills (Accounts Payable). NOTE: the base path is `vendor-bills`; the
// `/expenses` path is now owned by the standalone ExpensesModule (petty-cash /
// operating expenses), a distinct domain from AP bills.
@ApiTags('vendor-bills')
@ApiBearerAuth()
@Controller('vendor-bills')
@UseInterceptors(IdempotencyInterceptor)
export class VendorBillController {
  constructor(private readonly bills: VendorBillService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.expense.read)
  list(@Query() query: PaginationDto) {
    return this.bills.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.expense.read)
  findOne(@Param('id') id: string) {
    return this.bills.findOne(id);
  }

  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.expense.create)
  create(@Body() dto: CreateVendorBillDto) {
    return this.bills.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.expense.update)
  update(@Param('id') id: string, @Body() dto: CreateVendorBillDto) {
    return this.bills.update(id, dto);
  }

  /**
   * Post a bill. Set `override3WM: true` to bypass a blocked three-way
   * match (requires `three_way_match:override` permission). Set
   * `overrideApproval: true` to bypass a pending approval request
   * (requires `approvals:decide` permission).
   */
  @Post(':id/post')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.expense.post)
  post(@Param('id') id: string, @Body() body: PostOptionsDto = {}) {
    return this.bills.post(id, { override3WM: body.override3WM, overrideApproval: body.overrideApproval });
  }

  @Post(':id/cancel')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.expense.cancel)
  cancel(@Param('id') id: string) {
    return this.bills.cancel(id);
  }

  @Get('suppliers/:partnerId/ledger')
  @RequirePermissions(PERMISSIONS.expense.read)
  ledger(@Param('partnerId') partnerId: string) {
    return this.bills.ledger(partnerId);
  }
}
