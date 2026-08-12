import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
  IsIn,
} from 'class-validator';

export class InvoiceLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Quantity cannot be negative' })
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01, { message: 'Unit price must be at least 0.01' })
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Discount percent cannot be negative' })
  @Max(100, { message: 'Discount percent cannot exceed 100' })
  discountPercent?: number;

  @IsOptional()
  @IsString()
  taxId?: string;

  /** Odoo-style line type: 'product' (default), 'section', 'note'. */
  @IsOptional()
  @IsIn(['product', 'section', 'note'])
  lineType?: string;
}

export class CreateInvoiceDto {
  @IsString()
  partnerId!: string;

  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** Payment term id (core master). Drives due-date derivation when dueDate is absent. */
  @IsOptional()
  @IsString()
  paymentTermId?: string;

  /** Payment method intent (how the sale will be settled). */
  @IsOptional()
  @IsIn(['cash', 'card', 'mobile_money', 'mixed', 'credit'])
  paymentMode?: string;

  /** Fiscal position (loose ref to core FiscalPosition master). */
  @IsOptional()
  @IsString()
  fiscalPositionId?: string;

  /** Invoicing journal (loose ref to Journal master). */
  @IsOptional()
  @IsString()
  invoicingJournalId?: string;

  /** Salesperson on the sale (loose ref to HrEmployee). */
  @IsOptional()
  @IsString()
  salespersonId?: string;

  /** Expected delivery date (ISO date). */
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  /** Delivery address snapshot (free text / chosen from the partner's addresses). */
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  incoterm?: string;

  @IsOptional()
  @IsString()
  incotermLocation?: string;

  /** Source document reference (SO/PO/quotation number). */
  @IsOptional()
  @IsString()
  sourceDocument?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}
