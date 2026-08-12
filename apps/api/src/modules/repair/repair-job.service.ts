import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';

/**
 * RepairJobService — internal work orders against a repair order. A job is the
 * technician-facing unit: assignee, deadline, hours, instructions and a
 * checklist snapshot. Statuses: pending → in_progress → testing → completed
 * (cancelled is legal from pending/in_progress).
 */
@Injectable()
export class RepairJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly notifications: NotificationsService,
  ) {}

  async listJobs(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.repairOrderId) where.repairOrderId = query.repairOrderId;
    if (query.technicianId) where.technicianId = query.technicianId;
    return this.prisma.client.repairJob.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: { repairOrder: { select: { repairNumber: true, itemType: true, brand: true, model: true } } },
      take: Math.min(Number(query.take ?? 50), 200),
      skip: Number(query.skip ?? 0),
    });
  }

  async getJob(id: string) {
    const orgId = this.tenant.organizationId;
    const job = await this.prisma.client.repairJob.findFirst({
      where: { id, organizationId: orgId },
      include: {
        repairOrder: {
          include: {
            parts: { where: { jobId: id }, orderBy: { createdAt: 'desc' } },
            items: { orderBy: { lineNumber: 'asc' } },
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Repair job not found');
    return job;
  }

  async createJob(repairOrderId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id: repairOrderId, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    const jobNumber = await this.seq.next('repair_job', { prefix: 'JOB-', padding: 6 });
    const job = await this.prisma.client.repairJob.create({
      data: {
        organizationId: orgId,
        repairOrderId,
        jobNumber,
        technicianId: dto.technicianId ?? null,
        priority: dto.priority ?? 'medium',
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        estimatedHours: dto.estimatedHours ?? null,
        instructions: dto.instructions ?? null,
        checklist: dto.checklist ?? [],
        notes: dto.notes ?? null,
        createdBy: this.tenant.userId,
      },
    });
    await this.notifications.send({
      organizationId: orgId,
      channel: 'in_app',
      category: 'repair',
      title: `Job ${jobNumber} created`,
      body: `${order.itemType ?? 'Item'} — ${dto.instructions ?? 'no instructions'}`,
      payload: { repairOrderId, jobId: job.id, jobNumber },
    });
    return this.getJob(job.id);
  }

  async startJob(id: string) {
    return this.setStatus(id, 'in_progress', { startedAt: new Date() });
  }

  async completeJob(id: string, dto: any = {}) {
    return this.setStatus(id, 'completed', {
      completedAt: new Date(),
      actualHours: dto.actualHours ?? undefined,
      checklist: dto.checklist ?? undefined,
    });
  }

  async testJob(id: string) {
    return this.setStatus(id, 'testing');
  }

  async cancelJob(id: string, dto: { reason?: string } = {}) {
    return this.setStatus(id, 'cancelled', { cancelledAt: new Date(), notes: dto.reason ?? undefined });
  }

  private async setStatus(id: string, status: string, extra: any = {}) {
    const orgId = this.tenant.organizationId;
    const job = await this.prisma.client.repairJob.findFirst({ where: { id, organizationId: orgId } });
    if (!job) throw new NotFoundException('Repair job not found');
    if (job.status === 'completed' || job.status === 'cancelled')
      throw new BadRequestException(`Job is ${job.status} — no further transitions`);
    return this.prisma.client.repairJob.update({
      where: { id },
      data: { status, updatedBy: this.tenant.userId, ...extra },
    });
  }

  async updateJob(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const job = await this.prisma.client.repairJob.findFirst({ where: { id, organizationId: orgId } });
    if (!job) throw new NotFoundException('Repair job not found');
    return this.prisma.client.repairJob.update({ where: { id }, data: dto });
  }

  async assignJob(id: string, dto: { technicianId: string }) {
    return this.updateJob(id, { technicianId: dto.technicianId });
  }

  /** Toggle one checklist item ({label, completed}) inside the job's checklist JSON. */
  async setChecklistItem(id: string, dto: { label: string; completed: boolean }) {
    const orgId = this.tenant.organizationId;
    const job = await this.prisma.client.repairJob.findFirst({ where: { id, organizationId: orgId } });
    if (!job) throw new NotFoundException('Repair job not found');
    const checklist: any[] = Array.isArray(job.checklist) ? job.checklist : [];
    const existing = checklist.find((c) => c.label === dto.label);
    if (existing) {
      existing.completed = dto.completed;
      existing.completedAt = dto.completed ? new Date().toISOString() : null;
    } else {
      checklist.push({ label: dto.label, completed: dto.completed, completedAt: dto.completed ? new Date().toISOString() : null });
    }
    return this.prisma.client.repairJob.update({
      where: { id },
      data: { checklist, updatedBy: this.tenant.userId },
    });
  }
}
