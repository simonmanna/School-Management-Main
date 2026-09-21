import { BadRequestException, Injectable } from '@nestjs/common';
import type { GradeLevel } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { AuditedCrudService } from '../../../kernel/common/audited-crud.service';
import type { CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateGradeLevelDto, UpdateGradeLevelDto } from './dto.types';
import { deriveCode, normaliseCode } from './structure-codes';

/**
 * Grade levels and the progression ladder between them (brief §5, §13).
 *
 * The ladder is configuration, not code. Promotion used to derive the next grade
 * from `order` plus the alphabetically-first class name, which meant a school
 * whose ladder was not a straight numeric run — nursery Top feeding into P1, or
 * a vocational stream rejoining the main ladder — got a destination the system
 * had guessed. `nextGradeLevelId` makes the answer explicit and editable, and
 * `isTerminal` says where the ladder ends so a P7 leaver is COMPLETED rather
 * than promoted into nothing.
 */
@Injectable()
export class GradeLevelService extends AuditedCrudService<
  GradeLevel,
  CreateGradeLevelDto,
  UpdateGradeLevelDto
> {
  protected readonly entityName = 'GradeLevel';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultOrderBy: Record<string, 'asc' | 'desc'> = { order: 'asc' as const };
  protected readonly defaultInclude = { classes: true };

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma.client.gradeLevel as unknown as CrudDelegate, prisma, audit);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertWritable(tx: any, id: string | null, data: any): Promise<void> {
    if (data?.code !== undefined && data.code !== null) data.code = normaliseCode(data.code);
    if (id === null && !data.code && data.name) data.code = deriveCode(data.name);

    if (data?.nextGradeLevelId) {
      if (id !== null && data.nextGradeLevelId === id) {
        throw new BadRequestException('A grade level cannot be promoted into itself.');
      }
      const target = await tx.gradeLevel.findFirst({
        where: { id: data.nextGradeLevelId },
        select: { id: true, name: true },
      });
      if (!target) {
        throw new BadRequestException(
          `Grade level ${data.nextGradeLevelId} does not exist in this school.`,
        );
      }
      if (id !== null) await this.assertNoCycle(tx, id, data.nextGradeLevelId);

      // A grade cannot both end the ladder and continue it. Rather than refuse a
      // reasonable edit, clear the flag the new destination contradicts.
      if (data.isTerminal === undefined) data.isTerminal = false;
    }

    // Deactivating a grade that another active grade promotes INTO would leave
    // that grade's learners with a destination nobody can be placed in.
    if (id !== null && data?.isActive === false) {
      const feeders = await tx.gradeLevel.count({
        where: { nextGradeLevelId: id, isActive: true, deletedAt: null },
      });
      if (feeders > 0) {
        throw new BadRequestException(
          `${feeders} active grade level(s) promote into this one. Repoint their progression ` +
            'before deactivating it, otherwise their learners have nowhere to go.',
        );
      }
    }
  }

  /**
   * Walk the proposed ladder forward and refuse if it returns to the start.
   *
   * A foreign key cannot prevent this: every row in a cycle points at a row that
   * really exists. Without the walk, `P4 → P5 → P4` is accepted and the first
   * bulk promotion that follows the chain never terminates. The walk is bounded
   * by the number of grade levels, so a cycle anywhere in the chain is caught,
   * not just one that closes immediately.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async assertNoCycle(tx: any, startId: string, nextId: string): Promise<void> {
    const limit = await tx.gradeLevel.count({ where: { deletedAt: null } });
    const seen = new Set<string>([startId]);
    let cursor: string | null = nextId;
    const path: string[] = [];

    for (let hops = 0; cursor && hops <= limit + 1; hops += 1) {
      const row: { id: string; name: string; nextGradeLevelId: string | null } | null =
        await tx.gradeLevel.findFirst({
          where: { id: cursor },
          select: { id: true, name: true, nextGradeLevelId: true },
        });
      if (!row) return;
      path.push(row.name);
      if (seen.has(row.id)) {
        throw new BadRequestException(
          `That progression creates a loop (${path.join(' → ')}). A learner promoted along it ` +
            'would never leave the ladder. Point the last grade at nothing and mark it terminal instead.',
        );
      }
      seen.add(row.id);
      cursor = row.nextGradeLevelId;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertDeletable(tx: any, id: string): Promise<void> {
    const blockers = await this.countBlockers([
      {
        label: 'class(es)',
        count: () => tx.schoolClass.count({ where: { gradeLevelId: id, deletedAt: null } }),
      },
      {
        label: 'enrollment(s)',
        count: () => tx.studentEnrollment.count({ where: { gradeLevelId: id } }),
      },
      {
        label: 'grade level(s) that promote into it',
        count: () => tx.gradeLevel.count({ where: { nextGradeLevelId: id, deletedAt: null } }),
      },
      {
        label: 'programme link(s)',
        count: () => tx.programmeGradeLevel.count({ where: { gradeLevelId: id } }),
      },
    ]);
    if (blockers.length > 0) throw this.blockedByHistory(blockers);
  }
}
