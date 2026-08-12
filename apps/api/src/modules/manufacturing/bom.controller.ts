import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { BomService } from './bom.service';
import { CreateBomDto, UpdateBomDto } from './dto/bom.dto';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

@RequiresModule('manufacturing')
@Controller('manufacturing/boms')
export class BomController {
  constructor(private readonly boms: BomService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.bom.read)
  list(@Query('outputProductId') outputProductId?: string, @Query('status') status?: string) {
    return this.boms.list({ outputProductId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.bom.read)
  get(@Param('id') id: string) {
    return this.boms.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.bom.create)
  create(@Body() dto: CreateBomDto) {
    return this.boms.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.bom.update)
  update(@Param('id') id: string, @Body() dto: UpdateBomDto) {
    return this.boms.update(id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.bom.activate)
  activate(@Param('id') id: string) {
    return this.boms.activate(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.bom.delete)
  async remove(@Param('id') id: string) {
    await this.boms.remove(id);
  }
}
