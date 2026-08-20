import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { FrontDeskService } from './front-desk.service';
import { CreateFrontDeskLogDto, CheckoutFrontDeskDto } from './front-desk.dto';

@Controller('school/front-desk')
export class FrontDeskController {
  constructor(private readonly service: FrontDeskService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query('status') status?: string) {
    return this.service.list(status);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateFrontDeskLogDto) {
    return this.service.create(dto);
  }

  @Patch(':id/checkout')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  checkout(@Param('id') id: string, @Body() dto: CheckoutFrontDeskDto) {
    return this.service.checkout(id, dto);
  }
}
