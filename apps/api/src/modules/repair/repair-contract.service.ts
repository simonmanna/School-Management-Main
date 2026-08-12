import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

/**
 * RepairContractService — service contracts (SLA maintenance) and preventive
 * maintenance schedules. A contract defines the customer, term and visit
 * cadence; a schedule drives the cron worker that auto-generates preventive
 * repair orders (RepairCronWorker).
 */
@Injectable()
export class RepairContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
  ) {}

  // ── Contracts ─────────────────────────────────────────────────────────────

  async listContracts(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.partnerId) where.partnerId = query.partnerId;
    return this.prisma.client.repairServiceContract.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Number(query.take ?? 50), 200),
      skip: Number(query.skip ?? 0),
    });
  }

  async createContract(dto: any) {
    const orgId = this.tenant.organizationId;
    const contractNumber = await this.seq.next('repair_contract', { prefix: 'CTR-', padding: 6 });
    return this.prisma.client.repairServiceContract.create({
      data: {
        organizationId: orgId,
        contractNumber,
        partnerId: dto.partnerId ?? null,
        title: dto.title,
        status: dto.status ?? 'draft',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        frequencyDays: dto.frequencyDays ?? 30,
        slaHours: dto.slaHours ?? null,
        includedLabour: dto.includedLabour ?? [],
        includedParts: dto.includedParts ?? [],
        notes: dto.notes ?? null,
        createdBy: this.tenant.userId,
      },
    });
  }

  async updateContract(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairServiceContract', id, orgId);
    return this.prisma.client.repairServiceContract.update({
      where: { id },
      data: { ...dto, updatedBy: this.tenant.userId },
    });
  }

  async activateContract(id: string) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairServiceContract', id, orgId);
    return this.prisma.client.repairServiceContract.update({
      where: { id },
      data: { status: 'active', startDate: new Date() },
    });
  }

  async cancelContract(id: string, dto: { reason?: string } = {}) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairServiceContract', id, orgId);
    return this.prisma.client.repairServiceContract.update({
      where: { id },
      data: { status: 'cancelled', notes: dto.reason ?? undefined },
    });
  }

  async deleteContract(id: string) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairServiceContract', id, orgId);
    return this.prisma.client.repairServiceContract.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Preventive schedules ──────────────────────────────────────────────────

  async listSchedules(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.contractId) where.contractId = query.contractId;
    return this.prisma.client.repairSchedule.findMany({
      where,
      orderBy: [{ nextDueAt: 'asc' }],
      take: Math.min(Number(query.take ?? 100), 300),
      skip: Number(query.skip ?? 0),
    });
  }

  async createSchedule(dto: any) {
    const orgId = this.tenant.organizationId;
    const intervalDays = dto.intervalDays ?? 30;
    const nextDueAt = dto.nextDueAt ? new Date(dto.nextDueAt) : new Date();
    return this.prisma.client.repairSchedule.create({
      data: {
        organizationId: orgId,
        contractId: dto.contractId ?? null,
        title: dto.title,
        assetRef: dto.assetRef ?? null,
        status: dto.status ?? 'active',
        intervalDays,
        nextDueAt,
        taskTemplate: dto.taskTemplate ?? null,
      },
    });
  }

  async updateSchedule(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairSchedule', id, orgId);
    return this.prisma.client.repairSchedule.update({ where: { id }, data: dto });
  }

  async deleteSchedule(id: string) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairSchedule', id, orgId);
    return this.prisma.client.repairSchedule.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Roll a schedule forward after a preventive run: lastRunAt = now,
   * nextDueAt = now + intervalDays.
   */
  async rollSchedule(id: string) {
    const orgId = this.tenant.organizationId;
    const schedule = await this.prisma.client.repairSchedule.findFirst({ where: { id, organizationId: orgId } });
    if (!schedule) throw new NotFoundException('Repair schedule not found');
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + schedule.intervalDays);
    return this.prisma.client.repairSchedule.update({
      where: { id },
      data: { lastRunAt: now, nextDueAt: next },
    });
  }

  /** Schedules due now (used by the cron worker). */
  async dueSchedules(now = new Date()) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairSchedule.findMany({
      where: { organizationId: orgId, status: 'active', nextDueAt: { lte: now }, deletedAt: null },
    });
  }

  private async ensureExists(model: 'repairServiceContract' | 'repairSchedule', id: string, orgId: string) {
    const row = await (this.prisma.client as any)[model].findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }
}
