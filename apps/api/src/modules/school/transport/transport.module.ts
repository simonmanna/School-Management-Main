import { Module } from '@nestjs/common';
import {
  RouteAssignmentService,
  RouteService,
  StopService,
  StudentTransportAssignmentService,
  VehicleService,
} from '../library/library-transport-hostel-cafeteria.service';
import {
  RouteAssignmentController,
  RouteController,
  StopController,
  StudentTransportAssignmentController,
  VehicleController,
} from '../library/library-transport-hostel-cafeteria.controller';

@Module({
  controllers: [VehicleController, RouteController, StopController, RouteAssignmentController, StudentTransportAssignmentController],
  providers: [
    VehicleService,
    RouteService,
    StopService,
    RouteAssignmentService,
    StudentTransportAssignmentService,
  ],
  exports: [VehicleService, RouteService, StopService, RouteAssignmentService, StudentTransportAssignmentService],
})
export class TransportModule {}