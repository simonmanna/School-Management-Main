/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 17 — transport.
 *
 * Five routes out of Kampala's suburbs (Ntinda–Kyanja, Kireka–Kira,
 * Kabalagala–Ggaba road, Nakulabye–Nansana, and a nursery shuttle through
 * Kololo and Naguru), priced by distance zone per term; six vehicles with
 * insurance and inspection certificates; drivers and bus attendants from the
 * HR roll; about 150 day pupils on the buses each term, with the people
 * allowed to collect them. Every term is billed through the transport module,
 * and the last two weeks of trips are on record stop by stop: pre-trip
 * inspection, dispatch, each pupil boarded and dropped, the end-of-trip check
 * that no child is left on the bus — plus the incidents a transport officer
 * actually logs.
 */
import { ok, log, rng, int, pick, MALE_NAMES, FEMALE_NAMES } from '../shared';
import type { Ctx, Timeline } from './kit';
import { clock, eat, addDaysIso, schoolDaysIso } from './kit';
import type { Books } from './13-accounts';
import type { Pupil, Roster } from './roster';
import { NURSERY } from './roster';

const PFX = 'SA';

const ZONES = [
  { code: 'ZA', name: 'Zone A – within 5 km', rate: 280_000 },
  { code: 'ZB', name: 'Zone B – 5 to 10 km', rate: 380_000 },
  { code: 'ZC', name: 'Zone C – over 10 km', rate: 480_000 },
];

const SCHOOL_STOP = { code: 'SCH', name: 'Sunrise Academy – Main Gate', zone: 'ZA', lat: 0.3136, lng: 32.5811, landmark: 'Plot 12, Kampala Road' };

type RouteSpec = {
  code: string;
  name: string;
  description: string;
  km: number;
  minutes: number;
  vehicle: string;
  driver: string;
  attendant: string;
  capacity: number;
  nursery?: boolean;
  stops: Array<{ code: string; name: string; zone: string; lat: number; lng: number; landmark: string; am: string; pm: string }>;
};

const ROUTES: RouteSpec[] = [
  {
    code: 'R1', name: 'Route 1 – Ntinda · Kisaasi · Kyanja', description: 'Northern route via Kamwokya and Ntinda.', km: 14.5, minutes: 70,
    vehicle: 'V01', driver: 'S013', attendant: 'S019', capacity: 31,
    stops: [
      { code: 'KYJ', name: 'Kyanja Market', zone: 'ZC', lat: 0.388, lng: 32.596, landmark: 'Opposite Kyanja Health Centre', am: '06:20', pm: '17:50' },
      { code: 'KSS', name: 'Kisaasi Roundabout', zone: 'ZB', lat: 0.372, lng: 32.597, landmark: 'Shell Kisaasi', am: '06:35', pm: '17:35' },
      { code: 'NTD', name: 'Ntinda Shopping Centre', zone: 'ZB', lat: 0.354, lng: 32.615, landmark: 'Capital Shoppers Ntinda', am: '06:50', pm: '17:15' },
      { code: 'KMW', name: 'Kamwokya – Bukoto Street', zone: 'ZA', lat: 0.342, lng: 32.588, landmark: 'Kamwokya Police Post', am: '07:05', pm: '17:00' },
    ],
  },
  {
    code: 'R2', name: 'Route 2 – Banda · Kireka · Namugongo · Kira', description: 'Eastern route along the Jinja road corridor.', km: 18, minutes: 80,
    vehicle: 'V02', driver: 'S014', attendant: 'S020', capacity: 31,
    stops: [
      { code: 'KRA', name: 'Kira Town', zone: 'ZC', lat: 0.399, lng: 32.64, landmark: 'Kira Municipal offices', am: '06:10', pm: '18:00' },
      { code: 'NMG', name: 'Namugongo Shrine Junction', zone: 'ZC', lat: 0.38, lng: 32.667, landmark: 'Catholic Martyrs Shrine gate', am: '06:25', pm: '17:45' },
      { code: 'KRK', name: 'Kireka Stage', zone: 'ZB', lat: 0.348, lng: 32.653, landmark: 'Kireka Police Barracks', am: '06:45', pm: '17:25' },
      { code: 'BND', name: 'Banda – Kyambogo Gate', zone: 'ZB', lat: 0.346, lng: 32.644, landmark: 'Kyambogo University main gate', am: '06:55', pm: '17:10' },
    ],
  },
  {
    code: 'R3', name: 'Route 3 – Ggaba Road · Kansanga · Kabalagala', description: 'Southern route along Ggaba road.', km: 11, minutes: 60,
    vehicle: 'V03', driver: 'S015', attendant: 'S021', capacity: 27,
    stops: [
      { code: 'BNG', name: 'Bunga – Ggaba Road', zone: 'ZC', lat: 0.27, lng: 32.617, landmark: 'Bunga Hill junction', am: '06:30', pm: '17:40' },
      { code: 'KNS', name: 'Kansanga Trading Centre', zone: 'ZB', lat: 0.285, lng: 32.606, landmark: 'Kampala International University', am: '06:42', pm: '17:28' },
      { code: 'MYG', name: 'Muyenga – Tank Hill', zone: 'ZB', lat: 0.293, lng: 32.61, landmark: 'Tank Hill water reservoir', am: '06:52', pm: '17:18' },
      { code: 'KBL', name: 'Kabalagala', zone: 'ZA', lat: 0.295, lng: 32.596, landmark: 'Kabalagala Police Station', am: '07:02', pm: '17:08' },
      { code: 'KBI', name: 'Kibuli Mosque Junction', zone: 'ZA', lat: 0.302, lng: 32.594, landmark: 'Kibuli Hospital', am: '07:10', pm: '17:00' },
    ],
  },
  {
    code: 'R4', name: 'Route 4 – Nansana · Kasubi · Nakulabye', description: 'Western route via Hoima road.', km: 13, minutes: 65,
    vehicle: 'V04', driver: 'S016', attendant: 'S022', capacity: 45,
    stops: [
      { code: 'NSN', name: 'Nansana Town', zone: 'ZC', lat: 0.364, lng: 32.528, landmark: 'Nansana Municipal Council', am: '06:15', pm: '17:55' },
      { code: 'KSB', name: 'Kasubi Market', zone: 'ZB', lat: 0.329, lng: 32.548, landmark: 'Kasubi Tombs road', am: '06:40', pm: '17:30' },
      { code: 'NKL', name: 'Nakulabye Roundabout', zone: 'ZA', lat: 0.326, lng: 32.555, landmark: 'Nakulabye Police', am: '06:50', pm: '17:20' },
      { code: 'WDG', name: 'Wandegeya', zone: 'ZA', lat: 0.33, lng: 32.573, landmark: 'Wandegeya market', am: '07:00', pm: '17:08' },
    ],
  },
  {
    code: 'R5', name: 'Route 5 – Nursery Shuttle (Bukoto · Naguru · Kololo)', description: 'Small van for nursery pupils; midday return.', km: 7, minutes: 40,
    vehicle: 'V05', driver: 'S017', attendant: 'S023', capacity: 13, nursery: true,
    stops: [
      { code: 'BKT', name: 'Bukoto – Kisementi', zone: 'ZA', lat: 0.348, lng: 32.6, landmark: 'Kisementi shops', am: '07:00', pm: '13:20' },
      { code: 'NGR', name: 'Naguru – Police Hill', zone: 'ZA', lat: 0.339, lng: 32.605, landmark: 'Naguru Police Training School', am: '07:10', pm: '13:10' },
      { code: 'KLL', name: 'Kololo Airstrip', zone: 'ZA', lat: 0.329, lng: 32.595, landmark: 'Kololo Ceremonial Grounds', am: '07:20', pm: '13:00' },
    ],
  },
];

const VEHICLES = [
  { code: 'V01', plate: 'UBJ 451K', fleet: 'SA-BUS-01', type: 'bus', make: 'Isuzu', model: 'NQR 33-seater', year: 2018, seats: 33, cap: 33, odo: 214_300 },
  { code: 'V02', plate: 'UBH 078T', fleet: 'SA-BUS-02', type: 'bus', make: 'Isuzu', model: 'NQR 33-seater', year: 2016, seats: 33, cap: 33, odo: 287_900 },
  { code: 'V03', plate: 'UBK 902P', fleet: 'SA-BUS-03', type: 'bus', make: 'Toyota', model: 'Coaster 29-seater', year: 2019, seats: 29, cap: 29, odo: 162_450 },
  { code: 'V04', plate: 'UBF 336M', fleet: 'SA-BUS-04', type: 'bus', make: 'Isuzu', model: 'Forward 51-seater', year: 2014, seats: 51, cap: 49, odo: 341_200 },
  { code: 'V05', plate: 'UBL 115D', fleet: 'SA-VAN-05', type: 'van', make: 'Toyota', model: 'HiAce 14-seater', year: 2020, seats: 14, cap: 14, odo: 98_600 },
  { code: 'V06', plate: 'UBD 640A', fleet: 'SA-BUS-06', type: 'bus', make: 'Toyota', model: 'Coaster 29-seater (spare)', year: 2012, seats: 29, cap: 29, odo: 402_700, status: 'maintenance' },
];

export async function seedTransport(ctx: Ctx, tl: Timeline, books: Books, roster: Roster): Promise<void> {
  const { prisma, O } = ctx;
  const config = ctx.svc('modules/school/transport/transport-config.service', 'TransportConfigService');
  const fleet = ctx.svc('modules/school/transport/transport-fleet.service', 'TransportFleetService');
  const crewSvc = ctx.svc('modules/school/transport/transport-crew.service', 'TransportCrewService');
  const enrollment = ctx.svc('modules/school/transport/transport-enrollment.service', 'TransportEnrollmentService');
  const scheduleSvc = ctx.svc('modules/school/transport/transport-schedule.service', 'TransportScheduleService');
  const trips = ctx.svc('modules/school/transport/transport-trip.service', 'TransportTripService');
  const boarding = ctx.svc('modules/school/transport/transport-boarding.service', 'TransportBoardingService');
  const safety = ctx.svc('modules/school/transport/transport-safety.service', 'TransportSafetyService');
  const billing = ctx.svc('modules/school/transport/transport-billing.service', 'TransportBillingService');
  const as = <T>(fn: () => Promise<T>) => ctx.as('transport', fn);

  // ── 1. Settings, zones, stops ────────────────────────────────────────────
  await as(() =>
    config.upsertSettings({
      operatingDays: [1, 2, 3, 4, 5], pickupGraceMin: 5, dropoffGraceMin: 5, lateThresholdMin: 10, maxRouteDurationMin: 90,
      boardingMethodsEnabled: ['manual', 'qr'], speedThresholdKph: 60, notifyAbsenceCancelsPickup: true, billingSuspensionEnabled: false,
    }),
  );
  const zoneId = new Map<string, string>();
  for (const z of ZONES) {
    let row = await prisma.transportZone.findFirst({ where: { organizationId: O, code: z.code, deletedAt: null } });
    if (!row) row = await as(() => config.createZone({ code: z.code, name: z.name }));
    zoneId.set(z.code, row!.id);
  }
  const stopId = new Map<string, string>();
  for (const s of [SCHOOL_STOP, ...ROUTES.flatMap((r) => r.stops)]) {
    let row = await prisma.stop.findFirst({ where: { organizationId: O, code: s.code, deletedAt: null } });
    if (!row) {
      row = await as(() =>
        config.createStop({ code: s.code, name: s.name, zoneId: zoneId.get(s.zone), latitude: s.lat, longitude: s.lng, landmark: s.landmark, address: `${s.name}, Kampala`, geofenceRadiusM: 120, status: 'active' }),
      );
    }
    stopId.set(s.code, row!.id);
  }

  // ── 2. Fleet and crew ────────────────────────────────────────────────────
  const vehicleId = new Map<string, string>();
  const crewPartner = async (code: string) => prisma.hrEmployee.findFirst({ where: { organizationId: O, employeeCode: `${PFX}-${code}` } });
  for (const v of VEHICLES) {
    let row = await prisma.vehicle.findFirst({ where: { organizationId: O, code: v.code, deletedAt: null } });
    if (!row) {
      row = await as(() =>
        fleet.createVehicle({
          code: v.code, plateNumber: v.plate, fleetNumber: v.fleet, type: v.type, make: v.make, model: v.model, year: v.year, fuelType: 'diesel',
          seatedCapacity: v.seats, operationalCapacity: v.cap, ownership: 'owned', status: v.status ?? 'assigned',
        }),
      );
      await prisma.vehicle.update({ where: { id: row!.id }, data: { odometerKm: v.odo } });
    }
    vehicleId.set(v.code, row!.id);
    const docs = [
      { documentType: 'insurance', documentNumber: `PGI/MV/2026/${v.code.slice(1)}${int(rng(v.code), 1000, 9999)}`, issueDate: '2026-01-14', expiryDate: '2027-01-13' },
      { documentType: 'inspection', documentNumber: `MoWT/INSP/${v.plate.replace(' ', '')}/26`, issueDate: v.code === 'V02' ? '2025-10-21' : '2026-01-28', expiryDate: v.code === 'V02' ? '2026-10-20' : '2027-01-27' },
      { documentType: 'logbook', documentNumber: `URA-LB-${v.plate.replace(' ', '')}`, issueDate: `${v.year}-03-01` },
    ];
    for (const d of docs) {
      const exists = await prisma.transportVehicleDocument.findFirst({ where: { vehicleId: row!.id, documentType: d.documentType } });
      if (!exists) await as(() => fleet.addVehicleDocument(row!.id, d));
    }
  }
  const crewId = new Map<string, string>();
  const crewCodes = [...new Set(ROUTES.flatMap((r) => [r.driver, r.attendant])), 'S018', 'S003'];
  for (const code of crewCodes) {
    const e = await crewPartner(code);
    if (!e) continue;
    const role = code === 'S003' ? 'coordinator' : ['S013', 'S014', 'S015', 'S016', 'S017', 'S018'].includes(code) ? 'driver' : 'attendant';
    let row = await prisma.transportCrewMember.findFirst({ where: { organizationId: O, partnerId: e.partnerId, deletedAt: null } });
    if (!row) {
      const staff = e.partnerId ? await prisma.staffProfile.findFirst({ where: { organizationId: O, partnerId: e.partnerId } }) : null;
      const r = rng(`crew:${code}`);
      row = await as(() =>
        crewSvc.createCrew({
          staffProfileId: staff?.id, partnerId: e.partnerId ?? undefined, role, name: `${e.firstName} ${e.lastName ?? ''}`.trim(), phone: e.phone ?? undefined,
          ...(role === 'driver'
            ? { licenseNumber: `UG-DL-${int(r, 1_000_000, 9_999_999)}`, licenseClass: code === 'S017' ? 'B, C' : 'B, C, CM, DL', licenseExpiry: code === 'S015' ? '2026-11-30T00:00:00.000Z' : `${int(r, 2027, 2030)}-0${int(r, 1, 9)}-15T00:00:00.000Z` }
            : {}),
          emergencyContact: { name: `${pick(FEMALE_NAMES, r)} ${e.lastName ?? ''}`.trim(), relationship: 'Spouse', phone: `+25677${int(r, 1_000_000, 9_999_999)}` },
          status: 'active',
        }),
      );
    }
    crewId.set(code, row!.id);
  }
  for (const v of VEHICLES) {
    const route = ROUTES.find((r) => r.vehicle === v.code);
    const driver = route ? await crewPartner(route.driver) : await crewPartner('S018');
    if (driver?.partnerId) await prisma.vehicle.update({ where: { id: vehicleId.get(v.code)! }, data: { driverPartnerId: driver.partnerId } });
  }

  // ── 3. Routes, versions, schedules, fee plan ─────────────────────────────
  const routeId = new Map<string, string>();
  const versionId = new Map<string, string>();
  for (const r of ROUTES) {
    let route = await prisma.route.findFirst({ where: { organizationId: O, code: r.code, deletedAt: null } });
    if (!route) {
      route = await as(() =>
        config.createRoute({ name: r.name, code: r.code, description: r.description, academicYearId: roster.yearId, direction: 'loop', serviceType: 'both', status: 'active', estimatedDurationMin: r.minutes, distanceKm: r.km, feeProductId: books.productId('FEE-TRANSPORT') }),
      );
    }
    routeId.set(r.code, route!.id);
    let version = await prisma.transportRouteVersion.findFirst({ where: { routeId: route!.id, versionNo: 1 } });
    if (!version) {
      version = await as(() => config.createVersion(route!.id, { versionNo: 1, effectiveFrom: '2026-01-05T00:00:00+03:00', status: 'draft', notes: 'Routes as agreed with parents at the start of 2026.' }));
      const ordered = [...r.stops.map((s, i) => ({ stopId: stopId.get(s.code)!, sequence: i + 1, plannedArrival: s.am, plannedDeparture: s.am, studentCapacity: r.capacity })),
        { stopId: stopId.get('SCH')!, sequence: r.stops.length + 1, plannedArrival: addMinutes(r.stops[r.stops.length - 1].am, 15), plannedDeparture: addMinutes(r.stops[r.stops.length - 1].am, 15) }];
      await as(() => config.setVersionStops(route!.id, version!.id, { stops: ordered }));
      await as(() => config.publishVersion(route!.id, version!.id, { notes: 'Published for Term 1 2026.' }));
      await prisma.route.update({ where: { id: route!.id }, data: { status: 'active' } });
    }
    versionId.set(r.code, version!.id);
    for (const direction of ['inbound', 'outbound'] as const) {
      const exists = await prisma.transportSchedule.findFirst({ where: { organizationId: O, routeVersionId: version!.id, direction, deletedAt: null } });
      if (exists) continue;
      await as(() =>
        scheduleSvc.createSchedule({
          routeVersionId: version!.id, direction, daysOfWeek: [1, 2, 3, 4, 5],
          departureTime: direction === 'inbound' ? r.stops[0].am : r.nursery ? '12:45' : '16:45',
          defaultVehicleId: vehicleId.get(r.vehicle), defaultCrewDriverId: crewId.get(r.driver), defaultCrewAttendantId: crewId.get(r.attendant),
          effectiveFrom: '2026-01-05T00:00:00+03:00', status: 'active',
        }),
      );
    }
  }
  let plan = await prisma.transportFeePlan.findFirst({ where: { organizationId: O, name: 'Termly transport by zone – 2026', deletedAt: null } });
  if (!plan) {
    plan = await ctx.as('bursar', () =>
      billing.createFeePlan({ name: 'Termly transport by zone – 2026', academicYearId: roster.yearId, basis: 'zone', period: 'termly', baseAmount: ZONES[0].rate, oneWayFactor: 0.6, feeProductId: books.productId('FEE-TRANSPORT') }),
    );
    for (const z of ZONES) await ctx.as('bursar', () => billing.addRate(plan!.id, { zoneId: zoneId.get(z.code), amount: z.rate }));
  }
  // Older test plans would win `resolvePlan` (cheapest active plan first).
  await prisma.transportFeePlan.updateMany({ where: { organizationId: O, id: { not: plan!.id } }, data: { isActive: false } });
  ok(`transport: ${ROUTES.length} routes, ${stopId.size} stops in ${ZONES.length} zones, ${VEHICLES.length} vehicles, ${crewId.size} crew, zone fee plan`);

  // ── 4. Who rides, term by term ───────────────────────────────────────────
  const dayPupils = roster.pupils.filter((p) => p.residence === 'day');
  const riders = new Map<string, { route: RouteSpec; stop: string; terms: Array<1 | 2 | 3> }>();
  const load = new Map<string, number>();
  const shuffled = [...dayPupils].sort((a, b) => rng(`rider:${a.id}`)() - rng(`rider:${b.id}`)());
  for (const p of shuffled) {
    const r = rng(`ride:${p.id}`);
    if (r() > 0.27) continue;
    const candidates = NURSERY.includes(p.grade) ? [ROUTES[4], ...ROUTES.slice(0, 4)] : ROUTES.slice(0, 4);
    const route = candidates.find((rt) => (load.get(rt.code) ?? 0) < rt.capacity);
    if (!route) continue;
    load.set(route.code, (load.get(route.code) ?? 0) + 1);
    const stop = pick(route.stops, r).code;
    const startTerm = r() < 0.9 ? 1 : 2;
    const leaves = r() < 0.05 ? 2 : 4;
    const terms = ([1, 2, 3] as const).filter((t) => t >= startTerm && t < leaves);
    if (terms.length) riders.set(p.id, { route, stop, terms });
  }
  const pupilById = new Map(roster.pupils.map((p) => [p.id, p]));
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    tl.add({
      at: eat(addDaysIso(term.start, no === 1 ? -14 : -10), '09:00'),
      priority: 6,
      label: `transport assignments ${term.name}`,
      run: async () => {
        for (const [pupilId, ride] of riders) {
          if (!ride.terms.includes(no)) continue;
          const exists = await prisma.studentTransportAssignment.findFirst({ where: { organizationId: O, studentProfileId: pupilId, termId: term.id } });
          if (exists) continue;
          await as(() =>
            enrollment.createAssignment({
              studentProfileId: pupilId, routeId: routeId.get(ride.route.code)!, stopId: stopId.get(ride.stop)!, termId: term.id, academicYearId: roster.yearId,
              startDate: `${term.start}T00:00:00+03:00`, endDate: `${term.end}T23:59:59+03:00`, serviceMode: 'both', assignmentType: 'permanent', daysOfWeek: [1, 2, 3, 4, 5],
            }),
          );
        }
      },
    });
    // A term's assignments end with the term.
    if (no < 3) {
      tl.add({
        at: eat(addDaysIso(term.end, 1), '08:00'),
        priority: 6,
        label: `transport assignments end ${term.name}`,
        run: () => prisma.studentTransportAssignment.updateMany({ where: { organizationId: O, termId: term.id, status: 'active' }, data: { status: 'ended' } }),
      });
    }
    const billDay = { 1: '2026-01-23', 2: '2026-05-08', 3: '2026-08-24' }[no];
    tl.add({ at: eat(billDay, '09:30'), priority: 12, label: `transport billing ${term.name}`, run: () => ctx.as('bursar', () => billing.generateForPeriod({ termId: term.id })) });
  }
  log(`riders: ${riders.size} day pupils on the buses (${[...load.entries()].map(([k, v]) => `${k} ${v}`).join(', ')})`);

  // Who may collect each rider; a few medical notes for the attendants.
  let authorised = 0;
  for (const [pupilId, ride] of riders) {
    const p = pupilById.get(pupilId)!;
    const existing = await prisma.transportAuthorizedPerson.count({ where: { organizationId: O, studentProfileId: pupilId } });
    if (existing > 0) continue;
    const r = rng(`auth:${pupilId}`);
    await as(() => enrollment.addAuthorizedPerson(pupilId, { name: p.guardianName, relationship: 'Parent', phone: p.guardianPhone ?? undefined, stopId: stopId.get(ride.stop), idType: 'National ID', idNumber: `CM${int(r, 80, 99)}0${int(r, 10_000_000, 99_999_999)}${pick(['A', 'B', 'C', 'D'], r)}`, isActive: true, verificationMethod: 'photo' }));
    if (r() < 0.45) {
      const female = r() < 0.7;
      await as(() => enrollment.addAuthorizedPerson(pupilId, { name: `${pick(female ? FEMALE_NAMES : MALE_NAMES, r)} ${p.name.split(' ').pop()}`, relationship: female ? 'House help' : 'Uncle', phone: `+25670${int(r, 1_000_000, 9_999_999)}`, stopId: stopId.get(ride.stop), isActive: true, verificationMethod: 'photo' }));
    }
    if (r() < 0.06) await as(() => enrollment.addSpecialRequirement(pupilId, pick(['medical', 'seating'], r), pick(['Asthmatic — inhaler in school bag.', 'Motion sickness — seat at the front.', 'Allergic to peanuts.'], r)));
    authorised += 1;
  }
  log(`authorised collectors on file for ${authorised} riders`);

  // Requests the transport officer has not finished with.
  const nonRiders = dayPupils.filter((p) => !riders.has(p.id));
  const requests = [
    { type: 'new', route: 'R1', stop: 'NTD', notes: 'Family moved to Ntinda over the holiday.', decision: null },
    { type: 'new', route: 'R4', stop: 'KSB', notes: 'Requesting transport from Term 3 week 6.', decision: null },
    { type: 'new', route: 'R2', stop: 'KRA', notes: 'Both parents now work in town.', decision: 'under_review' },
    { type: 'new', route: 'R3', stop: 'BNG', notes: 'Requesting Bunga pick-up at 6:00am.', decision: 'rejected', why: 'Route 3 is full at Bunga; placed on the waiting list for Term 1 2027.' },
  ];
  for (const [i, q] of requests.entries()) {
    const p = nonRiders[Math.floor(rng(`treq:${i}`)() * nonRiders.length)];
    if (!p) continue;
    const exists = await prisma.transportRequest.findFirst({ where: { organizationId: O, studentProfileId: p.id } });
    if (exists) continue;
    const req: any = await as(() => enrollment.createRequest({ studentProfileId: p.id, type: q.type, requestedRouteId: routeId.get(q.route), requestedStopId: stopId.get(q.stop), requestedStartDate: '2026-10-12', notes: q.notes }));
    if (q.decision) await as(() => enrollment.review(req.id, { decision: q.decision, decisionNotes: q.why }));
  }

  // ── 5. The last two weeks of trips, stop by stop ─────────────────────────
  const tripDays = schoolDaysIso('2026-09-21', ctx.asOf);
  const odometer = new Map(VEHICLES.map((v) => [v.code, v.odo + 18_000]));
  for (const day of tripDays) {
    tl.add({
      at: eat(day, '05:45'),
      priority: 60,
      label: `trips ${day}`,
      run: async () => {
        await as(async () => {
          clock.set(eat(day, '05:30'));
          // generate() rebuilds a trip's stops and manifest, so only ever run it
          // for a day that has no trips yet — never over recorded history.
          const already = await prisma.transportTrip.count({ where: { organizationId: O, date: new Date(`${day}T00:00:00+03:00`) } });
          if (already === 0) await trips.generate(new Date(`${day}T00:00:00+03:00`), 1);
          const todays = await prisma.transportTrip.findMany({
            where: { organizationId: O, date: new Date(`${day}T00:00:00+03:00`) },
            include: { stops: { orderBy: { sequence: 'asc' } }, passengers: true },
            orderBy: [{ direction: 'asc' }, { plannedDeparture: 'asc' }],
          });
          for (const trip of todays) {
            if (trip.status === 'completed' || trip.status === 'cancelled') continue;
            const route = ROUTES.find((r) => routeId.get(r.code) === trip.routeId);
            if (!route) continue;
            await runTrip(trip, route, day);
          }
        });
      },
    });
  }

  const runTrip = async (trip: any, route: RouteSpec, day: string) => {
    const r = rng(`trip:${trip.id}`);
    const vCode = route.vehicle;
    const inbound = trip.direction === 'inbound';
    const depart = new Date(trip.plannedDeparture ?? eat(day, inbound ? route.stops[0].am : '16:45'));
    // Pre-trip inspection by the driver, once a day per vehicle.
    clock.set(new Date(depart.getTime() - 20 * 60_000));
    const dayStart = new Date(`${day}T00:00:00+03:00`);
    const inspected = await prisma.transportVehicleInspection.findFirst({ where: { vehicleId: vehicleId.get(vCode), date: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } });
    if (!inspected) {
      const odo = (odometer.get(vCode) ?? 0) + int(r, 55, 80);
      odometer.set(vCode, odo);
      await fleet.createInspection({
        vehicleId: vehicleId.get(vCode)!, inspectedByCrewId: crewId.get(route.driver)!, date: new Date(depart.getTime() - 20 * 60_000).toISOString(), odometerKm: odo, result: 'pass',
        items: ['Brakes', 'Tyres & wheel nuts', 'Lights & indicators', 'Seat belts', 'Emergency exit & fire extinguisher', 'First-aid box', 'Fuel & oil level'].map((label) => ({ label, isCritical: ['Brakes', 'Tyres & wheel nuts', 'Emergency exit & fire extinguisher'].includes(label), result: 'pass' })),
      });
    }
    if (trip.status === 'scheduled') await trips.dispatch(trip.id, {});
    const delay = r() < 0.15 ? int(r, 8, 25) : int(r, 0, 6);
    clock.set(new Date(depart.getTime() + delay * 60_000));
    await trips.start(trip.id);

    const passengers = trip.passengers as any[];
    const absent = new Set(passengers.filter(() => r() < 0.05).map((x) => x.studentProfileId));
    const events: any[] = [];
    let seq = 0;
    const ev = (studentProfileId: string, eventType: string, stop: string, at: Date) => {
      seq += 1;
      events.push({ clientEventId: `${trip.id}:${studentProfileId}:${eventType}`, studentProfileId, stopId: stop, eventType, source: 'mobile', occurredAt: at.toISOString(), sequence: seq });
    };
    const stops = trip.stops as any[];
    const schoolStop = stopId.get('SCH')!;
    const order = inbound ? stops : [stops[stops.length - 1], ...stops.slice(0, -1).reverse()];
    let t = depart.getTime() + delay * 60_000;
    for (const [i, s] of order.entries()) {
      t += (i === 0 ? 0 : int(r, 8, 15)) * 60_000;
      clock.set(new Date(t));
      await trips.arriveStop(trip.id, s.stopId);
      const at = new Date(t + 60_000);
      if (inbound) {
        for (const p of passengers.filter((x) => x.pickupStopId === s.stopId)) ev(p.studentProfileId, absent.has(p.studentProfileId) ? 'absent' : 'board', s.stopId, at);
        if (s.stopId === schoolStop) for (const p of passengers.filter((x) => !absent.has(x.studentProfileId))) ev(p.studentProfileId, 'drop_off', s.stopId, at);
      } else {
        if (s.stopId === schoolStop) for (const p of passengers.filter((x) => !absent.has(x.studentProfileId))) ev(p.studentProfileId, 'board', s.stopId, at);
        else for (const p of passengers.filter((x) => x.dropoffStopId === s.stopId && !absent.has(x.studentProfileId))) ev(p.studentProfileId, 'drop_off', s.stopId, at);
      }
      clock.set(new Date(t + 3 * 60_000));
      await trips.departStop(trip.id, s.stopId, { stopId: s.stopId });
    }
    if (events.length) await boarding.sync({ tripId: trip.id, events });
    clock.set(new Date(t + 6 * 60_000));
    await safety.setEndOfTripCheck(trip.id, {
      checklist: { busWalkThroughDone: true, noChildLeftOnBoard: true, lostPropertyChecked: true, windowsClosed: true, notes: '' },
      confirmedByCrewId: crewId.get(route.attendant)!,
    });
    await trips.complete(trip.id, {});
    const minutes = Math.round((t - (depart.getTime() + delay * 60_000)) / 60_000);
    await prisma.transportTrip.update({ where: { id: trip.id }, data: { delayMinutes: delay, odometerStart: odometer.get(vCode)! - (inbound ? 0 : 0), odometerEnd: (odometer.get(vCode) ?? 0) + Math.round(route.km), actualArrival: new Date(t + 5 * 60_000) } });
    void minutes;
  };

  // ── 6. Incidents ─────────────────────────────────────────────────────────
  const INCIDENTS = [
    { day: '2026-03-17', type: 'breakdown', severity: 'medium', route: 'R2', at: '06:52', description: 'UBH 078T alternator failed at Kireka stage on the morning run. Pupils transferred to the spare Coaster UBD 640A; arrived 35 minutes late.', action: 'Spare bus dispatched; parents notified by SMS from the transport office.', resolution: 'Alternator replaced at Kawempe Auto Garage the same day.' },
    { day: '2026-05-26', type: 'medical', severity: 'low', route: 'R3', at: '17:20', description: 'P.2 pupil vomited on the evening run (motion sickness). Attendant cleaned up and seated her at the front.', action: 'Mother informed at the Kansanga drop-off.', resolution: 'Seat at the front added to the pupil\'s transport notes.' },
    { day: '2026-07-14', type: 'student_behavior', severity: 'medium', route: 'R4', at: '17:05', description: 'Two P.6 boys fought over a seat on the evening run near Wandegeya.', action: 'Deputy Head met both pupils and their parents the next morning.', resolution: 'Both pupils given assigned seats for the rest of term; written warning issued.' },
    { day: '2026-09-23', type: 'route_deviation', severity: 'low', route: 'R1', at: '06:40', description: 'Kisaasi road closed for KCCA roadworks; driver diverted through Kulambiro, 12 minutes late.', action: 'Transport officer agreed the diversion by phone.', resolution: null },
    { day: '2026-10-01', type: 'unauthorized_pickup', severity: 'high', route: 'R5', at: '13:12', description: 'A man not on the authorised list asked to collect a Middle Class pupil at Naguru. Attendant refused and kept the child on the van.', action: 'Mother called; she had sent a new boda rider without informing the school. Child returned to school and collected by the mother at 2:30pm.', resolution: null },
  ];
  for (const [i, inc] of INCIDENTS.entries()) {
    const route = ROUTES.find((r) => r.code === inc.route)!;
    tl.add({
      at: eat(inc.day, inc.at),
      priority: 61,
      label: `transport incident ${i + 1}`,
      run: async () => {
        const marker = inc.description.slice(0, 60);
        if (await prisma.transportIncident.findFirst({ where: { organizationId: O, description: { startsWith: marker } } })) return;
        const tripRow = await prisma.transportTrip.findFirst({ where: { organizationId: O, routeId: routeId.get(inc.route), date: new Date(`${inc.day}T00:00:00+03:00`) } });
        const riderIds = [...riders.entries()].filter(([, v]) => v.route.code === inc.route).map(([k]) => k);
        const students = inc.type === 'medical' || inc.type === 'unauthorized_pickup' ? riderIds.slice(0, 1) : inc.type === 'student_behavior' ? riderIds.slice(0, 2) : [];
        const created: any = await as(() =>
          safety.createIncident({ type: inc.type, severity: inc.severity, tripId: tripRow?.id, vehicleId: vehicleId.get(route.vehicle), crewMemberId: crewId.get(route.driver), description: inc.description, studentProfileIds: students }),
        );
        await as(() => safety.addAction(created.id, { action: inc.action }));
        if (inc.resolution) {
          clock.set(eat(addDaysIso(inc.day, 1), '10:00'));
          await as(() => safety.resolve(created.id, inc.resolution!));
        }
      },
    });
  }
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type { Pupil };
