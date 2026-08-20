import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { DriverSyncDto, BoardingEventInput } from './dto.types';

@Injectable()
export class TransportBoardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  /**
   * Offline-safe sync endpoint. Returns per-event status so the driver PWA can
   * clear its outbox precisely:
   *   applied     — new row written
   *   duplicate   — same clientEventId already present (idempotent)
   *   conflict    — contradicting board/drop_off for same (trip, student) arrived
   *                 earlier; stored as manual_override with mandatory reason
   */
  async sync(dto: DriverSyncDto) {
    const trip = await this.prisma.client.transportTrip.findFirst({
      where: { id: dto.tripId, organizationId: this.orgId },
    });
    if (!trip) throw new NotFoundException(`TransportTrip ${dto.tripId} not found`);

    const results: Array<{ clientEventId: string; status: 'applied' | 'duplicate' | 'conflict' }> = [];
    for (const ev of dto.events) {
      results.push(await this.record(ev, dto.tripId));
    }
    return { tripId: dto.tripId, results };
  }

  async record(ev: BoardingEventInput, tripId: string): Promise<{ clientEventId: string; status: 'applied' | 'duplicate' | 'conflict' }> {
    const orgId = this.orgId;
    // 1) Idempotency: same clientEventId => duplicate (no new row).
    const existing = await this.prisma.client.transportBoardingEvent.findFirst({
      where: { organizationId: orgId, clientEventId: ev.clientEventId },
    });
    if (existing) return { clientEventId: ev.clientEventId, status: 'duplicate' };

    // 2) First-write-wins for (trip, student, eventType) in {board, drop_off}.
    if (ev.eventType === 'board' || ev.eventType === 'drop_off') {
      const prior = await this.prisma.client.transportBoardingEvent.findFirst({
        where: { organizationId: orgId, tripId, studentProfileId: ev.studentProfileId, eventType: ev.eventType },
      });
      if (prior) {
        // Contradicting event already recorded — store as manual_override.
        await this.prisma.client.transportBoardingEvent.create({
          data: {
            organizationId: orgId,
            tripId,
            studentProfileId: ev.studentProfileId,
            stopId: ev.stopId ?? null,
            eventType: 'manual_override',
            occurredAt: ev.occurredAt ? new Date(ev.occurredAt) : new Date(),
            source: (ev.source ?? 'mobile') as any,
            deviceId: null,
            recordedById: this.tenant.userId ?? null,
            latitude: ev.latitude ?? null,
            longitude: ev.longitude ?? null,
            reason: `Conflicting ${ev.eventType} (client ${ev.clientEventId})`,
            clientEventId: ev.clientEventId,
            clientRecordedAt: ev.occurredAt ? new Date(ev.occurredAt) : null,
            sequence: ev.sequence ?? null,
          },
        });
        return { clientEventId: ev.clientEventId, status: 'conflict' };
      }
    }

    // 3) Write the event + update the passenger manifest status.
    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.transportBoardingEvent.create({
        data: {
          organizationId: orgId,
          tripId,
          studentProfileId: ev.studentProfileId,
          stopId: ev.stopId ?? null,
          eventType: ev.eventType as any,
          occurredAt: ev.occurredAt ? new Date(ev.occurredAt) : new Date(),
          source: (ev.source ?? 'mobile') as any,
          deviceId: null,
          recordedById: this.tenant.userId ?? null,
          latitude: ev.latitude ?? null,
          longitude: ev.longitude ?? null,
          reason: ev.reason ?? null,
          releasedToPersonId: ev.releasedToPersonId ?? null,
          clientEventId: ev.clientEventId,
          clientRecordedAt: ev.occurredAt ? new Date(ev.occurredAt) : null,
          sequence: ev.sequence ?? null,
        },
      });
      // Manifest status follows the latest event.
      const status = ev.eventType === 'board' ? 'boarded' : ev.eventType === 'drop_off' ? 'dropped_off' : (ev.eventType as any);
      await tx.transportTripPassenger.updateMany({
        where: { tripId, studentProfileId: ev.studentProfileId },
        data: { status },
      });
    });

    this.publishBoarding(orgId, tripId, ev);
    return { clientEventId: ev.clientEventId, status: 'applied' };
  }

  private publishBoarding(orgId: string, tripId: string, ev: BoardingEventInput) {
    if (ev.eventType === 'board') {
      this.events.publish('school.transport.student.boarded' as any, {
        organizationId: orgId,
        tripId,
        studentProfileId: ev.studentProfileId,
        stopId: ev.stopId,
      } as any);
    } else if (ev.eventType === 'drop_off') {
      this.events.publish('school.transport.student.dropped_off' as any, {
        organizationId: orgId,
        tripId,
        studentProfileId: ev.studentProfileId,
        stopId: ev.stopId,
      } as any);
    } else if (ev.eventType === 'no_show') {
      this.events.publish('school.transport.student.no_show' as any, orgId as any);
    }
  }

  async listEvents(tripId: string) {
    return this.prisma.client.transportBoardingEvent.findMany({
      where: { tripId, organizationId: this.orgId },
      orderBy: { occurredAt: 'asc' },
      include: { student: true, stop: true },
    });
  }
}
