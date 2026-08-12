import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class POLineDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  unitOfMeasureId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePODto {
  @ApiProperty()
  @IsString()
  partnerId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currencyCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @ApiProperty({ required: false, default: 'cash' })
  @IsOptional()
  @IsString()
  @IsIn(['cash', 'credit'])
  paymentType?: 'cash' | 'credit';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  terms?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiProperty({ type: [POLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => POLineDto)
  lines!: POLineDto[];
}

export class ReceiveLineDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  purchaseOrderLineId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  unitCost?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReceivePODto {
  @ApiProperty()
  @IsString()
  warehouseId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [ReceiveLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

export class PayPODto {
  @ApiProperty({ required: false, description: 'Amount to pay. Defaults to remaining balance.' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, enum: ['cash', 'bank'], default: 'bank', description: 'Funds source for the GL credit. Cash also records a drawer pay-out.' })
  @IsOptional()
  @IsIn(['cash', 'bank'])
  method?: 'cash' | 'bank';

  @ApiProperty({ required: false, description: 'Cash method only: the till whose open session records the pay-out. Defaults to any open session.' })
  @IsOptional()
  @IsString()
  cashRegisterId?: string;
}

export class UpdatePODto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  terms?: string;
}
