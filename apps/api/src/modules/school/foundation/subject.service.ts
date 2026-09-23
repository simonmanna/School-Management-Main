import { ConflictException, Injectable } from '@nestjs/common';
import type { Subject } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateSubjectDto, UpdateSubjectDto } from './dto.types';

@Injectable()
export class SubjectService extends BaseCrudService<Subject, CreateSubjectDto, UpdateSubjectDto> {
  protected readonly entityName = 'Subject';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultInclude = { department: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.subject as unknown as CrudDelegate);
  }

  /** Active subjects first, in the school's own order. */
  protected readonly defaultOrderBy: Array<Record<string, 'asc' | 'desc'>> = [
    { isActive: 'desc' },
    { displayOrder: 'asc' },
    { name: 'asc' },
  ];

  /**
   * A subject that has been taught, timetabled or assessed is part of the
   * historical record. It is RETIRED (isActive = false), never deleted.
   */
  async remove(id: string): Promise<void> {
    const [offerings, slots, curricula, assignments] = await Promise.all([
      this.prisma.client.courseOffering.count({ where: { subjectId: id } }),
      this.prisma.client.timetableSlot.count({ where: { subjectId: id } }),
      this.prisma.client.curriculumSubject.count({ where: { subjectId: id } }),
      this.prisma.client.teacherAssignment.count({ where: { subjectId: id } }),
    ]);
    if (offerings + slots + curricula + assignments > 0) {
      throw new ConflictException(
        'This subject is used by teaching, timetable or curriculum records. Retire it (set it inactive) instead of deleting it.',
      );
    }
    return super.remove(id);
  }
}