import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CostCenterService } from './cost-center.service';

@Controller('cost-centers')
export class CostCenterController {
  constructor(private readonly svc: CostCenterService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.costCenter.read)
  list(@Query() query: any) {
    return this.svc.list({ page: Number(query.page), pageSize: Number(query.pageSize), type: query.type });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.costCenter.read)
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.costCenter.create)
  create(@Body() dto: { code: string; name: string; type?: string }) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.costCenter.update)
  update(@Param('id') id: string, @Body() dto: { code?: string; name?: string; type?: string; isActive?: boolean }) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.costCenter.delete)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
