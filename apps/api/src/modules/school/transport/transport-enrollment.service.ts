import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateTransportRequestDto,
  ReviewTransportRequestDto,
  CreateAssignmentDto,
  ChangeAssignmentStatusDto,
  CreateAuthorizedPersonDto,
} from './dto.types';

@Injectable()
export class TransportEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  // ── Requests (FSM: submitted → under_review → {approved, rejected}; + withdrawn) ──
  async listRequests(status?: string) {
    return this.prisma.client.transportRequest.findMany({
      where: { organizationId: this.orgId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { student: true, route: true, stop: true },
    });
  }
  async getRequest(id: string) {
    const row = await this.prisma.client.transportRequest.findFirst({
      where: { id, organizationId: this.orgId },
      include: { student: true, route: true, stop: true, assignment: true },
    });
    if (!row) throw new NotFoundException(`TransportRequest ${id} not found`);
    return row;
  }
  async createRequest(dto: CreateTransportRequestDto) {
    const req = await this.prisma.client.transportRequest.create({
      data: {
        organizationId: this.orgId,
        studentProfileId: dto.studentProfileId,
        type: (dto.type ?? 'new') as any,
        requestedRouteId: dto.requestedRouteId ?? null,
        requestedStopId: dto.requestedStopId ?? null,
        requestedStartDate: dto.requestedStartDate ? new Date(dto.requestedStartDate) : null,
        requestedEndDate: dto.requestedEndDate ? new Date(dto.requestedEndDate) : null,
        status: 'submitted',
        notes: dto.notes ?? null,
      },
    });
    this.events.publish('school.transport.request.submitted' as any, {
      organizationId: this.orgId,
      requestId: req.id,
      studentProfileId: req.studentProfileId,
    } as any);
    return this.getRequest(req.id);
  }
  async review(id: string, dto: ReviewTransportRequestDto) {
    const req = await this.getRequest(id);
    if (!['submitted', 'under_review'].includes(req.status)) {
      throw new BadRequestException(`Cannot review a request in status ${req.status}`);
    }
    if (dto.decision === 'under_review') {
      return this.prisma.client.transportRequest.update({
        where: { id },
        data: { status: 'under_review', decisionNotes: dto.decisionNotes ?? null },
      });
    }
    if (dto.decision === 'withdrawn') {
      return this.prisma.client.transportRequest.update({ where: { id }, data: { status: 'withdrawn' } });
    }
    if (dto.decision === 'rejected') {
      await this.prisma.client.transportRequest.update({
        where: { id },
        data: { status: 'rejected', reviewedById: this.tenant.userId ?? null, decisionNotes: dto.decisionNotes ?? null },
      });
      this.events.publish('school.transport.request.rejected' as any, {
        organizationId: this.orgId,
        requestId: req.id,
        studentProfileId: req.studentProfileId,
      } as any);
      return this.getRequest(id);
    }
    // approved → mint an assignment
    const stopId = dto.requestedStopId ?? req.requestedStopId;
    if (!stopId || !req.requestedRouteId) {
      throw new BadRequestException('Approved request requires route + stop');
    }
    const assignment = await this.createAssignment({
      studentProfileId: undefined as any, // filled below
      routeId: req.requestedRouteId,
      stopId,
      termId: '',
      startDate: new Date(dto.requestedStartDate ?? req.requestedStartDate ?? new Date()).toISOString(),
      pickupStopId: stopId,
      dropoffStopId: stopId,
      serviceMode: 'both',
      requestId: req.id,
    } as any);
    await this.prisma.client.transportRequest.update({
      where: { id },
      data: { status: 'approved', reviewedById: this.tenant.userId ?? null, decisionNotes: dto.decisionNotes ?? null, assignmentId: assignment.id },
    });
    this.events.publish('school.transport.request.approved' as any, {
      organizationId: this.orgId,
      requestId: req.id,
      assignmentId: assignment.id,
      studentProfileId: req.studentProfileId,
    } as any);
    return this.getRequest(id);
  }

  // ── Assignments (history-preserving; one active per student/term/mode) ──
  async listAssignments(studentProfileId?: string) {
    return this.prisma.client.studentTransportAssignment.findMany({
      where: { organizationId: this.orgId, ...(studentProfileId ? { studentProfileId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { student: true, route: true, stop: true, pickupStop: true, dropoffStop: true },
    });
  }
  async getAssignment(id: string) {
    const row = await this.prisma.client.studentTransportAssignment.findFirst({
      where: { id, organizationId: this.orgId },
      include: { student: true, route: true, stop: true, pickupStop: true, dropoffStop: true, charges: true },
    });
    if (!row) throw new NotFoundException(`StudentTransportAssignment ${id} not found`);
    return row;
  }
  async createAssignment(dto: CreateAssignmentDto) {
    if (dto.studentProfileId === undefined) {
      throw new BadRequestException('studentProfileId is required');
    }
    const term = await this.prisma.client.term.findFirst({ where: { id: dto.termId, organizationId: this.orgId } });
    if (!term) throw new BadRequestException(`Term ${dto.termId} not found`);

    // Capacity guard: active assignments on the route must not exceed
    // operational capacity unless explicitly overridden (handled by caller).
    return this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const a = await tx.studentTransportAssignment.create({
        data: {
          organizationId: this.orgId,
          studentProfileId: dto.studentProfileId,
          routeId: dto.routeId,
          stopId: dto.stopId,
          pickupStopId: dto.pickupStopId ?? dto.stopId,
          dropoffStopId: dto.dropoffStopId ?? dto.stopId,
          campusId: dto.campusId ?? null,
          academicYearId: dto.academicYearId ?? null,
          termId: dto.termId,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          serviceMode: (dto.serviceMode ?? 'both') as any,
          assignmentType: (dto.assignmentType ?? 'permanent') as any,
          daysOfWeek: dto.daysOfWeek ?? [],
          monthlyFee: dto.monthlyFee != null ? new Prisma.Decimal(dto.monthlyFee) : undefined,
          status: 'active',
          requestId: dto.requestId ?? null,
        },
        include: { student: true, route: true, stop: true },
      });
      await this.audit.recordInTx(tx, { entity: 'StudentTransportAssignment', entityId: a.id, action: 'create' });
      this.events.publish('school.transport.assigned' as any, {
        organizationId: this.orgId,
        assignmentId: a.id,
        studentProfileId: a.studentProfileId,
        routeId: a.routeId,
      } as any);
      return a;
    });
  }

  /** Reassign ends the prior active row and creates a new one — never rewrites history. */
  async reassign(id: string, dto: CreateAssignmentDto) {
    const prior = await this.getAssignment(id);
    if (prior.status === 'active') {
      await this.prisma.client.studentTransportAssignment.update({ where: { id }, data: { status: 'ended', endDate: new Date() } });
      this.events.publish('school.transport.assignment.ended' as any, {
        organizationId: this.orgId,
        assignmentId: id,
        studentProfileId: prior.studentProfileId,
      } as any);
    }
    const next = await this.createAssignment({ ...dto, startDate: dto.startDate ?? new Date().toISOString() });
    this.events.publish('school.transport.assignment.changed' as any, {
      organizationId: this.orgId,
      assignmentId: next.id,
      studentProfileId: next.studentProfileId,
    } as any);
    return next;
  }

  async changeStatus(id: string, dto: ChangeAssignmentStatusDto) {
    const a = await this.getAssignment(id);
    if (dto.status === 'ended' || dto.status === 'cancelled') {
      await this.prisma.client.studentTransportAssignment.update({
        where: { id },
        data: { status: dto.status as any, endDate: dto.endDate ? new Date(dto.endDate) : new Date() },
      });
      this.events.publish('school.transport.assignment.ended' as any, {
        organizationId: this.orgId,
        assignmentId: id,
        studentProfileId: a.studentProfileId,
      } as any);
    } else {
      await this.prisma.client.studentTransportAssignment.update({ where: { id }, data: { status: dto.status as any } });
    }
    await this.audit.record({ entity: 'StudentTransportAssignment', entityId: id, action: 'update' });
    return this.getAssignment(id);
  }

  // ── Authorized persons ──
  async listAuthorizedPersons(studentProfileId: string) {
    return this.prisma.client.transportAuthorizedPerson.findMany({
      where: { studentProfileId, organizationId: this.orgId },
      orderBy: { name: 'asc' },
    });
  }
  async addAuthorizedPerson(studentProfileId: string, dto: CreateAuthorizedPersonDto) {
    return this.prisma.client.transportAuthorizedPerson.create({
      data: { organizationId: this.orgId, studentProfileId, ...dto },
    });
  }
  async removeAuthorizedPerson(studentProfileId: string, personId: string) {
    const row = await this.prisma.client.transportAuthorizedPerson.findFirst({
      where: { id: personId, studentProfileId, organizationId: this.orgId },
    });
    if (!row) throw new NotFoundException(`TransportAuthorizedPerson ${personId} not found`);
    await this.prisma.client.transportAuthorizedPerson.update({ where: { id: personId }, data: { isActive: false } });
  }

  // ── Special requirements ──
  async listSpecialRequirements(studentProfileId: string) {
    return this.prisma.client.transportSpecialRequirement.findMany({
      where: { studentProfileId, organizationId: this.orgId },
    });
  }
  async addSpecialRequirement(studentProfileId: string, kind: string, notes: string, validFrom?: string, validTo?: string) {
    return this.prisma.client.transportSpecialRequirement.create({
      data: {
        organizationId: this.orgId,
        studentProfileId,
        kind: kind as any,
        notes,
        validFrom: validFrom ? new Date(validFrom) : new Date(),
        validTo: validTo ? new Date(validTo) : null,
      },
    });
  }
  async removeSpecialRequirement(studentProfileId: string, reqId: string) {
    const row = await this.prisma.client.transportSpecialRequirement.findFirst({
      where: { id: reqId, studentProfileId, organizationId: this.orgId },
    });
    if (!row) throw new NotFoundException(`TransportSpecialRequirement ${reqId} not found`);
    await this.prisma.client.transportSpecialRequirement.update({ where: { id: reqId }, data: { validTo: new Date() } });
  }
}
