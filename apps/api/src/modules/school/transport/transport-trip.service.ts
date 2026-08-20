import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { DispatchTripDto, TripActionDto, CompleteTripDto, TripStopTimeDto } from './dto.types';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TransportTripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  // ── Manual + nightly generation ──
  /**
   * Upsert trips for the next `horizonDays` from `from`. Idempotent by
   * (org, scheduleId, date, direction). Materializes stops + passenger manifest
   * from the route version and active assignments (respecting daysOfWeek,
   * serviceMode, start/end dates). Skips non-teaching days via SchoolCalendarEvent.
   */
  async generate(from: Date, horizonDays = 7) {
    const orgId = this.orgId;
    const schedules = await this.prisma.client.transportSchedule.findMany({
      where: { organizationId: orgId, status: { in: ['active', 'planned'] } },
      include: {
        routeVersion: { include: { routeStops: { orderBy: { sequence: 'asc' }, include: { stop: true } } } },
        exceptions: true,
      },
    });

    const nonTeaching = await this.prisma.client.schoolCalendarEvent.findMany({
      where: { organizationId: orgId, type: { in: ['holiday', 'exam'] } },
      select: { startDate: true, endDate: true },
    });
    const isNonTeaching = (d: Date) => {
      const t = d.getTime();
      return nonTeaching.some((e) => {
        const s = new Date(e.startDate).getTime();
        const en = e.endDate ? new Date(e.endDate).getTime() : s;
        return t >= s && t <= en;
      });
    };

    let created = 0;
    for (const sched of schedules) {
      for (let i = 0; i < horizonDays; i++) {
        const date = new Date(from.getTime() + i * DAY_MS);
        const dow = date.getDay(); // 0 Sun .. 6 Sat
        if (!sched.daysOfWeek.includes(dow)) continue;
        if (isNonTeaching(date)) continue;

        const exception = sched.exceptions.find(
          (e) => new Date(e.date).toDateString() === date.toDateString(),
        );
        if (exception?.kind === 'no_service') continue;

        const routeVersionId = exception?.newRouteVersionId ?? sched.routeVersionId;
        const departureTime = exception?.newDepartureTime ?? sched.departureTime;

        // Upsert trip on the unique key.
        const trip = await this.prisma.client.transportTrip.upsert({
          where: {
            organizationId_scheduleId_date_direction: {
              organizationId: orgId,
              scheduleId: sched.id,
              date,
              direction: sched.direction,
            },
          },
          create: {
            organizationId: orgId,
            scheduleId: sched.id,
            routeVersionId,
            routeId: (sched.routeId ?? '') as string,
            direction: sched.direction,
            date,
            status: 'scheduled',
            plannedDeparture: this.combine(date, departureTime),
            vehicleId: sched.defaultVehicleId,
            driverCrewId: sched.defaultCrewDriverId,
            attendantCrewId: sched.defaultCrewAttendantId,
          },
          update: routeVersionId !== sched.routeVersionId ? { routeVersionId } : {},
        });
        if (trip) created++;

        // Materialize stops.
        const version = exception?.newRouteVersionId
          ? await this.prisma.client.transportRouteVersion.findFirst({
              where: { id: routeVersionId, organizationId: orgId },
              include: { routeStops: { orderBy: { sequence: 'asc' }, include: { stop: true } } },
            })
          : sched.routeVersion;
        await this.prisma.client.transportTripStop.deleteMany({ where: { tripId: trip.id } });
        for (const rs of (version?.routeStops ?? [])) {
          await this.prisma.client.transportTripStop.create({
            data: {
              organizationId: orgId,
              tripId: trip.id,
              stopId: rs.stopId,
              sequence: rs.sequence,
              plannedArrival: rs.plannedArrival ? this.combine(date, rs.plannedArrival) : null,
              plannedDeparture: rs.plannedDeparture ? this.combine(date, rs.plannedDeparture) : null,
            },
          });
        }

        // Materialize passenger manifest from active assignments.
        await this.prisma.client.transportTripPassenger.deleteMany({ where: { tripId: trip.id } });
        const assignments = await this.prisma.client.studentTransportAssignment.findMany({
          where: {
            organizationId: orgId,
            routeId: (sched.routeId ?? '') as string,
            status: 'active',
            startDate: { lte: date },
            OR: [{ endDate: null }, { endDate: { gte: date } }],
            serviceMode: sched.direction === 'inbound' ? { in: ['morning_only', 'both'] } : { in: ['afternoon_only', 'both'] },
            daysOfWeek: { has: dow },
          },
          include: { student: true },
        });
        for (const a of assignments) {
          await this.prisma.client.transportTripPassenger.create({
            data: {
              organizationId: orgId,
              tripId: trip.id,
              studentProfileId: a.studentProfileId,
              pickupStopId: a.pickupStopId ?? a.stopId,
              dropoffStopId: a.dropoffStopId ?? a.stopId,
              assignmentId: a.id,
              status: 'expected',
            },
          });
        }
      }
    }
    return { created };
  }

  private combine(date: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d;
  }

  async listTrips(date?: string) {
    return this.prisma.client.transportTrip.findMany({
      where: { organizationId: this.orgId, ...(date ? { date: new Date(date) } : {}) },
      orderBy: { plannedDeparture: 'asc' },
      include: {
        routeVersion: { include: { route: true } },
        vehicle: true,
        driver: true,
        attendant: true,
        passengers: { include: { student: true } },
      },
    });
  }
  async getTrip(id: string) {
    const row = await this.prisma.client.transportTrip.findFirst({
      where: { id, organizationId: this.orgId },
      include: {
        routeVersion: { include: { route: true } },
        vehicle: true,
        stops: { orderBy: { sequence: 'asc' }, include: { stop: true } },
        passengers: { include: { student: true, pickupStop: true, dropoffStop: true } },
        inspection: true,
      },
    });
    if (!row) throw new NotFoundException(`TransportTrip ${id} not found`);
    return row;
  }

  // ── FSM: scheduled → ready → dispatched → en_route ⇄ at_stop → completed ──
  private async transition(id: string, expected: string[], to: string, data: Record<string, unknown> = {}) {
    const trip = await this.getTrip(id);
    if (!expected.includes(trip.status)) {
      throw new BadRequestException(`Trip ${trip.status} cannot transition to ${to}`);
    }
    const updated = await this.prisma.client.transportTrip.update({
      where: { id, version: trip.version },
      data: { status: to as any, ...data, version: trip.version + 1 },
    });
    await this.recordEvent(id, `→ ${to}`, 'system', undefined);
    return updated;
  }

  async dispatch(id: string, dto: DispatchTripDto) {
    const trip = await this.getTrip(id);
    if (trip.status !== 'scheduled' && trip.status !== 'ready') {
      throw new BadRequestException(`Trip ${trip.status} cannot be dispatched`);
    }
    const vehicleId = dto.vehicleId ?? trip.vehicleId;
    const driverCrewId = dto.driverCrewId ?? trip.driverCrewId;
    const attendantCrewId = dto.attendantCrewId ?? trip.attendantCrewId;
    if (!vehicleId || !driverCrewId) {
      throw new BadRequestException('Vehicle and driver are required to dispatch');
    }
    await this.validateDispatch(vehicleId, driverCrewId, trip.date, id);

    const updated = await this.prisma.client.transportTrip.update({
      where: { id, version: trip.version },
      data: {
        status: 'dispatched',
        vehicleId,
        driverCrewId,
        attendantCrewId,
        actualDeparture: null,
        version: trip.version + 1,
      },
    });
    this.events.publish('school.transport.trip.dispatched' as any, {
      organizationId: this.orgId,
      tripId: id,
      vehicleId,
      driverCrewId,
    } as any);
    await this.recordEvent(id, 'dispatched', 'system', undefined);
    return updated;
  }

  /** Enforce every dispatch guard. Throws BadRequestException with a clear message. */
  async validateDispatch(vehicleId: string, driverCrewId: string, date: Date, tripId: string) {
    const vehicle = await this.prisma.client.vehicle.findFirst({ where: { id: vehicleId, organizationId: this.orgId } });
    if (!vehicle) throw new BadRequestException('Vehicle not found');
    if (!['available', 'assigned'].includes(vehicle.status)) {
      throw new BadRequestException(`Vehicle is ${vehicle.status} (not dispatchable)`);
    }
    const expired = await this.prisma.client.transportVehicleDocument.findFirst({
      where: { vehicleId, expiryDate: { lte: date }, documentType: { in: ['insurance', 'inspection', 'roadworthiness'] } },
    });
    if (expired) throw new BadRequestException(`${expired.documentType} document expired for vehicle`);
    const inspection = await this.prisma.client.transportVehicleInspection.findFirst({
      where: { vehicleId, date: { gte: this.dayStart(date), lt: this.dayEnd(date) }, result: 'pass' },
      include: { items: true },
    });
    if (!inspection) throw new BadRequestException('No passing pre-trip inspection for vehicle today');
    if (inspection.items.some((i) => i.isCritical && i.result === 'fail')) {
      throw new BadRequestException('Pre-trip inspection has a failed critical item');
    }
    const crew = await this.prisma.client.transportCrewMember.findFirst({ where: { id: driverCrewId, organizationId: this.orgId } });
    if (!crew) throw new BadRequestException('Driver not found');
    if (crew.status !== 'active') throw new BadRequestException(`Driver status is ${crew.status}`);
    if (crew.licenseExpiry && new Date(crew.licenseExpiry) < date) throw new BadRequestException('Driver license expired');
    // manifest capacity
    const expectedCount = await this.prisma.client.transportTripPassenger.count({
      where: { tripId, status: 'expected' },
    });
    if (vehicle.operationalCapacity != null && expectedCount > vehicle.operationalCapacity) {
      throw new BadRequestException(
        `Manifest (${expectedCount}) exceeds vehicle operational capacity (${vehicle.operationalCapacity})`,
      );
    }
    if (vehicle.wheelchairCapacity != null) {
      const wheelchair = await this.prisma.client.transportTripPassenger.count({
        where: { tripId, status: 'expected', student: { specialRequirements: { some: { kind: 'wheelchair' } } } },
      });
      if (wheelchair > vehicle.wheelchairCapacity) {
        throw new BadRequestException(`Wheelchair passengers (${wheelchair}) exceed capacity (${vehicle.wheelchairCapacity})`);
      }
    }
  }

  async start(id: string) {
    const trip = await this.getTrip(id);
    await this.recordEvent(id, 'started', 'system', undefined);
    this.events.publish('school.transport.trip.started' as any, { organizationId: this.orgId, tripId: id } as any);
    return this.transition(id, ['dispatched'], 'en_route', { actualDeparture: new Date() });
  }
  async arriveStop(id: string, stopId: string) {
    return this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const trip = await tx.transportTrip.update({ where: { id }, data: { status: 'at_stop' } });
      await tx.transportTripStop.updateMany({ where: { tripId: id, stopId }, data: { actualArrival: new Date() } });
      await this.recordEventTx(tx, id, `arrived ${stopId}`, 'system', undefined);
      return trip;
    });
  }
  async departStop(id: string, stopId: string, dto: TripStopTimeDto) {
    await this.prisma.client.transportTripStop.updateMany({
      where: { tripId: id, stopId },
      data: { actualDeparture: new Date(), skipped: dto.skipped ?? false, skipReason: dto.skipReason ?? null },
    });
    return this.transition(id, ['at_stop'], 'en_route');
  }
  async cancel(id: string, dto: TripActionDto) {
    const updated = await this.transition(id, ['scheduled', 'ready', 'dispatched', 'en_route', 'at_stop'], 'cancelled', {});
    this.events.publish('school.transport.trip.cancelled' as any, { organizationId: this.orgId, tripId: id } as any);
    return updated;
  }
  async abort(id: string, dto: TripActionDto) {
    const updated = await this.transition(id, ['dispatched', 'en_route', 'at_stop'], 'aborted');
    return updated;
  }

  /**
   * Completion guard: end-of-trip check required, and no passenger may remain
   * `boarded`. Non-zero unaccounted requires an explicit supervisor override
   * (reason) and raises a missing_student incident.
   */
  async complete(id: string, dto: CompleteTripDto) {
    const trip = await this.getTrip(id);
    const eot = await this.prisma.client.transportEndOfTripCheck.findFirst({ where: { tripId: id } });
    if (!eot) throw new BadRequestException('End-of-trip check is required before completion');

    const stillBoarded = await this.prisma.client.transportTripPassenger.count({
      where: { tripId: id, status: 'boarded' },
    });
    if (stillBoarded > 0 && !dto.overrideUnaccounted) {
      throw new BadRequestException(
        `Cannot complete: ${stillBoarded} student(s) still boarded. Use overrideUnaccounted with a reason, or resolve each.`,
      );
    }
    if (stillBoarded > 0 && dto.overrideUnaccounted) {
      // Raise a missing_student incident and audit the override.
      const incident = await this.prisma.client.transportIncident.create({
        data: {
          organizationId: this.orgId,
          type: 'missing_student',
          severity: 'high',
          tripId: id,
          vehicleId: trip.vehicleId,
          description: `Completion override with ${stillBoarded} unaccounted student(s). Reason: ${dto.reason ?? 'n/a'}`,
          status: 'open',
        },
      });
      this.events.publish('school.transport.incident.created' as any, {
        organizationId: this.orgId,
        incidentId: incident.id,
        tripId: id,
        severity: 'high',
      } as any);
    }
    this.events.publish('school.transport.trip.completed' as any, { organizationId: this.orgId, tripId: id } as any);
    return this.transition(id, ['en_route', 'at_stop', 'ready', 'dispatched'], 'completed', { actualArrival: new Date() });
  }

  // helpers
  private dayStart(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  private dayEnd(d: Date) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }
  private async recordEvent(tripId: string, eventType: string, actorId: string | undefined, fromStatus?: string) {
    await this.prisma.client.transportTripEvent.create({
      data: { organizationId: this.orgId, tripId, eventType, actorId: actorId ?? null, fromStatus: fromStatus ?? null, occurredAt: new Date() },
    });
  }
  private async recordEventTx(tx: Prisma.TransactionClient, tripId: string, eventType: string, actorId: string | undefined, fromStatus?: string) {
    await tx.transportTripEvent.create({
      data: { organizationId: this.orgId, tripId, eventType, actorId: actorId ?? null, fromStatus: fromStatus ?? null, occurredAt: new Date() },
    });
  }
}
