/**
 * DTOs for the School Transport Management System (STMS).
 * class-validator classes — import as values. Mirrors the library/meals DTO
 * conventions (IsString/IsIn/IsOptional/ValidateNested + Type).
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Config / Settings ──
export class UpsertTransportSettingsDto {
  @IsOptional() @IsArray() @IsInt({ each: true }) operatingDays?: number[];
  @IsOptional() @IsInt() @Min(0) pickupGraceMin?: number;
  @IsOptional() @IsInt() @Min(0) dropoffGraceMin?: number;
  @IsOptional() @IsInt() @Min(0) lateThresholdMin?: number;
  @IsOptional() @IsInt() @Min(0) maxRouteDurationMin?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) boardingMethodsEnabled?: string[];
  @IsOptional() @IsInt() @Min(0) deviationThresholdM?: number;
  @IsOptional() @IsInt() @Min(0) speedThresholdKph?: number;
  @IsOptional() @IsInt() @Min(0) geofenceDefaultRadiusM?: number;
  @IsOptional() @IsBoolean() notifyAbsenceCancelsPickup?: boolean;
  @IsOptional() @IsBoolean() billingSuspensionEnabled?: boolean;
}

// ── Zones ──
export class CreateTransportZoneDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsObject() boundary?: Record<string, unknown>;
}
export class UpdateTransportZoneDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsObject() boundary?: Record<string, unknown>;
}

// ── Stops (standalone location) ──
export class CreateStopDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() landmark?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsBoolean() pickupAllowed?: boolean;
  @IsOptional() @IsBoolean() dropoffAllowed?: boolean;
  @IsOptional() @IsInt() @Min(0) geofenceRadiusM?: number;
  @IsOptional() @IsString() safetyNotes?: string;
  @IsOptional() @IsIn(['active', 'inactive', 'retired']) status?: string;
}
export class UpdateStopDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() landmark?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsBoolean() pickupAllowed?: boolean;
  @IsOptional() @IsBoolean() dropoffAllowed?: boolean;
  @IsOptional() @IsInt() @Min(0) geofenceRadiusM?: number;
  @IsOptional() @IsString() safetyNotes?: string;
  @IsOptional() @IsIn(['active', 'inactive', 'retired']) status?: string;
}

// ── Routes ──
export class CreateRouteDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsIn(['inbound', 'outbound', 'loop']) direction?: string;
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsIn(['draft', 'planned', 'active', 'suspended', 'retired']) status?: string;
  @IsOptional() @IsInt() @Min(0) estimatedDurationMin?: number;
  @IsOptional() @IsNumber() distanceKm?: number;
  @IsOptional() @IsNumber() @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() feeProductId?: string;
}
export class UpdateRouteDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsIn(['inbound', 'outbound', 'loop']) direction?: string;
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsIn(['draft', 'planned', 'active', 'suspended', 'retired']) status?: string;
  @IsOptional() @IsInt() @Min(0) estimatedDurationMin?: number;
  @IsOptional() @IsNumber() distanceKm?: number;
  @IsOptional() @IsNumber() @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() feeProductId?: string;
}

// ── Route versions ──
export class CreateRouteVersionDto {
  @IsInt() @Min(1) versionNo!: number;
  @IsString() @IsNotEmpty() effectiveFrom!: string;
  @IsOptional() @IsString() effectiveTo?: string;
  @IsOptional() @IsIn(['draft', 'planned', 'active', 'suspended', 'retired']) status?: string;
  @IsOptional() @IsString() notes?: string;
}
export class PublishRouteVersionDto {
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() effectiveTo?: string;
}

// ── Route stops (version-scoped) ──
export class TransportRouteStopInput {
  @IsString() @IsNotEmpty() stopId!: string;
  @IsInt() @Min(1) sequence!: number;
  @IsOptional() @IsString() plannedArrival?: string; // 'HH:mm'
  @IsOptional() @IsString() plannedDeparture?: string; // 'HH:mm'
  @IsOptional() @IsBoolean() pickupAllowed?: boolean;
  @IsOptional() @IsBoolean() dropoffAllowed?: boolean;
  @IsOptional() @IsInt() @Min(0) studentCapacity?: number;
  @IsOptional() @IsNumber() distanceFromPrevKm?: number;
  @IsOptional() @IsNumber() feeOverride?: number;
}
export class SetRouteStopsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => TransportRouteStopInput) stops!: TransportRouteStopInput[];
}

// ── Vehicles ──
export class CreateVehicleDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() plateNumber!: string;
  @IsOptional() @IsString() fleetNumber?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsInt() year?: number;
  @IsOptional() @IsString() fuelType?: string;
  @IsOptional() @IsInt() @Min(0) seatedCapacity?: number;
  @IsOptional() @IsInt() @Min(0) wheelchairCapacity?: number;
  @IsOptional() @IsInt() @Min(0) operationalCapacity?: number;
  @IsOptional() @IsIn(['owned', 'leased', 'provider']) ownership?: string;
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsIn(['available', 'assigned', 'in_service', 'maintenance', 'out_of_service', 'accident', 'retired']) status?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() driverPartnerId?: string;
}
export class UpdateVehicleDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() plateNumber?: string;
  @IsOptional() @IsString() fleetNumber?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsInt() year?: number;
  @IsOptional() @IsString() fuelType?: string;
  @IsOptional() @IsInt() @Min(0) seatedCapacity?: number;
  @IsOptional() @IsInt() @Min(0) wheelchairCapacity?: number;
  @IsOptional() @IsInt() @Min(0) operationalCapacity?: number;
  @IsOptional() @IsIn(['owned', 'leased', 'provider']) ownership?: string;
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsIn(['available', 'assigned', 'in_service', 'maintenance', 'out_of_service', 'accident', 'retired']) status?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() driverPartnerId?: string;
}

// ── Vehicle documents ──
export class AddVehicleDocumentDto {
  @IsString() @IsNotEmpty() documentType!: string;
  @IsString() @IsNotEmpty() documentNumber!: string;
  @IsOptional() @IsString() issueDate?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsString() fileId?: string;
}

// ── Crew ──
export class CreateCrewMemberDto {
  @IsOptional() @IsString() staffProfileId?: string;
  @IsOptional() @IsString() partnerId?: string;
  @IsIn(['driver', 'attendant', 'supervisor', 'coordinator']) role!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() licenseNumber?: string;
  @IsOptional() @IsString() licenseClass?: string;
  @IsOptional() @IsString() licenseExpiry?: string;
  @IsOptional() @IsObject() emergencyContact?: Record<string, unknown>;
  @IsOptional() @IsIn(['active', 'suspended', 'on_leave', 'inactive']) status?: string;
}
export class UpdateCrewMemberDto {
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsIn(['driver', 'attendant', 'supervisor', 'coordinator']) role?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() licenseNumber?: string;
  @IsOptional() @IsString() licenseClass?: string;
  @IsOptional() @IsString() licenseExpiry?: string;
  @IsOptional() @IsObject() emergencyContact?: Record<string, unknown>;
  @IsOptional() @IsIn(['active', 'suspended', 'on_leave', 'inactive']) status?: string;
}
export class AddCrewDocumentDto {
  @IsString() @IsNotEmpty() documentType!: string;
  @IsString() @IsNotEmpty() documentNumber!: string;
  @IsOptional() @IsString() issueDate?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsString() fileId?: string;
}

// ── Enrollment: requests ──
export class CreateTransportRequestDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsIn(['new', 'change_stop', 'suspend', 'resume', 'cancel', 'temporary']) type?: string;
  @IsOptional() @IsString() requestedRouteId?: string;
  @IsOptional() @IsString() requestedStopId?: string;
  @IsOptional() @IsString() requestedStartDate?: string;
  @IsOptional() @IsString() requestedEndDate?: string;
  @IsOptional() @IsString() notes?: string;
}
export class ReviewTransportRequestDto {
  @IsIn(['approved', 'rejected', 'under_review']) decision!: string;
  @IsOptional() @IsString() decisionNotes?: string;
  @IsOptional() @IsString() requestedStopId?: string;
  @IsOptional() @IsString() requestedStartDate?: string;
  @IsOptional() @IsString() requestedEndDate?: string;
}

// ── Enrollment: assignments ──
export class CreateAssignmentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() routeId!: string;
  @IsString() @IsNotEmpty() stopId!: string;
  @IsOptional() @IsString() pickupStopId?: string;
  @IsOptional() @IsString() dropoffStopId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsIn(['morning_only', 'afternoon_only', 'both']) serviceMode?: string;
  @IsOptional() @IsIn(['permanent', 'temporary']) assignmentType?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) daysOfWeek?: number[];
  @IsOptional() @IsNumber() @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() requestId?: string;
}
export class ChangeAssignmentStatusDto {
  @IsIn(['pending', 'active', 'suspended', 'ended', 'cancelled']) status!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() endDate?: string;
}

// ── Authorized persons / special requirements ──
export class CreateAuthorizedPersonDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() relationship!: string;
  @IsOptional() @IsString() stopId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() photoFileId?: string;
  @IsOptional() @IsString() idType?: string;
  @IsOptional() @IsString() idNumber?: string;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() verificationMethod?: string;
}

// ── Schedules ──
export class CreateScheduleDto {
  @IsString() @IsNotEmpty() routeVersionId!: string;
  @IsIn(['inbound', 'outbound', 'loop']) direction!: string;
  @IsArray() @IsInt({ each: true }) daysOfWeek!: number[];
  @IsString() @IsNotEmpty() departureTime!: string; // 'HH:mm'
  @IsOptional() @IsString() defaultVehicleId?: string;
  @IsOptional() @IsString() defaultCrewDriverId?: string;
  @IsOptional() @IsString() defaultCrewAttendantId?: string;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;
  @IsOptional() @IsIn(['draft', 'planned', 'active', 'suspended', 'retired']) status?: string;
}
export class CreateScheduleExceptionDto {
  @IsString() @IsNotEmpty() date!: string;
  @IsIn(['no_service', 'time_change', 'route_change', 'extra_service']) kind!: string;
  @IsOptional() @IsString() newDepartureTime?: string;
  @IsOptional() @IsString() newRouteVersionId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() calendarEventId?: string;
}

// ── Trips ──
export class DispatchTripDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() driverCrewId?: string;
  @IsOptional() @IsString() attendantCrewId?: string;
}
export class TripStopTimeDto {
  @IsString() @IsNotEmpty() stopId!: string;
  @IsOptional() @IsString() actualArrival?: string;
  @IsOptional() @IsString() actualDeparture?: string;
  @IsOptional() @IsBoolean() skipped?: boolean;
  @IsOptional() @IsString() skipReason?: string;
}
export class TripActionDto {
  @IsOptional() @IsString() reason?: string;
}
export class CompleteTripDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() overrideUnaccounted?: boolean;
}

// ── Boarding (driver PWA sync batch) ──
export class BoardingEventInput {
  @IsString() @IsNotEmpty() clientEventId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() stopId?: string;
  @IsIn(['board', 'drop_off', 'absent', 'no_show', 'refused', 'manual_override']) eventType!: string;
  @IsOptional() @IsIn(['manual', 'qr', 'rfid', 'barcode', 'mobile', 'automated']) source?: string;
  @IsOptional() @IsString() occurredAt?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() releasedToPersonId?: string;
  @IsOptional() @IsInt() @Min(0) sequence?: number;
}
export class DriverSyncDto {
  @IsString() @IsNotEmpty() tripId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BoardingEventInput) events!: BoardingEventInput[];
}

// ── Inspections ─
export class CreateInspectionDto {
  @IsString() @IsNotEmpty() vehicleId!: string;
  @IsString() @IsNotEmpty() inspectedByCrewId!: string;
  @IsString() @IsNotEmpty() date!: string;
  @IsOptional() @IsNumber() @Min(0) odometerKm?: number;
  @IsOptional() @IsIn(['pass', 'fail']) result?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InspectionItemInput) items?: InspectionItemInput[];
}
export class InspectionItemInput {
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsBoolean() isCritical?: boolean;
  @IsOptional() @IsIn(['pass', 'fail', 'na']) result?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── Incidents ─
export class CreateIncidentDto {
  @IsOptional() @IsIn(['accident', 'breakdown', 'medical', 'student_behavior', 'missing_student', 'unauthorized_pickup', 'vehicle_failure', 'route_deviation', 'speeding', 'emergency', 'other']) type?: string;
  @IsOptional() @IsIn(['low', 'medium', 'high', 'critical']) severity?: string;
  @IsOptional() @IsString() tripId?: string;
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() crewMemberId?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) studentProfileIds?: string[];
}
export class AddIncidentActionDto {
  @IsString() @IsNotEmpty() action!: string;
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() fileId?: string;
}

// ── End-of-trip check ─
export class EndOfTripCheckDto {
  @IsObject() checklist!: Record<string, unknown>;
  @IsString() @IsNotEmpty() confirmedByCrewId!: string;
}

// ── Fee plans ─
export class CreateFeePlanDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsIn(['flat', 'zone', 'route', 'stop', 'distance']) basis!: string;
  @IsIn(['monthly', 'termly', 'yearly', 'per_trip']) period!: string;
  @IsNumber() @Min(0) baseAmount!: number;
  @IsOptional() @IsNumber() oneWayFactor?: number;
  @IsOptional() @IsNumber() ratePerKm?: number;
  @IsOptional() @IsString() feeProductId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateFeePlanRateDto {
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsString() routeId?: string;
  @IsOptional() @IsString() stopId?: string;
  @IsNumber() @Min(0) amount!: number;
}
export class GenerateChargesDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsString() periodStart?: string;
  @IsOptional() @IsString() periodEnd?: string;
}

// ── GPS ingest ──
export class GpsPointInput {
  @IsString() @IsNotEmpty() vehicleId!: string;
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
  @IsOptional() @IsString() tripId?: string;
  @IsOptional() @IsNumber() speedKph?: number;
  @IsOptional() @IsInt() headingDeg?: number;
  @IsOptional() @IsInt() @Min(0) accuracyM?: number;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() recordedAt?: string;
}
export class GpsIngestDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => GpsPointInput) points!: GpsPointInput[];
}
