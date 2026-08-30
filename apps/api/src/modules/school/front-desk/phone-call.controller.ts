import { Controller, Get, Post, Put, Delete, Param, Body, Query, ParseEnumPipe } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PhoneCallService } from './phone-call.service';
import { CreatePhoneCallDto, UpdatePhoneCallDto } from './phone-call.dto';
import { CallDirection, CallStatus } from '@prisma/client';

@Controller('school/phone-calls')
export class PhoneCallController {
  constructor(private readonly service: PhoneCallService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(
    @Query('direction', new ParseEnumPipe(CallDirection, { optional: true })) direction?: CallDirection,
    @Query('status', new ParseEnumPipe(CallStatus, { optional: true })) status?: CallStatus,
    @Query('partnerId') partnerId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.list({
      direction,
      status,
      partnerId,
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
  create(@Body() dto: CreatePhoneCallDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdatePhoneCallDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}