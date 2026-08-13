import { Module } from '@nestjs/common';
// Only the hostel + cafeteria services this module actually provides. (The file
// also exports library/transport services; those belong to their own modules.)
import {
  DormitoryService,
  HostelAllocationService,
  MealAccountService,
  MealPlanService,
  RoomService,
  BedService,
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