import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PositionService } from './position.service';
import { CreatePositionDto, UpdatePositionDto } from './dto.types';

@Controller('school/positions')
export class PositionController {
  constructor(private readonly positions: PositionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.positions.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.positions.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  create(@Body() dto: CreatePositionDto) {
    return this.positions.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  update(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.positions.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  remove(@Param('id') id: string) {
    return this.positions.remove(id);
  }
}