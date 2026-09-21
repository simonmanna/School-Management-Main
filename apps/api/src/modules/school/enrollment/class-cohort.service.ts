import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { resolveAllowsSubdivision } from './subdivision';
import { resolveProgrammeForGrade } from './programme.service';
import type {
  CreateClassCohortDto,
  GenerateClassCohortsDto,
  UpdateClassCohortDto,
} from './enrollment.dto';

/**
 * ClassCohort — one class in one academic year.
 *
 * This is the row that makes "P5, 2026" a thing you can point at. Sections are
 * tied to the cohort's class, whether the class is divided at all is decided
 * here (or on the class), and every placement names a cohort rather than a bare
 * class, so "which P5 did this learner sit in?" has a year attached to the
 * answer.
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
        schoolClass: { include: { gradeLevel: true, sections: { orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] } } },
        academicYear: true,
        programme: true,
      },
    });
    if (!row) throw new NotFoundException(`Class cohort ${id} not found`);
    return row;
  }

  /**
   * What a placement screen may offer for a cohort: whether the class is divided
   * and its ACTIVE sections in the school's own order. A deactivated section
   * stays on historical records but is never offered for a new placement.
   */
  async groupingOptions(cohortId: string) {
    const cohort = await this.get(cohortId);
    const allowsSubdivision = this.allowsSubdivisionOf(cohort);
    const sections = await this.prisma.client.section.findMany({
      where: { classId: cohort.classId, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, capacity: true, classId: true, displayOrder: true },
    });
    return {
      cohortId: cohort.id,
      classId: cohort.classId,
      className: cohort.schoolClass?.name ?? null,
      academicYearId: cohort.academicYearId,
      allowsSubdivision,
      requiresSection: allowsSubdivision && sections.length > 0,
      sections,
    };
  }

  /** Whether a loaded cohort (with schoolClass) is divided. */
  allowsSubdivisionOf(cohort: any): boolean {
    return resolveAllowsSubdivision({
      cohortOverride: cohort.allowsSubdivision,
      classAllowsStreams: cohort.schoolClass?.allowsStreams,
    });
  }

  /** The per-year subdivision override a DTO asks for; undefined leaves it alone. */
  private requestedSubdivision(dto: { allowsSubdivision?: boolean | null }): boolean | null | undefined {
    return dto.allowsSubdivision;
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
          allowsSubdivision: this.requestedSubdivision(dto) ?? null,
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
    const nextSubdivision = this.requestedSubdivision(dto);
    if (nextSubdivision === false && this.allowsSubdivisionOf(before)) {
      await this.assertUndivideAllowed(id);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.classCohort.updateMany({
        where: { id },
        data: {
          ...(dto.programmeId !== undefined ? { programmeId: dto.programmeId } : {}),
          ...(nextSubdivision !== undefined ? { allowsSubdivision: nextSubdivision } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          updatedBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ClassCohort',
        entityId: id,
        action: 'update',
        oldValues: {
          allowsSubdivision: this.allowsSubdivisionOf(before),
          status: before.status,
          capacity: before.capacity,
        },
        newValues: dto as any,
      });
      return tx.classCohort.findFirst({ where: { id } });
    });
  }

  /**
   * Turning subdivision OFF for a year is refused while learners in that cohort
   * sit in a stream: they would be left holding a placement the class no longer
   * allows. Move them out of their streams first.
   */
  private async assertUndivideAllowed(cohortId: string) {
    const inSection = await this.prisma.client.enrollmentPlacement.count({
      where: { classCohortId: cohortId, effectiveTo: null, sectionId: { not: null } },
    });
    if (inSection > 0) {
      throw new BadRequestException(
        `Cannot stop dividing this class: ${inSection} learner(s) currently sit in a stream. ` +
          'Move them to the class as a whole first.',
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
          allowsSubdivision: this.requestedSubdivision(dto) ?? null,
          // NULL = inherit the class's capacity. Copying it here froze the class
          // value into every year's cohort, so a later change to the class never
          // reached the cohorts already generated.
          capacity: null,
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

  /** The programme a class enrols into, via its grade's academic level. Null when unmapped. */
  async programmeForClass(classId: string, tx?: any): Promise<string | null> {
    const client = tx ?? this.prisma.client;
    const cls = await client.schoolClass.findFirst({ where: { id: classId }, select: { gradeLevelId: true } });
    if (!cls) return null;
    return (await resolveProgrammeForGrade(client, cls.gradeLevelId))?.id ?? null;
  }
}
