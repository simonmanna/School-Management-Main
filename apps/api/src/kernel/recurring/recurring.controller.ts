import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { RecurringService, type RecurringTemplate, type RecurringTemplateLine } from './recurring.service';

class RecurringLineDto implements RecurringTemplateLine {
  @ApiProperty({ required: false }) @IsOptional() @IsString() productId?: string;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: number;
  @ApiProperty({ required: false }) @IsOptional() discountPercent?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() taxId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() accountId?: string;
}

class RecurringTemplateDto implements RecurringTemplate {
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currencyId?: string;
  @ApiProperty({ required: false }) @IsOptional() exchangeRate?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reference?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [RecurringLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringLineDto)
  lines!: RecurringLineDto[];
}

class CreateRecurringDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: ['sales_invoice', 'credit_note', 'vendor_bill', 'debit_note'] })
  @IsIn(['sales_invoice', 'credit_note', 'vendor_bill', 'debit_note'])
  documentType!: 'sales_invoice' | 'credit_note' | 'vendor_bill' | 'debit_note';
  @ApiProperty({ type: RecurringTemplateDto })
  @ValidateNested()
  @Type(() => RecurringTemplateDto)
  template!: RecurringTemplateDto;
  @ApiProperty({ enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] })
  @IsIn(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
  frequency!: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  @ApiProperty({ example: '2025-01-31T00:00:00Z' })
  @IsDateString() nextRunAt!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() endDate?: string;
}

@ApiTags('recurring')
@ApiBearerAuth()
@Controller('recurring')
export class RecurringController {
  constructor(private readonly svc: RecurringService) {}

  @Get() list() { return this.svc.list(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: CreateRecurringDto) {
    return this.svc.create({
      ...dto,
      nextRunAt: new Date(dto.nextRunAt),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    });
  }
  @Patch(':id/pause') pause(@Param('id') id: string) { return this.svc.pause(id); }
  @Patch(':id/resume') resume(@Param('id') id: string) { return this.svc.resume(id); }
  @Patch(':id/end') end(@Param('id') id: string) { return this.svc.end(id); }
}
