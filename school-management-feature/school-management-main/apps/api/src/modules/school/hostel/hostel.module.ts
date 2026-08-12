import { Module } from '@nestjs/common';
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
} from '../library/library-transport-hostel-cafeteria.service';
import {
  BedController,
  DormitoryController,
  HostelAllocationController,
  MealAccountController,
  MealPlanController,
  RoomController,
} from '../library/library-transport-hostel-cafeteria.controller';

@Module({
  controllers: [DormitoryController, RoomController, BedController, HostelAllocationController, MealPlanController, MealAccountController],
  providers: [
    DormitoryService,
    RoomService,
    BedService,
    HostelAllocationService,
    MealPlanService,
    MealAccountService,
  ],
  exports: [
    DormitoryService,
    RoomService,
    BedService,
    HostelAllocationService,
    MealPlanService,
    MealAccountService,
  ],
})
export class HostelModule {}