import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * AttendanceStatusConfigService — CRUD for the organization's attendance-status
 * catalog (P-att-status). Each org owns its own list of statuses (e.g. the seed
 * ships Absent / Present / Late). The `status` string written to StudentAttendance
 * is the config `code`; this service is the source of display metadata (label,
 * colour) and the roll-up flags (isPresent / isLate / isAbsent).
 */
@Injectable()
export class AttendanceStatusConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  list() {
    return this.prisma.client.attendanceStatusConfig.findMany({
      where: { organizationId: this.orgId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.client.attendanceStatusConfig.findFirst({
      where: { id, organizationId: this.orgId },
    });
    if (!row) throw new NotFoundException(`Attendance status ${id} not found`);
    return row;
  }

  async create(dto: {
    code: string;
    label: string;
    color?: string;
    isDefault?: boolean;
    sortOrder?: number;
    isPresent?: boolean;
    isLate?: boolean;
    isAbsent?: boolean;
  }) {
    const code = dto.code.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(code)) {
      throw new BadRequestException('Code must be lowercase letters/numbers/underscore (e.g. "present").');
    }
    const dup = await this.prisma.client.attendanceStatusConfig.findFirst({
      where: { organizationId: this.orgId, code },
    });
    if (dup) throw new BadRequestException(`Status code "${code}" already exists.`);

    if (dto.isDefault) await this.clearDefault();

    return this.prisma.client.attendanceStatusConfig.create({
      data: {
        organizationId: this.orgId,
        code,
        label: dto.label.trim(),
        color: dto.color ?? '#6b7280',
        isDefault: dto.isDefault ?? false,
        sortOrder: dto.sortOrder ?? 0,
        isPresent: dto.isPresent ?? false,
        isLate: dto.isLate ?? false,
        isAbsent: dto.isAbsent ?? false,
      },
    });
  }

  async update(
    id: string,
    dto: Partial<{
      code: string;
      label: string;
      color: string;
      isDefault: boolean;
      sortOrder: number;
      isPresent: boolean;
      isLate: boolean;
      isAbsent: boolean;
    }>,
  ) {
    const existing = await this.get(id);
    const code = dto.code !== undefined ? dto.code.trim().toLowerCase() : existing.code;
    if (dto.code !== undefined && code !== existing.code) {
      if (!/^[a-z0-9_]+$/.test(code)) {
        throw new BadRequestException('Code must be lowercase letters/numbers/underscore (e.g. "present").');
      }
      const dup = await this.prisma.client.attendanceStatusConfig.findFirst({
        where: { organizationId: this.orgId, code, NOT: { id } },
      });
      if (dup) throw new BadRequestException(`Status code "${code}" already exists.`);
    }

    if (dto.isDefault) await this.clearDefault(id);

    const updated = await this.prisma.client.attendanceStatusConfig.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code } : {}),
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isPresent !== undefined ? { isPresent: dto.isPresent } : {}),
        ...(dto.isLate !== undefined ? { isLate: dto.isLate } : {}),
        ...(dto.isAbsent !== undefined ? { isAbsent: dto.isAbsent } : {}),
      },
    });

    // If the code changed, repoint any attendance rows that referenced the old code.
    if (dto.code !== undefined && code !== existing.code) {
      await this.prisma.client.studentAttendance.updateMany({
        where: { organizationId: this.orgId, status: existing.code },
        data: { status: code },
      });
    }
    return updated;
  }

  async remove(id: string) {
    const existing = await this.get(id);
    const used = await this.prisma.client.studentAttendance.count({
      where: { organizationId: this.orgId, status: existing.code },
    });
    if (used > 0) {
      throw new BadRequestException(
        `Cannot delete "${existing.label}": ${used} attendance record(s) use it. Correct or re-mark those first.`,
      );
    }
    if (existing.isDefault) {
      throw new BadRequestException('Cannot delete the default status. Set another as default first.');
    }
    await this.prisma.client.attendanceStatusConfig.delete({ where: { id } });
    return { ok: true };
  }

  /** Returns the org's status catalog keyed by code (for fast lookups). */
  async catalogByCode(): Promise<Record<string, any>> {
    const rows = await this.list();
    return Object.fromEntries(rows.map((r) => [r.code, r]));
  }

  private async clearDefault(exceptId?: string) {
    await this.prisma.client.attendanceStatusConfig.updateMany({
      where: { organizationId: this.orgId, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }
}
