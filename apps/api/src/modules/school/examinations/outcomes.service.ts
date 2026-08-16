import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { LearningOutcome, StudentOutcomeAchievement } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import {
  CreateLearningOutcomeDto,
  UpdateLearningOutcomeDto,
  RecordOutcomeAchievementDto,
} from './outcomes.dto';

export const OUTCOME_LEVELS = ['not_met', 'approaching', 'met', 'exceeded'] as const;

/**
 * P1-B: learning-outcome definitions + per-student achievement capture.
 *
 * A LearningOutcome is a concrete, assessable target ("Solve quadratic
 * equations") attached to a subject/topic/competency. Teachers record each
 * student's achievement level (and optional mastery %) per term; this feeds the
 * competency report (P2-B). Achievement is upserted per
 * (student, outcome, term) so re-grading is idempotent.
 */
@Injectable()
export class LearningOutcomeService extends BaseCrudService<LearningOutcome, CreateLearningOutcomeDto, UpdateLearningOutcomeDto> {
  protected readonly entityName = 'LearningOutcome';
  protected readonly searchFields = ['title', 'description'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.learningOutcome as unknown as CrudDelegate);
  }

  /** Record/overwrite a student's achievement against an outcome for a term. */
  async recordAchievement(dto: RecordOutcomeAchievementDto) {
    if (!OUTCOME_LEVELS.includes(dto.level as any)) {
      throw new BadRequestException(`level must be one of: ${OUTCOME_LEVELS.join(', ')}`);
    }
    const outcome = await this.prisma.client.learningOutcome.findFirst({ where: { id: dto.learningOutcomeId } });
    if (!outcome) throw new NotFoundException(`LearningOutcome ${dto.learningOutcomeId} not found`);
    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
    if (!student) throw new NotFoundException(`StudentProfile ${dto.studentProfileId} not found`);

    const achievement = await this.prisma.client.studentOutcomeAchievement.upsert({
      where: {
        studentProfileId_learningOutcomeId_termId: {
          studentProfileId: dto.studentProfileId,
          learningOutcomeId: dto.learningOutcomeId,
          termId: dto.termId,
        },
      },
      create: {
        organizationId: this.tenant.organizationId,
        studentProfileId: dto.studentProfileId,
        learningOutcomeId: dto.learningOutcomeId,
        termId: dto.termId,
        level: dto.level,
        masteryPercent: dto.masteryPercent ?? null,
        comment: dto.comment ?? null,
        assessedById: dto.assessedById ?? null,
      },
      update: {
        level: dto.level,
        masteryPercent: dto.masteryPercent ?? null,
        comment: dto.comment ?? null,
        assessedById: dto.assessedById ?? null,
      },
    });
    return achievement;
  }

  /** All achievements for a student in a term (drives the competency report). */
  async achievementsByStudentTerm(studentProfileId: string, termId: string): Promise<StudentOutcomeAchievement[]> {
    return this.prisma.client.studentOutcomeAchievement.findMany({
      where: { studentProfileId, termId },
      include: { learningOutcome: { include: { competency: true, subject: true, topic: true } } },
      orderBy: { learningOutcome: { order: 'asc' } },
    });
  }

  /** All achievements for a subject in a term (class-wide competency view). */
  async achievementsBySubjectTerm(subjectId: string, termId: string) {
    return this.prisma.client.studentOutcomeAchievement.findMany({
      where: { termId, learningOutcome: { subjectId } },
      include: { learningOutcome: true, student: { include: { partner: true } } },
      orderBy: { studentProfileId: 'asc' },
    });
  }
}
