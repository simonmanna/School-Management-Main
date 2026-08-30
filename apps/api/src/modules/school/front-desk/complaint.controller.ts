import { Controller, Get, Post, Put, Delete, Param, Body, Query, ParseEnumPipe } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ComplaintService } from './complaint.service';
import { CreateComplaintDto, UpdateComplaintDto } from './complaint.dto';
import { ComplaintCategory, ComplaintStatus, ComplaintPriority } from '@prisma/client';

@Controller('school/complaints')
export class ComplaintController {
  constructor(private readonly service: ComplaintService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(
    @Query('category', new ParseEnumPipe(ComplaintCategory, { optional: true })) category?: ComplaintCategory,
    @Query('status', new ParseEnumPipe(ComplaintStatus, { optional: true })) status?: ComplaintStatus,
    @Query('priority', new ParseEnumPipe(ComplaintPriority, { optional: true })) priority?: ComplaintPriority,
    @Query('partnerId') partnerId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.list({
      category,
      status,
      priority,
      partnerId,
      assignedToId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateComplaintDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateComplaintDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}