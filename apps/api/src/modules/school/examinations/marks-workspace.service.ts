import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { GradeEntryService } from './examinations.service';
import { GradingService } from './grading.service';
import type { ApplyClassesDto, LockMarksDto, RemoveClassDto, SaveMarkDto } from './marks-workspace.dto';

/** Participation values that mean "resolved, but no numeric mark". */
const NON_SCORING = new Set(['absent', 'exempt', 'excused', 'malpractice']);

type StudentRow = {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  streamId: string | null;
  streamName: string | null;
  sectionId: string | null;
};

/**
 * MarksWorkspaceService — the flat, task-shaped read/write surface behind the
 * exam workspace UI.
 *
 * The domain underneath is deliberately rich (exam → schedule → grade entry,
 * projected into the assessment spine). Front-office users do not think in
 * those nouns: they think "make an exam, say which classes sit it, type the
 * marks, look at the results, lock it". Every method here answers one of those
 * five questions in a single round trip, over the SAME rows the rest of the
 * system already writes — no parallel store, no migration of existing marks.
 *
 * The one rule that shapes this file: a marksheet is derived from the CLASS
 * ROSTER, never from the rows that happen to exist. A student with no mark yet
 * must still appear, with an empty box, or the teacher cannot enter their mark.
 */
@Injectable()
export class MarksWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly grades: GradeEntryService,
    private readonly grading: GradingService,
  ) {}

  /* ─────────────────────────── Step 1: exams ─────────────────────────── */

  /**
   * Exams for a term, each with a one-glance progress roll-up so the exam
   * office can see "Term 1 Mid-Term: 6 classes, 412/900 marks in" without
   * opening anything.
   */
  async exams(params: { termId?: string; academicYearId?: string }) {
    const where: any = {};
    if (params.termId) where.termId = params.termId;
    else if (params.academicYearId) {
      const terms = await this.prisma.client.term.findMany({
        where: { academicYearId: params.academicYearId },
        select: { id: true },
      });
      where.termId = { in: terms.map((t) => t.id) };
    }

    const exams = await this.prisma.client.exam.findMany({
      where,
      include: { examType: true, term: true },
      orderBy: [{ startDate: 'desc' }],
    });
    if (exams.length === 0) return [];

    const examIds = exams.map((e) => e.id);
    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId: { in: examIds } },
      select: { id: true, examId: true, classId: true, marksLockedAt: true },
    });
    const entered = await this.prisma.client.gradeEntry.groupBy({
      by: ['examScheduleId'],
      where: { examScheduleId: { in: schedules.map((s) => s.id) }, marksObtained: { not: null } },
      _count: { _all: true },
    });
    const enteredBySchedule = new Map(entered.map((e) => [e.examScheduleId, e._count._all]));

    // Class sizes, so "expected marks" is a real number rather than a guess.
    const classIds = [...new Set(schedules.map((s) => s.classId))];
    const sizes = await this.classSizes(classIds);

    return exams.map((exam) => {
      const own = schedules.filter((s) => s.examId === exam.id);
      const classes = new Set(own.map((s) => s.classId));
      let expected = 0;
      let done = 0;
      for (const s of own) {
        expected += sizes.get(s.classId) ?? 0;
        done += enteredBySchedule.get(s.id) ?? 0;
      }
      return {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        startDate: exam.startDate,
        endDate: exam.endDate,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeId: exam.examTypeId,
        examTypeName: exam.examType?.name ?? null,
        weight: exam.examType ? Number(exam.examType.weight) : null,
        isFinal: exam.examType?.isFinal ?? false,
        classCount: classes.size,
        paperCount: own.length,
        lockedPaperCount: own.filter((s) => s.marksLockedAt != null).length,
        marksExpected: expected,
        marksEntered: done,
      };
    });
  }

  /* ────────────────── Step 2: which classes sit this exam ────────────────── */

  /**
   * The class × exam matrix. One row per class: is it applied, how many papers,
   * how far along is entry, is it locked. This is the screen that replaces
   * hand-creating an exam schedule per subject per class.
   */
  async coverage(examId: string) {
    const exam = await this.prisma.client.exam.findFirst({
      where: { id: examId },
      include: { examType: true, term: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);

    const [classes, schedules] = await Promise.all([
      this.prisma.client.schoolClass.findMany({
        include: { gradeLevel: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.examSchedule.findMany({
        where: { examId },
        include: { subject: true },
      }),
    ]);

    const sizes = await this.classSizes(classes.map((c) => c.id));
    const entered = schedules.length
      ? await this.prisma.client.gradeEntry.groupBy({
          by: ['examScheduleId'],
          where: { examScheduleId: { in: schedules.map((s) => s.id) }, marksObtained: { not: null } },
          _count: { _all: true },
        })
      : [];
    const enteredBySchedule = new Map(entered.map((e) => [e.examScheduleId, e._count._all]));

    const rows = classes.map((c) => {
      const own = schedules.filter((s) => s.classId === c.id);
      const size = sizes.get(c.id) ?? 0;
      const done = own.reduce((n, s) => n + (enteredBySchedule.get(s.id) ?? 0), 0);
      return {
        classId: c.id,
        className: c.name,
        gradeLevelName: c.gradeLevel?.name ?? null,
        studentCount: size,
        applied: own.length > 0,
        paperCount: own.length,
        lockedPaperCount: own.filter((s) => s.marksLockedAt != null).length,
        marksExpected: own.length * size,
        marksEntered: done,
        subjects: own
          .map((s) => ({
            examScheduleId: s.id,
            subjectId: s.subjectId,
            subjectName: s.subject?.name ?? '',
            subjectCode: s.subject?.code ?? '',
            maxMarks: Number(s.maxMarks),
            locked: s.marksLockedAt != null,
            marksEntered: enteredBySchedule.get(s.id) ?? 0,
            marksExpected: size,
          }))
          .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
      };
    });

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeName: exam.examType?.name ?? null,
        status: exam.status,
        startDate: exam.startDate,
      },
      classes: rows,
    };
  }

  /**
   * Add an exam to one or more classes: one ExamSchedule per (class, subject).
   * Idempotent — re-running only fills the gaps, so a school can add a subject
   * later and press the same button.
   */
  async applyClasses(dto: ApplyClassesDto) {
    const organizationId = this.tenant.organizationId;
    const exam = await this.prisma.client.exam.findFirst({ where: { id: dto.examId } });
    if (!exam) throw new NotFoundException(`Exam ${dto.examId} not found`);

    const existing = await this.prisma.client.examSchedule.findMany({
      where: { examId: dto.examId, classId: { in: dto.classIds } },
      select: { classId: true, subjectId: true },
    });
    const have = new Set(existing.map((s) => `${s.classId}:${s.subjectId}`));

    const data: any[] = [];
    for (const classId of dto.classIds) {
      const subjectIds = dto.subjectIds?.length
        ? dto.subjectIds
        : (await this.subjectsForClass(classId)).map((s) => s.id);
      for (const subjectId of subjectIds) {
        if (have.has(`${classId}:${subjectId}`)) continue;
        data.push({
          organizationId,
          examId: dto.examId,
          classId,
          subjectId,
          date: exam.startDate,
          startTime: '09:00',
          durationMinutes: 120,
          maxMarks: dto.maxMarks ?? 100,
        });
      }
    }
    if (data.length === 0) return { created: 0, skipped: have.size };

    const res = await this.prisma.client.examSchedule.createMany({ data, skipDuplicates: true });
    await this.audit.record({
      entity: 'ExamSchedule',
      entityId: dto.examId,
      action: 'create',
      newValues: { action: 'apply_classes', examId: dto.examId, classIds: dto.classIds, created: res.count },
    });
    return { created: res.count, skipped: have.size };
  }

  /**
   * Take a class off an exam. Refused once any mark exists — removing it would
   * cascade-delete real marks, which is never what "untick a box" should mean.
   */
  async removeClass(dto: RemoveClassDto) {
    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId: dto.examId, classId: dto.classId },
      select: { id: true },
    });
    if (schedules.length === 0) return { removed: 0 };

    const marks = await this.prisma.client.gradeEntry.count({
      where: { examScheduleId: { in: schedules.map((s) => s.id) } },
    });
    if (marks > 0) {
      throw new ConflictException(
        `This class already has ${marks} mark(s) for this exam. Delete the marks first, or leave the class on the exam.`,
      );
    }

    const res = await this.prisma.client.examSchedule.deleteMany({
      where: { examId: dto.examId, classId: dto.classId },
    });
    await this.audit.record({
      entity: 'ExamSchedule',
      entityId: dto.examId,
      action: 'delete',
      newValues: { action: 'remove_class', examId: dto.examId, classId: dto.classId, removed: res.count },
    });
    return { removed: res.count };
  }

  /* ─────────────────────────── Step 3: marksheet ─────────────────────────── */

  /**
   * The marksheet for one paper — EVERY student in the class (optionally one
   * stream), each with their mark if one exists. Students without a GradeEntry
   * come back with `marks: null`, which is the whole point: you cannot type a
   * mark for a student the screen does not show.
   */
  async sheet(params: { examId: string; classId: string; subjectId: string; streamId?: string }) {
    const [exam, klass, subject] = await Promise.all([
      this.prisma.client.exam.findFirst({ where: { id: params.examId }, include: { term: true, examType: true } }),
      this.prisma.client.schoolClass.findFirst({ where: { id: params.classId } }),
      this.prisma.client.subject.findFirst({ where: { id: params.subjectId } }),
    ]);
    if (!exam) throw new NotFoundException(`Exam ${params.examId} not found`);
    if (!klass) throw new NotFoundException(`Class ${params.classId} not found`);
    if (!subject) throw new NotFoundException(`Subject ${params.subjectId} not found`);

    const schedule = await this.prisma.client.examSchedule.findFirst({
      where: { examId: params.examId, classId: params.classId, subjectId: params.subjectId },
    });

    const students = await this.studentsOfClass(params.classId, params.streamId);
    const entries = schedule
      ? await this.prisma.client.gradeEntry.findMany({ where: { examScheduleId: schedule.id } })
      : [];
    const byStudent = new Map(entries.map((g) => [g.studentProfileId, g]));

    const maxMarks = schedule ? Number(schedule.maxMarks) : 100;
    const rows = students.map((s, i) => {
      const g = byStudent.get(s.studentProfileId);
      return {
        index: i + 1,
        ...s,
        gradeEntryId: g?.id ?? null,
        marks: g?.marksObtained != null ? Number(g.marksObtained) : null,
        grade: g?.grade ?? null,
        remarks: g?.remarks ?? null,
        participation: this.participationOf(g),
        status: g?.status ?? 'draft',
        version: g?.version ?? 0,
      };
    });

    const entered = rows.filter((r) => r.marks != null || NON_SCORING.has(r.participation)).length;
    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeName: exam.examType?.name ?? null,
      },
      class: { id: klass.id, name: klass.name },
      subject: { id: subject.id, name: subject.name, code: subject.code },
      examScheduleId: schedule?.id ?? null,
      applied: schedule != null,
      maxMarks,
      locked: schedule?.marksLockedAt != null,
      lockedAt: schedule?.marksLockedAt ?? null,
      approvalStatus: this.rollupStatus(entries.map((e) => e.status)),
      total: rows.length,
      entered,
      students: rows,
    };
  }

  /**
   * Save one cell. Creates the exam schedule on demand, so a teacher who picked
   * a subject the office forgot to apply is not blocked — the paper is created
   * the moment a mark is typed into it.
   */
  async saveMark(dto: SaveMarkDto) {
    const schedule = await this.ensureSchedule(dto.examId, dto.classId, dto.subjectId, dto.maxMarks);
    if (schedule.marksLockedAt) {
      throw new ConflictException('Mark entry is locked for this paper. Unlock it to make changes.');
    }

    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: dto.studentProfileId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

    const maxMarks = Number(schedule.maxMarks);
    const clearing = dto.marks === null || dto.marks === undefined;

    if (clearing) {
      // Clearing a cell (or marking a non-scoring outcome) must not leave a
      // stale numeric mark behind — in EITHER store. This used to write
      // `gradeEntry` here directly and return, with no projection, so the spine
      // kept the old score and the gradebook, the result run and the report card
      // all went on counting a mark the teacher had erased.
      const remarks = dto.participation && dto.participation !== 'present' ? dto.participation : null;
      const res = await this.grades.clearEntry({
        examScheduleId: schedule.id,
        studentProfileId: dto.studentProfileId,
        remarks,
      });
      if (!res.row) return { cleared: true };
      return { cleared: true, examScheduleId: schedule.id, participation: dto.participation ?? null };
    }

    if (dto.marks! < 0 || dto.marks! > maxMarks) {
      throw new BadRequestException(`Mark must be between 0 and ${maxMarks}`);
    }

    // Reuse the hardened bulk path: range check, grading-scale band lookup,
    // audit, event, and the atomic projection into the assessment spine.
    const res = await this.grades.bulkUpsert({
      examScheduleId: schedule.id,
      entries: [
        {
          studentProfileId: dto.studentProfileId,
          marksObtained: dto.marks!,
          maxMarks,
          remarks: dto.participation && dto.participation !== 'present' ? dto.participation : undefined,
        },
      ],
    });

    const row = res.results?.[0];
    return {
      examScheduleId: schedule.id,
      gradeEntryId: row?.id ?? null,
      marks: row?.marksObtained != null ? Number(row.marksObtained) : null,
      grade: row?.grade ?? null,
      version: row?.version ?? 0,
    };
  }

  /* ─────────────────────────── Step 4: results ─────────────────────────── */

  /**
   * The results grid for one exam × class: students down, subjects across,
   * with total / average / grade / position. This is the sheet a head teacher
   * actually reads, and it is computed from the same marks that were typed —
   * no separate "compute" step to forget.
   */
  async grid(params: { examId: string; classId: string; streamId?: string }) {
    const exam = await this.prisma.client.exam.findFirst({
      where: { id: params.examId },
      include: { term: true, examType: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${params.examId} not found`);

    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId: params.examId, classId: params.classId },
      include: { subject: true },
    });
    const subjects = schedules
      .map((s) => ({
        examScheduleId: s.id,
        subjectId: s.subjectId,
        name: s.subject?.name ?? '',
        code: s.subject?.code ?? '',
        maxMarks: Number(s.maxMarks),
        locked: s.marksLockedAt != null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const students = await this.studentsOfClass(params.classId, params.streamId);
    const entries = schedules.length
      ? await this.prisma.client.gradeEntry.findMany({
          where: { examScheduleId: { in: schedules.map((s) => s.id) } },
        })
      : [];

    const bySubject = new Map<string, Map<string, any>>();
    for (const s of subjects) bySubject.set(s.subjectId, new Map());
    const scheduleSubject = new Map(schedules.map((s) => [s.id, s.subjectId]));
    for (const g of entries) {
      const subjectId = scheduleSubject.get(g.examScheduleId);
      if (subjectId) bySubject.get(subjectId)?.set(g.studentProfileId, g);
    }

    const system = await this.gradingSystem();

    const rows = await Promise.all(
      students.map(async (s) => {
        const cells: Record<string, { marks: number | null; grade: string | null; participation: string }> = {};
        let total = 0;
        let counted = 0;
        let maxTotal = 0;
        for (const sub of subjects) {
          const g = bySubject.get(sub.subjectId)?.get(s.studentProfileId);
          const marks = g?.marksObtained != null ? Number(g.marksObtained) : null;
          cells[sub.subjectId] = {
            marks,
            grade: g?.grade ?? null,
            participation: this.participationOf(g),
          };
          if (marks != null) {
            total += marks;
            maxTotal += sub.maxMarks;
            counted += 1;
          }
        }
        const average = counted > 0 ? total / counted : null;
        const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : null;
        const band = percentage != null ? await this.grading.bandFor(total, maxTotal, system) : null;
        return {
          ...s,
          cells,
          subjectsMarked: counted,
          total: counted > 0 ? Number(total.toFixed(2)) : null,
          average: average != null ? Number(average.toFixed(2)) : null,
          percentage: percentage != null ? Number(percentage.toFixed(2)) : null,
          grade: band?.grade ?? null,
          position: 0,
        };
      }),
    );

    // Position on total, competition-ranked (ties share a position, next rank skips).
    const ranked = [...rows].filter((r) => r.total != null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    let lastTotal: number | null = null;
    let lastPos = 0;
    ranked.forEach((r, i) => {
      if (r.total !== lastTotal) {
        lastPos = i + 1;
        lastTotal = r.total;
      }
      r.position = lastPos;
    });

    const expected = students.length * subjects.length;
    const done = entries.filter((g) => g.marksObtained != null).length;
    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeName: exam.examType?.name ?? null,
      },
      subjects,
      students: rows.sort((a, b) => a.name.localeCompare(b.name)),
      classSize: students.length,
      marksExpected: expected,
      marksEntered: done,
      complete: expected > 0 && done >= expected,
      lockedPaperCount: subjects.filter((s) => s.locked).length,
      paperCount: subjects.length,
    };
  }

  /* ─────────────────────────── Lock / unlock ─────────────────────────── */

  async setLock(dto: LockMarksDto) {
    const where: any = { examId: dto.examId, classId: dto.classId };
    if (dto.subjectId) where.subjectId = dto.subjectId;

    const schedules = await this.prisma.client.examSchedule.findMany({ where, select: { id: true } });
    if (schedules.length === 0) {
      throw new NotFoundException('No papers found for this exam and class.');
    }

    const res = await this.prisma.client.examSchedule.updateMany({
      where: { id: { in: schedules.map((s) => s.id) } },
      data: {
        marksLockedAt: dto.locked ? new Date() : null,
        marksLockedById: dto.locked ? (this.tenant.userId ?? null) : null,
      },
    });
    await this.audit.record({
      entity: 'ExamSchedule',
      entityId: dto.examId,
      action: 'update',
      newValues: {
        action: dto.locked ? 'lock_marks' : 'unlock_marks',
        examId: dto.examId,
        classId: dto.classId,
        subjectId: dto.subjectId ?? null,
        count: res.count,
      },
    });
    return { updated: res.count, locked: dto.locked };
  }

  /* ─────────────────────────── Helpers ─────────────────────────── */

  /**
   * Subjects a class actually takes. Derived from who is timetabled/assigned to
   * teach it; a school that has not set either up yet falls back to the full
   * subject list rather than showing an empty screen.
   */
  async subjectsForClass(classId: string) {
    const [assignments, slots] = await Promise.all([
      this.prisma.client.teacherAssignment.findMany({ where: { classId }, select: { subjectId: true } }),
      this.prisma.client.timetableSlot.findMany({
        where: { classId, type: 'lesson' },
        select: { subjectId: true },
      }),
    ]);
    const ids = [...new Set([...assignments, ...slots].map((r) => r.subjectId))];
    const subjects = await this.prisma.client.subject.findMany({
      where: ids.length > 0 ? { id: { in: ids } } : {},
      orderBy: { name: 'asc' },
    });
    return subjects.map((s) => ({ id: s.id, name: s.name, code: s.code, isCore: s.isCore }));
  }

  /** Active students of a class, optionally one stream, ordered by name. */
  private async studentsOfClass(classId: string, streamId?: string): Promise<StudentRow[]> {
    const students = await this.prisma.client.studentProfile.findMany({
      where: {
        currentClassId: classId,
        status: 'active',
        ...(streamId ? { currentStreamId: streamId } : {}),
      },
      include: { partner: true, currentStream: true },
    });
    return students
      .map((s) => ({
        studentProfileId: s.id,
        name: s.partner?.name ?? s.admissionNo,
        admissionNo: s.admissionNo,
        streamId: s.currentStreamId,
        streamName: s.currentStream?.name ?? null,
        sectionId: s.currentSectionId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async classSizes(classIds: string[]): Promise<Map<string, number>> {
    if (classIds.length === 0) return new Map();
    const counts = await this.prisma.client.studentProfile.groupBy({
      by: ['currentClassId'],
      where: { currentClassId: { in: classIds }, status: 'active' },
      _count: { _all: true },
    });
    return new Map(counts.map((c) => [c.currentClassId as string, c._count._all]));
  }

  /** Find the paper, creating it if a mark is being entered for a missing one. */
  private async ensureSchedule(examId: string, classId: string, subjectId: string, maxMarks?: number) {
    const existing = await this.prisma.client.examSchedule.findFirst({
      where: { examId, classId, subjectId },
    });
    if (existing) return existing;

    const exam = await this.prisma.client.exam.findFirst({ where: { id: examId } });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
    return this.prisma.client.examSchedule.create({
      data: {
        organizationId: this.tenant.organizationId,
        examId,
        classId,
        subjectId,
        date: exam.startDate,
        startTime: '09:00',
        durationMinutes: 120,
        maxMarks: maxMarks ?? 100,
      },
    });
  }

  /** `remarks` doubles as the non-scoring outcome marker on the legacy row. */
  private participationOf(g: { remarks?: string | null } | undefined): string {
    const r = g?.remarks?.trim().toLowerCase();
    return r && NON_SCORING.has(r) ? r : 'present';
  }

  /** Weakest status wins, so "partly approved" never reads as approved. */
  private rollupStatus(statuses: string[]): string {
    if (statuses.length === 0) return 'draft';
    if (statuses.includes('rejected')) return 'rejected';
    if (statuses.includes('draft')) return 'draft';
    if (statuses.includes('submitted')) return 'submitted';
    return 'approved';
  }

  private async gradingSystem() {
    const profile = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.tenant.organizationId },
      select: { gradingSystem: true },
    });
    return profile?.gradingSystem ?? undefined;
  }
}
