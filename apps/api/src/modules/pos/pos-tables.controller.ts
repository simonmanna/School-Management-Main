/**
 * POS Phase T1 — Tables Management controller (ADR-012).
 *
 * Permission gating is enforced via `@RequirePermissions`; every body is
 * class-validator validated.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';

import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosTablesService, type CreateTableDto } from './pos-tables.service';

class CreateTableBody implements CreateTableDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsInt() number!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) seats?: number;
  @ApiProperty({ required: false, description: 'Key of a PosTableZone (dining area)' })
  @IsOptional() @IsString() zone?: string;
  @ApiProperty({ required: false, enum: ['square','rectangle','circle'] })
  @IsOptional() @IsIn(['square','rectangle','circle']) shape?: 'square' | 'rectangle' | 'circle';
  @ApiProperty({ required: false }) @IsOptional() @IsInt() posX?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() posY?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(20) width?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(20) height?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  @ApiProperty({ required: false }) @IsOptional() active?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignedWaiterId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() qrCodeUrl?: string;
}

class UpdateTableBody {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() number?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) seats?: number;
  @ApiProperty({ required: false, description: 'Key of a PosTableZone (dining area)' })
  @IsOptional() @IsString() zone?: string;
  @ApiProperty({ required: false, enum: ['square','rectangle','circle'] })
  @IsOptional() @IsIn(['square','rectangle','circle'])
  shape?: 'square' | 'rectangle' | 'circle';
  @ApiProperty({ required: false }) @IsOptional() @IsInt() posX?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() posY?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(20) width?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(20) height?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  @ApiProperty({ required: false }) @IsOptional() active?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignedWaiterId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() qrCodeUrl?: string;
}

class StatusBody {
  @ApiProperty({ enum: ['available','occupied','reserved','out_of_service','cleaning'] })
  @IsIn(['available','occupied','reserved','out_of_service','cleaning'])
  status!: 'available' | 'occupied' | 'reserved' | 'out_of_service' | 'cleaning';
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}

class AssignWaiterBody {
  @ApiProperty({ nullable: true }) @IsOptional() @IsString() waiterId?: string | null;
}

class SplitLineBody {
  @ApiProperty() @IsString() sourceItemId!: string;
  @ApiProperty() @IsNumber() @Min(0.0001) quantity!: number;
}

class SplitGroupBody {
  @ApiProperty() @IsString() label!: string;
  @ApiProperty({ type: [SplitLineBody] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SplitLineBody)
  lines!: SplitLineBody[];
}

class SplitBillBody {
  @ApiProperty() @IsString() sourceOrderId!: string;
  @ApiProperty({ type: [SplitGroupBody] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SplitGroupBody)
  splits!: SplitGroupBody[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
}

class TransferItemBody {
  @ApiProperty() @IsString() lineId!: string;
  @ApiProperty() @IsNumber() @Min(0.0001) quantity!: number;
}

class TransferItemsBody {
  @ApiProperty({ type: [TransferItemBody] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => TransferItemBody)
  items!: TransferItemBody[];
}

@ApiTags('pos/tables')
@ApiBearerAuth()
@Controller('pos/tables')
export class PosTablesController {
  constructor(private readonly svc: PosTablesService) {}

  @Get()
  @RequirePermissions('tables:view')
  list(
    @Query('status') status?: string,
    @Query('zone') zone?: string,
    @Query('active') active?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.svc.list({ status, zone, active: activeBool });
  }

  @Get('stats')
  @RequirePermissions('tables:view')
  stats() {
    return this.svc.stats();
  }

  @Get('stream')
  @RequirePermissions('tables:view')
  stream(@Res() res: Response, @Req() req: any) {
    return this.svc.stream(res, req.headers?.origin);
  }

  @Get(':id')
  @RequirePermissions('tables:view')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @RequirePermissions('tables:create')
  create(@Body() dto: CreateTableBody) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('tables:edit')
  update(@Param('id') id: string, @Body() dto: UpdateTableBody) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('tables:delete')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Put(':id/status')
  @RequirePermissions('tables:edit')
  setStatus(@Param('id') id: string, @Body() dto: StatusBody) {
    return this.svc.setStatus(id, dto);
  }

  @Post(':id/assign-waiter')
  @RequirePermissions('tables:edit')
  assignWaiter(@Param('id') id: string, @Body() dto: AssignWaiterBody) {
    return this.svc.assignWaiter(id, { waiterId: dto.waiterId ?? null });
  }

  @Post(':id/merge/:targetId')
  @RequirePermissions('tables:merge')
  merge(@Param('id') id: string, @Param('targetId') targetId: string) {
    return this.svc.merge(id, targetId);
  }

  @Post(':id/unmerge')
  @RequirePermissions('tables:merge')
  unmerge(@Param('id') id: string) {
    return this.svc.unmerge(id);
  }

  @Post(':id/transfer/:targetId')
  @RequirePermissions('tables:transfer')
  transfer(@Param('id') id: string, @Param('targetId') targetId: string) {
    return this.svc.transfer(id, targetId);
  }

  /**
   * Item-level transfer (ADR-012): move selected lines (with optional partial
   * quantities) from this table's draft order into another table's. Works into
   * an occupied table. Table ids travel in the URL only — keeping them out of
   * the body keeps the DTO `forbidNonWhitelisted`-safe.
   */
  @Post(':id/transfer-items/:targetId')
  @RequirePermissions('tables:transfer')
  transferItems(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @Body() dto: TransferItemsBody,
  ) {
    return this.svc.transferItems(id, targetId, dto.items);
  }

  @Post(':id/split-bill')
  @RequirePermissions('tables:split')
  splitBill(@Param('id') id: string, @Body() dto: SplitBillBody) {
    return this.svc.splitBill({
      tableId: id,
      sourceOrderId: dto.sourceOrderId,
      splits: dto.splits,
      partnerId: dto.partnerId,
    });
  }

  /**
   * Internal endpoint called by the POS checkout flow when the cashier
   * opens a sale on this table. Kept under tables:edit so a manager can
   * override; production cashiers also hold it.
   */
  @Post(':id/attach-sale')
  @RequirePermissions('tables:edit')
  attachSale(
    @Param('id') id: string,
    @Body() dto: { orderId: string; customerName?: string; guestCount?: number },
  ) {
    return this.svc.attachSaleToTable({
      tableId: id,
      orderId: dto.orderId,
      customerName: dto.customerName,
      guestCount: dto.guestCount,
    });
  }
}