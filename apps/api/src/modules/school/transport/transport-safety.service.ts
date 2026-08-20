import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import type { CreateIncidentDto, AddIncidentActionDto, EndOfTripCheckDto } from './dto.types';

@Injectable()
export class TransportSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  async listIncidents(status?: string) {
    return this.prisma.client.transportIncident.findMany({
      where: { organizationId: this.orgId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { students: { include: { student: true } }, actions: true, trip: true, vehicle: true },
    });
  }
  async getIncident(id: string) {
    const row = await this.prisma.client.transportIncident.findFirst({
      where: { id: id, organizationId: this.orgId },
      include: { students: { include: { student: true } }, actions: true },
    });
    if (!row) throw new NotFoundException(`TransportIncident ${id} not found`);
    return row;
  }
  async createIncident(dto: CreateIncidentDto) {
    const incident = await this.prisma.client.transportIncident.create({
      data: {
        organizationId: this.orgId,
        type: (dto.type ?? 'other') as any,
        severity: (dto.severity ?? 'medium') as any,
        tripId: dto.tripId ?? null,
        vehicleId: dto.vehicleId ?? null,
        crewMemberId: dto.crewMemberId ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        description: dto.description ?? null,
        status: 'open',
        reportedById: this.tenant.userId ?? null,
      },
      include: { students: true, actions: true },
    });
    if (dto.studentProfileIds?.length) {
      await this.prisma.client.transportIncidentStudent.createMany({
        data: dto.studentProfileIds.map((sid) => ({ organizationId: this.orgId, incidentId: incident.id, studentProfileId: sid })),
      });
    }
    this.events.publish('school.transport.incident.created' as any, {
      organizationId: this.orgId,
      incidentId: incident.id,
      tripId: dto.tripId,
      severity: incident.severity,
    } as any);
    if (incident.type === 'emergency' || incident.severity === 'critical') {
      this.events.publish('school.transport.incident.emergency' as any, {
        organizationId: this.orgId,
        incidentId: incident.id,
        tripId: dto.tripId,
      } as any);
    }
    return this.getIncident(incident.id);
  }
  async addAction(id: string, dto: AddIncidentActionDto) {
    await this.getIncident(id);
    await this.prisma.client.transportIncidentAction.create({
      data: { organizationId: this.orgId, incidentId: id, action: dto.action, actorId: dto.actorId ?? this.tenant.userId ?? null, notes: dto.notes ?? null, fileId: dto.fileId ?? null },
    });
  }
  async resolve(id: string, resolutionNotes: string) {
    const incident = await this.prisma.client.transportIncident.update({
      where: { id },
      data: { status: 'resolved', resolutionNotes, resolvedAt: new Date(), resolvedById: this.tenant.userId ?? null },
    });
    await this.audit.record({ entity: 'TransportIncident', entityId: id, action: 'update' });
    return incident;
  }

  // ── End-of-trip check (trip cannot close without it) ──
  async setEndOfTripCheck(tripId: string, dto: EndOfTripCheckDto) {
    const existing = await this.prisma.client.transportEndOfTripCheck.findFirst({ where: { tripId } });
    if (existing) {
      return this.prisma.client.transportEndOfTripCheck.update({
        where: { id: existing.id },
        data: { checklist: dto.checklist as any, confirmedByCrewId: dto.confirmedByCrewId, confirmedAt: new Date() },
      });
    }
    return this.prisma.client.transportEndOfTripCheck.create({
      data: { organizationId: this.orgId, tripId, checklist: dto.checklist as any, confirmedByCrewId: dto.confirmedByCrewId },
    });
  }
}
