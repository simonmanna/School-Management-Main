import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EVENTS } from '@erp/shared';
import type {
  UpsertTransportSettingsDto,
  CreateTransportZoneDto,
  UpdateTransportZoneDto,
  CreateStopDto,
  UpdateStopDto,
  CreateRouteDto,
  UpdateRouteDto,
  CreateRouteVersionDto,
  PublishRouteVersionDto,
  SetRouteStopsDto,
} from './dto.types';

@Injectable()
export class TransportConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  // ── Settings ──
  async getSettings() {
    return (
      (await this.prisma.client.transportSettings.findFirst({
        where: { organizationId: this.orgId },
      })) ?? null
    );
  }

  async upsertSettings(dto: UpsertTransportSettingsDto) {
    const existing = await this.prisma.client.transportSettings.findFirst({
      where: { organizationId: this.orgId },
    });
    if (existing) {
      return this.prisma.client.transportSettings.update({
        where: { id: existing.id },
        data: { ...dto },
      });
    }
    return this.prisma.client.transportSettings.create({
      data: { organizationId: this.orgId, ...dto },
    });
  }

  // ── Zones ──
  async listZones() {
    return this.prisma.client.transportZone.findMany({
      where: { organizationId: this.orgId },
      orderBy: { name: 'asc' },
    });
  }
  async getZone(id: string) {
    const row = await this.prisma.client.transportZone.findFirst({
      where: { id, organizationId: this.orgId },
    });
    if (!row) throw new NotFoundException(`TransportZone ${id} not found`);
    return row;
  }
  async createZone(dto: CreateTransportZoneDto) {
    return this.prisma.client.transportZone.create({
      data: { organizationId: this.orgId, ...(dto as any) },
    });
  }
  async updateZone(id: string, dto: UpdateTransportZoneDto) {
    await this.getZone(id);
    return this.prisma.client.transportZone.update({ where: { id }, data: { ...(dto as any) } });
  }
  async removeZone(id: string) {
    await this.getZone(id);
    await this.prisma.client.transportZone.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Stops (standalone location) ──
  async listStops() {
    return this.prisma.client.stop.findMany({
      where: { organizationId: this.orgId },
      orderBy: { code: 'asc' },
      include: { zone: true },
    });
  }
  async getStop(id: string) {
    const row = await this.prisma.client.stop.findFirst({
      where: { id, organizationId: this.orgId },
      include: { zone: true },
    });
    if (!row) throw new NotFoundException(`Stop ${id} not found`);
    return row;
  }
  async createStop(dto: CreateStopDto) {
    return this.prisma.client.stop.create({
      data: { organizationId: this.orgId, ...(dto as any) },
    });
  }
  async updateStop(id: string, dto: UpdateStopDto) {
    await this.getStop(id);
    return this.prisma.client.stop.update({ where: { id }, data: { ...(dto as any) } });
  }
  async removeStop(id: string) {
    await this.getStop(id);
    await this.prisma.client.stop.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Routes ──
  async listRoutes() {
    return this.prisma.client.route.findMany({
      where: { organizationId: this.orgId },
      orderBy: { name: 'asc' },
      include: { versions: { orderBy: { versionNo: 'desc' } } },
    });
  }
  async getRoute(id: string) {
    const row = await this.prisma.client.route.findFirst({
      where: { id, organizationId: this.orgId },
      include: {
        versions: { orderBy: { versionNo: 'desc' }, include: { routeStops: { orderBy: { sequence: 'asc' }, include: { stop: true } } } },
      },
    });
    if (!row) throw new NotFoundException(`Route ${id} not found`);
    return row;
  }
  async createRoute(dto: CreateRouteDto) {
    return this.prisma.client.route.create({
      data: { organizationId: this.orgId, ...(dto as any) },
    });
  }
  async updateRoute(id: string, dto: UpdateRouteDto) {
    await this.getRoute(id);
    return this.prisma.client.route.update({ where: { id }, data: { ...(dto as any) } });
  }
  async removeRoute(id: string) {
    await this.getRoute(id);
    await this.prisma.client.route.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Route versions (immutable history) ──
  async listVersions(routeId: string) {
    return this.prisma.client.transportRouteVersion.findMany({
      where: { routeId, organizationId: this.orgId },
      orderBy: { versionNo: 'desc' },
      include: { routeStops: { orderBy: { sequence: 'asc' }, include: { stop: true } } },
    });
  }
  async getVersion(routeId: string, versionId: string) {
    const row = await this.prisma.client.transportRouteVersion.findFirst({
      where: { id: versionId, routeId, organizationId: this.orgId },
      include: { routeStops: { orderBy: { sequence: 'asc' }, include: { stop: true } } },
    });
    if (!row) throw new NotFoundException(`TransportRouteVersion ${versionId} not found`);
    return row;
  }
  async createVersion(routeId: string, dto: CreateRouteVersionDto) {
    const route = await this.getRoute(routeId);
    const version = await this.prisma.client.transportRouteVersion.create({
      data: {
        organizationId: this.orgId,
        routeId,
        versionNo: dto.versionNo,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        status: (dto.status as any) ?? 'draft',
        notes: dto.notes,
      },
    });
    await this.audit.record(
      { entity: 'TransportRouteVersion', entityId: version.id, action: 'create' },
    );
    return this.getVersion(routeId, version.id);
  }

  /**
   * Publish a route version: the prior active/superseded version is retired and
   * the route's currentVersionId is set. Reassigning never rewrites history —
   * trips keep their routeVersionId.
   */
  async publishVersion(routeId: string, versionId: string, dto: PublishRouteVersionDto) {
    const route = await this.getRoute(routeId);
    const version = await this.getVersion(routeId, versionId);
    if (version.status === 'active') {
      throw new BadRequestException('Version is already active');
    }
    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      // Retire any currently-active version.
      await tx.transportRouteVersion.updateMany({
        where: { routeId, organizationId: this.orgId, status: 'active' },
        data: { status: 'retired', effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : new Date() },
      });
      await tx.transportRouteVersion.update({
        where: { id: versionId },
        data: { status: 'active', effectiveFrom: version.effectiveFrom, effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null, notes: dto.notes ?? version.notes },
      });
      await tx.route.update({
        where: { id: routeId },
        data: { currentVersionId: versionId, status: route.status === 'draft' ? 'planned' : route.status },
      });
      await this.audit.record({ entity: 'TransportRouteVersion', entityId: versionId, action: 'update' });
    });
    return this.getVersion(routeId, versionId);
  }

  /** Materialize the ordered stops for a version. Replaces the prior set. */
  async setVersionStops(routeId: string, versionId: string, dto: SetRouteStopsDto) {
    await this.getVersion(routeId, versionId);
    const seqs = dto.stops.map((s) => s.sequence);
    if (new Set(seqs).size !== seqs.length) {
      throw new BadRequestException('Stop sequences must be unique within a version');
    }
    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.transportRouteStop.deleteMany({ where: { routeVersionId: versionId } });
      for (const s of dto.stops) {
        await tx.transportRouteStop.create({
          data: {
            organizationId: this.orgId,
            routeVersionId: versionId,
            stopId: s.stopId,
            sequence: s.sequence,
            plannedArrival: s.plannedArrival ?? null,
            plannedDeparture: s.plannedDeparture ?? null,
            pickupAllowed: s.pickupAllowed ?? true,
            dropoffAllowed: s.dropoffAllowed ?? true,
            studentCapacity: s.studentCapacity ?? null,
            distanceFromPrevKm: s.distanceFromPrevKm ?? null,
            feeOverride: s.feeOverride ?? null,
          },
        });
      }
    });
    return this.getVersion(routeId, versionId);
  }
}
