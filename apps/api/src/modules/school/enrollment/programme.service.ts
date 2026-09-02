import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import type { GroupingModeValue } from './grouping';
import type {
  CreateProgrammeDto,
  SeedUgandaProgrammesDto,
  UpdateProgrammeDto,
} from './enrollment.dto';

/**
 * Uganda programme templates (§4 of the plan).
 *
 * These are DATA, not code branches. Nothing in the system may ever ask
 * `if (className === 'P2')`; it asks the learner's programme, and the programme
 * carries the stage, the grouping default and the versioned `config` that later
 * phases read for assessment kinds, ranking and report templates.
 */
export const UGANDA_PROGRAMME_TEMPLATES = [
  {
    code: 'PRIMARY_LOWER',
    name: 'Lower Primary (P1–P3)',
    stage: 'PRIMARY_LOWER' as const,
    curriculumAuthority: 'NCDC',
    grades: ['P1', 'P2', 'P3'],
    description: 'Learning areas, continuous observation and competency checklists. No ranking by default.',
    config: {
      assessmentModel: 'LEARNING_AREA',
      continuousObservation: true,
      competencyChecklists: true,
      narrativeFeedback: true,
      rankingEnabled: false,
      requiresEvidenceAttachments: true,
      assessmentKinds: ['OBSERVATION', 'CLASSWORK', 'PROJECT', 'ACTIVITY_OF_INTEGRATION'],
    },
  },
  {
    code: 'PRIMARY_UPPER',
    name: 'Upper Primary (P4–P7)',
    stage: 'PRIMARY_UPPER' as const,
    curriculumAuthority: 'NCDC',
    grades: ['P4', 'P5', 'P6', 'P7'],
    description: 'Subject-based offerings with homework, CAT, project, practical and examination components.',
    config: {
      assessmentModel: 'SUBJECT',
      continuousObservation: true,
      competencyChecklists: true,
      narrativeFeedback: true,
      rankingEnabled: true,
      assessmentKinds: ['HOMEWORK', 'CAT', 'CLASSWORK', 'PROJECT', 'PRACTICAL', 'OBSERVATION', 'EXAM'],
    },
  },
  {
    code: 'LOWER_SECONDARY',
    name: 'Lower Secondary (S1–S4)',
    stage: 'LOWER_SECONDARY' as const,
    curriculumAuthority: 'UNEB',
    grades: ['S1', 'S2', 'S3', 'S4'],
    description:
      'Knowledge/understanding/skills evidence, Activities of Integration and project work, with UNEB CA readiness checks.',
    config: {
      assessmentModel: 'SUBJECT',
      activitiesOfIntegration: true,
      projectWork: true,
      unebContinuousAssessment: true,
      candidateNumberRequiredFromGrade: 'S3',
      rankingEnabled: true,
      assessmentKinds: ['HOMEWORK', 'CAT', 'PROJECT', 'PRACTICAL', 'ORAL', 'ACTIVITY_OF_INTEGRATION', 'EXAM'],
    },
  },
  {
    code: 'ADVANCED_SECONDARY',
    name: 'Advanced Secondary (S5–S6)',
    stage: 'ADVANCED_SECONDARY' as const,
    curriculumAuthority: 'UNEB',
    grades: ['S5', 'S6'],
    description: 'Subject combinations, subsidiary subjects, rubric-based classroom assessment and research work.',
    config: {
      assessmentModel: 'SUBJECT',
      subjectCombinations: true,
      subsidiarySubjects: true,
      rubricAssessment: true,
      rankingEnabled: true,
      assessmentKinds: ['CAT', 'PROJECT', 'PRACTICAL', 'ORAL', 'EXAM'],
    },
  },
] as const;

/**
 * Normalise a grade-level name for template matching: 'Primary 1', 'P.1',
 * 'p 1' and 'P1' are all the same grade. Anything that does not normalise to a
 * template grade simply stays unlinked — the seeder never guesses.
 */
export function normaliseGradeName(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[\s._-]/g, '');
  const primary = s.match(/^(?:PRIMARY|P)(\d{1,2})$/);
  if (primary) return `P${Number(primary[1])}`;
  const senior = s.match(/^(?:SENIOR|SECONDARY|S|FORM)(\d{1,2})$/);
  if (senior) return `S${Number(senior[1])}`;
  return s;
}

@Injectable()
export class ProgrammeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(opts: { includeInactive?: boolean } = {}) {
    return this.prisma.client.academicProgramme.findMany({
      where: { ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ stage: 'asc' }, { code: 'asc' }],
      include: {
        gradeLevels: { include: { gradeLevel: true } },
        _count: { select: { cohorts: true, enrollments: true } },
      },
    });
  }

  async get(id: string) {
    const row = await this.prisma.client.academicProgramme.findFirst({
      where: { id },
      include: { gradeLevels: { include: { gradeLevel: true } } },
    });
    if (!row) throw new NotFoundException(`Programme ${id} not found`);
    return row;
  }

  async create(dto: CreateProgrammeDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const programme = await tx.academicProgramme.create({
        data: {
          organizationId,
          code: dto.code.trim(),
          name: dto.name.trim(),
          stage: dto.stage ?? 'OTHER',
          curriculumAuthority: dto.curriculumAuthority ?? null,
          groupingMode: dto.groupingMode ?? 'SECTION_ONLY',
          description: dto.description ?? null,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          isActive: dto.isActive ?? true,
          config: (dto.config ?? {}) as any,
          createdBy: this.tenant.userId ?? null,
        },
      });
      if (dto.gradeLevelIds?.length) {
        await this.replaceGradeLinks(tx, organizationId, programme.id, dto.gradeLevelIds);
      }
      await this.audit.recordInTx(tx, {
        entity: 'AcademicProgramme',
        entityId: programme.id,
        action: 'create',
        newValues: { code: programme.code, stage: programme.stage, groupingMode: programme.groupingMode },
      });
      return programme;
    });
  }

  async update(id: string, dto: UpdateProgrammeDto) {
    const organizationId = this.tenant.organizationId;
    const before = await this.get(id);
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.academicProgramme.updateMany({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.stage !== undefined ? { stage: dto.stage } : {}),
          ...(dto.curriculumAuthority !== undefined ? { curriculumAuthority: dto.curriculumAuthority } : {}),
          ...(dto.groupingMode !== undefined ? { groupingMode: dto.groupingMode } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.effectiveFrom !== undefined ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
          ...(dto.effectiveTo !== undefined ? { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.config !== undefined ? { config: dto.config as any } : {}),
          updatedBy: this.tenant.userId ?? null,
        },
      });
      if (dto.gradeLevelIds) {
        await this.replaceGradeLinks(tx, organizationId, id, dto.gradeLevelIds);
      }
      await this.audit.recordInTx(tx, {
        entity: 'AcademicProgramme',
        entityId: id,
        action: 'update',
        oldValues: { stage: before.stage, groupingMode: before.groupingMode, isActive: before.isActive },
        newValues: dto as any,
      });
      return tx.academicProgramme.findFirst({ where: { id }, include: { gradeLevels: true } });
    });
  }

  /**
   * A grade level maps to exactly ONE programme (schema-enforced), so linking it
   * to a new programme detaches it from the old one rather than failing on the
   * unique index — which is what an administrator actually means when they move
   * P4 from Lower to Upper Primary.
   */
  private async replaceGradeLinks(tx: any, organizationId: string, programmeId: string, gradeLevelIds: string[]) {
    const unique = [...new Set(gradeLevelIds)];
    const found = await tx.gradeLevel.findMany({ where: { id: { in: unique } }, select: { id: true } });
    const missing = unique.filter((id) => !found.some((g: any) => g.id === id));
    if (missing.length) {
      throw new BadRequestException(`Unknown grade level(s): ${missing.join(', ')}`);
    }
    await tx.programmeGradeLevel.deleteMany({ where: { programmeId } });
    await tx.programmeGradeLevel.deleteMany({ where: { gradeLevelId: { in: unique } } });
    for (const gradeLevelId of unique) {
      await tx.programmeGradeLevel.create({ data: { organizationId, programmeId, gradeLevelId } });
    }
  }

  /** Resolve the programme that owns a grade level. */
  async programmeForGradeLevel(gradeLevelId: string, tx?: any) {
    const client = tx ?? this.prisma.client;
    const link = await client.programmeGradeLevel.findFirst({
      where: { gradeLevelId },
      include: { programme: true },
    });
    return link?.programme ?? null;
  }

  /**
   * Install (or top up) the four Uganda programme templates and attach them to
   * matching grade levels. Idempotent: re-running updates the template rows and
   * relinks grades, so a school that adds P7 later just runs it again.
   */
  async seedUganda(dto: SeedUgandaProgrammesDto = {}) {
    const organizationId = this.tenant.organizationId;
    const link = dto.linkGradeLevels ?? true;
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    const gradeLevels = await this.prisma.client.gradeLevel.findMany({ select: { id: true, name: true } });
    const byNormalised = new Map<string, string>();
    for (const g of gradeLevels) byNormalised.set(normaliseGradeName(g.name), g.id);

    const created: string[] = [];
    const updated: string[] = [];
    const linked: Record<string, string[]> = {};
    const unmatchedGrades: string[] = [];

    for (const template of UGANDA_PROGRAMME_TEMPLATES) {
      const existing = await this.prisma.client.academicProgramme.findFirst({ where: { code: template.code } });
      const data = {
        name: template.name,
        stage: template.stage,
        curriculumAuthority: template.curriculumAuthority,
        groupingMode: (dto.groupingMode ?? 'SECTION_ONLY') as GroupingModeValue,
        description: template.description,
        config: template.config as any,
      };
      let programmeId: string;
      if (existing) {
        // Never clobber a school's own grouping choice on a re-run.
        const { groupingMode: _ignoredMode, ...rest } = data;
        await this.prisma.client.academicProgramme.updateMany({ where: { id: existing.id }, data: rest as any });
        programmeId = existing.id;
        updated.push(template.code);
      } else {
        const row = await this.prisma.client.academicProgramme.create({
          data: {
            organizationId,
            code: template.code,
            effectiveFrom,
            isActive: true,
            createdBy: this.tenant.userId ?? null,
            ...(data as any),
          },
        });
        programmeId = row.id;
        created.push(template.code);
      }

      if (link) {
        const ids: string[] = [];
        for (const grade of template.grades) {
          const gradeLevelId = byNormalised.get(grade);
          if (!gradeLevelId) {
            unmatchedGrades.push(grade);
            continue;
          }
          ids.push(gradeLevelId);
        }
        if (ids.length) {
          await this.prisma.client.$transaction(async (tx: any) => {
            await this.replaceGradeLinks(tx, organizationId, programmeId, ids);
          });
        }
        linked[template.code] = ids;
      }
    }

    await this.audit.record({
      entity: 'AcademicProgramme',
      entityId: 'uganda-templates',
      action: 'create',
      newValues: { created, updated, linked, unmatchedGrades },
    });

    return {
      created,
      updated,
      linked,
      /** Template grades with no matching GradeLevel row — create them first. */
      unmatchedGrades: [...new Set(unmatchedGrades)],
    };
  }
}
