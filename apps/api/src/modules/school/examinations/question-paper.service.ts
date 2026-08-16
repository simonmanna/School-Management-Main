import { Injectable, NotFoundException } from '@nestjs/common';
import type { QuestionPaper } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateQuestionPaperDto, UpdateQuestionPaperDto } from './question-paper.dto';

/**
 * P2-A: traditional (paper-based) question papers attached to an ExamSchedule
 * sitting. Distinct from the CBT `Paper` so a school can keep a printed-paper
 * archive (with setter/moderator sign-off and an optional uploaded source
 * file) alongside computer-based testing.
 */
@Injectable()
export class QuestionPaperService extends BaseCrudService<QuestionPaper, CreateQuestionPaperDto, UpdateQuestionPaperDto> {
  protected readonly entityName = 'QuestionPaper';
  protected readonly searchFields = ['title'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.questionPaper as unknown as CrudDelegate);
  }

  /** All papers for a schedule sitting. */
  async bySchedule(examScheduleId: string) {
    return this.prisma.client.questionPaper.findMany({
      where: { examScheduleId, deletedAt: null },
      orderBy: { paperNumber: 'asc' },
    });
  }

  /** Override create to validate the schedule exists + belongs to org. */
  async create(dto: CreateQuestionPaperDto): Promise<QuestionPaper> {
    const schedule = await this.prisma.client.examSchedule.findFirst({ where: { id: dto.examScheduleId } });
    if (!schedule) throw new NotFoundException(`ExamSchedule ${dto.examScheduleId} not found`);
    return super.create({ ...dto, organizationId: this.tenant.organizationId } as any);
  }
}
