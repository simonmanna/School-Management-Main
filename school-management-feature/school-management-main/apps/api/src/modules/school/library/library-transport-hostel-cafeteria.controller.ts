import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  BookCopyService,
  BookMetadataService,
  BorrowingService,
  DormitoryService,
  HostelAllocationService,
  MealAccountService,
  MealPlanService,
  RouteAssignmentService,
  RouteService,
  RoomService,
  BedService,
  StopService,
  StudentTransportAssignmentService,
  VehicleService,
} from './library-transport-hostel-cafeteria.service';

@Controller('school/library/books')
export class BookMetadataController {
  constructor(private readonly service: BookMetadataService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageLibrary) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageLibrary) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageLibrary) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/library/copies')
export class BookCopyController {
  constructor(private readonly service: BookCopyService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageLibrary) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageLibrary) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
}

@Controller('school/library/borrowings')
export class BorrowingController {
  constructor(private readonly service: BorrowingService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post('borrow') @RequirePermissions(PERMISSIONS.school.manageLibrary) borrow(
    @Body() body: { bookCopyId: string; studentProfileId: string; dueAt: Date | string; notes?: string },
  ) { return this.service.borrow(body.bookCopyId, body.studentProfileId, new Date(body.dueAt), body.notes); }
  @Post(':id/return') @RequirePermissions(PERMISSIONS.school.manageLibrary) returnCopy(@Param('id') id: string) { return this.service.return(id); }
}

@Controller('school/transport/vehicles')
export class VehicleController {
  constructor(private readonly service: VehicleService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/routes')
export class RouteController {
  constructor(private readonly service: RouteService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/stops')
export class StopController {
  constructor(private readonly service: StopService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/route-assignments')
export class RouteAssignmentController {
  constructor(private readonly service: RouteAssignmentService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/assignments')
export class StudentTransportAssignmentController {
  constructor(private readonly service: StudentTransportAssignmentService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post('assign') @RequirePermissions(PERMISSIONS.school.manageTransport) assign(
    @Body() body: { studentProfileId: string; routeId: string; stopId: string; startDate: Date | string; monthlyFee: number },
  ) { return this.service.assign(body.studentProfileId, body.routeId, body.stopId, new Date(body.startDate), body.monthlyFee); }
}

@Controller('school/hostel/dormitories')
export class DormitoryController {
  constructor(private readonly service: DormitoryService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageHostel) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageHostel) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageHostel) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/hostel/rooms')
export class RoomController {
  constructor(private readonly service: RoomService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageHostel) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageHostel) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
}

@Controller('school/hostel/beds')
export class BedController {
  constructor(private readonly service: BedService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageHostel) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageHostel) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
}

@Controller('school/hostel/allocations')
export class HostelAllocationController {
  constructor(private readonly service: HostelAllocationService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post('allocate') @RequirePermissions(PERMISSIONS.school.manageHostel) allocate(
    @Body() body: { bedId: string; studentProfileId: string; startDate: Date | string },
  ) { return this.service.allocate(body.bedId, body.studentProfileId, new Date(body.startDate)); }
  @Post(':id/checkout') @RequirePermissions(PERMISSIONS.school.manageHostel) checkout(
    @Param('id') id: string, @Body('checkOutDate') checkOutDate: Date | string,
  ) { return this.service.checkout(id, new Date(checkOutDate)); }
}

@Controller('school/cafeteria/plans')
export class MealPlanController {
  constructor(private readonly service: MealPlanService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageCafeteria) create(@Body() dto: any) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageCafeteria) update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageCafeteria) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/cafeteria/accounts')
export class MealAccountController {
  constructor(private readonly service: MealAccountService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post('top-up') @RequirePermissions(PERMISSIONS.school.manageCafeteria) topUp(
    @Body() body: { studentProfileId: string; mealPlanId: string; amount: number },
  ) { return this.service.topUp(body.studentProfileId, body.mealPlanId, body.amount); }
  @Post('purchase') @RequirePermissions(PERMISSIONS.school.manageCafeteria) purchase(
    @Body() body: { mealAccountId: string; amount: number; description: string; paymentId?: string },
  ) { return this.service.purchase(body.mealAccountId, body.amount, body.description, body.paymentId); }
}