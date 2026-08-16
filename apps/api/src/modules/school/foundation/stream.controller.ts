import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StreamService } from './stream.service';
import { CreateStreamDto, UpdateStreamDto } from './dto.types';

@Controller('school/streams')
export class StreamController {
  constructor(private readonly service: StreamService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass(@Param('classId') classId: string) {
    return this.service.byClass(classId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateStreamDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateStreamDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
