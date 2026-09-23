import { BadRequestException, Injectable } from '@nestjs/common';
import type { SchoolClass, Section } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { AuditedCrudService } from '../../../kernel/common/audited-crud.service';
import type { CrudDelegate } from '../../../kernel/common/base-crud.service';
import type {
  CreateSchoolClassDto,
  CreateSectionDto,
  UpdateSchoolClassDto,
  UpdateSectionDto,
} from './dto.types';
import { deriveCode, normaliseCode } from './structure-codes';

/**
 * Classes and their subdivisions (brief §5, §6, §41).
 *
 * Both live in one file because they are one editing surface: you cannot create
 * a section without a class, and the delete rules are the same argument applied
 * at two levels — once academic history exists, the row stops being deletable.
 */
@Injectable()
export class SchoolClassService extends AuditedCrudService<
  SchoolClass,
  CreateSchoolClassDto,
  UpdateSchoolClassDto
> {
  protected readonly entityName = 'SchoolClass';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultInclude = { gradeLevel: true, campus: true, sections: true };
  /**
   * Academic order, not alphabetical order. Sorting by name puts "P10" before
   * "P2" and gives North/South/East/West an ordering that means nothing to the
   * school. `displayOrder` is seeded from the grade ladder and is then the
   * administrator's to arrange.
   */
  protected readonly defaultOrderBy: Array<Record<string, 'asc' | 'desc'>> = [
    { displayOrder: 'asc' },
    { name: 'asc' },
  ];

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma.client.schoolClass as unknown as CrudDelegate, prisma, audit);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertWritable(tx: any, id: string | null, data: any): Promise<void> {
    if (data?.code !== undefined && data.code !== null) data.code = normaliseCode(data.code);
    if (id === null && !data.code && data.name) data.code = deriveCode(data.name);

    // A foreign key from another tenant must be a 400 naming the problem, not a
    // 500 from a constraint the caller cannot see. The tenancy extension scopes
    // this read, so a row belonging to another organization simply is not found.
    if (data?.gradeLevelId) {
      const grade = await tx.gradeLevel.findFirst({
        where: { id: data.gradeLevelId },
        select: { id: true },
      });
      if (!grade) {
        throw new BadRequestException(
          `Grade level ${data.gradeLevelId} does not exist in this school.`,
        );
      }
    }
    if (data?.campusId) {
      const campus = await tx.campus.findFirst({ where: { id: data.campusId }, select: { id: true } });
      if (!campus) {
        throw new BadRequestException(`Campus ${data.campusId} does not exist in this school.`);
      }
    }

    // Turning subdivision off while sections are still in use would strand every
    // learner placed in one, so it is refused rather than silently ignored.
    if (id !== null && data?.allowsStreams === false) {
      const sections = await tx.section.count({ where: { classId: id, deletedAt: null } });
      if (sections > 0) {
        throw new BadRequestException(
          `This class still has ${sections} stream(s). Remove or deactivate them before ` +
            'turning subdivision off, otherwise learners placed in a stream would be stranded.',
        );
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertDeletable(tx: any, id: string): Promise<void> {
    const blockers = await this.countBlockers([
      {
        label: 'annual cohort(s)',
        count: () => tx.classCohort.count({ where: { classId: id, deletedAt: null } }),
      },
      {
        label: 'placement(s) in its history',
        count: () => tx.enrollmentPlacement.count({ where: { classCohort: { classId: id } } }),
      },
      {
        label: 'stream(s)',
        count: () => tx.section.count({ where: { classId: id, deletedAt: null } }),
      },
      {
        label: 'teacher assignment(s)',
        count: () => tx.teacherAssignment.count({ where: { classId: id } }),
      },
      {
        label: 'timetable slot(s)',
        count: () => tx.timetableSlot.count({ where: { classId: id } }),
      },
    ]);
    if (blockers.length > 0) throw this.blockedByHistory(blockers);
  }
}

@Injectable()
export class SectionService extends AuditedCrudService<Section, CreateSectionDto, UpdateSectionDto> {
  protected readonly entityName = 'Section';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultInclude = {
    schoolClass: { include: { gradeLevel: true, homeroomTeacher: { include: { partner: true } } } },
    classTeacher: { include: { partner: true } },
  };
  protected readonly defaultOrderBy: Array<Record<string, 'asc' | 'desc'>> = [
    { displayOrder: 'asc' },
    { name: 'asc' },
  ];

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma.client.section as unknown as CrudDelegate, prisma, audit);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertWritable(tx: any, id: string | null, data: any): Promise<void> {
    if (data?.code !== undefined && data.code !== null) data.code = normaliseCode(data.code);
    if (id === null && !data.code && data.name) data.code = deriveCode(data.name);

    const classId =
      data?.classId ??
      (id ? (await tx.section.findFirst({ where: { id }, select: { classId: true } }))?.classId : null);
    if (!classId) return;

    const schoolClass = await tx.schoolClass.findFirst({
      where: { id: classId },
      select: { id: true, name: true, allowsStreams: true },
    });
    if (!schoolClass) {
      throw new BadRequestException(`Class ${classId} does not exist in this school.`);
    }
    if (!schoolClass.allowsStreams) {
      throw new BadRequestException(
        `"${schoolClass.name}" is not subdivided, so it cannot have streams. ` +
          'Enable streams on the class first if this school groups its learners.',
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async assertDeletable(tx: any, id: string): Promise<void> {
    const blockers = await this.countBlockers([
      {
        // Closed placements count. "P4 North was used in 2025" is exactly the
        // history that must survive, and it is reachable only through this row.
        label: 'placement(s) in its history',
        count: () => tx.enrollmentPlacement.count({ where: { sectionId: id } }),
      },
      {
        label: 'teacher assignment(s)',
        count: () => tx.teacherAssignment.count({ where: { sectionId: id } }),
      },
      {
        label: 'timetable slot(s)',
        count: () => tx.timetableSlot.count({ where: { sectionId: id } }),
      },
      {
        label: 'attendance record(s)',
        count: () => tx.studentAttendance.count({ where: { sectionId: id } }),
      },
    ]);
    if (blockers.length > 0) throw this.blockedByHistory(blockers);
  }
}
