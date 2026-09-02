import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/**
 * Who can be handed a script.
 *
 * `ScriptAllocation.markerId` holds a **User** id, not a StaffProfile id, for
 * the same reason `MarkEntry.markerId` does: the identity the server can verify
 * when the marker submits is the signed-in user. This resolves the staff records
 * that have a login, so the allocation screen picks a person rather than a uuid.
 */
@Injectable()
export class MarkerDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Array<{ userId: string; name: string; employeeNo: string | null; staffCategory: string | null; departmentName: string | null }>> {
    const employees = await this.prisma.client.hrEmployee.findMany({
      where: { userId: { not: null }, deletedAt: null },
      select: { userId: true, partnerId: true, partner: { select: { name: true } } },
    });
    if (!employees.length) return [];

    const staff = await this.prisma.client.staffProfile.findMany({
      where: { partnerId: { in: employees.map((e: any) => e.partnerId).filter(Boolean) as string[] }, deletedAt: null, status: 'active' },
      select: { partnerId: true, employeeNo: true, staffCategory: true, department: { select: { name: true } }, partner: { select: { name: true } } },
    });
    const byPartner = new Map(staff.map((s: any) => [s.partnerId, s]));

    return employees
      .filter((e: any) => e.partnerId && byPartner.has(e.partnerId))
      .map((e: any) => {
        const s: any = byPartner.get(e.partnerId);
        return {
          userId: e.userId as string,
          name: s.partner?.name ?? e.partner?.name ?? 'Staff member',
          employeeNo: s.employeeNo ?? null,
          staffCategory: s.staffCategory ?? null,
          departmentName: s.department?.name ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
