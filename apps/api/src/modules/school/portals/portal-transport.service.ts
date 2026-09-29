import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { safeTimeZone, zonedDate } from '../../../kernel/common/school-time';

/**
 * Wave 16 — what a family sees about school transport: which route and stops
 * their child is on, and how today's trips are going (expected, boarded,
 * dropped off, delayed).
 *
 * Read-only, and deliberately thin: no crew names or phone numbers, no GPS
 * trail, no other pupils on the bus. The caller's right to this pupil is
 * checked by the portal route before this runs.
 */
@Injectable()
export class PortalTransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async forFamily(studentProfileId: string, now = new Date()) {
    const org = await this.prisma.client.organization.findFirst({
      where: { id: this.tenant.organizationId },
      select: { timezone: true },
    });
    const today = zonedDate(now, safeTimeZone(org?.timezone));
    const dayStart = new Date(Date.UTC(today.year, today.month - 1, today.day));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [assignments, passengers] = await Promise.all([
      this.prisma.client.studentTransportAssignment.findMany({
        where: {
          studentProfileId,
          deletedAt: null,
          status: { in: ['pending', 'active', 'suspended'] },
          OR: [{ endDate: null }, { endDate: { gte: dayStart } }],
        },
        include: {
          route: { select: { name: true, code: true } },
          pickupStop: { select: { name: true, landmark: true } },
          dropoffStop: { select: { name: true, landmark: true } },
          stop: { select: { name: true, landmark: true } },
        },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.client.transportTripPassenger.findMany({
        where: { studentProfileId, trip: { date: { gte: dayStart, lt: dayEnd } } },
        include: {
          trip: {
            select: {
              id: true, direction: true, status: true, plannedDeparture: true, plannedArrival: true,
              actualDeparture: true, actualArrival: true, delayMinutes: true,
            },
          },
          boardingEvents: { orderBy: { occurredAt: 'desc' }, take: 1, select: { eventType: true, occurredAt: true } },
        },
      }),
    ]);

    return {
      date: dayStart.toISOString().slice(0, 10),
      assignments: assignments.map((a: any) => ({
        id: a.id,
        route: a.route?.name ?? null,
        routeCode: a.route?.code ?? null,
        serviceMode: a.serviceMode,
        daysOfWeek: a.daysOfWeek,
        pickupStop: a.pickupStop ?? a.stop ?? null,
        dropoffStop: a.dropoffStop ?? a.stop ?? null,
        startDate: a.startDate,
        endDate: a.endDate,
        status: a.status,
      })),
      today: passengers
        .map((p: any) => ({
          direction: p.trip.direction,
          tripStatus: p.trip.status,
          plannedDeparture: p.trip.plannedDeparture,
          plannedArrival: p.trip.plannedArrival,
          actualDeparture: p.trip.actualDeparture,
          actualArrival: p.trip.actualArrival,
          delayMinutes: p.trip.delayMinutes,
          passengerStatus: p.status,
          lastEvent: p.boardingEvents[0] ?? null,
        }))
        .sort((a, b) => String(a.plannedDeparture ?? '').localeCompare(String(b.plannedDeparture ?? ''))),
    };
  }
}
