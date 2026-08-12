import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { MarkStaffAttendanceDto } from './dto.types';

/**
 * StaffAttendance — bulk-mark a day's attendance for many staff in one tx.
 * Unique key (staffProfileId, date) ensures idempotent upserts.
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async mark(dto: MarkStaffAttendanceDto) {
    const organizationId = this.tenant.organizationId;
    const date = new Date(dto.date);
    return this.prisma.client.$transaction(async (tx: any) => {
      const results: any[] = [];
      for (const e of dto.entries) {
        const row = await tx.staffAttendance.upsert({
          where: {
            organizationId_staffProfileId_date: {
              organizationId,
              staffProfileId: e.staffProfileId,
              date,
            } as any,
          },
          create: {
            organizationId,
            staffProfileId: e.staffProfileId,
            date,
            status: e.status,
            checkIn: e.checkIn ? new Date(e.checkIn) : null,
            checkOut: e.checkOut ? new Date(e.checkOut) : null,
            notes: e.notes ?? null,
            markedById: this.tenant.userId ?? null,
          },
          update: {
            status: e.status,
            checkIn: e.checkIn ? new Date(e.checkIn) : null,
            checkOut: e.checkOut ? new Date(e.checkOut) : null,
            notes: e.notes ?? null,
            markedById: this.tenant.userId ?? null,
          },
        });
        results.push(row);
      }
      return { count: results.length, results };
    });
  }

  async byDate(date: Date | string) {
    return this.prisma.client.staffAttendance.findMany({
      where: { date: new Date(date) },
      include: { staff: { include: { department: true, position: true } } },
      orderBy: { staff: { employeeNo: 'asc' } } as any,
    });
  }

  async byStaff(staffProfileId: string, from: Date, to: Date) {
    return this.prisma.client.staffAttendance.findMany({
      where: { staffProfileId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
  }
}