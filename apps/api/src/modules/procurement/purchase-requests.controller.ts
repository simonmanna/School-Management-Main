import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PurchaseRequestsService } from './purchase-requests.service';

export class PRLineDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() productId?: string;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() unitOfMeasureId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() estimatedUnitPrice?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}

class CreatePRDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() neededBy?: string;
  @ApiProperty({ type: [PRLineDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PRLineDto)
  lines!: PRLineDto[];
}

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('procurement/purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly svc: PurchaseRequestsService) {}

  @Get()
  @RequirePermissions('purchase_request:read')
  list(@Query('status') status?: string) {
    return this.svc.list(status);
  }

  @Get(':id')
  @RequirePermissions('purchase_request:read')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @RequirePermissions('purchase_request:create')
  create(@Body() dto: CreatePRDto) {
    return this.svc.create(dto);
  }

  @Patch(':id/submit')
  @RequirePermissions('purchase_request:submit')
  submit(@Param('id') id: string) {
    return this.svc.submit(id);
  }

  @Patch(':id/approve')
  @RequirePermissions('purchase_request:approve')
  approve(@Param('id') id: string) {
    return this.svc.approve(id);
  }

  @Patch(':id/reject')
  @RequirePermissions('purchase_request:approve')
  reject(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.svc.reject(id, body?.reason ?? '');
  }

  @Delete(':id')
  @RequirePermissions('purchase_request:delete')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
