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
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { UomService } from './uom.service';
import { UomConversionService } from './uom-conversion.service';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const UOM_TYPES = ['bigger', 'reference', 'smaller'] as const;

class CreateUomDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() symbol?: string;
  @IsOptional() @IsString() categoryId?: string;
  /** Legacy free-text category tag (kept until backfill completes). */
  @IsOptional() @IsString() category?: string;
  /** Base units per 1 of this unit (reference = 1). */
  @IsOptional() @IsNumber() factor?: number;
  @IsOptional() @IsNumber() ratio?: number;
  @IsOptional() @IsNumber() roundingPrecision?: number;
  @IsOptional() @IsIn([...UOM_TYPES]) uomType?: (typeof UOM_TYPES)[number];
  @IsOptional() @IsBoolean() isBase?: boolean;
}

class UpdateUomDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() symbol?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() factor?: number;
  @IsOptional() @IsNumber() ratio?: number;
  @IsOptional() @IsNumber() roundingPrecision?: number;
  @IsOptional() @IsIn([...UOM_TYPES]) uomType?: (typeof UOM_TYPES)[number];
  @IsOptional() @IsBoolean() isBase?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ConvertUomDto {
  @IsNumber() quantity!: number;
  @IsString() @IsNotEmpty() fromUomId!: string;
  @IsString() @IsNotEmpty() toUomId!: string;
  @IsOptional() @IsString() productId?: string;
}

@Controller('uoms')
export class UomController {
  constructor(
    private readonly uoms: UomService,
    private readonly conversion: UomConversionService,
  ) {}

  @Post('convert')
  @RequirePermissions(PERMISSIONS.uom.read)
  async convert(@Body() dto: ConvertUomDto) {
    const result = await this.conversion.convert(dto.quantity, dto.fromUomId, dto.toUomId, {
      productId: dto.productId,
    });
    return { result: result.toString() };
  }

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