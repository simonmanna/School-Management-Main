import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { resolveGroupingMode, type GroupingModeValue } from './grouping';
import type {
  AttachStreamToSectionDto,
  CreateClassCohortDto,
  GenerateClassCohortsDto,
  UpdateClassCohortDto,
} from './enrollment.dto';

/**
 * ClassCohort — one class in one academic year.
 *
 * This is the row that makes "P5, 2026" a thing you can point at. Sections and
 * streams are tied to the cohort's class, the grouping mode lives here (or on
 * the programme), and every placement names a cohort rather than a bare class,
 * so "which P5 did this learner sit in?" has a year attached to the answer.
 */
@Injectable()
export class ClassCohortService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(opts: { academicYearId?: string; classId?: string; programmeId?: string } = {}) {
    return this.prisma.client.classCohort.findMany({
      where: {
        ...(opts.academicYearId ? { academicYearId: opts.academicYearId } : {}),
        ...(opts.classId ? { classId: opts.classId } : {}),
        ...(opts.programmeId ? { programmeId: opts.programmeId } : {}),
      },
      orderBy: [{ academicYearId: 'desc' }, { classId: 'asc' }],
      include: {
        schoolClass: { include: { gradeLevel: true } },
        academicYear: true,
        programme: true,
        _count: { select: { placements: true } },
      },
    });
  }

  async get(id: string) {
    const row = await this.prisma.client.classCohort.findFirst({
      where: { id },
      include: {
        schoolClass: { include: { gradeLevel: true, sections: true, streams: true } },
        academicYear: true,
        programme: true,
      },
    });
    if (!row) throw new NotFoundException(`Class cohort ${id} not found`);
    return row;
  }

  /**
   * The grouping options a UI may offer for a cohort: the effective mode plus
   * the sections and streams that legally belong to it. The placement screens
   * read this so a user is never shown a stream from another class.
   */
  async groupingOptions(cohortId: string) {
    const cohort = await this.get(cohortId);
    const mode = resolveGroupingMode(
      cohort.groupingMode as GroupingModeValue | null,
      (cohort.programme?.groupingMode ?? null) as GroupingModeValue | null,
    );
    const sections = await this.prisma.client.section.findMany({
      where: { classId: cohort.classId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, capacity: true, classId: true },
    });
    const streams = await this.prisma.client.stream.findMany({
      where: { classId: cohort.classId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, capacity: true, classId: true, sectionId: true },
    });
    return {
      cohortId: cohort.id,
      classId: cohort.classId,
      className: cohort.schoolClass?.name ?? null,
      academicYearId: cohort.academicYearId,
      groupingMode: mode,
      requiresSection: mode === 'SECTION_ONLY' || mode === 'SECTION_AND_STREAM',
      requiresStream: mode === 'STREAM_ONLY' || mode === 'SECTION_AND_STREAM',
      sections,
      streams,
    };
  }

  async create(dto: CreateClassCohortDto) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.classCohort.findFirst({
      where: { academicYearId: dto.academicYearId, classId: dto.classId },
    });
    if (existing) {
      throw new BadRequestException(
        `A cohort already exists for this class in that academic year (${existing.id}). Update it instead of creating a second one.`,
      );
    }
    const programmeId = dto.programmeId ?? (await this.programmeForClass(dto.classId));
    return this.prisma.client.$transaction(async (tx: any) => {
      const cohort = await tx.classCohort.create({
        data: {
          organizationId,
          academicYearId: dto.academicYearId,
          classId: dto.classId,
          programmeId: programmeId ?? null,
          groupingMode: dto.groupingMode ?? null,
          capacity: dto.capacity ?? null,
          status: dto.status ?? 'ACTIVE',
          createdBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ClassCohort',
        entityId: cohort.id,
        action: 'create',
        newValues: { academicYearId: dto.academicYearId, classId: dto.classId, programmeId },
      });
      return cohort;
    });
  }

  async update(id: string, dto: UpdateClassCohortDto) {
    const before = await this.get(id);
    if (dto.groupingMode && dto.groupingMode !== before.groupingMode) {
      await this.assertGroupingModeChangeAllowed(id, dto.groupingMode);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.classCohort.updateMany({
        where: { id },
        data: {
          ...(dto.programmeId !== undefined ? { programmeId: dto.programmeId } : {}),
          ...(dto.groupingMode !== undefined ? { groupingMode: dto.groupingMode } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          updatedBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ClassCohort',
        entityId: id,
        action: 'update',
        oldValues: { groupingMode: before.groupingMode, status: before.status, capacity: before.capacity },
        newValues: dto as any,
      });
      return tx.classCohort.findFirst({ where: { id } });
    });
  }

  /**
   * ADR-019: changing a grouping mode is versioned by academic year and blocked
   * once placements depend on it. Silently flipping SECTION_ONLY to STREAM_ONLY
   * would leave every existing placement holding a now-illegal tuple.
   */
  private async assertGroupingModeChangeAllowed(cohortId: string, next: GroupingModeValue) {
    const open = await this.prisma.client.enrollmentPlacement.count({
      where: { classCohortId: cohortId, effectiveTo: null },
    });
    if (open === 0) return;
    const offending = await this.prisma.client.enrollmentPlacement.count({
      where: {
        classCohortId: cohortId,
        effectiveTo: null,
        ...(next === 'NONE'
          ? { OR: [{ sectionId: { not: null } }, { streamId: { not: null } }] }
          : next === 'SECTION_ONLY'
            ? { OR: [{ sectionId: null }, { streamId: { not: null } }] }
            : next === 'STREAM_ONLY'
              ? { OR: [{ streamId: null }, { sectionId: { not: null } }] }
              : { OR: [{ sectionId: null }, { streamId: null }] }),
      },
    });
    if (offending > 0) {
      throw new BadRequestException(
        `Cannot switch this cohort to ${next}: ${offending} of ${open} current placements would become invalid. ` +
          'Move those learners first, or supply a reviewed migration.',
      );
    }
  }

  /** Create a cohort for every class in a year that does not have one yet. */
  async generate(dto: GenerateClassCohortsDto) {
    const organizationId = this.tenant.organizationId;
    const year = await this.prisma.client.academicYear.findFirst({ where: { id: dto.academicYearId } });
    if (!year) throw new NotFoundException(`Academic year ${dto.academicYearId} not found`);

    const classes = await this.prisma.client.schoolClass.findMany({
      where: { ...(dto.classIds?.length ? { id: { in: dto.classIds } } : {}) },
      select: { id: true, name: true, gradeLevelId: true, capacity: true },
      orderBy: { name: 'asc' },
    });
    const existing = await this.prisma.client.classCohort.findMany({
      where: { academicYearId: dto.academicYearId },
      select: { classId: true },
    });
    const have = new Set(existing.map((c: any) => c.classId));

    const created: Array<{ id: string; classId: string; className: string }> = [];
    const skipped: Array<{ classId: string; className: string; reason: string }> = [];

    for (const cls of classes) {
      if (have.has(cls.id)) {
        skipped.push({ classId: cls.id, className: cls.name, reason: 'cohort already exists' });
        continue;
      }
      const programmeId = await this.programmeForClass(cls.id);
      const cohort = await this.prisma.client.classCohort.create({
        data: {
          organizationId,
          academicYearId: dto.academicYearId,
          classId: cls.id,
          programmeId,
          groupingMode: dto.groupingMode ?? null,
          capacity: cls.capacity ?? null,
          status: 'ACTIVE',
          createdBy: this.tenant.userId ?? null,
        },
      });
      created.push({ id: cohort.id, classId: cls.id, className: cls.name });
    }

    await this.audit.record({
      entity: 'ClassCohort',
      entityId: dto.academicYearId,
      action: 'create',
      newValues: { generated: created.length, skipped: skipped.length },
    });
    return { academicYearId: dto.academicYearId, created, skipped };
  }

  /**
   * Find or create the cohort for a class in a year. Placement commands call
   * this so a school never has to pre-build cohorts before enrolling anyone.
   */
  async ensureCohort(academicYearId: string, classId: string, tx?: any) {
    const client = tx ?? this.prisma.client;
    const found = await client.classCohort.findFirst({ where: { academicYearId, classId } });
    if (found) return found;
    const programmeId = await this.programmeForClass(classId, client);
    return client.classCohort.create({
      data: {
        organizationId: this.tenant.organizationId,
        academicYearId,
        classId,
        programmeId,
        status: 'ACTIVE',
        createdBy: this.tenant.userId ?? null,
      },
    });
  }

  /** The programme that owns a class, via its grade level. Null when unmapped. */
  async programmeForClass(classId: string, tx?: any): Promise<string | null> {
    const client = tx ?? this.prisma.client;
    const cls = await client.schoolClass.findFirst({ where: { id: classId }, select: { gradeLevelId: true } });
    if (!cls) return null;
    const link = await client.programmeGradeLevel.findFirst({
      where: { gradeLevelId: cls.gradeLevelId },
      select: { programmeId: true },
    });
    return link?.programmeId ?? null;
  }

  /**
   * Attach (or detach) a stream to a section. ADR-019 backfill path for schools
   * moving to SECTION_AND_STREAM — the database trigger refuses a section from
   * another class, and so do we, with a message a person can act on.
   */
  async attachStreamToSection(streamId: string, dto: AttachStreamToSectionDto) {
    const stream = await this.prisma.client.stream.findFirst({ where: { id: streamId } });
    if (!stream) throw new NotFoundException(`Stream ${streamId} not found`);
    const sectionId = dto.sectionId ?? null;
    if (sectionId) {
      const section = await this.prisma.client.section.findFirst({ where: { id: sectionId } });
      if (!section) throw new NotFoundException(`Section ${sectionId} not found`);
      if (section.classId !== stream.classId) {
        throw new BadRequestException(
          `Section "${section.name}" belongs to a different class than stream "${stream.name}". ` +
            'A stream may only sit under a section of its own class.',
        );
      }
      const clashes = await this.prisma.client.enrollmentPlacement.count({
        where: { streamId, effectiveTo: null, sectionId: { not: sectionId } },
      });
      if (clashes > 0) {
        throw new BadRequestException(
          `${clashes} current placement(s) use stream "${stream.name}" with a different section. Move those learners first.`,
        );
      }
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.stream.updateMany({ where: { id: streamId }, data: { sectionId } });
      await this.audit.recordInTx(tx, {
        entity: 'Stream',
        entityId: streamId,
        action: 'update',
        oldValues: { sectionId: stream.sectionId },
        newValues: { sectionId },
      });
      return tx.stream.findFirst({ where: { id: streamId } });
    });
  }
}
