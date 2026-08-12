import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { FiscalPeriodService } from './fiscal-period.service';
import { IsDateString, IsOptional, IsString } from 'class-validator';

class CreateFiscalPeriodDto {
  @IsString() name!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

class UpdateFiscalPeriodDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() status?: 'open' | 'closed' | 'locked';
}

@Controller('fiscal-periods')
export class FiscalPeriodController {
  constructor(private readonly periods: FiscalPeriodService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fiscalPeriod.read)
  list(@Query() query: PaginationDto) {
    return this.periods.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.fiscalPeriod.read)
  findOne(@Param('id') id: string) {
    return this.periods.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.fiscalPeriod.create)
  create(@Body() dto: CreateFiscalPeriodDto) {
    return this.periods.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fiscalPeriod.update)
  update(@Param('id') id: string, @Body() dto: UpdateFiscalPeriodDto) {
    return this.periods.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.fiscalPeriod.delete)
  remove(@Param('id') id: string) {
    return this.periods.remove(id);
  }
}