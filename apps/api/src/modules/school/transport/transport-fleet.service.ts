import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { CreateVehicleDto, UpdateVehicleDto, AddVehicleDocumentDto, CreateInspectionDto } from './dto.types';

@Injectable()
export class TransportFleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  async listVehicles() {
    return this.prisma.client.vehicle.findMany({
      where: { organizationId: this.orgId },
      orderBy: { code: 'asc' },
      include: {
        documents: true,
        inspections: { orderBy: { date: 'desc' }, take: 1 },
      },
    });
  }
  async getVehicle(id: string) {
    const row = await this.prisma.client.vehicle.findFirst({
      where: { id, organizationId: this.orgId },
      include: { documents: true, inspections: { orderBy: { date: 'desc' } } },
    });
    if (!row) throw new NotFoundException(`Vehicle ${id} not found`);
    return row;
  }
  async createVehicle(dto: CreateVehicleDto) {
    return this.prisma.client.vehicle.create({
      data: { organizationId: this.orgId, ...(dto as any) },
    });
  }
  async updateVehicle(id: string, dto: UpdateVehicleDto) {
    await this.getVehicle(id);
    return this.prisma.client.vehicle.update({ where: { id }, data: { ...(dto as any) } });
  }
  async removeVehicle(id: string) {
    await this.getVehicle(id);
    await this.prisma.client.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Vehicle documents ──
  async listVehicleDocuments(vehicleId: string) {
    await this.getVehicle(vehicleId);
    return this.prisma.client.transportVehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { documentType: 'asc' },
    });
  }
  async addVehicleDocument(vehicleId: string, dto: AddVehicleDocumentDto) {
    await this.getVehicle(vehicleId);
    return this.prisma.client.transportVehicleDocument.create({
      data: {
        organizationId: this.orgId,
        vehicleId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        fileId: dto.fileId ?? null,
      },
    });
  }
  async removeVehicleDocument(vehicleId: string, docId: string) {
    const doc = await this.prisma.client.transportVehicleDocument.findFirst({
      where: { id: docId, vehicleId },
    });
    if (!doc) throw new NotFoundException(`TransportVehicleDocument ${docId} not found`);
    await this.prisma.client.transportVehicleDocument.delete({ where: { id: docId } });
  }

  /** Daily sweep: vehicles with an expired blocking document (insurance/
   *  inspection/roadworthiness) as of today. */
  async expiringDocuments(asOf = new Date()) {
    const docs = await this.prisma.client.transportVehicleDocument.findMany({
      where: {
        organizationId: this.orgId,
        expiryDate: { lte: asOf },
        documentType: { in: ['insurance', 'inspection', 'roadworthiness'] },
      },
      include: { vehicle: true },
    });
    return docs;
  }

  // ── Pre-trip inspections ──
  async listInspections(vehicleId: string) {
    await this.getVehicle(vehicleId);
    return this.prisma.client.transportVehicleInspection.findMany({
      where: { vehicleId },
      orderBy: { date: 'desc' },
      include: { items: true, crewMember: true },
    });
  }
  async createInspection(dto: CreateInspectionDto) {
    await this.getVehicle(dto.vehicleId);
    return this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const items = (dto.items ?? []).map((it) => ({
        organizationId: this.orgId,
        label: it.label,
        isCritical: it.isCritical ?? false,
        result: (it.result ?? 'pass') as any,
        notes: it.notes ?? null,
      }));
      const hasBlockingFail = items.some((i) => i.isCritical && i.result === 'fail');
      const result = (dto.result ?? (hasBlockingFail ? 'fail' : 'pass')) as any;
      const inspection = await tx.transportVehicleInspection.create({
        data: {
          organizationId: this.orgId,
          vehicleId: dto.vehicleId,
          inspectedByCrewId: dto.inspectedByCrewId,
          date: new Date(dto.date),
          odometerKm: dto.odometerKm ?? new Prisma.Decimal(0),
          result,
          notes: dto.notes ?? null,
          items: { create: items },
        },
        include: { items: true, crewMember: true },
      });
      if (result === 'fail') {
        this.events.publish('school.transport.inspection.failed' as any, {
          organizationId: this.orgId,
          inspectionId: inspection.id,
          vehicleId: dto.vehicleId,
        } as any);
      }
      return inspection;
    });
  }

  /** A passing inspection for (vehicle, date) with zero critical fails. */
  async passingInspection(vehicleId: string, date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const insp = await this.prisma.client.transportVehicleInspection.findFirst({
      where: {
        vehicleId,
        date: { gte: start, lt: end },
        result: 'pass',
      },
      include: { items: true },
    });
    if (!insp) return null;
    const blocking = insp.items.some((i) => i.isCritical && i.result === 'fail');
    return blocking ? null : insp;
  }
}
