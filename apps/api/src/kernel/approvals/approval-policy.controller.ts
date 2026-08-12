import {
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
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApprovalPolicyDto, UpdateApprovalPolicyDto } from './dto/approval-policy.dto';

/**
 * CRUD for ApprovalPolicy — the main lever for configuring which features
 * require approval and who can approve them. Each policy is per-org.
 *
 * The toggle: `isActive: false` or no policy = auto-approve (action proceeds
 * without waiting for a human approver). `isActive: true` = gated behind the
 * configured approval workflow (N approvers holding `approverPermissions`).
 */
@ApiTags('approval-policies')
@ApiBearerAuth()
@Controller('approval-policies')
export class ApprovalPolicyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('approvals:read')
  async list() {
    return this.prisma.client.approvalPolicy.findMany({
      where: { organizationId: this.tenant.organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @RequirePermissions('approvals:read')
  async findOne(@Param('id') id: string) {
    const policy = await this.prisma.client.approvalPolicy.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!policy) throw new NotFoundException('Approval policy not found');
    return policy;
  }

  @Post()
  @RequirePermissions('approvals:manage')
  async create(@Body() dto: CreateApprovalPolicyDto) {
    return this.prisma.client.approvalPolicy.create({
      data: {
        organizationId: this.tenant.organizationId,
        name: dto.name,
        entityType: dto.entityType,
        minAmount: dto.minAmount ?? null,
        approverPermissions: dto.approverPermissions,
        requiredCount: dto.requiredCount,
        isActive: dto.isActive ?? true,
      },
    });
  }

  @Patch(':id')
  @RequirePermissions('approvals:manage')
  async update(@Param('id') id: string, @Body() dto: UpdateApprovalPolicyDto) {
    const existing = await this.prisma.client.approvalPolicy.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!existing) throw new NotFoundException('Approval policy not found');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.minAmount !== undefined) data.minAmount = dto.minAmount;
    if (dto.approverPermissions !== undefined) data.approverPermissions = dto.approverPermissions;
    if (dto.requiredCount !== undefined) data.requiredCount = dto.requiredCount;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.client.approvalPolicy.update({ where: { id }, data });
  }

  @Delete(':id')
  @RequirePermissions('approvals:manage')
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.client.approvalPolicy.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!existing) throw new NotFoundException('Approval policy not found');
    await this.prisma.client.approvalPolicy.delete({ where: { id } });
    return { ok: true };
  }
}
