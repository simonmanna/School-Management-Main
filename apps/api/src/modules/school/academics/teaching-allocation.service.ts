import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { assertYearWritable } from '../foundation/academic-year-guard';

/**
 * Teacher allocation as a Ugandan school does it (review A7, Phase 1.4): one
 * grid per level — classes (or streams) down, subjects across, a teacher in
 * each cell — plus the class teacher of every class or stream. "Copy from last
 * term" makes the termly chore one click.
 *
 * It writes `TeacherAssignment` rows for the term: exactly what teacher scoping
 * (`DataScopeService.taughtClassIds`), exam-paper entry
 * (`MarkingService.assertMayEnterExamPaper`) and My Teaching read. Course
 * offerings remain available for schools that run them, behind "Advanced".
 */
export interface AllocationCell { classId: string; sectionId?: string | null; subjectId: string; teacherPartnerId: string | null }
export interface ClassTeacherCell { classId: string; sectionId?: string | null; staffProfileId: string | null }

@Injectable()
export class TeachingAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async matrix(termId: string) {
    const db = this.prisma.client as any;
    const term = await db.term.findFirst({ where: { id: termId }, select: { id: true, name: true, academicYearId: true } });
    if (!term) throw new NotFoundException('Term not found.');

    const [classes, subjects, assignments, staff] = await Promise.all([
      db.schoolClass.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, displayOrder: true, homeroomTeacherId: true,
          gradeLevel: { select: { order: true, academicLevelId: true, academicLevel: { select: { id: true, name: true, stage: true, displayOrder: true } } } },
          sections: { where: { isActive: true, deletedAt: null }, select: { id: true, name: true, classTeacherId: true }, orderBy: { name: 'asc' } },
        },
      }),
      db.subject.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, code: true, name: true, academicLevelId: true, displayOrder: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      }),
      db.teacherAssignment.findMany({
        where: { termId },
        select: { classId: true, sectionId: true, subjectId: true, teacherPartnerId: true },
      }),
      // Every active member of staff: a school's category data is not reliable
      // enough to hide someone who does teach (a head teacher, a bursar who
      // takes a class). Teaching staff are listed first.
      db.staffProfile.findMany({
        where: { status: { in: ['active', 'on_leave'] } },
        select: { id: true, employeeNo: true, staffCategory: true, partner: { select: { name: true } } },
      }),
    ]);

    const assigned = new Map<string, string>(
      assignments.map((a: any) => [`${a.classId}:${a.sectionId ?? ''}:${a.subjectId}`, a.teacherPartnerId]),
    );
    const levels = new Map<string, { levelId: string | null; levelName: string; stage: string | null; order: number; subjects: any[]; rows: any[] }>();
    const sorted = [...classes].sort(
      (a: any, b: any) => (a.gradeLevel?.order ?? 0) - (b.gradeLevel?.order ?? 0) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
    for (const c of sorted as any[]) {
      const level = c.gradeLevel?.academicLevel ?? null;
      const key = level?.id ?? 'none';
      if (!levels.has(key)) {
        levels.set(key, {
          levelId: level?.id ?? null,
          levelName: level?.name ?? 'Other classes',
          stage: level?.stage ?? null,
          order: level?.displayOrder ?? 99,
          // A subject tied to a level is taught there; an unbanded subject anywhere.
          subjects: subjects.filter((s: any) => !s.academicLevelId || s.academicLevelId === level?.id),
          rows: [],
        });
      }
      const group = levels.get(key)!;
      const streams: Array<{ id: string | null; name: string | null; classTeacherId: string | null }> = c.sections.length
        ? c.sections.map((s: any) => ({ id: s.id, name: s.name, classTeacherId: s.classTeacherId }))
        : [{ id: null, name: null, classTeacherId: c.homeroomTeacherId }];
      for (const st of streams) {
        const cells: Record<string, { teacherPartnerId: string | null; inherited: boolean }> = {};
        for (const s of group.subjects) {
          const own = assigned.get(`${c.id}:${st.id ?? ''}:${s.id}`);
          const whole = st.id ? assigned.get(`${c.id}::${s.id}`) : undefined;
          cells[s.id] = { teacherPartnerId: own ?? whole ?? null, inherited: !own && !!whole };
        }
        group.rows.push({
          classId: c.id,
          className: c.name,
          sectionId: st.id,
          sectionName: st.name,
          classTeacherId: st.classTeacherId ?? null,
          cells,
        });
      }
    }

    return {
      term,
      levels: [...levels.values()].sort((a, b) => a.order - b.order),
      staff: staff
        .map((s: any) => ({ id: s.id, name: s.partner?.name ?? s.employeeNo, employeeNo: s.employeeNo, teaching: s.staffCategory !== 'non_teaching' }))
        .sort((a: any, b: any) => Number(b.teaching) - Number(a.teaching) || a.name.localeCompare(b.name)),
    };
  }

  /** Save changed cells and class teachers for a term, all or nothing. */
  async save(dto: { termId: string; cells?: AllocationCell[]; classTeachers?: ClassTeacherCell[] }) {
    const db = this.prisma.client as any;
    const term = await db.term.findFirst({ where: { id: dto.termId }, select: { academicYearId: true } });
    if (!term) throw new NotFoundException('Term not found.');
    await assertYearWritable(db, this.tenant.organizationId, term.academicYearId, 'modify');

    const cells = dto.cells ?? [];
    const classTeachers = dto.classTeachers ?? [];
    const staffIds = [...new Set([...cells.map((c) => c.teacherPartnerId), ...classTeachers.map((c) => c.staffProfileId)].filter(Boolean))] as string[];
    const classIds = [...new Set([...cells, ...classTeachers].map((c) => c.classId))];
    const sectionIds = [...new Set([...cells, ...classTeachers].map((c) => c.sectionId).filter(Boolean))] as string[];
    const subjectIds = [...new Set(cells.map((c) => c.subjectId))];
    const [staff, classes, sections, subjects] = await Promise.all([
      staffIds.length ? db.staffProfile.findMany({ where: { id: { in: staffIds } }, select: { id: true, status: true } }) : [],
      classIds.length ? db.schoolClass.findMany({ where: { id: { in: classIds } }, select: { id: true } }) : [],
      sectionIds.length ? db.section.findMany({ where: { id: { in: sectionIds } }, select: { id: true, classId: true } }) : [],
      subjectIds.length ? db.subject.findMany({ where: { id: { in: subjectIds }, isActive: true }, select: { id: true } }) : [],
    ]);
    const okStaff = new Set(staff.filter((s: any) => s.status === 'active' || s.status === 'on_leave').map((s: any) => s.id));
    const okClass = new Set(classes.map((c: any) => c.id));
    const sectionClass = new Map(sections.map((s: any) => [s.id, s.classId]));
    const okSubject = new Set(subjects.map((s: any) => s.id));
    for (const c of [...cells, ...classTeachers]) {
      if (!okClass.has(c.classId)) throw new BadRequestException('A class in this allocation no longer exists.');
      if (c.sectionId && sectionClass.get(c.sectionId) !== c.classId) throw new BadRequestException('A stream does not belong to its class.');
    }
    for (const c of cells) {
      if (!okSubject.has(c.subjectId)) throw new BadRequestException('A subject in this allocation is retired or missing.');
      if (c.teacherPartnerId && !okStaff.has(c.teacherPartnerId)) throw new BadRequestException('A chosen teacher is not active staff.');
    }
    for (const c of classTeachers) {
      if (c.staffProfileId && !okStaff.has(c.staffProfileId)) throw new BadRequestException('A chosen class teacher is not active staff.');
    }

    await this.prisma.client.$transaction(async (tx: any) => {
      for (const c of cells) {
        await tx.teacherAssignment.deleteMany({
          where: { termId: dto.termId, classId: c.classId, sectionId: c.sectionId ?? null, subjectId: c.subjectId },
        });
        if (c.teacherPartnerId) {
          await tx.teacherAssignment.create({
            data: {
              organizationId: this.tenant.organizationId,
              termId: dto.termId,
              classId: c.classId,
              sectionId: c.sectionId ?? null,
              subjectId: c.subjectId,
              teacherPartnerId: c.teacherPartnerId,
            },
          });
        }
      }
      for (const c of classTeachers) {
        if (c.sectionId) await tx.section.updateMany({ where: { id: c.sectionId }, data: { classTeacherId: c.staffProfileId } });
        else await tx.schoolClass.updateMany({ where: { id: c.classId }, data: { homeroomTeacherId: c.staffProfileId } });
      }
      await this.audit.recordInTx(tx, {
        entity: 'TeacherAssignment',
        entityId: dto.termId,
        action: 'update',
        newValues: { cells: cells.length, classTeachers: classTeachers.length },
      });
    });
    return this.matrix(dto.termId);
  }

  /**
   * Start a term from another one's allocation. Cells already allocated in the
   * target term are kept — copying never overwrites a decision.
   */
  async copy(dto: { fromTermId: string; toTermId: string }) {
    if (dto.fromTermId === dto.toTermId) throw new BadRequestException('Choose a different term to copy from.');
    const db = this.prisma.client as any;
    const [from, to] = await Promise.all([
      db.term.findFirst({ where: { id: dto.fromTermId }, select: { id: true } }),
      db.term.findFirst({ where: { id: dto.toTermId }, select: { id: true, academicYearId: true } }),
    ]);
    if (!from || !to) throw new NotFoundException('Term not found.');
    await assertYearWritable(db, this.tenant.organizationId, to.academicYearId, 'create');
    const [source, target] = await Promise.all([
      db.teacherAssignment.findMany({
        where: { termId: dto.fromTermId, teacher: { status: { in: ['active', 'on_leave'] } }, subject: { isActive: true }, schoolClass: { isActive: true } },
        select: { classId: true, sectionId: true, subjectId: true, teacherPartnerId: true, periodsPerWeek: true },
      }),
      db.teacherAssignment.findMany({ where: { termId: dto.toTermId }, select: { classId: true, sectionId: true, subjectId: true } }),
    ]);
    const taken = new Set(target.map((a: any) => `${a.classId}:${a.sectionId ?? ''}:${a.subjectId}`));
    const rows = source.filter((a: any) => !taken.has(`${a.classId}:${a.sectionId ?? ''}:${a.subjectId}`));
    if (rows.length) {
      await db.teacherAssignment.createMany({
        data: rows.map((a: any) => ({ ...a, organizationId: this.tenant.organizationId, termId: dto.toTermId })),
        skipDuplicates: true,
      });
    }
    return { copied: rows.length, kept: source.length - rows.length };
  }
}
