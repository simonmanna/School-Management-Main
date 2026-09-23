import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS, resolveTerminology, validateTerminology } from '@erp/shared';
import type { UpdateSchoolProfileDto } from './school-profile.dto';

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
   * Returns the singleton SchoolProfile (one per organization), creating it on
   * first use from the ORGANIZATION's currency — the organization is the single
   * source for currency and timezone, so nothing Uganda-specific is assumed here.
   * The response carries the organization's timezone and the resolved labels.
   */
  async getOrCreateProfile() {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId },
    });
    const org = await this.prisma.client.organization.findFirst({
      where: { id: organizationId },
      select: { name: true, currencyCode: true, timezone: true },
    });
    if (existing) return this.present(existing, org);

    const created = await this.prisma.client.schoolProfile.create({
      data: {
        organizationId,
        name: org?.name ?? 'My School',
        currencyCode: org?.currencyCode ?? 'UGX',
        educationLevel: 'mixed',
        gradingSystem: 'UCE',
      },
    });
    this.events.publish(EVENTS.SchoolProfileUpdated, {
      organizationId,
      profileId: created.id,
    });
    return this.present(created, org);
  }

  /** Profile + the organization's currency/timezone + resolved terminology labels. */
  private present(profile: any, org: { currencyCode: string; timezone: string } | null) {
    return {
      ...profile,
      currencyCode: org?.currencyCode ?? profile.currencyCode,
      timezone: org?.timezone ?? 'UTC',
      labels: resolveTerminology(profile.terminology),
    };
  }

  /** The school's words for its structures, defaults filled in. Safe for every signed-in user. */
  async terminology() {
    const profile = await this.prisma.client.schoolProfile.findFirst({ select: { terminology: true } });
    return resolveTerminology(profile?.terminology);
  }

  async updateProfile(dto: UpdateSchoolProfileDto) {
    const organizationId = this.tenant.organizationId;
    const current = await this.getOrCreateProfile();

    if (dto.terminology !== undefined) {
      const errors = validateTerminology(dto.terminology);
      if (errors.length > 0) {
        throw new BadRequestException(errors.map((e) => `${e.key}: ${e.reason}`).join(' '));
      }
    }
    if (dto.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException(`"${dto.timezone}" is not a valid IANA time zone (e.g. Africa/Kampala).`);
      }
    }
    const currencyCode = dto.currencyCode?.toUpperCase();
    if (currencyCode) {
      const known = await this.prisma.client.currency.findUnique({ where: { code: currencyCode } });
      if (!known) throw new BadRequestException(`Currency ${currencyCode} is not configured.`);
    }

    const { timezone, currencyCode: _cur, ...profileFields } = dto;
    await this.prisma.client.$transaction(async (tx: any) => {
      // Currency and timezone live on the Organization — the one source every
      // module (fees, accounting, HR, dates) reads. The profile mirrors currency.
      if (timezone !== undefined || currencyCode) {
        await tx.organization.updateMany({
          where: { id: organizationId },
          data: { ...(timezone !== undefined ? { timezone } : {}), ...(currencyCode ? { currencyCode } : {}) },
        });
      }
      const updated = await tx.schoolProfile.updateMany({
        where: { id: current.id },
        data: {
          ...profileFields,
          ...(dto.country ? { country: dto.country.toUpperCase() } : {}),
          ...(currencyCode ? { currencyCode } : {}),
        } as any,
      });
      if (updated.count === 0) throw new NotFoundException('SchoolProfile not found');
    });
    this.events.publish(EVENTS.SchoolProfileUpdated, {
      organizationId,
      profileId: current.id,
    });
    return this.getOrCreateProfile();
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