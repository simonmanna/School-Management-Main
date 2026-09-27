import { Body, Controller, Get, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CashDeskService } from './cash-desk.service';

class OpenDrawerDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) openingFloat?: number;
}

class CloseDrawerDto {
  @Type(() => Number) @IsNumber() @Min(0) closingCounted!: number;
  @IsOptional() @IsString() @MaxLength(500) varianceReason?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** The fee desk's cash drawer (ADR-032 P3, audit F09). */
@Controller('school/fees/cash-desk')
export class CashDeskController {
  constructor(private readonly desk: CashDeskService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  status() {
    return this.desk.status();
  }

  @Post('open')
  @RequirePermissions(PERMISSIONS.school.collectPayments, PERMISSIONS.cashSession.open)
  open(@Body() dto: OpenDrawerDto) {
    return this.desk.open(dto.openingFloat ?? 0);
  }

  @Post('close')
  @RequirePermissions(PERMISSIONS.school.collectPayments, PERMISSIONS.cashSession.close)
  close(@Body() dto: CloseDrawerDto) {
    return this.desk.close(dto);
  }
}
