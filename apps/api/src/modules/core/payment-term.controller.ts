import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsNumber, IsString, Min } from 'class-validator';
import type { PaymentTermMethod } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PaymentTermService } from './payment-term.service';

class UpsertPaymentTermDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsEnum(['immediate', 'net_days', 'end_of_following_month']) method?: PaymentTermMethod;
  @IsOptional() @IsInt() @Min(0) netDays?: number;
  @IsOptional() @IsInt() @Min(0) discountDays?: number;
  @IsOptional() @IsNumber() discountPercent?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

@Controller('payment-terms')
export class PaymentTermController {
  constructor(private readonly terms: PaymentTermService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.account.read)
  list() {
    return this.terms.list();
  }

  /** MUST be declared before @Get(':id') — a later :id route would swallow 'deleted'. */
  @Get('deleted')
  @RequirePermissions(PERMISSIONS.account.read)
  deleted() {
    return this.terms.deleted();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.account.read)
  get(@Param('id') id: string) {
    return this.terms.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.account.create)
  create(@Body() dto: UpsertPaymentTermDto) {
    return this.terms.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.account.update)
  update(@Param('id') id: string, @Body() dto: Partial<UpsertPaymentTermDto>) {
    return this.terms.update(id, dto);
  }

  @Patch(':id/restore')
  @RequirePermissions(PERMISSIONS.account.update)
  restore(@Param('id') id: string) {
    return this.terms.restore(id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.account.delete)
  remove(@Param('id') id: string) {
    return this.terms.remove(id);
  }
}