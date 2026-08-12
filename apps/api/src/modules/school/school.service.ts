import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';

/**
 * School facade — exposes cross-domain read queries that the UI dashboards
 * use to compose data from many sub-modules in a single call.
 */
@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  /**
   * Returns the singleton SchoolProfile (one per organization).
   * Auto-creates a Uganda-default profile if the org has none yet.
   */
  async getOrCreateProfile() {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId },
    });
    if (existing) return existing;

    // First boot: create a Uganda-default profile.
    const org = await this.prisma.client.organization.findFirst({
      where: { id: organizationId },
    });
    const created = await this.prisma.client.schoolProfile.create({
      data: {
        organizationId,
        name: org?.name ?? 'My School',
        country: 'UG',
        currencyCode: 'UGX',
        educationLevel: 'mixed',
        gradingSystem: 'UCE',
      },
    });
    this.events.publish(EVENTS.SchoolProfileUpdated, {
      organizationId,
      profileId: created.id,
    });
    return created;
  }

  async updateProfile(updates: {
    name?: string;
    motto?: string;
    logoUrl?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    educationLevel?: string;
    gradingSystem?: string;
    contacts?: Record<string, unknown>;
    customFields?: Record<string, unknown>;
  }) {
    const organizationId = this.tenant.organizationId;
    const current = await this.getOrCreateProfile();
    const updated = await this.prisma.client.schoolProfile.updateMany({
      where: { id: current.id },
      data: updates as any,
    });
    if (updated.count === 0) throw new NotFoundException('SchoolProfile not found');
    this.events.publish(EVENTS.SchoolProfileUpdated, {
      organizationId,
      profileId: current.id,
    });
    return this.prisma.client.schoolProfile.findFirst({ where: { id: current.id } });
  }

  /**
   * Counts that power the admin dashboard.
   * All queries are org-scoped via the tenancy extension.
   */
  async adminOverview() {
    const organizationId = this.tenant.organizationId;
    const [students, staff, campuses, classes, terms, sections] = await Promise.all([
      this.prisma.client.studentProfile.count({ where: { status: 'active' } }),
      this.prisma.client.staffProfile.count({ where: { status: 'active' } }),
      this.prisma.client.campus.count({ where: { isActive: true } }),
      this.prisma.client.schoolClass.count(),
      this.prisma.client.term.count({ where: { isCurrent: true } }),
      this.prisma.client.section.count(),
    ]);
    return { students, staff, campuses, classes, terms, sections, organizationId };
  }
}