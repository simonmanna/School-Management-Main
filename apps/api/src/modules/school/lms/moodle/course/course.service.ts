import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseModule, CourseOffering, CourseSection, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { LmsContextService } from '../context/context.service';
import { AvailabilityService } from '../availability/availability.service';
import { LmsEventService } from '../lms-event.service';

/**
 * Course spine — offering settings, sections, and the assembled course-page payload
 * (ADR-014 §3.2, §5, §6). The page is resolved server-side: for a student, hidden and
 * unavailable modules are filtered/greyed here; the client never decides.
 */
@Injectable()
export class CourseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly contexts: LmsContextService,
    private readonly availability: AvailabilityService,
    private readonly events: LmsEventService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  async listCourses(filter: { termId?: string; classId?: string; subjectId?: string; categoryId?: string }) {
    return this.prisma.client.courseOffering.findMany({
      where: {
        organizationId: this.org,
        deletedAt: null,
        ...(filter.termId ? { termId: filter.termId } : {}),
        ...(filter.classId ? { classId: filter.classId } : {}),
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      },
      include: { teachers: true, _count: { select: { modules: true, enrolments: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOffering(id: string): Promise<CourseOffering> {
    const o = await this.prisma.client.courseOffering.findFirst({ where: { id, organizationId: this.org } });
    if (!o) throw new NotFoundException(`Course ${id} not found`);
    return o;
  }

  async updateSettings(id: string, dto: Partial<Pick<CourseOffering,
    'format' | 'numSections' | 'summary' | 'visible' | 'groupMode' | 'forceGroupMode' |
    'completionEnabled' | 'showGradesToStudents' | 'categoryId' | 'startDate' | 'endDate'>>) {
    await this.getOffering(id);
    const updated = await this.prisma.client.courseOffering.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
      },
    });
    await this.contexts.ensureCourseContext(id);
    await this.events.log({ eventName: 'core_course.updated', component: 'core_course', action: 'updated', target: 'course', courseOfferingId: id });
    return updated;
  }

  /** Idempotently create sections 0..numSections for a weekly/topic course. */
  async ensureSections(id: string): Promise<CourseSection[]> {
    const offering = await this.getOffering(id);
    const count = offering.format === 'single_activity' || offering.format === 'social' ? 1 : offering.numSections;
    const existing = await this.prisma.client.courseSection.findMany({ where: { organizationId: this.org, courseOfferingId: id } });
    const have = new Set(existing.map((s) => s.sectionNo));
    for (let n = 0; n <= count; n++) {
      if (have.has(n)) continue;
      const weekOf = offering.format === 'weeks' && offering.startDate && n > 0
        ? new Date(new Date(offering.startDate).getTime() + (n - 1) * 7 * 86400000)
        : null;
      await this.prisma.client.courseSection.create({
        data: { organizationId: this.org, courseOfferingId: id, sectionNo: n, name: n === 0 ? 'General' : null, weekOf },
      });
    }
    return this.prisma.client.courseSection.findMany({ where: { organizationId: this.org, courseOfferingId: id }, orderBy: { sectionNo: 'asc' } });
  }

  async addSection(id: string, dto: { name?: string; summary?: string }): Promise<CourseSection> {
    await this.getOffering(id);
    const max = await this.prisma.client.courseSection.aggregate({ where: { organizationId: this.org, courseOfferingId: id }, _max: { sectionNo: true } });
    return this.prisma.client.courseSection.create({
      data: { organizationId: this.org, courseOfferingId: id, sectionNo: (max._max.sectionNo ?? -1) + 1, name: dto.name, summary: dto.summary },
    });
  }

  async updateSection(sectionId: string, dto: Partial<Pick<CourseSection, 'name' | 'summary' | 'visible'>> & { availability?: unknown }) {
    const sec = await this.prisma.client.courseSection.findFirst({ where: { id: sectionId, organizationId: this.org } });
    if (!sec) throw new NotFoundException('Section not found');
    return this.prisma.client.courseSection.update({
      where: { id: sectionId },
      data: { ...dto, availability: dto.availability === undefined ? undefined : (dto.availability as Prisma.InputJsonValue) },
    });
  }

  /**
   * The course-page payload. When `studentProfileId` is set, hidden modules are
   * dropped, unavailable modules are greyed (or hidden), and completion state is
   * attached. Otherwise the full teacher view is returned.
   */
  async coursePage(id: string, opts: { studentProfileId?: string; canViewHidden: boolean }) {
    const offering = await this.getOffering(id);
    const sections = await this.prisma.client.courseSection.findMany({
      where: { organizationId: this.org, courseOfferingId: id, deletedAt: null },
      orderBy: { sectionNo: 'asc' },
    });
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId: id, deletedAt: null },
    });

    const completions = opts.studentProfileId
      ? await this.prisma.client.courseModuleCompletion.findMany({
          where: { organizationId: this.org, studentProfileId: opts.studentProfileId, courseModuleId: { in: modules.map((m) => m.id) } },
        })
      : [];
    const completionByModule = new Map(completions.map((c) => [c.courseModuleId, c]));

    const sectionOut = [];
    for (const sec of sections) {
      if (opts.studentProfileId && !sec.visible && !opts.canViewHidden) continue;
      // Section-level availability
      let sectionAvail = { available: true, reasons: [] as string[], showGreyed: true };
      if (opts.studentProfileId) sectionAvail = await this.availability.evaluate(sec.availability, { studentProfileId: opts.studentProfileId, courseOfferingId: id });
      if (!sectionAvail.available && !sectionAvail.showGreyed && !opts.canViewHidden) continue;

      const inSection = this.ordered(modules.filter((m) => m.sectionId === sec.id), sec.sequence);
      const modOut = [];
      for (const m of inSection) {
        if (!m.visible && !opts.canViewHidden) continue;
        let avail = { available: true, reasons: [] as string[], showGreyed: true };
        if (opts.studentProfileId) avail = await this.availability.evaluate(m.availability, { studentProfileId: opts.studentProfileId, courseOfferingId: id });
        if (!avail.available && !avail.showGreyed && !opts.canViewHidden) continue;
        modOut.push({
          ...m,
          availability: undefined,
          availabilityInfo: opts.studentProfileId ? avail : undefined,
          completion: opts.studentProfileId ? completionByModule.get(m.id)?.state ?? 'incomplete' : undefined,
        });
      }
      sectionOut.push({ ...sec, availabilityInfo: opts.studentProfileId ? sectionAvail : undefined, modules: modOut });
    }
    return { offering, sections: sectionOut };
  }

  /** Order modules by the section's denormalised sequence, appending any not yet listed. */
  private ordered(mods: CourseModule[], sequence: string[]): CourseModule[] {
    const byId = new Map(mods.map((m) => [m.id, m]));
    const out: CourseModule[] = [];
    for (const mid of sequence) {
      const m = byId.get(mid);
      if (m) { out.push(m); byId.delete(mid); }
    }
    for (const m of byId.values()) out.push(m);
    return out;
  }

  async moveSection(sectionId: string, toSectionNo: number) {
    const sec = await this.prisma.client.courseSection.findFirst({ where: { id: sectionId, organizationId: this.org } });
    if (!sec) throw new NotFoundException('Section not found');
    if (sec.sectionNo === 0) throw new BadRequestException('The General section cannot be moved');
    await this.prisma.client.courseSection.update({ where: { id: sectionId }, data: { sectionNo: toSectionNo } });
    return { ok: true };
  }

  async softDeleteSection(sectionId: string) {
    const sec = await this.prisma.client.courseSection.findFirst({ where: { id: sectionId, organizationId: this.org } });
    if (!sec) throw new NotFoundException('Section not found');
    if (sec.sectionNo === 0) throw new BadRequestException('The General section cannot be deleted');
    await this.prisma.client.courseSection.update({ where: { id: sectionId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
