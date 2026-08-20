/**
 * school-transport seed — populates a realistic School Transport Management
 * System (STMS) dataset for the DEMO organization on top of the academic data
 * created by `seed-school-demo.ts`.
 *
 * Design notes (why it is safe + reproducible):
 *  - Drives a standalone PrismaClient (no tenancy extension) and sets
 *    organizationId explicitly on every row — RLS is off on schooldb-planet by
 *    design, so a plain client can write freely.
 *  - IDEMPOTENT: if the route with code ROUTE_CODE already exists for the DEMO
 *    org it bails out, so re-running never duplicates. Delete that Route (and
 *    its cascading versions/stops) to reseed.
 *  - Models the post-T1 shape of the domain: a `Stop` is a standalone place,
 *    while ordering/timing live on `TransportRouteStop`, which hangs off an
 *    immutable `TransportRouteVersion`. Trips/schedules reference the *version*,
 *    never the route directly.
 *  - Student assignments skip any student who already holds an assignment for
 *    the current term, respecting the
 *    (organizationId, studentProfileId, termId, serviceMode) unique invariant.
 *
 * Run (from apps/api, with DATABASE_URL / .env present):
 *   npx ts-node prisma/seed-school-transport.ts
 *   # or:  node -r ts-node/register prisma/seed-school-transport.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_CODE = 'DEMO';
const ROUTE_CODE = 'RT-KLA-AM';
const D = (v: number | string) => new Prisma.Decimal(v);

const log = (m: string) => console.log(`  • ${m}`);
const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);

async function main() {
  console.log('\n=== School transport seed (STMS) ===\n');
  const org = await prisma.organization.findUnique({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`Org ${ORG_CODE} not found — run 'pnpm db:seed' first.`);
  const O = org.id;

  const already = await prisma.route.findFirst({ where: { organizationId: O, code: ROUTE_CODE } });
  if (already) {
    console.log(
      `\x1b[33mRoute ${ROUTE_CODE} already exists for ${ORG_CODE} — seed skipped (idempotent). Delete it to reseed.\x1b[0m`,
    );
    return;
  }

  // Anchor onto whatever academic scaffolding the school seed produced.
  const campus =
    (await prisma.campus.findFirst({ where: { organizationId: O, code: 'MAIN' } })) ??
    (await prisma.campus.findFirst({ where: { organizationId: O } }));
  const year = await prisma.academicYear.findFirst({ where: { organizationId: O, isCurrent: true } });
  const term = await prisma.term.findFirst({ where: { organizationId: O, isCurrent: true } });
  const campusId = campus?.id ?? null;
  log(`scope: campus=${campus?.name ?? 'n/a'} year=${year?.name ?? 'n/a'} term=${term?.name ?? 'n/a'}`);

  // ── T0: org-wide transport policy ──────────────────────────────────────────
  const settings = await prisma.transportSettings.findFirst({ where: { organizationId: O, campusId } });
  if (!settings) {
    await prisma.transportSettings.create({
      data: {
        organizationId: O,
        campusId,
        operatingDays: [1, 2, 3, 4, 5],
        pickupGraceMin: 5,
        dropoffGraceMin: 5,
        lateThresholdMin: 10,
        maxRouteDurationMin: 90,
        deviationThresholdM: 150,
        speedThresholdKph: 80,
        geofenceDefaultRadiusM: 120,
      },
    });
    log('transport settings created');
  }

  // ── T1: zones ──────────────────────────────────────────────────────────────
  const zoneCentral = await prisma.transportZone.create({
    data: { organizationId: O, code: 'Z-CENTRAL', name: 'Central Kampala', campusId },
  });
  const zoneNorth = await prisma.transportZone.create({
    data: { organizationId: O, code: 'Z-NORTH', name: 'Northern Suburbs', campusId },
  });
  ok('zones: Central Kampala, Northern Suburbs');

  // ── T1: standalone stops (shared places — no route ownership) ──────────────
  const stopNtinda = await prisma.stop.create({
    data: {
      organizationId: O, code: 'NTINDA-STAGE', name: 'Ntinda Stage', zoneId: zoneNorth.id, campusId,
      address: 'Ntinda Trading Centre, Kampala', landmark: 'Opposite Capital Shoppers',
      latitude: D('0.356000'), longitude: D('32.618000'),
      pickupAllowed: true, dropoffAllowed: true, geofenceRadiusM: 120,
      safetyNotes: 'Board on the service lane only — do not stop on the main carriageway.',
      status: 'active',
    },
  });
  const stopKamwokya = await prisma.stop.create({
    data: {
      organizationId: O, code: 'KAMWOKYA-STAGE', name: 'Kamwokya Stage', zoneId: zoneNorth.id, campusId,
      address: 'Kira Road, Kamwokya, Kampala', landmark: 'Near Kamwokya Market',
      latitude: D('0.343000'), longitude: D('32.586000'),
      pickupAllowed: true, dropoffAllowed: true, geofenceRadiusM: 100,
      status: 'active',
    },
  });
  const stopWandegeya = await prisma.stop.create({
    data: {
      organizationId: O, code: 'WANDEGEYA-STAGE', name: 'Wandegeya Stage', zoneId: zoneCentral.id, campusId,
      address: 'Bombo Road, Wandegeya, Kampala', landmark: 'Wandegeya Clock Tower',
      latitude: D('0.334000'), longitude: D('32.573000'),
      pickupAllowed: true, dropoffAllowed: true, geofenceRadiusM: 100,
      status: 'active',
    },
  });
  const stopCampusGate = await prisma.stop.create({
    data: {
      organizationId: O, code: 'HILLTOP-GATE', name: 'Hilltop Main Gate', zoneId: zoneCentral.id, campusId,
      address: 'Hilltop High School, Main Campus', landmark: 'School main gate turning circle',
      latitude: D('0.320000'), longitude: D('32.580000'),
      pickupAllowed: false, dropoffAllowed: true, geofenceRadiusM: 150,
      safetyNotes: 'Terminal stop — all passengers must disembark inside the gate.',
      status: 'active',
    },
  });
  const boardingStops = [stopNtinda, stopKamwokya, stopWandegeya];
  ok(`stops: ${boardingStops.length} boarding + 1 terminal (Hilltop Main Gate)`);

  // ── T1: route + immutable version ──────────────────────────────────────────
  const route = await prisma.route.create({
    data: {
      organizationId: O,
      name: 'Kampala North – Hilltop (AM)',
      code: ROUTE_CODE,
      description: 'Morning inbound run collecting from the northern suburbs and Central Kampala.',
      campusId,
      academicYearId: year?.id ?? null,
      direction: 'inbound',
      serviceType: 'morning',
      status: 'active',
      estimatedDurationMin: 55,
      distanceKm: D('18.4'),
      monthlyFee: D(120000),
    },
  });
  const version = await prisma.transportRouteVersion.create({
    data: {
      organizationId: O, routeId: route.id, versionNo: 1,
      effectiveFrom: new Date(), status: 'active',
      notes: 'Initial published version — seeded.',
    },
  });
  await prisma.route.update({ where: { id: route.id }, data: { currentVersionId: version.id } });
  ok(`route ${ROUTE_CODE} (inbound / morning) + version 1`);

  // ── T1: ordered stops on the version (timing lives here, not on Stop) ─────
  const routeStopPlan = [
    { stop: stopNtinda, sequence: 1, plannedArrival: '06:30', plannedDeparture: '06:34', pickupAllowed: true, dropoffAllowed: false, distanceFromPrevKm: null as string | null, studentCapacity: 20 },
    { stop: stopKamwokya, sequence: 2, plannedArrival: '06:48', plannedDeparture: '06:52', pickupAllowed: true, dropoffAllowed: false, distanceFromPrevKm: '5.2', studentCapacity: 18 },
    { stop: stopWandegeya, sequence: 3, plannedArrival: '07:05', plannedDeparture: '07:09', pickupAllowed: true, dropoffAllowed: false, distanceFromPrevKm: '4.1', studentCapacity: 15 },
    { stop: stopCampusGate, sequence: 4, plannedArrival: '07:25', plannedDeparture: null as string | null, pickupAllowed: false, dropoffAllowed: true, distanceFromPrevKm: '9.1', studentCapacity: null as number | null },
  ];
  for (const rs of routeStopPlan) {
    await prisma.transportRouteStop.create({
      data: {
        organizationId: O,
        routeVersionId: version.id,
        stopId: rs.stop.id,
        sequence: rs.sequence,
        plannedArrival: rs.plannedArrival,
        plannedDeparture: rs.plannedDeparture,
        pickupAllowed: rs.pickupAllowed,
        dropoffAllowed: rs.dropoffAllowed,
        studentCapacity: rs.studentCapacity,
        distanceFromPrevKm: rs.distanceFromPrevKm ? D(rs.distanceFromPrevKm) : null,
      },
    });
  }
  ok(`route stops: ${routeStopPlan.length} sequenced on version 1`);

  // ── T2: fleet ──────────────────────────────────────────────────────────────
  const bus1 = await prisma.vehicle.create({
    data: {
      organizationId: O, code: 'BUS-01', plateNumber: 'UAX 481K', fleetNumber: 'F-01',
      type: 'bus', make: 'Toyota', model: 'Coaster', year: 2019, fuelType: 'diesel',
      odometerKm: D('184320'), seatedCapacity: 30, operationalCapacity: 28,
      ownership: 'owned', status: 'available', campusId,
    },
  });
  const van1 = await prisma.vehicle.create({
    data: {
      organizationId: O, code: 'VAN-01', plateNumber: 'UBG 774H', fleetNumber: 'F-02',
      type: 'van', make: 'Nissan', model: 'Caravan', year: 2021, fuelType: 'diesel',
      odometerKm: D('62150'), seatedCapacity: 14, operationalCapacity: 13,
      ownership: 'owned', status: 'available', campusId,
    },
  });
  ok(`vehicles: ${bus1.code} (${bus1.plateNumber}), ${van1.code} (${van1.plateNumber})`);

  // ── T2: crew ───────────────────────────────────────────────────────────────
  const driver = await prisma.transportCrewMember.create({
    data: {
      organizationId: O, role: 'driver', name: 'Julius Ssekandi', phone: '+256772104553',
      licenseNumber: 'DL-UG-4471902', licenseClass: 'CM',
      licenseExpiry: new Date('2028-03-31'), status: 'active',
      emergencyContact: { name: 'Betty Ssekandi', relation: 'spouse', phone: '+256701445210' },
    },
  });
  const attendant = await prisma.transportCrewMember.create({
    data: {
      organizationId: O, role: 'attendant', name: 'Harriet Nabukenya', phone: '+256756330218',
      status: 'active',
      emergencyContact: { name: 'Paul Nabukenya', relation: 'brother', phone: '+256782119047' },
    },
  });
  ok(`crew: ${driver.name} (driver), ${attendant.name} (attendant)`);

  // ── T3: schedule ───────────────────────────────────────────────────────────
  await prisma.transportSchedule.create({
    data: {
      organizationId: O,
      routeVersionId: version.id,
      routeId: route.id,
      direction: 'inbound',
      daysOfWeek: [1, 2, 3, 4, 5],
      departureTime: '06:30',
      defaultVehicleId: bus1.id,
      defaultCrewDriverId: driver.id,
      defaultCrewAttendantId: attendant.id,
      effectiveFrom: new Date(),
      status: 'active',
    },
  });
  ok('schedule: Mon–Fri inbound departing 06:30');

  // ── T3: student assignments (skip students already assigned this term) ─────
  const taken = await prisma.studentTransportAssignment.findMany({
    where: { organizationId: O, termId: term?.id ?? null },
    select: { studentProfileId: true },
  });
  const takenIds = taken.map((t) => t.studentProfileId);

  const where: Prisma.StudentProfileWhereInput = { organizationId: O, status: 'active' };
  if (takenIds.length) where.id = { notIn: takenIds };
  const riders = await prisma.studentProfile.findMany({
    where,
    orderBy: { admissionNo: 'asc' },
    take: 4,
  });

  if (!riders.length) {
    console.log('\x1b[33mno unassigned students found — skipped student assignments.\x1b[0m');
  } else {
    let i = 0;
    for (const st of riders) {
      const pickup = boardingStops[i % boardingStops.length];
      i++;
      await prisma.studentTransportAssignment.create({
        data: {
          organizationId: O,
          studentProfileId: st.id,
          routeId: route.id,
          // `stopId` is the deprecated v1 alias but is still required.
          stopId: pickup.id,
          pickupStopId: pickup.id,
          dropoffStopId: pickup.id,
          campusId,
          academicYearId: year?.id ?? null,
          termId: term?.id ?? null,
          startDate: term?.startDate ?? new Date(),
          serviceMode: 'both',
          assignmentType: 'permanent',
          daysOfWeek: [1, 2, 3, 4, 5],
          monthlyFee: D(120000),
          status: 'active',
        },
      });
    }
    ok(`assignments: ${riders.length} students riding ${ROUTE_CODE}`);
  }

  console.log('\n=== Transport seed complete ===\n');
}

main()
  .catch((e) => {
    console.error('\x1b[31mTransport seed failed:\x1b[0m', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
