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
import { PERMISSIONS, type TaxType } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { TaxService } from './tax.service';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

class CreateTaxDto {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() type?: TaxType;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsBoolean() isInclusive?: boolean;
  @IsOptional() @IsBoolean() isCompound?: boolean;
  @IsOptional() @IsString() accountId?: string;
}

class UpdateTaxDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() type?: TaxType;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsBoolean() isInclusive?: boolean;
  @IsOptional() @IsBoolean() isCompound?: boolean;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('taxes')
export class TaxController {
  constructor(private readonly taxes: TaxService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.tax.read)
  list(@Query() query: PaginationDto) {
    return this.taxes.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.tax.read)
  findOne(@Param('id') id: string) {
    return this.taxes.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.tax.create)
  create(@Body() dto: CreateTaxDto) {
    return this.taxes.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.tax.update)
  update(@Param('id') id: string, @Body() dto: UpdateTaxDto) {
    return this.taxes.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.tax.delete)
  remove(@Param('id') id: string) {
    return this.taxes.remove(id);
  }
}