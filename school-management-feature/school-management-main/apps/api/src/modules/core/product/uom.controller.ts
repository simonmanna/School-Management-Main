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
import { UomService } from './uom.service';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

class CreateUomDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() ratio?: number;
  @IsOptional() @IsBoolean() isBase?: boolean;
}

class UpdateUomDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() ratio?: number;
  @IsOptional() @IsBoolean() isBase?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('uoms')
export class UomController {
  constructor(private readonly uoms: UomService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.uom.read)
  list(@Query() query: PaginationDto) {
    return this.uoms.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.uom.read)
  findOne(@Param('id') id: string) {
    return this.uoms.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.uom.create)
  create(@Body() dto: CreateUomDto) {
    return this.uoms.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.uom.update)
  update(@Param('id') id: string, @Body() dto: UpdateUomDto) {
    return this.uoms.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.uom.delete)
  remove(@Param('id') id: string) {
    return this.uoms.remove(id);
  }
}