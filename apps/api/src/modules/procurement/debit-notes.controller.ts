import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { DebitNotesService } from './debit-notes.service';

export class DebitNoteLineDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() productId?: string;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty() @IsNumber() unitPrice!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() taxId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}

export class CreateDebitNoteDto {
  @ApiProperty({ enum: ['outbound', 'inbound'] })
  @IsIn(['outbound', 'inbound'])
  direction!: 'outbound' | 'inbound';
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() documentId?: string;
  @ApiProperty({ enum: ['price_adjustment', 'returned_goods', 'overcharge', 'correction', 'other'] })
  @IsIn(['price_adjustment', 'returned_goods', 'overcharge', 'correction', 'other'])
  reason!: 'price_adjustment' | 'returned_goods' | 'overcharge' | 'correction' | 'other';
  @ApiProperty({ required: false }) @IsOptional() @IsString() reasonNote?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() issueDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currencyCode?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() exchangeRate?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  /** RTV only: the warehouse the returned goods leave from. Defaults to the
   *  org's default warehouse when omitted. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() locationId?: string;
  @ApiProperty({ type: [DebitNoteLineDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DebitNoteLineDto)
  lines!: DebitNoteLineDto[];
}

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('procurement/debit-notes')
export class DebitNotesController {
  constructor(private readonly svc: DebitNotesService) {}

  @Get()
  @RequirePermissions('debit_note:read')
  list(@Query('direction') direction?: string, @Query('status') status?: string) {
    return this.svc.list({ direction, status });
  }

  @Get(':id')
  @RequirePermissions('debit_note:read')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @RequirePermissions('debit_note:create')
  create(@Body() dto: CreateDebitNoteDto) {
    return this.svc.create(dto);
  }

  @Patch(':id/post')
  @RequirePermissions('debit_note:post')
  post(@Param('id') id: string) {
    return this.svc.post(id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('debit_note:cancel')
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }
}
