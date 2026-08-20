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
// Value imports (not `import type`): the global ValidationPipe reads
// class-validator metadata off the runtime class.
import {
  CreateBookMetadataDto,
  UpdateBookMetadataDto,
  CreateBookCopyDto,
  UpdateBookCopyDto,
  BorrowDto,
  CreateVehicleDto,
  UpdateVehicleDto,
  CreateRouteDto,
  UpdateRouteDto,
  CreateStopDto,
  UpdateStopDto,
  CreateRouteAssignmentDto,
  UpdateRouteAssignmentDto,
  TransportAssignDto,
  CreateDormitoryDto,
  UpdateDormitoryDto,
  CreateRoomDto,
  UpdateRoomDto,
  CreateBedDto,
  UpdateBedDto,
  HostelAllocateDto,
  HostelCheckoutDto,
  CreateMealPlanDto,
  UpdateMealPlanDto,
  MealTopUpDto,
  MealPurchaseDto,
} from './dto.types';

@Controller('school/library/books')
export class BookMetadataController {
  constructor(private readonly service: BookMetadataService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageLibrary) create(@Body() dto: CreateBookMetadataDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageLibrary) update(@Param('id') id: string, @Body() dto: UpdateBookMetadataDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageLibrary) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/library/copies')
export class BookCopyController {
  constructor(private readonly service: BookCopyService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageLibrary) create(@Body() dto: CreateBookCopyDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageLibrary) update(@Param('id') id: string, @Body() dto: UpdateBookCopyDto) { return this.service.update(id, dto); }
}

@Controller('school/library/borrowings')
export class BorrowingController {
  constructor(private readonly service: BorrowingService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Get('by-student/:studentProfileId') @RequirePermissions(PERMISSIONS.school.read) byStudent(@Param('studentProfileId') studentProfileId: string) {
    return this.service.byStudent(studentProfileId);
  }
  @Post('borrow') @RequirePermissions(PERMISSIONS.school.manageLibrary) borrow(@Body() dto: BorrowDto) {
    return this.service.borrow(dto.bookCopyId, dto.studentProfileId, new Date(dto.dueAt), dto.notes);
  }
  @Post(':id/return') @RequirePermissions(PERMISSIONS.school.manageLibrary) returnCopy(@Param('id') id: string) { return this.service.return(id); }
}

@Controller('school/transport/vehicles')
export class VehicleController {
  constructor(private readonly service: VehicleService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: CreateVehicleDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: UpdateVehicleDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/routes')
export class RouteController {
  constructor(private readonly service: RouteService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: CreateRouteDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: UpdateRouteDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/stops')
export class StopController {
  constructor(private readonly service: StopService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: CreateStopDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: UpdateStopDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/route-assignments')
export class RouteAssignmentController {
  constructor(private readonly service: RouteAssignmentService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageTransport) create(@Body() dto: CreateRouteAssignmentDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageTransport) update(@Param('id') id: string, @Body() dto: UpdateRouteAssignmentDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageTransport) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/transport/assignments')
export class StudentTransportAssignmentController {
  constructor(private readonly service: StudentTransportAssignmentService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get('by-student/:studentProfileId') @RequirePermissions(PERMISSIONS.school.read) byStudent(@Param('studentProfileId') studentProfileId: string) {
    return this.service.byStudent(studentProfileId);
  }
  @Post('assign') @RequirePermissions(PERMISSIONS.school.manageTransport) assign(@Body() dto: TransportAssignDto) {
    return this.service.assign(dto.studentProfileId, dto.routeId, dto.stopId, new Date(dto.startDate), dto.monthlyFee);
  }
}

@Controller('school/hostel/dormitories')
export class DormitoryController {
  constructor(private readonly service: DormitoryService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageHostel) create(@Body() dto: CreateDormitoryDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageHostel) update(@Param('id') id: string, @Body() dto: UpdateDormitoryDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageHostel) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/hostel/rooms')
export class RoomController {
  constructor(private readonly service: RoomService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageHostel) create(@Body() dto: CreateRoomDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageHostel) update(@Param('id') id: string, @Body() dto: UpdateRoomDto) { return this.service.update(id, dto); }
}

@Controller('school/hostel/beds')
export class BedController {
  constructor(private readonly service: BedService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageHostel) create(@Body() dto: CreateBedDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageHostel) update(@Param('id') id: string, @Body() dto: UpdateBedDto) { return this.service.update(id, dto); }
}

@Controller('school/hostel/allocations')
export class HostelAllocationController {
  constructor(private readonly service: HostelAllocationService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post('allocate') @RequirePermissions(PERMISSIONS.school.manageHostel) allocate(@Body() dto: HostelAllocateDto) {
    return this.service.allocate(dto.bedId, dto.studentProfileId, new Date(dto.startDate));
  }
  @Post(':id/checkout') @RequirePermissions(PERMISSIONS.school.manageHostel) checkout(@Param('id') id: string, @Body() dto: HostelCheckoutDto) {
    return this.service.checkout(id, new Date(dto.checkOutDate));
  }
}

@Controller('school/cafeteria/plans')
export class MealPlanController {
  constructor(private readonly service: MealPlanService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageCafeteria) create(@Body() dto: CreateMealPlanDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageCafeteria) update(@Param('id') id: string, @Body() dto: UpdateMealPlanDto) { return this.service.updatePlan(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageCafeteria) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/cafeteria/accounts')
export class MealAccountController {
  constructor(private readonly service: MealAccountService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post('top-up') @RequirePermissions(PERMISSIONS.school.manageCafeteria) topUp(@Body() dto: MealTopUpDto) {
    return this.service.topUp(dto.studentProfileId, dto.mealPlanId, dto.amount);
  }
  @Post('purchase') @RequirePermissions(PERMISSIONS.school.manageCafeteria) purchase(@Body() dto: MealPurchaseDto) {
    return this.service.purchase(dto.mealAccountId, dto.amount, dto.description, dto.paymentId);
  }
}
