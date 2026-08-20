import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { CreateScheduleDto, CreateScheduleExceptionDto } from './dto.types';

@Injectable()
export class TransportScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  async listSchedules() {
    return this.prisma.client.transportSchedule.findMany({
      where: { organizationId: this.orgId },
      orderBy: [{ direction: 'asc' }, { departureTime: 'asc' }],
      include: { routeVersion: { include: { route: true } }, vehicle: true, driver: true, attendant: true },
    });
  }
  async getSchedule(id: string) {
    const row = await this.prisma.client.transportSchedule.findFirst({
      where: { id, organizationId: this.orgId },
      include: { routeVersion: true, exceptions: true },
    });
    if (!row) throw new NotFoundException(`TransportSchedule ${id} not found`);
    return row;
  }
  async createSchedule(dto: CreateScheduleDto) {
    const version = await this.prisma.client.transportRouteVersion.findFirst({
      where: { id: dto.routeVersionId, organizationId: this.orgId },
    });
    if (!version) throw new BadRequestException(`TransportRouteVersion ${dto.routeVersionId} not found`);
    return this.prisma.client.transportSchedule.create({
      data: {
        organizationId: this.orgId,
        routeVersionId: dto.routeVersionId,
        routeId: version.routeId,
        direction: dto.direction as any,
        daysOfWeek: dto.daysOfWeek,
        departureTime: dto.departureTime,
        defaultVehicleId: dto.defaultVehicleId ?? null,
        defaultCrewDriverId: dto.defaultCrewDriverId ?? null,
        defaultCrewAttendantId: dto.defaultCrewAttendantId ?? null,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        status: (dto.status ?? 'active') as any,
      },
    });
  }
  async updateSchedule(id: string, dto: Partial<CreateScheduleDto>) {
    await this.getSchedule(id);
    return this.prisma.client.transportSchedule.update({
      where: { id },
      data: {
        ...(dto.routeVersionId ? { routeVersionId: dto.routeVersionId } : {}),
        ...(dto.direction ? { direction: dto.direction as any } : {}),
        ...(dto.daysOfWeek ? { daysOfWeek: dto.daysOfWeek } : {}),
        ...(dto.departureTime ? { departureTime: dto.departureTime } : {}),
        ...(dto.defaultVehicleId !== undefined ? { defaultVehicleId: dto.defaultVehicleId } : {}),
        ...(dto.defaultCrewDriverId !== undefined ? { defaultCrewDriverId: dto.defaultCrewDriverId } : {}),
        ...(dto.defaultCrewAttendantId !== undefined ? { defaultCrewAttendantId: dto.defaultCrewAttendantId } : {}),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null } : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null } : {}),
        ...(dto.status ? { status: dto.status as any } : {}),
      },
    });
  }
  async removeSchedule(id: string) {
    await this.getSchedule(id);
    await this.prisma.client.transportSchedule.update({ where: { id }, data: { status: 'retired' } });
  }

  async addException(scheduleId: string, dto: CreateScheduleExceptionDto) {
    await this.getSchedule(scheduleId);
    return this.prisma.client.transportScheduleException.create({
      data: {
        organizationId: this.orgId,
        scheduleId,
        date: new Date(dto.date),
        kind: dto.kind as any,
        newDepartureTime: dto.newDepartureTime ?? null,
        newRouteVersionId: dto.newRouteVersionId ?? null,
        reason: dto.reason ?? null,
        calendarEventId: dto.calendarEventId ?? null,
      },
    });
  }
}
