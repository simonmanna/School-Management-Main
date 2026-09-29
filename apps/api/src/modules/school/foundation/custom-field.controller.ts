import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CustomFieldService } from './custom-field.service';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './config.dto';

@Controller('school/custom-fields')
export class CustomFieldController {
  constructor(private readonly fields: CustomFieldService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.fields.list(q);
  }

  /** Wave 16: the active fields a form for this entity should render, in order. */
  @Get('for/:entityType')
  @RequirePermissions(PERMISSIONS.school.read)
  forEntity(@Param('entityType') entityType: string) {
    return this.fields.definitionsFor(entityType);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.fields.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateCustomFieldDto) {
    return this.fields.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateCustomFieldDto) {
    return this.fields.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.fields.remove(id);
  }
}
