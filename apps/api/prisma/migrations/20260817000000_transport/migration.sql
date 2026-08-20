-- CreateEnum
CREATE TYPE "TransportOwnership" AS ENUM ('owned', 'leased', 'provider');

-- CreateEnum
CREATE TYPE "TransportVehicleStatus" AS ENUM ('available', 'assigned', 'in_service', 'maintenance', 'out_of_service', 'accident', 'retired');

-- CreateEnum
CREATE TYPE "TransportRouteStatus" AS ENUM ('draft', 'planned', 'active', 'suspended', 'retired');

-- CreateEnum
CREATE TYPE "TransportDirection" AS ENUM ('inbound', 'outbound', 'loop');

-- CreateEnum
CREATE TYPE "TransportStopStatus" AS ENUM ('active', 'inactive', 'retired');

-- CreateEnum
CREATE TYPE "TransportServiceMode" AS ENUM ('morning_only', 'afternoon_only', 'both');

-- CreateEnum
CREATE TYPE "TransportAssignmentType" AS ENUM ('permanent', 'temporary');

-- CreateEnum
CREATE TYPE "TransportAssignmentStatus" AS ENUM ('pending', 'active', 'suspended', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "TransportCrewRole" AS ENUM ('driver', 'attendant', 'supervisor', 'coordinator');

-- CreateEnum
CREATE TYPE "TransportCrewStatus" AS ENUM ('active', 'suspended', 'on_leave', 'inactive');

-- CreateEnum
CREATE TYPE "TransportRequestType" AS ENUM ('new', 'change_stop', 'suspend', 'resume', 'cancel', 'temporary');

-- CreateEnum
CREATE TYPE "TransportRequestStatus" AS ENUM ('submitted', 'under_review', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "TransportScheduleExceptionKind" AS ENUM ('no_service', 'time_change', 'route_change', 'extra_service');

-- CreateEnum
CREATE TYPE "TransportTripStatus" AS ENUM ('scheduled', 'ready', 'dispatched', 'en_route', 'at_stop', 'completed', 'cancelled', 'aborted');

-- CreateEnum
CREATE TYPE "TransportPassengerStatus" AS ENUM ('expected', 'boarded', 'no_show', 'dropped_off', 'excused', 'cancelled');

-- CreateEnum
CREATE TYPE "TransportBoardingEventType" AS ENUM ('board', 'drop_off', 'absent', 'no_show', 'refused', 'manual_override');

-- CreateEnum
CREATE TYPE "TransportBoardingSource" AS ENUM ('manual', 'qr', 'rfid', 'barcode', 'mobile', 'automated');

-- CreateEnum
CREATE TYPE "TransportInspectionResult" AS ENUM ('pass', 'fail');

-- CreateEnum
CREATE TYPE "TransportInspectionItemResult" AS ENUM ('pass', 'fail', 'na');

-- CreateEnum
CREATE TYPE "TransportFeeBasis" AS ENUM ('flat', 'zone', 'route', 'stop', 'distance');

-- CreateEnum
CREATE TYPE "TransportFeePeriod" AS ENUM ('monthly', 'termly', 'yearly', 'per_trip');

-- CreateEnum
CREATE TYPE "TransportChargeStatus" AS ENUM ('pending', 'invoiced', 'cancelled');

-- CreateEnum
CREATE TYPE "TransportIncidentType" AS ENUM ('accident', 'breakdown', 'medical', 'student_behavior', 'missing_student', 'unauthorized_pickup', 'vehicle_failure', 'route_deviation', 'speeding', 'emergency', 'other');

-- CreateEnum
CREATE TYPE "TransportIncidentSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "TransportIncidentStatus" AS ENUM ('open', 'investigating', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TransportGeofenceKind" AS ENUM ('school', 'stop', 'zone', 'corridor', 'restricted');

-- CreateEnum
CREATE TYPE "TransportGeofenceEventType" AS ENUM ('entered', 'left');

-- CreateEnum
CREATE TYPE "TransportTrackingAlertKind" AS ENUM ('route_deviation', 'speed_violation', 'prolonged_stop', 'no_signal');

-- CreateEnum
CREATE TYPE "TransportTrackingAlertSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "TransportDeviceKind" AS ENUM ('hardware', 'phone');

-- DropForeignKey
ALTER TABLE "FeeCredit" DROP CONSTRAINT "FeeCredit_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsorship" DROP CONSTRAINT "Sponsorship_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Stop" DROP CONSTRAINT "Stop_routeId_fkey";

-- DropForeignKey
ALTER TABLE "Waiver" DROP CONSTRAINT "Waiver_organizationId_fkey";

-- DropIndex
DROP INDEX "FeeCredit_organizationId_code_key";

-- DropIndex
DROP INDEX "Stop_organizationId_routeId_name_key";

-- DropIndex
DROP INDEX "TimetableSlot_room_idx";

-- DropIndex
DROP INDEX "TimetableSlot_subjectId_idx";

-- DropIndex
DROP INDEX "TimetableSlot_teacherPartnerId_idx";

-- DropIndex
DROP INDEX "Waiver_organizationId_code_key";

-- AlterTable
ALTER TABLE "CustomField" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FeeCredit" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "remaining" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "source" SET DEFAULT 'overpayment',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReportCard" ADD COLUMN     "classTeacherComment" TEXT,
ADD COLUMN     "competencyLevels" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "principalComment" TEXT;

-- AlterTable
ALTER TABLE "Route" DROP COLUMN "isActive",
ADD COLUMN     "academicYearId" TEXT,
ADD COLUMN     "campusId" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "direction" "TransportDirection" NOT NULL DEFAULT 'inbound',
ADD COLUMN     "distanceKm" DECIMAL(20,6),
ADD COLUMN     "estimatedDurationMin" INTEGER,
ADD COLUMN     "serviceType" TEXT NOT NULL DEFAULT 'morning',
ADD COLUMN     "status" "TransportRouteStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "monthlyFee" SET DATA TYPE DECIMAL(20,6);

-- AlterTable
ALTER TABLE "SchoolPolicy" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sponsorship" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "capAmount" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Stop" DROP COLUMN "dropoffTime",
DROP COLUMN "feeOverride",
DROP COLUMN "location",
DROP COLUMN "order",
DROP COLUMN "pickupTime",
DROP COLUMN "routeId",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "campusId" TEXT,
ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "dropoffAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "geofenceRadiusM" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "pickupAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "safetyNotes" TEXT,
ADD COLUMN     "status" "TransportStopStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "updatedBy" TEXT,
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "StudentTransportAssignment" DROP COLUMN "isActive",
ADD COLUMN     "academicYearId" TEXT,
ADD COLUMN     "assignmentType" "TransportAssignmentType" NOT NULL DEFAULT 'permanent',
ADD COLUMN     "campusId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "dropoffStopId" TEXT,
ADD COLUMN     "pickupStopId" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "serviceMode" "TransportServiceMode" NOT NULL DEFAULT 'both',
ADD COLUMN     "status" "TransportAssignmentStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "monthlyFee" SET DATA TYPE DECIMAL(20,6);

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "capacity",
DROP COLUMN "isActive",
ADD COLUMN     "campusId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "fleetNumber" TEXT,
ADD COLUMN     "fuelType" TEXT,
ADD COLUMN     "make" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "odometerKm" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "operationalCapacity" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "ownership" "TransportOwnership" NOT NULL DEFAULT 'owned',
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "seatedCapacity" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "status" "TransportVehicleStatus" NOT NULL DEFAULT 'available',
ADD COLUMN     "updatedBy" TEXT,
ADD COLUMN     "wheelchairCapacity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "year" INTEGER;

-- AlterTable
ALTER TABLE "Waiver" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(20,6),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Invigilator" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffId" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invigilator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvigilatorAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "examScheduleId" TEXT NOT NULL,
    "invigilatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvigilatorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningOutcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectId" TEXT,
    "topicId" TEXT,
    "competencyId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "expectedLevel" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LearningOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentOutcomeAchievement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "learningOutcomeId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'not_met',
    "masteryPercent" INTEGER,
    "comment" TEXT,
    "assessedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentOutcomeAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionPaper" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "examScheduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "paperKind" TEXT NOT NULL DEFAULT 'theory',
    "paperNumber" INTEGER,
    "totalMarks" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "fileUrl" TEXT,
    "setterId" TEXT,
    "moderatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuestionPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "operatingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "pickupGraceMin" INTEGER NOT NULL DEFAULT 5,
    "dropoffGraceMin" INTEGER NOT NULL DEFAULT 5,
    "lateThresholdMin" INTEGER NOT NULL DEFAULT 10,
    "maxRouteDurationMin" INTEGER,
    "boardingMethodsEnabled" JSONB NOT NULL DEFAULT '["manual","qr","rfid","barcode","mobile"]',
    "deviationThresholdM" INTEGER NOT NULL DEFAULT 150,
    "speedThresholdKph" INTEGER NOT NULL DEFAULT 80,
    "geofenceDefaultRadiusM" INTEGER NOT NULL DEFAULT 100,
    "notifyAbsenceCancelsPickup" BOOLEAN NOT NULL DEFAULT false,
    "billingSuspensionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "TransportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportZone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campusId" TEXT,
    "boundary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRouteVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "TransportRouteStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportRouteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRouteStop" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedArrival" TEXT,
    "plannedDeparture" TEXT,
    "pickupAllowed" BOOLEAN NOT NULL DEFAULT true,
    "dropoffAllowed" BOOLEAN NOT NULL DEFAULT true,
    "studentCapacity" INTEGER,
    "distanceFromPrevKm" DECIMAL(20,6),
    "feeOverride" DECIMAL(20,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportRouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportCrewMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffProfileId" TEXT,
    "partnerId" TEXT,
    "role" "TransportCrewRole" NOT NULL DEFAULT 'driver',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "licenseNumber" TEXT,
    "licenseClass" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "emergencyContact" JSONB,
    "status" "TransportCrewStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportCrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportCrewDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportCrewDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportVehicleDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportVehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "type" "TransportRequestType" NOT NULL DEFAULT 'new',
    "requestedRouteId" TEXT,
    "requestedStopId" TEXT,
    "requestedStartDate" TIMESTAMP(3),
    "requestedEndDate" TIMESTAMP(3),
    "notes" TEXT,
    "status" "TransportRequestStatus" NOT NULL DEFAULT 'submitted',
    "reviewedById" TEXT,
    "decisionNotes" TEXT,
    "assignmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "TransportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportAuthorizedPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "stopId" TEXT,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT,
    "photoFileId" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verificationMethod" TEXT NOT NULL DEFAULT 'visual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportAuthorizedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportSpecialRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "notes" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportSpecialRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "routeId" TEXT,
    "direction" "TransportDirection" NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "departureTime" TEXT NOT NULL,
    "defaultVehicleId" TEXT,
    "defaultCrewDriverId" TEXT,
    "defaultCrewAttendantId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" "TransportRouteStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportScheduleException" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" "TransportScheduleExceptionKind" NOT NULL,
    "newDepartureTime" TEXT,
    "newRouteVersionId" TEXT,
    "reason" TEXT,
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTrip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "routeVersionId" TEXT NOT NULL,
    "routeId" TEXT,
    "direction" "TransportDirection" NOT NULL,
    "vehicleId" TEXT,
    "driverCrewId" TEXT,
    "attendantCrewId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "TransportTripStatus" NOT NULL DEFAULT 'scheduled',
    "plannedDeparture" TIMESTAMP(3),
    "plannedArrival" TIMESTAMP(3),
    "actualDeparture" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "odometerStart" DECIMAL(20,6),
    "odometerEnd" DECIMAL(20,6),
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "inspectionId" TEXT,
    "endOfTripCheckedAt" TIMESTAMP(3),
    "endOfTripCheckedById" TEXT,
    "unaccountedCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "TransportTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTripStop" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedArrival" TIMESTAMP(3),
    "plannedDeparture" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "actualDeparture" TIMESTAMP(3),
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "boardedCount" INTEGER NOT NULL DEFAULT 0,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportTripStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTripPassenger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "pickupStopId" TEXT,
    "dropoffStopId" TEXT,
    "assignmentId" TEXT,
    "status" "TransportPassengerStatus" NOT NULL DEFAULT 'expected',
    "specialRequirementsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportTripPassenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportBoardingEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "stopId" TEXT,
    "assignmentId" TEXT,
    "eventType" "TransportBoardingEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "TransportBoardingSource" NOT NULL DEFAULT 'manual',
    "deviceId" TEXT,
    "recordedById" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "reason" TEXT,
    "releasedToPersonId" TEXT,
    "clientEventId" TEXT,
    "clientRecordedAt" TIMESTAMP(3),
    "sequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportBoardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportVehicleInspection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "inspectedByCrewId" TEXT NOT NULL,
    "result" "TransportInspectionResult" NOT NULL DEFAULT 'pass',
    "odometerKm" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportVehicleInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportInspectionItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "result" "TransportInspectionItemResult" NOT NULL DEFAULT 'pass',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportInspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTripEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorId" TEXT,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportTripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportFeePlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campusId" TEXT,
    "academicYearId" TEXT,
    "basis" "TransportFeeBasis" NOT NULL DEFAULT 'flat',
    "period" "TransportFeePeriod" NOT NULL DEFAULT 'monthly',
    "baseAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "oneWayFactor" DECIMAL(9,4) NOT NULL DEFAULT 0.6,
    "ratePerKm" DECIMAL(20,6),
    "feeProductId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportFeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportFeePlanRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "feePlanId" TEXT NOT NULL,
    "zoneId" TEXT,
    "routeId" TEXT,
    "stopId" TEXT,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportFeePlanRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportDiscountRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "criteria" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportDiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "documentId" TEXT,
    "status" "TransportChargeStatus" NOT NULL DEFAULT 'pending',
    "prorated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportIncident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "TransportIncidentType" NOT NULL DEFAULT 'other',
    "severity" "TransportIncidentSeverity" NOT NULL DEFAULT 'medium',
    "tripId" TEXT,
    "vehicleId" TEXT,
    "crewMemberId" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "status" "TransportIncidentStatus" NOT NULL DEFAULT 'open',
    "reportedById" TEXT,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportIncidentStudent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportIncidentStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportIncidentAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "notes" TEXT,
    "fileId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportIncidentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportEndOfTripCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "confirmedByCrewId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportEndOfTripCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "kind" "TransportDeviceKind" NOT NULL DEFAULT 'hardware',
    "identifier" TEXT NOT NULL,
    "secretHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportLocationEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "speedKph" DECIMAL(9,2),
    "headingDeg" INTEGER,
    "accuracyM" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'gps',
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportLocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportGeofence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "TransportGeofenceKind" NOT NULL DEFAULT 'stop',
    "stopId" TEXT,
    "campusId" TEXT,
    "zoneId" TEXT,
    "centerLat" DECIMAL(9,6),
    "centerLng" DECIMAL(9,6),
    "radiusM" INTEGER,
    "polygon" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TransportGeofence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportGeofenceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "geofenceId" TEXT NOT NULL,
    "eventType" "TransportGeofenceEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportGeofenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTrackingAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "kind" "TransportTrackingAlertKind" NOT NULL,
    "severity" "TransportTrackingAlertSeverity" NOT NULL DEFAULT 'medium',
    "detail" JSONB,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportTrackingAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTripTrack" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "polyline" JSONB,
    "distanceKm" DECIMAL(20,6),
    "maxSpeedKph" DECIMAL(9,2),
    "avgSpeedKph" DECIMAL(9,2),
    "pointCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportTripTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_passengerBoarding" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_passengerBoarding_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Invigilator_organizationId_idx" ON "Invigilator"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invigilator_organizationId_staffId_key" ON "Invigilator"("organizationId", "staffId");

-- CreateIndex
CREATE INDEX "InvigilatorAssignment_organizationId_idx" ON "InvigilatorAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "InvigilatorAssignment_examScheduleId_idx" ON "InvigilatorAssignment"("examScheduleId");

-- CreateIndex
CREATE INDEX "InvigilatorAssignment_invigilatorId_idx" ON "InvigilatorAssignment"("invigilatorId");

-- CreateIndex
CREATE UNIQUE INDEX "InvigilatorAssignment_examScheduleId_invigilatorId_key" ON "InvigilatorAssignment"("examScheduleId", "invigilatorId");

-- CreateIndex
CREATE INDEX "LearningOutcome_organizationId_idx" ON "LearningOutcome"("organizationId");

-- CreateIndex
CREATE INDEX "LearningOutcome_subjectId_idx" ON "LearningOutcome"("subjectId");

-- CreateIndex
CREATE INDEX "LearningOutcome_topicId_idx" ON "LearningOutcome"("topicId");

-- CreateIndex
CREATE INDEX "LearningOutcome_competencyId_idx" ON "LearningOutcome"("competencyId");

-- CreateIndex
CREATE INDEX "StudentOutcomeAchievement_organizationId_idx" ON "StudentOutcomeAchievement"("organizationId");

-- CreateIndex
CREATE INDEX "StudentOutcomeAchievement_studentProfileId_termId_idx" ON "StudentOutcomeAchievement"("studentProfileId", "termId");

-- CreateIndex
CREATE INDEX "StudentOutcomeAchievement_learningOutcomeId_idx" ON "StudentOutcomeAchievement"("learningOutcomeId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentOutcomeAchievement_studentProfileId_learningOutcomeI_key" ON "StudentOutcomeAchievement"("studentProfileId", "learningOutcomeId", "termId");

-- CreateIndex
CREATE INDEX "QuestionPaper_organizationId_idx" ON "QuestionPaper"("organizationId");

-- CreateIndex
CREATE INDEX "QuestionPaper_examScheduleId_idx" ON "QuestionPaper"("examScheduleId");

-- CreateIndex
CREATE INDEX "TransportSettings_organizationId_idx" ON "TransportSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportSettings_organizationId_campusId_key" ON "TransportSettings"("organizationId", "campusId");

-- CreateIndex
CREATE INDEX "TransportZone_organizationId_idx" ON "TransportZone"("organizationId");

-- CreateIndex
CREATE INDEX "TransportZone_campusId_idx" ON "TransportZone"("campusId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportZone_organizationId_code_key" ON "TransportZone"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TransportRouteVersion_organizationId_idx" ON "TransportRouteVersion"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRouteVersion_routeId_idx" ON "TransportRouteVersion"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteVersion_routeId_versionNo_key" ON "TransportRouteVersion"("routeId", "versionNo");

-- CreateIndex
CREATE INDEX "TransportRouteStop_organizationId_idx" ON "TransportRouteStop"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRouteStop_routeVersionId_idx" ON "TransportRouteStop"("routeVersionId");

-- CreateIndex
CREATE INDEX "TransportRouteStop_stopId_idx" ON "TransportRouteStop"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteStop_routeVersionId_sequence_key" ON "TransportRouteStop"("routeVersionId", "sequence");

-- CreateIndex
CREATE INDEX "TransportCrewMember_organizationId_idx" ON "TransportCrewMember"("organizationId");

-- CreateIndex
CREATE INDEX "TransportCrewMember_staffProfileId_idx" ON "TransportCrewMember"("staffProfileId");

-- CreateIndex
CREATE INDEX "TransportCrewMember_partnerId_idx" ON "TransportCrewMember"("partnerId");

-- CreateIndex
CREATE INDEX "TransportCrewMember_status_idx" ON "TransportCrewMember"("status");

-- CreateIndex
CREATE INDEX "TransportCrewDocument_organizationId_idx" ON "TransportCrewDocument"("organizationId");

-- CreateIndex
CREATE INDEX "TransportCrewDocument_crewMemberId_idx" ON "TransportCrewDocument"("crewMemberId");

-- CreateIndex
CREATE INDEX "TransportCrewDocument_expiryDate_idx" ON "TransportCrewDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "TransportVehicleDocument_organizationId_idx" ON "TransportVehicleDocument"("organizationId");

-- CreateIndex
CREATE INDEX "TransportVehicleDocument_vehicleId_idx" ON "TransportVehicleDocument"("vehicleId");

-- CreateIndex
CREATE INDEX "TransportVehicleDocument_expiryDate_idx" ON "TransportVehicleDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "TransportRequest_organizationId_idx" ON "TransportRequest"("organizationId");

-- CreateIndex
CREATE INDEX "TransportRequest_studentProfileId_idx" ON "TransportRequest"("studentProfileId");

-- CreateIndex
CREATE INDEX "TransportRequest_status_idx" ON "TransportRequest"("status");

-- CreateIndex
CREATE INDEX "TransportAuthorizedPerson_organizationId_idx" ON "TransportAuthorizedPerson"("organizationId");

-- CreateIndex
CREATE INDEX "TransportAuthorizedPerson_studentProfileId_idx" ON "TransportAuthorizedPerson"("studentProfileId");

-- CreateIndex
CREATE INDEX "TransportAuthorizedPerson_stopId_idx" ON "TransportAuthorizedPerson"("stopId");

-- CreateIndex
CREATE INDEX "TransportSpecialRequirement_organizationId_idx" ON "TransportSpecialRequirement"("organizationId");

-- CreateIndex
CREATE INDEX "TransportSpecialRequirement_studentProfileId_idx" ON "TransportSpecialRequirement"("studentProfileId");

-- CreateIndex
CREATE INDEX "TransportSchedule_organizationId_idx" ON "TransportSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "TransportSchedule_routeVersionId_idx" ON "TransportSchedule"("routeVersionId");

-- CreateIndex
CREATE INDEX "TransportScheduleException_organizationId_idx" ON "TransportScheduleException"("organizationId");

-- CreateIndex
CREATE INDEX "TransportScheduleException_scheduleId_idx" ON "TransportScheduleException"("scheduleId");

-- CreateIndex
CREATE INDEX "TransportScheduleException_date_idx" ON "TransportScheduleException"("date");

-- CreateIndex
CREATE INDEX "TransportTrip_organizationId_idx" ON "TransportTrip"("organizationId");

-- CreateIndex
CREATE INDEX "TransportTrip_routeVersionId_idx" ON "TransportTrip"("routeVersionId");

-- CreateIndex
CREATE INDEX "TransportTrip_vehicleId_idx" ON "TransportTrip"("vehicleId");

-- CreateIndex
CREATE INDEX "TransportTrip_date_idx" ON "TransportTrip"("date");

-- CreateIndex
CREATE INDEX "TransportTrip_status_idx" ON "TransportTrip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportTrip_organizationId_scheduleId_date_direction_key" ON "TransportTrip"("organizationId", "scheduleId", "date", "direction");

-- CreateIndex
CREATE INDEX "TransportTripStop_organizationId_idx" ON "TransportTripStop"("organizationId");

-- CreateIndex
CREATE INDEX "TransportTripStop_tripId_idx" ON "TransportTripStop"("tripId");

-- CreateIndex
CREATE INDEX "TransportTripStop_stopId_idx" ON "TransportTripStop"("stopId");

-- CreateIndex
CREATE INDEX "TransportTripPassenger_organizationId_idx" ON "TransportTripPassenger"("organizationId");

-- CreateIndex
CREATE INDEX "TransportTripPassenger_tripId_idx" ON "TransportTripPassenger"("tripId");

-- CreateIndex
CREATE INDEX "TransportTripPassenger_studentProfileId_idx" ON "TransportTripPassenger"("studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportTripPassenger_tripId_studentProfileId_key" ON "TransportTripPassenger"("tripId", "studentProfileId");

-- CreateIndex
CREATE INDEX "TransportBoardingEvent_organizationId_idx" ON "TransportBoardingEvent"("organizationId");

-- CreateIndex
CREATE INDEX "TransportBoardingEvent_tripId_idx" ON "TransportBoardingEvent"("tripId");

-- CreateIndex
CREATE INDEX "TransportBoardingEvent_studentProfileId_idx" ON "TransportBoardingEvent"("studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportBoardingEvent_client_unique" ON "TransportBoardingEvent"("organizationId", "clientEventId");

-- CreateIndex
CREATE INDEX "TransportVehicleInspection_organizationId_idx" ON "TransportVehicleInspection"("organizationId");

-- CreateIndex
CREATE INDEX "TransportVehicleInspection_vehicleId_idx" ON "TransportVehicleInspection"("vehicleId");

-- CreateIndex
CREATE INDEX "TransportVehicleInspection_date_idx" ON "TransportVehicleInspection"("date");

-- CreateIndex
CREATE INDEX "TransportInspectionItem_organizationId_idx" ON "TransportInspectionItem"("organizationId");

-- CreateIndex
CREATE INDEX "TransportInspectionItem_inspectionId_idx" ON "TransportInspectionItem"("inspectionId");

-- CreateIndex
CREATE INDEX "TransportTripEvent_organizationId_idx" ON "TransportTripEvent"("organizationId");

-- CreateIndex
CREATE INDEX "TransportTripEvent_tripId_idx" ON "TransportTripEvent"("tripId");

-- CreateIndex
CREATE INDEX "TransportFeePlan_organizationId_idx" ON "TransportFeePlan"("organizationId");

-- CreateIndex
CREATE INDEX "TransportFeePlan_campusId_idx" ON "TransportFeePlan"("campusId");

-- CreateIndex
CREATE INDEX "TransportFeePlan_academicYearId_idx" ON "TransportFeePlan"("academicYearId");

-- CreateIndex
CREATE INDEX "TransportFeePlanRate_organizationId_idx" ON "TransportFeePlanRate"("organizationId");

-- CreateIndex
CREATE INDEX "TransportFeePlanRate_feePlanId_idx" ON "TransportFeePlanRate"("feePlanId");

-- CreateIndex
CREATE INDEX "TransportDiscountRule_organizationId_idx" ON "TransportDiscountRule"("organizationId");

-- CreateIndex
CREATE INDEX "TransportDiscountRule_isActive_idx" ON "TransportDiscountRule"("isActive");

-- CreateIndex
CREATE INDEX "TransportCharge_organizationId_idx" ON "TransportCharge"("organizationId");

-- CreateIndex
CREATE INDEX "TransportCharge_assignmentId_idx" ON "TransportCharge"("assignmentId");

-- CreateIndex
CREATE INDEX "TransportCharge_status_idx" ON "TransportCharge"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportCharge_organizationId_assignmentId_periodStart_per_key" ON "TransportCharge"("organizationId", "assignmentId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "TransportIncident_organizationId_idx" ON "TransportIncident"("organizationId");

-- CreateIndex
CREATE INDEX "TransportIncident_tripId_idx" ON "TransportIncident"("tripId");

-- CreateIndex
CREATE INDEX "TransportIncident_status_idx" ON "TransportIncident"("status");

-- CreateIndex
CREATE INDEX "TransportIncident_severity_idx" ON "TransportIncident"("severity");

-- CreateIndex
CREATE INDEX "TransportIncidentStudent_organizationId_idx" ON "TransportIncidentStudent"("organizationId");

-- CreateIndex
CREATE INDEX "TransportIncidentStudent_incidentId_idx" ON "TransportIncidentStudent"("incidentId");

-- CreateIndex
CREATE INDEX "TransportIncidentStudent_studentProfileId_idx" ON "TransportIncidentStudent"("studentProfileId");

-- CreateIndex
CREATE INDEX "TransportIncidentAction_organizationId_idx" ON "TransportIncidentAction"("organizationId");

-- CreateIndex
CREATE INDEX "TransportIncidentAction_incidentId_idx" ON "TransportIncidentAction"("incidentId");

-- CreateIndex
CREATE INDEX "TransportEndOfTripCheck_organizationId_idx" ON "TransportEndOfTripCheck"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportEndOfTripCheck_tripId_key" ON "TransportEndOfTripCheck"("tripId");

-- CreateIndex
CREATE INDEX "TransportDevice_organizationId_idx" ON "TransportDevice"("organizationId");

-- CreateIndex
CREATE INDEX "TransportDevice_vehicleId_idx" ON "TransportDevice"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportDevice_organizationId_identifier_key" ON "TransportDevice"("organizationId", "identifier");

-- CreateIndex
CREATE INDEX "TransportLocationEvent_organizationId_idx" ON "TransportLocationEvent"("organizationId");

-- CreateIndex
CREATE INDEX "TransportLocationEvent_vehicleId_idx" ON "TransportLocationEvent"("vehicleId");

-- CreateIndex
CREATE INDEX "TransportLocationEvent_tripId_idx" ON "TransportLocationEvent"("tripId");

-- CreateIndex
CREATE INDEX "TransportLocationEvent_recordedAt_idx" ON "TransportLocationEvent"("recordedAt");

-- CreateIndex
CREATE INDEX "TransportGeofence_organizationId_idx" ON "TransportGeofence"("organizationId");

-- CreateIndex
CREATE INDEX "TransportGeofence_stopId_idx" ON "TransportGeofence"("stopId");

-- CreateIndex
CREATE INDEX "TransportGeofence_campusId_idx" ON "TransportGeofence"("campusId");

-- CreateIndex
CREATE INDEX "TransportGeofence_zoneId_idx" ON "TransportGeofence"("zoneId");

-- CreateIndex
CREATE INDEX "TransportGeofenceEvent_organizationId_idx" ON "TransportGeofenceEvent"("organizationId");

-- CreateIndex
CREATE INDEX "TransportGeofenceEvent_vehicleId_idx" ON "TransportGeofenceEvent"("vehicleId");

-- CreateIndex
CREATE INDEX "TransportGeofenceEvent_tripId_idx" ON "TransportGeofenceEvent"("tripId");

-- CreateIndex
CREATE INDEX "TransportGeofenceEvent_geofenceId_idx" ON "TransportGeofenceEvent"("geofenceId");

-- CreateIndex
CREATE INDEX "TransportTrackingAlert_organizationId_idx" ON "TransportTrackingAlert"("organizationId");

-- CreateIndex
CREATE INDEX "TransportTrackingAlert_tripId_idx" ON "TransportTrackingAlert"("tripId");

-- CreateIndex
CREATE INDEX "TransportTrackingAlert_vehicleId_idx" ON "TransportTrackingAlert"("vehicleId");

-- CreateIndex
CREATE INDEX "TransportTrackingAlert_raisedAt_idx" ON "TransportTrackingAlert"("raisedAt");

-- CreateIndex
CREATE INDEX "TransportTripTrack_organizationId_idx" ON "TransportTripTrack"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportTripTrack_tripId_key" ON "TransportTripTrack"("tripId");

-- CreateIndex
CREATE INDEX "_passengerBoarding_B_index" ON "_passengerBoarding"("B");

-- CreateIndex
CREATE INDEX "FeeCredit_studentProfileId_idx" ON "FeeCredit"("studentProfileId");

-- CreateIndex
CREATE INDEX "Route_campusId_idx" ON "Route"("campusId");

-- CreateIndex
CREATE INDEX "Route_academicYearId_idx" ON "Route"("academicYearId");

-- CreateIndex
CREATE INDEX "Route_status_idx" ON "Route"("status");

-- CreateIndex
CREATE INDEX "Sponsorship_sponsorId_idx" ON "Sponsorship"("sponsorId");

-- CreateIndex
CREATE INDEX "Sponsorship_studentProfileId_idx" ON "Sponsorship"("studentProfileId");

-- CreateIndex
CREATE INDEX "Stop_zoneId_idx" ON "Stop"("zoneId");

-- CreateIndex
CREATE INDEX "Stop_campusId_idx" ON "Stop"("campusId");

-- CreateIndex
CREATE INDEX "Stop_status_idx" ON "Stop"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Stop_organizationId_code_key" ON "Stop"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StudentTransportAssignment_routeId_idx" ON "StudentTransportAssignment"("routeId");

-- CreateIndex
CREATE INDEX "StudentTransportAssignment_status_idx" ON "StudentTransportAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StudentTransportAssignment_active_unique" ON "StudentTransportAssignment"("organizationId", "studentProfileId", "termId", "serviceMode");

-- CreateIndex
CREATE INDEX "Vehicle_campusId_idx" ON "Vehicle"("campusId");

-- CreateIndex
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- CreateIndex
CREATE INDEX "Waiver_studentProfileId_idx" ON "Waiver"("studentProfileId");

-- CreateIndex
CREATE INDEX "Waiver_documentId_idx" ON "Waiver"("documentId");

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_teachingRoomId_fkey" FOREIGN KEY ("teachingRoomId") REFERENCES "TeachingRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilatorAssignment" ADD CONSTRAINT "InvigilatorAssignment_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvigilatorAssignment" ADD CONSTRAINT "InvigilatorAssignment_invigilatorId_fkey" FOREIGN KEY ("invigilatorId") REFERENCES "Invigilator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningOutcome" ADD CONSTRAINT "LearningOutcome_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningOutcome" ADD CONSTRAINT "LearningOutcome_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningOutcome" ADD CONSTRAINT "LearningOutcome_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentOutcomeAchievement" ADD CONSTRAINT "StudentOutcomeAchievement_learningOutcomeId_fkey" FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentOutcomeAchievement" ADD CONSTRAINT "StudentOutcomeAchievement_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionPaper" ADD CONSTRAINT "QuestionPaper_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "TransportZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_pickupStopId_fkey" FOREIGN KEY ("pickupStopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTransportAssignment" ADD CONSTRAINT "StudentTransportAssignment_dropoffStopId_fkey" FOREIGN KEY ("dropoffStopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteVersion" ADD CONSTRAINT "TransportRouteVersion_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "TransportRouteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportCrewDocument" ADD CONSTRAINT "TransportCrewDocument_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "TransportCrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicleDocument" ADD CONSTRAINT "TransportVehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRequest" ADD CONSTRAINT "TransportRequest_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRequest" ADD CONSTRAINT "TransportRequest_requestedRouteId_fkey" FOREIGN KEY ("requestedRouteId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRequest" ADD CONSTRAINT "TransportRequest_requestedStopId_fkey" FOREIGN KEY ("requestedStopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRequest" ADD CONSTRAINT "TransportRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAuthorizedPerson" ADD CONSTRAINT "TransportAuthorizedPerson_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAuthorizedPerson" ADD CONSTRAINT "TransportAuthorizedPerson_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSpecialRequirement" ADD CONSTRAINT "TransportSpecialRequirement_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSchedule" ADD CONSTRAINT "TransportSchedule_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "TransportRouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSchedule" ADD CONSTRAINT "TransportSchedule_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSchedule" ADD CONSTRAINT "TransportSchedule_defaultVehicleId_fkey" FOREIGN KEY ("defaultVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSchedule" ADD CONSTRAINT "TransportSchedule_defaultCrewDriverId_fkey" FOREIGN KEY ("defaultCrewDriverId") REFERENCES "TransportCrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSchedule" ADD CONSTRAINT "TransportSchedule_defaultCrewAttendantId_fkey" FOREIGN KEY ("defaultCrewAttendantId") REFERENCES "TransportCrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportScheduleException" ADD CONSTRAINT "TransportScheduleException_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TransportSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportScheduleException" ADD CONSTRAINT "TransportScheduleException_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "SchoolCalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "TransportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "TransportRouteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_driverCrewId_fkey" FOREIGN KEY ("driverCrewId") REFERENCES "TransportCrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_attendantCrewId_fkey" FOREIGN KEY ("attendantCrewId") REFERENCES "TransportCrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "TransportVehicleInspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripStop" ADD CONSTRAINT "TransportTripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripStop" ADD CONSTRAINT "TransportTripStop_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripPassenger" ADD CONSTRAINT "TransportTripPassenger_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripPassenger" ADD CONSTRAINT "TransportTripPassenger_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripPassenger" ADD CONSTRAINT "TransportTripPassenger_pickupStopId_fkey" FOREIGN KEY ("pickupStopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripPassenger" ADD CONSTRAINT "TransportTripPassenger_dropoffStopId_fkey" FOREIGN KEY ("dropoffStopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripPassenger" ADD CONSTRAINT "TransportTripPassenger_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBoardingEvent" ADD CONSTRAINT "TransportBoardingEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBoardingEvent" ADD CONSTRAINT "TransportBoardingEvent_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBoardingEvent" ADD CONSTRAINT "TransportBoardingEvent_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBoardingEvent" ADD CONSTRAINT "TransportBoardingEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportBoardingEvent" ADD CONSTRAINT "TransportBoardingEvent_releasedToPersonId_fkey" FOREIGN KEY ("releasedToPersonId") REFERENCES "TransportAuthorizedPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicleInspection" ADD CONSTRAINT "TransportVehicleInspection_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportVehicleInspection" ADD CONSTRAINT "TransportVehicleInspection_inspectedByCrewId_fkey" FOREIGN KEY ("inspectedByCrewId") REFERENCES "TransportCrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportInspectionItem" ADD CONSTRAINT "TransportInspectionItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "TransportVehicleInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripEvent" ADD CONSTRAINT "TransportTripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeePlanRate" ADD CONSTRAINT "TransportFeePlanRate_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "TransportFeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeePlanRate" ADD CONSTRAINT "TransportFeePlanRate_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "TransportZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeePlanRate" ADD CONSTRAINT "TransportFeePlanRate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportFeePlanRate" ADD CONSTRAINT "TransportFeePlanRate_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportCharge" ADD CONSTRAINT "TransportCharge_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentTransportAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIncident" ADD CONSTRAINT "TransportIncident_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIncident" ADD CONSTRAINT "TransportIncident_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIncident" ADD CONSTRAINT "TransportIncident_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "TransportCrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIncidentStudent" ADD CONSTRAINT "TransportIncidentStudent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "TransportIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIncidentStudent" ADD CONSTRAINT "TransportIncidentStudent_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportIncidentAction" ADD CONSTRAINT "TransportIncidentAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "TransportIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportEndOfTripCheck" ADD CONSTRAINT "TransportEndOfTripCheck_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportDevice" ADD CONSTRAINT "TransportDevice_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportLocationEvent" ADD CONSTRAINT "TransportLocationEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportLocationEvent" ADD CONSTRAINT "TransportLocationEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGeofence" ADD CONSTRAINT "TransportGeofence_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGeofence" ADD CONSTRAINT "TransportGeofence_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGeofence" ADD CONSTRAINT "TransportGeofence_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "TransportZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGeofenceEvent" ADD CONSTRAINT "TransportGeofenceEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGeofenceEvent" ADD CONSTRAINT "TransportGeofenceEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportGeofenceEvent" ADD CONSTRAINT "TransportGeofenceEvent_geofenceId_fkey" FOREIGN KEY ("geofenceId") REFERENCES "TransportGeofence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrackingAlert" ADD CONSTRAINT "TransportTrackingAlert_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrackingAlert" ADD CONSTRAINT "TransportTrackingAlert_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTripTrack" ADD CONSTRAINT "TransportTripTrack_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "TransportTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_passengerBoarding" ADD CONSTRAINT "_passengerBoarding_A_fkey" FOREIGN KEY ("A") REFERENCES "TransportBoardingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_passengerBoarding" ADD CONSTRAINT "_passengerBoarding_B_fkey" FOREIGN KEY ("B") REFERENCES "TransportTripPassenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "SchoolDoc_category_idx" RENAME TO "SchoolDoc_organizationId_category_idx";

-- RenameIndex
ALTER INDEX "SchoolDoc_expires_idx" RENAME TO "SchoolDoc_organizationId_expiresAt_idx";

-- RenameIndex
ALTER INDEX "SchoolDoc_org_owner_idx" RENAME TO "SchoolDoc_organizationId_ownerType_ownerId_idx";

-- RenameIndex
ALTER INDEX "TeacherAvailability_organizationId_teacherPartnerId_dayOfWeek_p" RENAME TO "TeacherAvailability_organizationId_teacherPartnerId_dayOfWe_key";

