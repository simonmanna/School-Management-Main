import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseInterceptors, HttpCode } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { TransportConfigService } from './transport-config.service';
import { TransportFleetService } from './transport-fleet.service';
import { TransportCrewService } from './transport-crew.service';
import { TransportEnrollmentService } from './transport-enrollment.service';
import { TransportScheduleService } from './transport-schedule.service';
import { TransportTripService } from './transport-trip.service';
import { TransportBoardingService } from './transport-boarding.service';
import { TransportSafetyService } from './transport-safety.service';
import { TransportBillingService } from './transport-billing.service';
import * as D from './dto.types';

const P = PERMISSIONS.school;

@Controller('school/transport')
export class TransportController {
  constructor(
    private readonly config: TransportConfigService,
    private readonly fleet: TransportFleetService,
    private readonly crew: TransportCrewService,
    private readonly enrollment: TransportEnrollmentService,
    private readonly schedule: TransportScheduleService,
    private readonly trips: TransportTripService,
    private readonly boarding: TransportBoardingService,
    private readonly safety: TransportSafetyService,
    private readonly billing: TransportBillingService,
  ) {}

  // ── Settings ──
  @Get('settings') @RequirePermissions(P.transportRead) getSettings() { return this.config.getSettings(); }
  @Post('settings') @RequirePermissions(P.manageTransport) @UseInterceptors(IdempotencyInterceptor) @Idempotent() upsertSettings(@Body() dto: D.UpsertTransportSettingsDto) { return this.config.upsertSettings(dto); }

  // ── Zones ──
  @Get('zones') @RequirePermissions(P.transportRead) listZones() { return this.config.listZones(); }
  @Post('zones') @RequirePermissions(P.manageTransport) createZone(@Body() dto: D.CreateTransportZoneDto) { return this.config.createZone(dto); }
  @Get('zones/:id') @RequirePermissions(P.transportRead) getZone(@Param('id') id: string) { return this.config.getZone(id); }
  @Patch('zones/:id') @RequirePermissions(P.manageTransport) updateZone(@Param('id') id: string, @Body() dto: D.UpdateTransportZoneDto) { return this.config.updateZone(id, dto); }
  @Delete('zones/:id') @HttpCode(204) @RequirePermissions(P.manageTransport) removeZone(@Param('id') id: string) { return this.config.removeZone(id); }

  // ── Stops ──
  @Get('stops') @RequirePermissions(P.transportRead) listStops() { return this.config.listStops(); }
  @Post('stops') @RequirePermissions(P.manageTransport) createStop(@Body() dto: D.CreateStopDto) { return this.config.createStop(dto); }
  @Get('stops/:id') @RequirePermissions(P.transportRead) getStop(@Param('id') id: string) { return this.config.getStop(id); }
  @Patch('stops/:id') @RequirePermissions(P.manageTransport) updateStop(@Param('id') id: string, @Body() dto: D.UpdateStopDto) { return this.config.updateStop(id, dto); }
  @Delete('stops/:id') @HttpCode(204) @RequirePermissions(P.manageTransport) removeStop(@Param('id') id: string) { return this.config.removeStop(id); }

  // ── Routes + versions ──
  @Get('routes') @RequirePermissions(P.transportRead) listRoutes() { return this.config.listRoutes(); }
  @Post('routes') @RequirePermissions(P.manageTransport) createRoute(@Body() dto: D.CreateRouteDto) { return this.config.createRoute(dto); }
  @Get('routes/:id') @RequirePermissions(P.transportRead) getRoute(@Param('id') id: string) { return this.config.getRoute(id); }
  @Patch('routes/:id') @RequirePermissions(P.manageTransport) updateRoute(@Param('id') id: string, @Body() dto: D.UpdateRouteDto) { return this.config.updateRoute(id, dto); }
  @Delete('routes/:id') @HttpCode(204) @RequirePermissions(P.manageTransport) removeRoute(@Param('id') id: string) { return this.config.removeRoute(id); }
  @Get('routes/:id/versions') @RequirePermissions(P.transportRead) listVersions(@Param('id') id: string) { return this.config.listVersions(id); }
  @Post('routes/:id/versions') @RequirePermissions(P.manageTransport) createVersion(@Param('id') id: string, @Body() dto: D.CreateRouteVersionDto) { return this.config.createVersion(id, dto); }
  @Get('routes/:id/versions/:vid') @RequirePermissions(P.transportRead) getVersion(@Param('id') id: string, @Param('vid') vid: string) { return this.config.getVersion(id, vid); }
  @Post('routes/:id/versions/:vid/publish') @RequirePermissions(P.manageTransport) publishVersion(@Param('id') id: string, @Param('vid') vid: string, @Body() dto: D.PublishRouteVersionDto) { return this.config.publishVersion(id, vid, dto); }
  @Post('routes/:id/versions/:vid/stops') @RequirePermissions(P.manageTransport) setVersionStops(@Param('id') id: string, @Param('vid') vid: string, @Body() dto: D.SetRouteStopsDto) { return this.config.setVersionStops(id, vid, dto); }

  // ── Vehicles ──
  @Get('vehicles') @RequirePermissions(P.transportRead) listVehicles() { return this.fleet.listVehicles(); }
  @Post('vehicles') @RequirePermissions(P.manageFleet) createVehicle(@Body() dto: D.CreateVehicleDto) { return this.fleet.createVehicle(dto); }
  @Get('vehicles/:id') @RequirePermissions(P.transportRead) getVehicle(@Param('id') id: string) { return this.fleet.getVehicle(id); }
  @Patch('vehicles/:id') @RequirePermissions(P.manageFleet) updateVehicle(@Param('id') id: string, @Body() dto: D.UpdateVehicleDto) { return this.fleet.updateVehicle(id, dto); }
  @Delete('vehicles/:id') @HttpCode(204) @RequirePermissions(P.manageFleet) removeVehicle(@Param('id') id: string) { return this.fleet.removeVehicle(id); }
  @Get('vehicles/:id/documents') @RequirePermissions(P.transportRead) listVehicleDocuments(@Param('id') id: string) { return this.fleet.listVehicleDocuments(id); }
  @Post('vehicles/:id/documents') @RequirePermissions(P.manageFleet) addVehicleDocument(@Param('id') id: string, @Body() dto: D.AddVehicleDocumentDto) { return this.fleet.addVehicleDocument(id, dto); }
  @Delete('vehicles/:id/documents/:docId') @HttpCode(204) @RequirePermissions(P.manageFleet) removeVehicleDocument(@Param('id') id: string, @Param('docId') docId: string) { return this.fleet.removeVehicleDocument(id, docId); }
  @Get('vehicles/:id/inspections') @RequirePermissions(P.transportRead) listInspections(@Param('id') id: string) { return this.fleet.listInspections(id); }
  @Post('vehicles/:id/inspections') @RequirePermissions(P.manageFleet) createInspection(@Param('id') id: string, @Body() dto: D.CreateInspectionDto) { return this.fleet.createInspection(dto); }

  // ── Crew ──
  @Get('crew') @RequirePermissions(P.transportRead) listCrew(@Query('role') role?: string) { return this.crew.listCrew(role); }
  @Post('crew') @RequirePermissions(P.manageCrew) createCrew(@Body() dto: D.CreateCrewMemberDto) { return this.crew.createCrew(dto); }
  @Get('crew/:id') @RequirePermissions(P.transportRead) getCrew(@Param('id') id: string) { return this.crew.getCrew(id); }
  @Patch('crew/:id') @RequirePermissions(P.manageCrew) updateCrew(@Param('id') id: string, @Body() dto: D.UpdateCrewMemberDto) { return this.crew.updateCrew(id, dto); }
  @Delete('crew/:id') @HttpCode(204) @RequirePermissions(P.manageCrew) removeCrew(@Param('id') id: string) { return this.crew.removeCrew(id); }
  @Get('crew/:id/documents') @RequirePermissions(P.transportRead) listCrewDocuments(@Param('id') id: string) { return this.crew.listDocuments(id); }
  @Post('crew/:id/documents') @RequirePermissions(P.manageCrew) addCrewDocument(@Param('id') id: string, @Body() dto: D.AddCrewDocumentDto) { return this.crew.addDocument(id, dto); }
  @Delete('crew/:id/documents/:docId') @HttpCode(204) @RequirePermissions(P.manageCrew) removeCrewDocument(@Param('id') id: string, @Param('docId') docId: string) { return this.crew.removeCrewDocument(id, docId); }

  // ── Enrollment: requests ──
  @Get('requests') @RequirePermissions(P.transportEnrollment) listRequests(@Query('status') status?: string) { return this.enrollment.listRequests(status); }
  @Post('requests') @RequirePermissions(P.transportEnrollment) createRequest(@Body() dto: D.CreateTransportRequestDto) { return this.enrollment.createRequest(dto); }
  @Get('requests/:id') @RequirePermissions(P.transportEnrollment) getRequest(@Param('id') id: string) { return this.enrollment.getRequest(id); }
  @Post('requests/:id/review') @RequirePermissions(P.transportEnrollment) reviewRequest(@Param('id') id: string, @Body() dto: D.ReviewTransportRequestDto) { return this.enrollment.review(id, dto); }

  // ── Enrollment: assignments ──
  @Get('assignments') @RequirePermissions(P.transportEnrollment) listAssignments(@Query('studentProfileId') studentProfileId?: string) { return this.enrollment.listAssignments(studentProfileId); }
  @Post('assignments') @RequirePermissions(P.transportEnrollment) createAssignment(@Body() dto: D.CreateAssignmentDto) { return this.enrollment.createAssignment(dto); }
  @Get('assignments/:id') @RequirePermissions(P.transportEnrollment) getAssignment(@Param('id') id: string) { return this.enrollment.getAssignment(id); }
  @Post('assignments/:id/reassign') @RequirePermissions(P.transportEnrollment) reassign(@Param('id') id: string, @Body() dto: D.CreateAssignmentDto) { return this.enrollment.reassign(id, dto); }
  @Patch('assignments/:id/status') @RequirePermissions(P.transportEnrollment) changeStatus(@Param('id') id: string, @Body() dto: D.ChangeAssignmentStatusDto) { return this.enrollment.changeStatus(id, dto); }
  @Get('students/:studentId/authorized-persons') @RequirePermissions(P.transportEnrollment) listAuthPersons(@Param('studentId') studentId: string) { return this.enrollment.listAuthorizedPersons(studentId); }
  @Post('students/:studentId/authorized-persons') @RequirePermissions(P.transportEnrollment) addAuthPerson(@Param('studentId') studentId: string, @Body() dto: D.CreateAuthorizedPersonDto) { return this.enrollment.addAuthorizedPerson(studentId, dto); }
  @Delete('students/:studentId/authorized-persons/:pid') @HttpCode(204) @RequirePermissions(P.transportEnrollment) removeAuthPerson(@Param('studentId') studentId: string, @Param('pid') pid: string) { return this.enrollment.removeAuthorizedPerson(studentId, pid); }
  @Get('students/:studentId/special-requirements') @RequirePermissions(P.transportEnrollment) listSpecial(@Param('studentId') studentId: string) { return this.enrollment.listSpecialRequirements(studentId); }
  @Post('students/:studentId/special-requirements') @RequirePermissions(P.transportEnrollment) addSpecial(@Param('studentId') studentId: string, @Body() body: { kind: string; notes: string; validFrom?: string; validTo?: string }) { return this.enrollment.addSpecialRequirement(studentId, body.kind, body.notes, body.validFrom, body.validTo); }
  @Delete('students/:studentId/special-requirements/:rid') @HttpCode(204) @RequirePermissions(P.transportEnrollment) removeSpecial(@Param('studentId') studentId: string, @Param('rid') rid: string) { return this.enrollment.removeSpecialRequirement(studentId, rid); }

  // ── Schedules ──
  @Get('schedules') @RequirePermissions(P.transportRead) listSchedules() { return this.schedule.listSchedules(); }
  @Post('schedules') @RequirePermissions(P.manageTransport) createSchedule(@Body() dto: D.CreateScheduleDto) { return this.schedule.createSchedule(dto); }
  @Get('schedules/:id') @RequirePermissions(P.transportRead) getSchedule(@Param('id') id: string) { return this.schedule.getSchedule(id); }
  @Patch('schedules/:id') @RequirePermissions(P.manageTransport) updateSchedule(@Param('id') id: string, @Body() dto: Partial<D.CreateScheduleDto>) { return this.schedule.updateSchedule(id, dto); }
  @Delete('schedules/:id') @HttpCode(204) @RequirePermissions(P.manageTransport) removeSchedule(@Param('id') id: string) { return this.schedule.removeSchedule(id); }
  @Post('schedules/:id/exceptions') @RequirePermissions(P.manageTransport) addException(@Param('id') id: string, @Body() dto: D.CreateScheduleExceptionDto) { return this.schedule.addException(id, dto); }
  @Post('schedules/generate') @RequirePermissions(P.manageTransport) generateTrips(@Body() body: { from?: string; horizonDays?: number }) { return this.trips.generate(body.from ? new Date(body.from) : new Date(), body.horizonDays ?? 7); }

  // ── Trips ──
  @Get('trips') @RequirePermissions(P.transportDispatch) listTrips(@Query('date') date?: string) { return this.trips.listTrips(date); }
  @Get('trips/:id') @RequirePermissions(P.transportDispatch) getTrip(@Param('id') id: string) { return this.trips.getTrip(id); }
  @Post('trips/:id/dispatch') @RequirePermissions(P.transportDispatch) dispatch(@Param('id') id: string, @Body() dto: D.DispatchTripDto) { return this.trips.dispatch(id, dto); }
  @Post('trips/:id/start') @RequirePermissions(P.transportDispatch) start(@Param('id') id: string) { return this.trips.start(id); }
  @Post('trips/:id/arrive-stop') @RequirePermissions(P.transportDispatch) arriveStop(@Param('id') id: string, @Body() body: { stopId: string }) { return this.trips.arriveStop(id, body.stopId); }
  @Post('trips/:id/depart-stop') @RequirePermissions(P.transportDispatch) departStop(@Param('id') id: string, @Body() dto: D.TripStopTimeDto) { return this.trips.departStop(id, dto.stopId, dto); }
  @Post('trips/:id/cancel') @RequirePermissions(P.transportDispatch) cancel(@Param('id') id: string, @Body() dto: D.TripActionDto) { return this.trips.cancel(id, dto); }
  @Post('trips/:id/abort') @RequirePermissions(P.transportDispatch) abort(@Param('id') id: string, @Body() dto: D.TripActionDto) { return this.trips.abort(id, dto); }
  @Post('trips/:id/complete') @RequirePermissions(P.transportDispatch) complete(@Param('id') id: string, @Body() dto: D.CompleteTripDto) { return this.trips.complete(id, dto); }

  // ── Boarding (driver PWA sync) ──
  @Post('driver/sync') @RequirePermissions(P.transportDriverApp) @UseInterceptors(IdempotencyInterceptor) @Idempotent() sync(@Body() dto: D.DriverSyncDto) { return this.boarding.sync(dto); }
  @Get('trips/:id/boarding') @RequirePermissions(P.transportBoarding) listBoarding(@Param('id') id: string) { return this.boarding.listEvents(id); }

  // ── Safety ──
  @Get('incidents') @RequirePermissions(P.transportIncidents) listIncidents(@Query('status') status?: string) { return this.safety.listIncidents(status); }
  @Post('incidents') @RequirePermissions(P.transportIncidents) createIncident(@Body() dto: D.CreateIncidentDto) { return this.safety.createIncident(dto); }
  @Get('incidents/:id') @RequirePermissions(P.transportIncidents) getIncident(@Param('id') id: string) { return this.safety.getIncident(id); }
  @Post('incidents/:id/actions') @RequirePermissions(P.transportIncidents) addAction(@Param('id') id: string, @Body() dto: D.AddIncidentActionDto) { return this.safety.addAction(id, dto); }
  @Post('incidents/:id/resolve') @RequirePermissions(P.transportIncidents) resolveIncident(@Param('id') id: string, @Body() body: { resolutionNotes: string }) { return this.safety.resolve(id, body.resolutionNotes); }
  @Post('trips/:id/end-of-trip-check') @RequirePermissions(P.transportDispatch) setEot(@Param('id') id: string, @Body() dto: D.EndOfTripCheckDto) { return this.safety.setEndOfTripCheck(id, dto); }

  // ── Billing ──
  @Get('fee-plans') @RequirePermissions(P.transportBilling) listFeePlans() { return this.billing.listFeePlans(); }
  @Post('fee-plans') @RequirePermissions(P.transportBilling) createFeePlan(@Body() dto: D.CreateFeePlanDto) { return this.billing.createFeePlan(dto); }
  @Post('fee-plans/:id/rates') @RequirePermissions(P.transportBilling) addRate(@Param('id') id: string, @Body() dto: D.CreateFeePlanRateDto) { return this.billing.addRate(id, dto); }
  @Post('billing/generate') @RequirePermissions(P.transportBilling) generateCharges(@Body() dto: D.GenerateChargesDto) { return this.billing.generateForPeriod(dto); }
}
