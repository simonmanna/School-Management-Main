import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * HrReconciliationService — the human-in-the-loop bridge between the school's
 * `StaffProfile` roster and the HR `HrEmployee` payroll record.
 *
 * Both facets hang off the same master-data `Partner` (ADR-008):
 *
 *     Partner ──1:1── StaffProfile   (school: campus, category, teaching links)
 *        └────1:1──── HrEmployee     (HR: employment, pay, leave, payroll)
 *
 * The Phase 2 migration linked only rows that matched EXACTLY (employee number,
 * then verified user email, then unambiguous email). Everything else lands in
 * one of two buckets here for a human to resolve. Fuzzy name matching is
 * deliberately absent: a wrong link puts one person's salary and GL partner
 * dimension onto another's record, silently.
 *
 * NOTE this service reads `StaffProfile` — a school-vertical table — from the
 * HR module. That is a read of shared master data through Prisma, not a code
 * import of the school module, so the vertical isolation rule (ADR-011) holds.
 */
@Injectable()
export class HrReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  /**
   * Three buckets: already linked, HR-only (no school profile), school-only
   * (roster entry with no payroll record).
   */
  async overview() {
    const orgId = this.orgId;

    const employees = await this.prisma.client.hrEmployee.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true, email: true,
        isActive: true, partnerId: true,
      },
      orderBy: [{ employeeCode: 'asc' }],
    });

    const profiles = await this.prisma.client.staffProfile.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true, employeeNo: true, partnerId: true, staffCategory: true, status: true,
        partner: { select: { id: true, name: true, email: true, phone: true } },
        department: { select: { id: true, name: true } },
        campus: { select: { id: true, name: true } },
      },
      orderBy: [{ employeeNo: 'asc' }],
    });

    const profileByPartner = new Map(profiles.map((p: any) => [p.partnerId, p]));
    const linkedPartnerIds = new Set(
      employees.filter((e: any) => e.partnerId).map((e: any) => e.partnerId as string),
    );

    const linked: any[] = [];
    const hrOnly: any[] = [];
    for (const e of employees) {
      const profile = e.partnerId ? profileByPartner.get(e.partnerId) : undefined;
      if (profile) linked.push({ employee: e, staffProfile: profile });
      else hrOnly.push(e);
    }

    const schoolOnly = profiles.filter((p: any) => !linkedPartnerIds.has(p.partnerId));

    return {
      counts: {
        linked: linked.length,
        hrOnly: hrOnly.length,
        schoolOnly: schoolOnly.length,
        employees: employees.length,
        staffProfiles: profiles.length,
      },
      linked,
      hrOnly,
      schoolOnly,
    };
  }

  /**
   * Point an existing HrEmployee at an existing StaffProfile's Partner.
   * Both sides must be free — Partner↔HrEmployee is 1:1.
   */
  async link(employeeId: string, staffProfileId: string) {
    const orgId = this.orgId;
    const actorId = this.tenant.userId;

    const employee = await this.prisma.client.hrEmployee.findFirst({
      where: { id: employeeId, organizationId: orgId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const profile = await this.prisma.client.staffProfile.findFirst({
      where: { id: staffProfileId, organizationId: orgId, deletedAt: null },
    });
    if (!profile) throw new NotFoundException('Staff profile not found');

    if (employee.partnerId && employee.partnerId !== profile.partnerId) {
      throw new BadRequestException('Employee is already linked to a different person — unlink first');
    }
    const taken = await this.prisma.client.hrEmployee.findFirst({
      where: { organizationId: orgId, partnerId: profile.partnerId, NOT: { id: employeeId } },
      select: { id: true, employeeCode: true },
    });
    if (taken) {
      throw new BadRequestException(`That staff member is already linked to employee ${taken.employeeCode}`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.hrEmployee.update({
        where: { id: employeeId },
        data: { partnerId: profile.partnerId, updatedBy: actorId },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployee',
        entityId: employeeId,
        action: 'assign',
        oldValues: { partnerId: employee.partnerId },
        newValues: { partnerId: profile.partnerId, staffProfileId, reconciliation: 'link' },
      });
      return updated;
    });
  }

  /** Break a link without deleting either side. */
  async unlink(employeeId: string) {
    const orgId = this.orgId;
    const actorId = this.tenant.userId;
    const employee = await this.prisma.client.hrEmployee.findFirst({
      where: { id: employeeId, organizationId: orgId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.hrEmployee.update({
        where: { id: employeeId },
        data: { partnerId: null, updatedBy: actorId },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployee',
        entityId: employeeId,
        action: 'unassign',
        oldValues: { partnerId: employee.partnerId },
        newValues: { partnerId: null, reconciliation: 'unlink' },
      });
      return updated;
    });
  }

  /**
   * Create the missing HR employment record for a school staff member, reusing
   * their existing Partner (name/email/phone come from it, so the two facets
   * cannot drift apart at birth).
   */
  async createEmployeeFromStaff(staffProfileId: string, overrides: any = {}) {
    const orgId = this.orgId;
    const actorId = this.tenant.userId;

    const profile = await this.prisma.client.staffProfile.findFirst({
      where: { id: staffProfileId, organizationId: orgId, deletedAt: null },
      include: { partner: true, position: true, department: true },
      // Opt back in to the globally omitted legacy pay blob: HR seeds baseSalary from it.
      omit: { compensation: false },
    });
    if (!profile) throw new NotFoundException('Staff profile not found');

    const existing = await this.prisma.client.hrEmployee.findFirst({
      where: { organizationId: orgId, partnerId: profile.partnerId },
      select: { id: true, employeeCode: true },
    });
    if (existing) {
      throw new BadRequestException(`Already linked to employee ${existing.employeeCode}`);
    }

    // Partner.name is a single field; split on the first space so the HR record
    // keeps its first/last shape without inventing data.
    const fullName = (profile.partner?.name ?? '').trim();
    const spaceAt = fullName.indexOf(' ');
    const firstName = overrides.firstName ?? (spaceAt > 0 ? fullName.slice(0, spaceAt) : fullName || profile.employeeNo);
    const lastName = overrides.lastName ?? (spaceAt > 0 ? fullName.slice(spaceAt + 1) : null);

    const employeeCode =
      overrides.employeeCode ??
      profile.employeeNo ??
      (await this.seq.next('hr_employee', { prefix: 'EMP-', padding: 5 }));

    const codeTaken = await this.prisma.client.hrEmployee.findFirst({
      where: { organizationId: orgId, employeeCode },
      select: { id: true },
    });
    if (codeTaken) throw new BadRequestException(`Employee code "${employeeCode}" already exists`);

    return this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.hrEmployee.create({
        data: {
          organizationId: orgId,
          employeeCode,
          partnerId: profile.partnerId,
          firstName,
          lastName,
          email: profile.partner?.email ?? null,
          phone: profile.partner?.phone ?? null,
          employmentType: overrides.employmentType ?? this.mapContractType(profile.contractType),
          hireDate: profile.joinDate ?? null,
          contractEndDate: profile.contractEndDate ?? null,
          baseSalary: overrides.baseSalary ?? this.readCompensation(profile.compensation),
          payFrequency: overrides.payFrequency ?? 'MONTHLY',
          isActive: profile.status === 'active',
          notes: overrides.notes ?? `Created from school staff profile ${profile.employeeNo}`,
          createdBy: actorId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployee',
        entityId: created.id,
        action: 'create',
        newValues: {
          employeeCode,
          partnerId: profile.partnerId,
          staffProfileId,
          source: 'reconciliation:createEmployeeFromStaff',
        },
      });
      return created;
    });
  }

  /**
   * Create the missing school roster entry for an HR employee, reusing their
   * Partner. If the employee has no Partner yet, one is created and linked in
   * the same transaction — that is the only place this service mints master
   * data, and it is always paired 1:1:1.
   */
  async createStaffFromEmployee(employeeId: string, overrides: any = {}) {
    const orgId = this.orgId;
    const actorId = this.tenant.userId;

    const employee = await this.prisma.client.hrEmployee.findFirst({
      where: { id: employeeId, organizationId: orgId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (employee.partnerId) {
      const already = await this.prisma.client.staffProfile.findFirst({
        where: { organizationId: orgId, partnerId: employee.partnerId, deletedAt: null },
        select: { id: true, employeeNo: true },
      });
      if (already) throw new BadRequestException(`Already linked to staff profile ${already.employeeNo}`);
    }

    const employeeNo = overrides.employeeNo ?? employee.employeeCode;
    const noTaken = await this.prisma.client.staffProfile.findFirst({
      where: { organizationId: orgId, employeeNo },
      select: { id: true },
    });
    if (noTaken) throw new BadRequestException(`Employee number "${employeeNo}" already exists`);

    return this.prisma.client.$transaction(async (tx: any) => {
      let partnerId = employee.partnerId;
      if (!partnerId) {
        const code = await this.seq.next(`staff:${new Date().getUTCFullYear()}`, { prefix: 'EMP-', padding: 6 }, tx);
        const partner = await tx.partner.create({
          data: {
            organizationId: orgId,
            code,
            name: `${employee.firstName}${employee.lastName ? ' ' + employee.lastName : ''}`.trim(),
            isEmployee: true,
            email: employee.email ?? null,
            phone: employee.phone ?? null,
          },
        });
        partnerId = partner.id;
        await tx.hrEmployee.update({ where: { id: employeeId }, data: { partnerId, updatedBy: actorId } });
      }

      const profile = await tx.staffProfile.create({
        data: {
          organizationId: orgId,
          partnerId,
          employeeNo,
          joinDate: employee.hireDate ?? new Date(),
          contractType: overrides.contractType ?? 'permanent',
          contractEndDate: employee.contractEndDate ?? null,
          status: employee.isActive ? 'active' : 'terminated',
          staffCategory: overrides.staffCategory ?? 'teaching',
          campusId: overrides.campusId ?? null,
          departmentId: overrides.departmentId ?? null,
          positionId: overrides.positionId ?? null,
          createdBy: actorId,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'StaffProfile',
        entityId: profile.id,
        action: 'create',
        newValues: {
          employeeNo,
          partnerId,
          employeeId,
          source: 'reconciliation:createStaffFromEmployee',
        },
      });
      return profile;
    });
  }

  /** `StaffProfile.contractType` → `HrEmploymentType`. */
  private mapContractType(contractType: string | null | undefined): string {
    switch (contractType) {
      case 'contract': return 'CONTRACT';
      case 'temporary': return 'CASUAL';
      case 'probation': return 'PROBATION';
      default: return 'FULL_TIME';
    }
  }

  /**
   * `StaffProfile.compensation` is a deprecated JSON blob (Phase 2 stops
   * writing it). Read a base salary out of it once, when creating the HR
   * record that supersedes it.
   */
  private readCompensation(compensation: any): number | null {
    if (!compensation || typeof compensation !== 'object') return null;
    const v = compensation.baseSalary ?? compensation.basic ?? compensation.salary;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
