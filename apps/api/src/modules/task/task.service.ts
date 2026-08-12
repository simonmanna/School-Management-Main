/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import type { Prisma } from '@prisma/client';

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  private get userId() {
    return this.tenant.store?.userId ?? 'system';
  }

  // ─── CRUD ────────────────────────────────────────────────────────────

  async create(dto: any) {
    const { checklistItems, ...data } = dto;
    const task = await this.prisma.client.task.create({
      data: {
        ...data,
        organizationId: this.orgId,
        createdBy: this.userId,
        checklistProgress: 0,
        checklistTotal: 0,
        ...(checklistItems?.length
          ? {
              checklistItems: {
                create: checklistItems.map((item: any, i: number) => ({
                  organizationId: this.orgId,
                  description: item.description,
                  sortOrder: item.sortOrder ?? i,
                })),
              },
              checklistTotal: checklistItems.length,
            }
          : {}),
      },
      include: this.defaultInclude(),
    });
    await this.logActivity(task.id, 'created', null, null, 'Task created');
    return task;
  }

  async findAll(query: any) {
    const {
      status,
      priority,
      category,
      area,
      branchId,
      assignedToId,
      search,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = query;

    const where: Prisma.TaskWhereInput = {
      organizationId: this.orgId,
      deletedAt: null,
    };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (area) where.area = area;
    if (branchId) where.branchId = branchId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (dateFrom || dateTo) {
      where.dueDate = {};
      if (dateFrom) where.dueDate.gte = new Date(dateFrom);
      if (dateTo) where.dueDate.lte = new Date(dateTo);
    }

    const [items, total] = await Promise.all([
      this.prisma.client.task.findMany({
        where,
        include: this.defaultInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.task.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const task = await this.prisma.client.task.findFirst({
      where: { id, organizationId: this.orgId, deletedAt: null },
      include: {
        ...this.defaultInclude(),
        comments: {
          include: {
            replies: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        activityLog: {
          orderBy: { createdAt: 'desc' },
        },
        children: {
          where: { deletedAt: null },
          include: this.defaultInclude(),
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, dto: any) {
    const existing = await this.findOne(id);
    const changes = this.getChangedFields(existing, dto);

    const task = await this.prisma.client.task.update({
      where: { id },
      data: {
        ...dto,
        updatedBy: this.userId,
      },
      include: this.defaultInclude(),
    });

    for (const change of changes) {
      await this.logActivity(
        id,
        'updated',
        change.field,
        change.oldValue,
        change.description,
      );
    }

    return task;
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.client.task.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: this.userId },
    });
  }

  async reorder(id: string, status: string) {
    await this.findOne(id);
    const task = await this.prisma.client.task.update({
      where: { id },
      data: { status: status as any, updatedBy: this.userId },
      include: this.defaultInclude(),
    });
    await this.logActivity(id, 'status_changed', 'status', null, `Status changed to ${status}`);
    return task;
  }

  // ─── Checklist ───────────────────────────────────────────────────────

  async toggleChecklist(taskId: string, itemId: string, isCompleted: boolean) {
    await this.findOne(taskId);

    await this.prisma.client.taskChecklistItem.update({
      where: { id: itemId },
      data: {
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
        completedBy: isCompleted ? this.userId : null,
      },
    });

    // Recalculate progress
    const items = await this.prisma.client.taskChecklistItem.findMany({
      where: { taskId },
    });
    const total = items.length;
    const done = items.filter((i) => i.isCompleted).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;

    const task = await this.prisma.client.task.update({
      where: { id: taskId },
      data: {
        checklistProgress: progress,
        checklistTotal: total,
        updatedBy: this.userId,
      },
      include: this.defaultInclude(),
    });

    await this.logActivity(
      taskId,
      'checklist_updated',
      'checklistProgress',
      null,
      `Checklist ${done}/${total} (${progress}%)`,
    );

    return task;
  }

  // ─── Comments ────────────────────────────────────────────────────────

  async addComment(taskId: string, dto: { content: string; parentId?: string; mentions?: string[]; attachmentUrls?: string[] }) {
    await this.findOne(taskId);

    const comment = await this.prisma.client.taskComment.create({
      data: {
        organizationId: this.orgId,
        taskId,
        content: dto.content,
        parentId: dto.parentId ?? null,
        mentions: dto.mentions ?? [],
        attachmentUrls: dto.attachmentUrls ?? [],
        createdById: this.userId,
      },
      include: {
        replies: true,
      },
    });

    await this.logActivity(taskId, 'commented', null, null, 'Comment added');
    return comment;
  }

  // ─── Verification ────────────────────────────────────────────────────

  async verify(taskId: string, dto: { verificationMethod: string; verificationNote?: string }) {
    const task = await this.findOne(taskId);

    if (!task.requiresVerification) {
      throw new BadRequestException('This task does not require verification');
    }

    const updated = await this.prisma.client.task.update({
      where: { id: taskId },
      data: {
        verifiedById: this.userId,
        verifiedAt: new Date(),
        verificationNote: dto.verificationNote ?? null,
        status: 'VERIFIED',
        updatedBy: this.userId,
      },
      include: this.defaultInclude(),
    });

    await this.logActivity(taskId, 'verified', 'status', task.status, `Verified via ${dto.verificationMethod}`);
    return updated;
  }

  // ─── Dashboard ───────────────────────────────────────────────────────

  async dashboard() {
    const orgId = this.orgId;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const baseWhere: Prisma.TaskWhereInput = {
      organizationId: orgId,
      deletedAt: null,
    };

    const [
      todayTotal,
      todayCompleted,
      pending,
      inProgress,
      overdue,
      dueToday,
      verificationPending,
      recurringToday,
    ] = await Promise.all([
      this.prisma.client.task.count({ where: { ...baseWhere, createdAt: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.client.task.count({ where: { ...baseWhere, status: 'COMPLETED', completedAt: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.client.task.count({ where: { ...baseWhere, status: 'PENDING' } }),
      this.prisma.client.task.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),
      this.prisma.client.task.count({ where: { ...baseWhere, status: { notIn: ['COMPLETED', 'CANCELLED', 'SKIPPED'] }, dueDate: { lt: now } } }),
      this.prisma.client.task.count({ where: { ...baseWhere, dueDate: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.client.task.count({ where: { ...baseWhere, requiresVerification: true, status: 'COMPLETED', verifiedAt: null } }),
      this.prisma.client.task.count({ where: { ...baseWhere, isRecurring: true, createdAt: { gte: todayStart, lt: todayEnd } } }),
    ]);

    // Completion rate (all time)
    const totalTasks = await this.prisma.client.task.count({ where: baseWhere });
    const completedTasks = await this.prisma.client.task.count({ where: { ...baseWhere, status: 'COMPLETED' } });
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Avg completion time (in minutes) — fetch completed tasks and compute in JS
    const completedTasksForAvg = await this.prisma.client.task.findMany({
      where: { ...baseWhere, completedAt: { not: null as any }, createdAt: { not: null as any } },
      select: { createdAt: true, completedAt: true },
    });
    let avgCompletionMinutes = 0;
    if (completedTasksForAvg.length > 0) {
      const totalMinutes = completedTasksForAvg.reduce((sum, t) => {
        const diff = (t.completedAt!.getTime() - t.createdAt!.getTime()) / 60000;
        return sum + diff;
      }, 0);
      avgCompletionMinutes = Math.round(totalMinutes / completedTasksForAvg.length);
    }

    // Top employees by completion
    const topEmployees = await this.prisma.client.task.groupBy({
      by: ['assignedToId'],
      where: { ...baseWhere, status: 'COMPLETED', assignedToId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    return {
      todayTotal,
      todayCompleted,
      pending,
      inProgress,
      overdue,
      dueToday,
      recurringToday,
      verificationPending,
      completionRate,
      avgCompletionMinutes: Math.round(avgCompletionMinutes),
      topEmployees: topEmployees.map((e) => ({
        assignedToId: e.assignedToId,
        completedCount: e._count.id,
      })),
    };
  }

  // ─── Labels ──────────────────────────────────────────────────────────

  async listLabels() {
    return this.prisma.client.taskLabel.findMany({
      where: { organizationId: this.orgId },
      orderBy: { name: 'asc' },
    });
  }

  async createLabel(dto: { name: string; color?: string }) {
    return this.prisma.client.taskLabel.create({
      data: {
        organizationId: this.orgId,
        name: dto.name,
        color: dto.color ?? '#6366f1',
      },
    });
  }

  // ─── Templates ───────────────────────────────────────────────────────

  async listTemplates() {
    return this.prisma.client.taskRecurringTemplate.findMany({
      where: { organizationId: this.orgId, deletedAt: null },
      orderBy: { title: 'asc' },
    });
  }

  async createTemplate(dto: any) {
    return this.prisma.client.taskRecurringTemplate.create({
      data: { ...dto, organizationId: this.orgId, createdBy: this.userId },
    });
  }

  // ─── Auto Rules ──────────────────────────────────────────────────────

  async listAutoRules() {
    return this.prisma.client.taskAutoRule.findMany({
      where: { organizationId: this.orgId },
      orderBy: { name: 'asc' },
    });
  }

  async createAutoRule(dto: any) {
    return this.prisma.client.taskAutoRule.create({
      data: { ...dto, organizationId: this.orgId, createdBy: this.userId },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private defaultInclude() {
    return {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      supervisor: { select: { id: true, firstName: true, lastName: true, email: true } },
      verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      branch: { select: { id: true, name: true } },
      labels: { select: { id: true, name: true, color: true } },
      checklistItems: { orderBy: { sortOrder: 'asc' as const } },
    };
  }

  private async logActivity(
    taskId: string,
    action: string,
    field: string | null,
    oldValue: string | null,
    description: string | null,
  ) {
    await this.prisma.client.taskActivityLog.create({
      data: {
        organizationId: this.orgId,
        taskId,
        action,
        field,
        oldValue: oldValue ? String(oldValue) : null,
        newValue: field ? String((await this.findOne(taskId))[field as keyof typeof this.findOne]) : null,
        description,
        createdById: this.userId,
      },
    });
  }

  private getChangedFields(existing: any, dto: any): Array<{ field: string; oldValue: string | null; description: string }> {
    const changes: Array<{ field: string; oldValue: string | null; description: string }> = [];
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && value !== null && String(existing[key as keyof typeof existing]) !== String(value)) {
        changes.push({
          field: key,
          oldValue: String(existing[key as keyof typeof existing] ?? ''),
          description: `Updated ${key}`,
        });
      }
    }
    return changes;
  }
}
