import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { MarkingService } from './marking.service';
import { AssessmentPolicyService } from './assessment-config.service';
import { resolveBands } from './grade-bands';
import { kindOf } from './assessment-math';
import {
  computeSubject,
  type AssessmentDatum,
  type ComponentConfig,
  type ResultInput,
  type SubjectInput,
} from './result-computation';
import type { GradebookCellDto, GradebookColumnDto, UpdateGradebookColumnDto } from './gradebook.dto';

type Tx = Prisma.TransactionClient;

const NON_SCORING = new Set(['absent', 'exempt', 'excused', 'malpractice', 'special_consideration']);

/** The synthetic "component" that holds assessments no policy weights. */
const UNWEIGHTED = { id: '__unweighted__', name: 'Not in the weighting policy', kind: 'other' };

/**
 * GradebookService — the class × term × subject spreadsheet over the assessment
 * spine.
 *
 * The gradebook is a LIVE PREVIEW of `computeSubject`; a published ResultSet is
 * a frozen SNAPSHOT of the same function. They share `result-computation.ts`
 * verbatim, so a total shown here and a total in a report card can only differ
 * by which policy resolved, never by which formula ran. (This is the point of
 * the phase: the LMS gradebook used to run an unweighted mean of its own, so a
 * teacher and a head teacher could read two different numbers for one student.)
 *
 * Columns are the `Assessment` rows for the (class, term, subject); a cell edit
 * routes through `MarkingService.postMark`, the one writer. Nothing is stored
 * here that is not derivable from the spine.
 */
@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly marking: MarkingService,
    private readonly policies: AssessmentPolicyService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /* ─────────────────────────── The sheet ─────────────────────────── */

  async sheet(params: { classId: string; termId: string; subjectId?: string; streamId?: string }) {
    const [klass, term, subjects] = await Promise.all([
      this.prisma.client.schoolClass.findFirst({ where: { id: params.classId }, include: { gradeLevel: true } }),
      this.prisma.client.term.findFirst({ where: { id: params.termId } }),
      this.subjectsForClass(params.classId),
    ]);
    if (!klass) throw new NotFoundException(`Class ${params.classId} not found`);
    if (!term) throw new NotFoundException(`Term ${params.termId} not found`);

    // Default to the first subject the class takes, so the screen is never blank.
    const subjectId = params.subjectId || subjects[0]?.id;
    if (!subjectId) {
      return {
        class: { id: klass.id, name: klass.name },
        term: { id: term.id, name: term.name },
        subjects,
        subject: null,
        columns: [],
        groups: [],
        students: [],
        policy: null,
      };
    }
    const subject = subjects.find((s) => s.id === subjectId)
      ?? (await this.prisma.client.subject.findFirst({ where: { id: subjectId } }).then((s) => s && ({ id: s.id, name: s.name, code: s.code })));
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found`);

    // Columns: every assessment for this class/term/subject.
    const assessments = await this.prisma.client.assessment.findMany({
      where: { classId: params.classId, termId: params.termId, subjectId, deletedAt: null },
      include: { component: true },
      orderBy: [{ createdAt: 'asc' }],
    });

    const policy = await this.policies.resolve({
      subjectId,
      classId: params.classId,
      gradeLevelId: klass.gradeLevelId,
      termId: params.termId,
    });
    const components: ComponentConfig[] = (policy?.components ?? []).map((c: any) => ({
      id: c.id,
      kind: c.kind,
      weight: c.weight,
      aggregation: c.aggregation,
      bestN: c.bestN,
      countsAbsentAsZero: c.countsAbsentAsZero,
    }));

    // Assign each column to the component it contributes to (mirrors
    // computeSubject's member-matching exactly), else to the unweighted group.
    const columns = assessments.map((a) => {
      const kind = kindOf(a);
      const owner =
        components.find((c) => a.componentId === c.id) ??
        components.find((c) => a.componentId == null && c.kind === kind) ??
        null;
      return {
        assessmentId: a.id,
        title: a.title,
        kind,
        maxScore: Number(a.maxScore),
        sourceType: a.sourceType,
        componentId: owner?.id ?? null,
        groupId: owner?.id ?? UNWEIGHTED.id,
        locked: a.lockedAt != null,
        hiddenFromStudents: a.hiddenFromStudents,
        dueAt: a.dueAt,
        editable: a.sourceType === 'manual', // exam/assignment/quiz columns are marked in their own screens
      };
    });

    // Group headers, in policy order, then the unweighted bucket last.
    const groups = [
      ...(policy?.components ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        weight: Number(c.weight),
        columnIds: columns.filter((col) => col.groupId === c.id).map((col) => col.assessmentId),
      })),
      {
        id: UNWEIGHTED.id,
        name: UNWEIGHTED.name,
        kind: UNWEIGHTED.kind,
        weight: null as number | null,
        columnIds: columns.filter((col) => col.groupId === UNWEIGHTED.id).map((col) => col.assessmentId),
      },
    ].filter((g) => g.columnIds.length > 0 || g.id !== UNWEIGHTED.id);

    // Students + their marks.
    const students = await this.studentsOfClass(params.classId, params.streamId);
    const assessmentIds = assessments.map((a) => a.id);
    const saRows = assessmentIds.length
      ? await this.prisma.client.studentAssessment.findMany({
          where: { assessmentId: { in: assessmentIds }, studentProfileId: { in: students.map((s) => s.studentProfileId) } },
        })
      : [];
    const saByStudent = new Map<string, Map<string, any>>();
    for (const r of saRows) {
      if (!saByStudent.has(r.studentProfileId)) saByStudent.set(r.studentProfileId, new Map());
      saByStudent.get(r.studentProfileId)!.set(r.assessmentId, r);
    }

    const bands = await resolveBands(this.prisma.client, await this.gradingSystem());
    const input: ResultInput = {
      gradingSystem: (await this.gradingSystem()) as ResultInput['gradingSystem'],
      bands,
      roundingMode: 'half_up',
      decimalPlaces: 2,
      rankOn: 'meanPercent',
      students: [],
    };

    const rows = students.map((s) => {
      const mine = saByStudent.get(s.studentProfileId) ?? new Map();
      const cells: Record<string, { studentAssessmentId: string | null; marks: number | null; grade: string | null; participation: string; status: string }> = {};
      const data: AssessmentDatum[] = [];
      assessments.forEach((a, i) => {
        const r = mine.get(a.id);
        const marks = r?.effectiveScore != null ? Number(r.effectiveScore) : null;
        cells[a.id] = {
          studentAssessmentId: r?.id ?? null,
          marks,
          grade: null,
          participation: r?.participation ?? 'present',
          status: r?.status ?? 'assigned',
        };
        data.push({
          componentId: a.componentId,
          kind: columns[i].kind,
          effectiveScore: r?.effectiveScore ?? null,
          maxScore: a.maxScore,
          participation: r?.participation ?? 'present',
          order: i,
        });
      });

      const subjectInput: SubjectInput = { subjectId, passMark: policy?.passMark ?? 50, components, assessments: data };
      const result = computeSubject(subjectInput, input);

      return {
        studentProfileId: s.studentProfileId,
        name: s.name,
        admissionNo: s.admissionNo,
        streamName: s.streamName,
        cells,
        finalPercent: result.finalPercent != null ? Number(result.finalPercent) : null,
        grade: result.grade,
        componentPercents: result.componentBreakdown.map((b) => ({
          componentId: b.componentId,
          percent: b.componentPercent != null ? Number(b.componentPercent) : null,
          weight: Number(b.weight),
        })),
      };
    });

    const weightsTotal = components.reduce((sum, c) => sum + Number(c.weight), 0);
    return {
      class: { id: klass.id, name: klass.name, gradeLevelId: klass.gradeLevelId },
      term: { id: term.id, name: term.name },
      subjects,
      subject,
      columns,
      groups,
      students: rows,
      policy: policy
        ? { id: policy.id, name: policy.name, weightsTotal, weightsValid: Math.abs(weightsTotal - 100) < 0.01 }
        : null,
    };
  }

  /* ─────────────────────────── Cells ─────────────────────────── */

  /** Save (or clear) one cell, through the one write path. */
  async cell(dto: GradebookCellDto) {
    return this.prisma.client.$transaction(async (tx: Tx) => {
      const assessment = await tx.assessment.findFirst({ where: { id: dto.assessmentId, deletedAt: null } });
      if (!assessment) throw new NotFoundException(`Assessment ${dto.assessmentId} not found`);
      // The spreadsheet only edits manual columns; exam/assignment/quiz marks
      // belong to their own screens where their workflow lives.
      if (assessment.sourceType !== 'manual') {
        throw new BadRequestException(
          `"${assessment.title}" is a ${assessment.sourceType.replace('_', ' ')} column — enter its marks from its own screen.`,
        );
      }

      const clearing = dto.marks === null || dto.marks === undefined;
      const sa = await this.marking.postMark(tx, {
        assessmentId: dto.assessmentId,
        studentProfileId: dto.studentProfileId,
        score: clearing ? null : dto.marks!,
        source: 'manual',
      });

      // A non-scoring participation with no numeric mark still needs recording.
      if (dto.participation) {
        await tx.studentAssessment.updateMany({
          where: { id: sa.id },
          data: { participation: dto.participation as Prisma.StudentAssessmentUpdateInput['participation'] },
        });
      }
      return tx.studentAssessment.findFirst({ where: { id: sa.id } });
    });
  }

  /* ─────────────────────────── Columns (CRUD) ─────────────────────────── */

  /** Add a manual column ("CAT 2", "Homework 3") to the sheet. */
  async createColumn(dto: GradebookColumnDto) {
    const [klass, subject, term] = await Promise.all([
      this.prisma.client.schoolClass.findFirst({ where: { id: dto.classId } }),
      this.prisma.client.subject.findFirst({ where: { id: dto.subjectId } }),
      this.prisma.client.term.findFirst({ where: { id: dto.termId } }),
    ]);
    if (!klass) throw new NotFoundException(`Class ${dto.classId} not found`);
    if (!subject) throw new NotFoundException(`Subject ${dto.subjectId} not found`);
    if (!term) throw new NotFoundException(`Term ${dto.termId} not found`);
    if (dto.componentId) {
      const component = await this.prisma.client.assessmentComponent.findFirst({ where: { id: dto.componentId } });
      if (!component) throw new NotFoundException(`Component ${dto.componentId} not found`);
    }

    // The column records what it IS. Kind used to be guessed on read, from the
    // component or the source type, which classified every component-less
    // column as a CAT and weighted it as one.
    const component = dto.componentId
      ? await this.prisma.client.assessmentComponent.findFirst({ where: { id: dto.componentId } })
      : null;

    const created = await this.prisma.client.assessment.create({
      data: {
        organizationId: this.org,
        subjectId: dto.subjectId,
        classId: dto.classId,
        termId: dto.termId,
        componentId: dto.componentId ?? null,
        title: dto.title,
        maxScore: dto.maxScore ?? 100,
        kind: (dto.kind ?? component?.kind ?? 'cat') as any,
        sourceType: 'manual',
        status: 'open',
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        createdBy: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({
      entity: 'Assessment',
      entityId: created.id,
      action: 'create',
      newValues: { action: 'gradebook_column', title: dto.title, classId: dto.classId, subjectId: dto.subjectId },
    });
    return created;
  }

  async updateColumn(assessmentId: string, dto: UpdateGradebookColumnDto) {
    const assessment = await this.prisma.client.assessment.findFirst({ where: { id: assessmentId, deletedAt: null } });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);

    // Rescaling a maximum after marks exist silently restates every percentage.
    if (dto.maxScore != null && Number(dto.maxScore) !== Number(assessment.maxScore)) {
      const marked = await this.prisma.client.markEntry.count({ where: { studentAssessment: { assessmentId } } });
      if (marked > 0) {
        throw new ConflictException(
          `Cannot change the maximum of "${assessment.title}": ${marked} mark(s) are already recorded against it.`,
        );
      }
    }

    await this.prisma.client.assessment.updateMany({
      where: { id: assessmentId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind as any } : {}),
        ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
        ...(dto.componentId !== undefined ? { componentId: dto.componentId } : {}),
        ...(dto.hiddenFromStudents !== undefined ? { hiddenFromStudents: dto.hiddenFromStudents } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      },
    });
    await this.audit.record({ entity: 'Assessment', entityId: assessmentId, action: 'update', newValues: dto as any });
    return this.prisma.client.assessment.findFirst({ where: { id: assessmentId } });
  }

  /** Soft-delete a column. Refused once marks exist unless forced. */
  async deleteColumn(assessmentId: string, force = false) {
    const assessment = await this.prisma.client.assessment.findFirst({ where: { id: assessmentId, deletedAt: null } });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);

    const marked = await this.prisma.client.markEntry.count({ where: { studentAssessment: { assessmentId } } });
    if (marked > 0 && !force) {
      throw new ConflictException(
        `"${assessment.title}" has ${marked} mark(s). Deleting it removes them from the total — pass force to confirm.`,
      );
    }
    await this.prisma.client.assessment.updateMany({ where: { id: assessmentId }, data: { deletedAt: new Date() } });
    await this.audit.record({
      entity: 'Assessment',
      entityId: assessmentId,
      action: 'delete',
      newValues: { action: 'gradebook_column_delete', marked, force },
    });
    return { deleted: true };
  }

  /** Lock / unlock a column against further mark entry. */
  async setLock(assessmentId: string, locked: boolean) {
    const assessment = await this.prisma.client.assessment.findFirst({ where: { id: assessmentId, deletedAt: null } });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);
    await this.prisma.client.assessment.updateMany({
      where: { id: assessmentId },
      data: { lockedAt: locked ? new Date() : null },
    });
    await this.audit.record({
      entity: 'Assessment',
      entityId: assessmentId,
      action: 'update',
      newValues: { action: locked ? 'lock' : 'unlock' },
    });
    return { locked };
  }

  /* ─────────────────────────── Helpers ─────────────────────────── */

  /** Subjects a class takes — from teaching load / timetable, else every subject. */
  async subjectsForClass(classId: string) {
    const [assignments, slots] = await Promise.all([
      this.prisma.client.teacherAssignment.findMany({ where: { classId }, select: { subjectId: true } }),
      this.prisma.client.timetableSlot.findMany({ where: { classId, type: 'lesson' }, select: { subjectId: true } }),
    ]);
    const ids = [...new Set([...assignments, ...slots].map((r) => r.subjectId))];
    const subjects = await this.prisma.client.subject.findMany({
      where: ids.length > 0 ? { id: { in: ids } } : {},
      orderBy: { name: 'asc' },
    });
    return subjects.map((s) => ({ id: s.id, name: s.name, code: s.code }));
  }

  private async studentsOfClass(classId: string, streamId?: string) {
    const students = await this.prisma.client.studentProfile.findMany({
      where: { currentClassId: classId, status: 'active', ...(streamId ? { currentStreamId: streamId } : {}) },
      include: { partner: true, currentStream: true },
    });
    return students
      .map((s) => ({
        studentProfileId: s.id,
        name: s.partner?.name ?? s.admissionNo,
        admissionNo: s.admissionNo,
        streamName: s.currentStream?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async gradingSystem(): Promise<string> {
    const profile = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.org },
      select: { gradingSystem: true },
    });
    return profile?.gradingSystem ?? 'UCE';
  }
}
