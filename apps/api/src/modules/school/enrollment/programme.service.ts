import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
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
 * carries the stage and the versioned `config` that later
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
 * template grade simply stays unbanded — the seeder never guesses.
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
        defaultForLevels: { select: { id: true, code: true, name: true } },
        _count: { select: { cohorts: true, enrollments: true } },
      },
    });
  }

  async get(id: string) {
    const row = await this.prisma.client.academicProgramme.findFirst({
      where: { id },
      include: { defaultForLevels: { select: { id: true, code: true, name: true } } },
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
          description: dto.description ?? null,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          isActive: dto.isActive ?? true,
          config: (dto.config ?? {}) as any,
          createdBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AcademicProgramme',
        entityId: programme.id,
        action: 'create',
        newValues: { code: programme.code, stage: programme.stage },
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
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.effectiveFrom !== undefined ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
          ...(dto.effectiveTo !== undefined ? { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.config !== undefined ? { config: dto.config as any } : {}),
          updatedBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AcademicProgramme',
        entityId: id,
        action: 'update',
        oldValues: { stage: before.stage, isActive: before.isActive },
        newValues: dto as any,
      });
      return tx.academicProgramme.findFirst({ where: { id } });
    });
  }

  /**
   * The programme a learner in this grade is enrolled under (ADR-028):
   * `gradeLevel → academicLevel → defaultProgramme`. See `resolveProgrammeForGrade`.
   */
  async programmeForGradeLevel(gradeLevelId: string, tx?: any) {
    return resolveProgrammeForGrade(tx ?? this.prisma.client, gradeLevelId);
  }

  /**
   * Install (or top up) the Uganda programme templates. For each one, an
   * Academic Level with the same code nominates it as the default programme,
   * and the matching grade levels are banded into that level. Idempotent:
   * re-running updates the template rows and re-bands unbanded grades, so a
   * school that adds P7 later just runs it again. A grade the school already
   * banded is left alone.
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
        description: template.description,
        config: template.config as any,
      };
      let programmeId: string;
      if (existing) {
        await this.prisma.client.academicProgramme.updateMany({ where: { id: existing.id }, data: data as any });
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
            const level =
              (await tx.academicLevel.findFirst({ where: { code: template.code } })) ??
              (await tx.academicLevel.create({
                data: {
                  organizationId,
                  code: template.code,
                  name: template.name,
                  stage: template.stage,
                  displayOrder: UGANDA_PROGRAMME_TEMPLATES.findIndex((t) => t.code === template.code) + 1,
                  defaultProgrammeId: programmeId,
                  createdBy: this.tenant.userId ?? null,
                },
              }));
            if (!level.defaultProgrammeId) {
              await tx.academicLevel.updateMany({ where: { id: level.id }, data: { defaultProgrammeId: programmeId } });
            }
            await tx.gradeLevel.updateMany({
              where: { id: { in: ids }, academicLevelId: null },
              data: { academicLevelId: level.id },
            });
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

/**
 * Resolve the programme a grade enrols into (ADR-028).
 *
 * `gradeLevel → academicLevel → defaultProgramme` is deterministic: a grade
 * belongs to one level and a level nominates one default programme. A school
 * that runs a single programme and has not banded its grades gets that one;
 * anything else is null, and the caller must refuse rather than guess.
 */
export async function resolveProgrammeForGrade(client: any, gradeLevelId: string) {
  const grade = await client.gradeLevel.findFirst({
    where: { id: gradeLevelId },
    select: { academicLevel: { select: { defaultProgramme: true } } },
  });
  const viaLevel = grade?.academicLevel?.defaultProgramme ?? null;
  if (viaLevel) return viaLevel;
  const active = await client.academicProgramme.findMany({ where: { isActive: true }, take: 2 });
  return active.length === 1 ? active[0] : null;
}
