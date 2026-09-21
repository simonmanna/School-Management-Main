import { BadRequestException, Injectable } from '@nestjs/common';
import type { AcademicLevel } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { AuditedCrudService } from '../../../kernel/common/audited-crud.service';
import type { CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateAcademicLevelDto, UpdateAcademicLevelDto } from './dto.types';
import { deriveCode, normaliseCode } from './structure-codes';

/**
 * Academic levels — the band above a grade (ADR-028, brief §4).
 *
 * Pre-Primary, Primary, Secondary, Vocational. Or Junior School and Senior
 * School. Or one band called whatever the school calls it. Nothing in this file
 * knows which of those a given school uses, and nothing may start knowing:
 * levels are data a school configures, never a list in code.
 *
 * The level is also where programme resolution now begins. A grade belongs to
 * one level, and a level nominates one default programme, so
 * `gradeLevel → programme` stays deterministic while losing the join table that
 * used to own the answer.
 */
@Injectable()
export class AcademicLevelService extends AuditedCrudService<
  AcademicLevel,
  CreateAcademicLevelDto,
  UpdateAcademicLevelDto
> {
  protected readonly entityName = 'AcademicLevel';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultOrderBy: Array<Record<string, 'asc' | 'desc'>> = [
    { displayOrder: 'asc' },
    { name: 'asc' },
  ];
  protected readonly defaultInclude = {
    defaultProgramme: true,
    gradeLevels: { orderBy: { order: 'asc' as const } },
  };

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma.client.academicLevel as unknown as CrudDelegate, prisma, audit);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertWritable(tx: any, id: string | null, data: any): Promise<void> {
    if (data?.code !== undefined && data.code !== null) data.code = normaliseCode(data.code);
    if (id === null && !data.code && data.name) data.code = deriveCode(data.name);
    if (id === null && !data.code) {
      throw new BadRequestException(
        'An academic level needs a code. Give it one, or a name that contains at least one letter or digit.',
      );
    }

    if (data?.defaultProgrammeId) {
      const programme = await tx.academicProgramme.findFirst({
        where: { id: data.defaultProgrammeId },
        select: { id: true },
      });
      if (!programme) {
        throw new BadRequestException(
          `Programme ${data.defaultProgrammeId} does not exist in this school.`,
        );
      }
    }

    // Deactivating a level that still holds active grades would leave those
    // grades pointing at a band the structure screen no longer offers.
    if (id !== null && data?.isActive === false) {
      const grades = await tx.gradeLevel.count({
        where: { academicLevelId: id, isActive: true, deletedAt: null },
      });
      if (grades > 0) {
        throw new BadRequestException(
          `This level still holds ${grades} active grade level(s). Move them to another level, ` +
            'or deactivate them first.',
        );
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertDeletable(tx: any, id: string): Promise<void> {
    const blockers = await this.countBlockers([
      {
        // GradeLevel.academicLevelId is ON DELETE RESTRICT precisely so this
        // cannot be bypassed: silently unbanding every grade because someone
        // removed a level is how a structure screen grows an "Unassigned"
        // bucket nobody can account for.
        label: 'grade level(s)',
        count: () => tx.gradeLevel.count({ where: { academicLevelId: id, deletedAt: null } }),
      },
    ]);
    if (blockers.length > 0) throw this.blockedByHistory(blockers);
  }
}
