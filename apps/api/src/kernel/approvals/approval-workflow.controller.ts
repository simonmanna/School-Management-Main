import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ApprovalStepDto,
  CreateApprovalWorkflowDto,
  UpdateApprovalWorkflowDto,
} from './dto/approval-workflow.dto';

/**
 * F.5b — CRUD for ApprovalWorkflow (+ its ordered ApprovalStep chain). The main
 * lever for configuring which document types require approval, at what amount
 * bands, and who decides each step. Supersedes ApprovalPolicy.
 *
 * No active workflow for an entityType = auto-approve (the action proceeds).
 */
@ApiTags('approval-workflows')
@ApiBearerAuth()
@Controller('approval-workflows')
export class ApprovalWorkflowController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.approvals.read)
  list() {
    return this.prisma.client.approvalWorkflow.findMany({
      where: { organizationId: this.tenant.organizationId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.approvals.read)
  async findOne(@Param('id') id: string) {
    const wf = await this.prisma.client.approvalWorkflow.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!wf) throw new NotFoundException('Approval workflow not found');
    return wf;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.approvals.manage)
  async create(@Body() dto: CreateApprovalWorkflowDto) {
    this.assertSteps(dto.steps);
    const orgId = this.tenant.organizationId;
    const wf = await this.prisma.client.approvalWorkflow.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        entityType: dto.entityType,
        minAmount: dto.minAmount ?? null,
        enforceDistinctApprovers: dto.enforceDistinctApprovers ?? false,
        isActive: dto.isActive ?? true,
        steps: {
          create: dto.steps.map((s) => ({
            organizationId: orgId, // nested creates are NOT auto-scoped by the tenancy extension
            stepOrder: s.stepOrder,
            name: s.name,
            approverPermissions: s.approverPermissions,
            requiredCount: s.requiredCount,
            minAmount: s.minAmount ?? null,
            maxAmount: s.maxAmount ?? null,
          })),
        },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    await this.audit.record({
      entity: 'ApprovalWorkflow',
      entityId: wf.id,
      action: 'create',
      newValues: { name: wf.name, entityType: wf.entityType, steps: dto.steps.length },
    });
    return wf;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.approvals.manage)
  async update(@Param('id') id: string, @Body() dto: UpdateApprovalWorkflowDto) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.approvalWorkflow.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Approval workflow not found');
    if (dto.steps) this.assertSteps(dto.steps);

    const scalar: Record<string, unknown> = {};
    if (dto.name !== undefined) scalar.name = dto.name;
    if (dto.entityType !== undefined) scalar.entityType = dto.entityType;
    if (dto.minAmount !== undefined) scalar.minAmount = dto.minAmount;
    if (dto.enforceDistinctApprovers !== undefined)
      scalar.enforceDistinctApprovers = dto.enforceDistinctApprovers;
    if (dto.isActive !== undefined) scalar.isActive = dto.isActive;

    return this.prisma.client.$transaction(async (tx) => {
      await tx.approvalWorkflow.update({ where: { id }, data: scalar });
      // Full replace of the step list when provided.
      if (dto.steps) {
        await tx.approvalStep.deleteMany({ where: { workflowId: id } });
        await tx.approvalStep.createMany({
          data: dto.steps.map((s) => ({
            organizationId: orgId,
            workflowId: id,
            stepOrder: s.stepOrder,
            name: s.name,
            approverPermissions: s.approverPermissions,
            requiredCount: s.requiredCount,
            minAmount: s.minAmount ?? null,
            maxAmount: s.maxAmount ?? null,
          })),
        });
      }
      await this.audit.recordInTx(tx, {
        entity: 'ApprovalWorkflow',
        entityId: id,
        action: 'update',
        newValues: { ...scalar, ...(dto.steps ? { steps: dto.steps.length } : {}) },
      });
      return tx.approvalWorkflow.findFirst({
        where: { id },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    });
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.approvals.manage)
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.client.approvalWorkflow.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!existing) throw new NotFoundException('Approval workflow not found');
    await this.prisma.client.approvalWorkflow.delete({ where: { id } }); // steps cascade
    await this.audit.record({ entity: 'ApprovalWorkflow', entityId: id, action: 'delete' });
    return { ok: true };
  }

  private assertSteps(steps: ApprovalStepDto[]): void {
    if (!steps.length) throw new BadRequestException('A workflow needs at least one step');
    const orders = steps.map((s) => s.stepOrder);
    if (new Set(orders).size !== orders.length)
      throw new BadRequestException('Duplicate stepOrder values');
  }
}
