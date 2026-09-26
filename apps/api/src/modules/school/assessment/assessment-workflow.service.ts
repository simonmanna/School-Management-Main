import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { MarkingService } from './marking.service';
import { reconcileCompulsoryRostersInTx } from '../course-offerings/course-roster-reconcile';
import type { AssessmentLifecycleDto, BulkBoardMarksDto, CreateUnifiedAssessmentDto, ReconcileAssessmentContextDto, ReconcileHomeworkDto } from './assessment-board.dto';

export const RESOLVED_WITHOUT_SCORE = ['absent', 'exempt', 'excused', 'malpractice', 'withdrawn', 'not_enrolled'];
export const hasOutcome = (row: { effectiveScore?: unknown; marks?: unknown; participation: string }) =>
  row.effectiveScore != null || row.marks != null || RESOLVED_WITHOUT_SCORE.includes(row.participation);

/** Phase 4 domain workflow. Assessment + StudentAssessment remain the only grade stores. */
@Injectable()
export class AssessmentWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly marking: MarkingService,
  ) {}

  private get db(): any { return this.prisma.client; }
  private get org() { return this.tenant.organizationId; }

  private async offering(tx: any, id: string, historical = false) {
    const row = await tx.courseOffering.findFirst({ where: { id, organizationId: this.org, deletedAt: null }, include: { teachers: true } });
    if (!row) throw new NotFoundException('Course offering not found');
    if (!(historical ? ['PUBLISHED', 'ACTIVE', 'CLOSED', 'ARCHIVED'] : ['PUBLISHED', 'ACTIVE']).includes(row.status)) throw new BadRequestException('Assessments require a published or active course offering');
    const now = new Date();
    row.teachers = row.teachers.filter((t: any) => t.effectiveFrom <= now && (!t.effectiveTo || t.effectiveTo > now));
    if (!historical && !row.teachers.some((t: any) => t.isResponsible)) {
      throw new BadRequestException('The course needs a current responsible teacher');
    }
    return row;
  }

  /** Snapshot official course enrollment, never the StudentProfile class projection. */
  async captureRoster(courseOfferingId: string) {
    await this.marking.assertMayTeachOffering(courseOfferingId);
    return this.db.$transaction(async (tx: any) => {
      const offering = await this.offering(tx, courseOfferingId);
      const now = new Date();
      const active = {
        where: { courseOfferingId, status: 'ENROLLED', startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] },
        include: { studentEnrollment: { include: { placements: { where: { termId: offering.termId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, include: { classCohort: true }, orderBy: { effectiveFrom: 'desc' as const }, take: 1 } } } },
      };
      let enrollments = await tx.courseEnrollment.findMany(active);
      if (!enrollments.length) {
        // Self-heal before refusing. Placement reconciles compulsory rosters now,
        // but offerings created after the class was filled — and every offering
        // that predates that reconciliation — still start empty, and a teacher
        // cannot be expected to diagnose that from a blank mark sheet.
        await this.reconcileFromPlacements(tx, offering);
        enrollments = await tx.courseEnrollment.findMany(active);
      }
      if (!enrollments.length) {
        throw new BadRequestException(
          'No learner is placed in this course\'s class for this term, so there is no roster to capture. ' +
            'Check the class placement, or enrol learners explicitly if this is an elective.',
        );
      }
      const roster = await tx.academicRoster.create({ data: {
        organizationId: this.org, termId: offering.termId, classId: offering.classId,
        sectionId: offering.sectionId, subjectId: offering.subjectId, scopeType: 'subject', source: 'enrollment',
        name: `${offering.name} — ${now.toISOString().slice(0, 10)}`, capturedById: this.tenant.userId,
      } });
      await tx.academicRosterMember.createMany({ data: enrollments.map((e: any) => {
        const placement = e.studentEnrollment.placements[0];
        return { organizationId: this.org, rosterId: roster.id, studentProfileId: e.studentEnrollment.studentProfileId,
          classId: placement?.classCohort?.classId ?? offering.classId, sectionId: placement?.sectionId ?? offering.sectionId,
          gradeLevelId: e.studentEnrollment.gradeLevelId, effectiveFrom: now, joinReason: `course:${courseOfferingId}` };
      }) });
      await tx.academicRoster.updateMany({ where: { id: roster.id }, data: { frozenAt: now, frozenById: this.tenant.userId, version: { increment: 1 } } });
      await this.audit.recordInTx(tx, { entity: 'AcademicRoster', entityId: roster.id, action: 'create', newValues: { courseOfferingId, members: enrollments.length, frozen: true } });
      return { ...roster, frozenAt: now, memberCount: enrollments.length };
    });
  }

  /**
   * Fill an empty compulsory course roster from the term's placements.
   *
   * The placement is the school's record of who sits in the class; course
   * membership is derived from it. One learner at a time keeps the opt-out and
   * late-arrival rules in a single place (`course-roster-reconcile`).
   */
  private async reconcileFromPlacements(tx: any, offering: any) {
    if (offering.audienceScope === 'CUSTOM') return;
    const where: any = { termId: offering.termId, effectiveTo: null };
    if (offering.audienceScope !== 'SCHOOL') where.classCohortId = offering.classCohortId;
    if (offering.audienceScope === 'SECTION') where.sectionId = offering.sectionId;
    const placements = await tx.enrollmentPlacement.findMany({
      where,
      select: { enrollmentId: true, classCohortId: true, sectionId: true, effectiveFrom: true },
    });
    for (const placement of placements) {
      await reconcileCompulsoryRostersInTx(tx, {
        organizationId: this.org,
        enrollmentId: placement.enrollmentId,
        termId: offering.termId,
        classCohortId: placement.classCohortId,
        sectionId: placement.sectionId,
        effectiveFrom: placement.effectiveFrom,
        actorId: this.tenant.userId ?? null,
      });
    }
  }

  private async validateRoster(tx: any, rosterId: string, offering: any) {
    const roster = await tx.academicRoster.findFirst({ where: { id: rosterId, organizationId: this.org }, include: { members: true } });
    if (!roster?.frozenAt || !roster.members.length) throw new BadRequestException('Choose a non-empty frozen assessment roster');
    if (roster.termId !== offering.termId || (roster.classId && roster.classId !== offering.classId)
      || (roster.sectionId && roster.sectionId !== offering.sectionId) || (roster.subjectId && roster.subjectId !== offering.subjectId)) {
      throw new BadRequestException('The frozen roster does not match this course context');
    }
    const enrolled = await tx.courseEnrollment.findMany({ where: { courseOfferingId: offering.id }, include: { studentEnrollment: { select: { studentProfileId: true } } } });
    const ids = new Set(enrolled.map((e: any) => e.studentEnrollment.studentProfileId));
    if (roster.members.some((m: any) => !ids.has(m.studentProfileId))) throw new BadRequestException('The roster contains learners outside this course');
    return roster;
  }

  async create(dto: CreateUnifiedAssessmentDto) {
    if (!dto.courseOfferingId || !dto.rosterId) throw new BadRequestException('A course offering and frozen roster are required');
    if (!dto.title.trim()) throw new BadRequestException('An assessment title is required');
    await this.marking.assertMayTeachOffering(dto.courseOfferingId);
    return this.db.$transaction(async (tx: any) => {
      const offering = await this.offering(tx, dto.courseOfferingId);
      if (offering.subjectId !== (dto.subjectId ?? null) || offering.classId !== (dto.classId ?? null) || offering.termId !== dto.termId) {
        throw new BadRequestException('Subject, class and term must come from the selected course offering');
      }
      await this.validateRoster(tx, dto.rosterId, offering);
      if (dto.openAt && dto.dueAt && new Date(dto.openAt) > new Date(dto.dueAt)) throw new BadRequestException('Open time must be before the due time');
      if (dto.dueAt && dto.closeAt && new Date(dto.dueAt) > new Date(dto.closeAt)) throw new BadRequestException('Close time must be after the due time');
      let component: any = null;
      if (dto.componentId) {
        component = await tx.assessmentComponent.findFirst({ where: { id: dto.componentId }, include: { policy: true } });
        if (!component || component.kind !== dto.kind) throw new BadRequestException('Choose a matching assessment component');
        const p = component.policy;
        if ((p.subjectId && p.subjectId !== offering.subjectId) || (p.classId && p.classId !== offering.classId) || (p.termId && p.termId !== offering.termId)) {
          throw new BadRequestException('Assessment policy does not apply to this course');
        }
      }
      const outcomeIds = [...new Set(dto.learningOutcomeIds ?? [])];
      if (outcomeIds.length) {
        const outcomes = await tx.learningOutcome.findMany({ where: { id: { in: outcomeIds } } });
        if (outcomes.length !== outcomeIds.length || outcomes.some((o: any) => o.subjectId && o.subjectId !== offering.subjectId)) {
          throw new BadRequestException('Learning outcomes must belong to the selected course');
        }
      }
      let rubric: any = null;
      if (dto.gradingMode === 'rubric' || dto.rubricId) {
        rubric = await tx.rubric.findFirst({ where: { id: dto.rubricId ?? '', isActive: true }, include: { criteria: true } });
        if (!rubric?.criteria.length) throw new BadRequestException('Choose a rubric with at least one criterion');
      }
      let sourceRef: string | null = null;
      if (dto.kind === 'exam') {
        if (!offering.subjectId || !offering.classId) throw new BadRequestException('Exam papers require a subject and class course; use observation or assignment for this offering');
        const exam = await tx.exam.findFirst({ where: { id: dto.examId ?? '', termId: offering.termId } });
        if (!exam) throw new BadRequestException('Choose an examination in this term');
        if (dto.classIds?.some((id) => id !== offering.classId)) throw new BadRequestException('Create each exam paper in its own course context');
        const existing = await tx.examSchedule.findFirst({ where: { examId: exam.id, classId: offering.classId, subjectId: offering.subjectId } });
        if (existing) throw new ConflictException('This examination already has a paper for the selected class and subject');
        const schedule = await tx.examSchedule.create({ data: { organizationId: this.org, examId: exam.id, classId: offering.classId,
          subjectId: offering.subjectId, date: dto.dueAt ? new Date(dto.dueAt) : exam.startDate, startTime: '09:00', durationMinutes: 120, maxMarks: dto.maxScore ?? 100, paperNumber: dto.sequence ?? 1 } });
        sourceRef = schedule.id;
      }
      const assessment = await tx.assessment.create({ data: {
        organizationId: this.org, courseOfferingId: offering.id, rosterId: dto.rosterId, componentId: component?.id,
        subjectId: offering.subjectId, classId: offering.classId, sectionId: offering.sectionId, termId: offering.termId,
        teacherPartnerId: offering.teachers.find((t: any) => t.isResponsible)?.teacherPartnerId ?? offering.teachers[0].teacherPartnerId,
        title: dto.title.trim(), kind: dto.kind, maxScore: dto.maxScore ?? 100, sequence: dto.sequence ?? 1,
        description: dto.description, sourceType: dto.kind === 'exam' ? 'exam_session' : 'assignment', sourceRef,
        status: 'draft', hiddenFromStudents: true, createdBy: this.tenant.userId,
        openAt: dto.openAt ? new Date(dto.openAt) : null, dueAt: dto.dueAt ? new Date(dto.dueAt) : null, closeAt: dto.closeAt ? new Date(dto.closeAt) : null,
      } });
      if (dto.kind !== 'exam') await tx.assignment.create({ data: {
        organizationId: this.org, assessmentId: assessment.id, rosterId: dto.rosterId, instructions: dto.description,
        allowLate: dto.allowLate ?? false, latePenaltyPercent: dto.latePenaltyPercent ?? 0, maxAttempts: dto.maxAttempts ?? 1,
        gradingMode: dto.gradingMode ?? 'points', rubricId: rubric?.id, rubricVersion: rubric?.version,
      } });
      if (outcomeIds.length) await tx.assessmentOutcome.createMany({ data: outcomeIds.map((learningOutcomeId) => ({ organizationId: this.org, assessmentId: assessment.id, learningOutcomeId })) });
      await this.audit.recordInTx(tx, { entity: 'Assessment', entityId: assessment.id, action: 'create', newValues: { courseOfferingId: offering.id, rosterId: dto.rosterId, kind: dto.kind } });
      return { assessment, created: 1 };
    });
  }

  async transition(id: string, dto: AssessmentLifecycleDto) {
    await this.marking.assertMayViewAssessment(id);
    return this.db.$transaction(async (tx: any) => {
      const a = await tx.assessment.findFirst({ where: { id }, include: { component: { include: { policy: true } } } });
      if (!a) throw new NotFoundException('Assessment not found');
      if (a.version !== dto.expectedVersion) throw new ConflictException('Assessment changed. Refresh before continuing.');
      if (dto.action.startsWith('release_')) {
        if (!this.tenant.permissions.some((p) => ['*', PERMISSIONS.school.manageAssessments, PERMISSIONS.school.approveGrades].includes(p))) throw new ForbiddenException('Assessment management or approval permission is required to release results');
      } else if (a.courseOfferingId) await this.marking.assertMayTeachOffering(a.courseOfferingId);
      const data: any = { version: { increment: 1 }, updatedBy: this.tenant.userId };
      if (dto.action === 'release_feedback' || dto.action === 'release_marks') {
        if (!a.courseOfferingId || !a.rosterId || ['draft', 'scheduled', 'archived'].includes(a.status)) throw new BadRequestException('Reconcile and publish the assessment before release');
        const roster = await this.validateRoster(tx, a.rosterId, await this.offering(tx, a.courseOfferingId));
        const rows = await tx.studentAssessment.findMany({ where: { assessmentId: id } });
        if (rows.length !== roster.members.length || rows.some((r: any) => r.approvalStatus !== 'approved' || !roster.members.some((m: any) => m.studentProfileId === r.studentProfileId))) throw new BadRequestException('Approve every frozen-roster learner outcome before releasing feedback or marks');
        data[dto.action === 'release_feedback' ? 'feedbackReleaseAt' : 'marksReleaseAt'] = new Date();
        if (dto.action === 'release_marks') data.hiddenFromStudents = false;
      } else {
        const transitions: Record<string, { from: string[]; to: string }> = {
          publish: { from: ['draft', 'scheduled'], to: 'published' }, open: { from: ['published'], to: 'open' },
          close: { from: ['published', 'open'], to: 'closed' }, grade: { from: ['closed', 'grading'], to: 'graded' },
          archive: { from: ['graded', 'closed'], to: 'archived' },
        };
        const t = transitions[dto.action];
        if (!t || !t.from.includes(a.status)) throw new BadRequestException(`Cannot ${dto.action} an assessment in ${a.status}`);
        data.status = t.to;
        if (dto.action === 'publish') {
          if (!a.courseOfferingId || !a.rosterId) throw new BadRequestException('Bind a course offering and frozen roster before publishing');
          const offering = await this.offering(tx, a.courseOfferingId);
          const roster = await this.validateRoster(tx, a.rosterId, offering);
          if (a.component && !a.component.policy.publishedAt) throw new BadRequestException('Publish the assessment policy revision before publishing this assessment');
          await tx.studentAssessment.createMany({ skipDuplicates: true, data: roster.members.map((m: any) => ({
            organizationId: this.org, assessmentId: id, studentProfileId: m.studentProfileId, classId: m.classId, sectionId: m.sectionId,
            gradeLevelId: m.gradeLevelId, termId: a.termId, maxScore: a.maxScore, participation: 'missing', status: 'assigned',
          })) });
        }
      }
      const changed = await tx.assessment.updateMany({ where: { id, version: dto.expectedVersion }, data });
      if (!changed.count) throw new ConflictException('Assessment changed while applying this action');
      await this.audit.recordInTx(tx, { entity: 'Assessment', entityId: id, action: 'update', oldValues: { status: a.status }, newValues: { action: dto.action, ...data } });
      return tx.assessment.findFirst({ where: { id } });
    });
  }

  /** Atomic response ledger: retrying a committed batch never re-enters marks. */
  async saveBulk(id: string, dto: BulkBoardMarksDto, requestKey: string) {
    if (!requestKey || requestKey.length > 160) throw new BadRequestException('A stable Idempotency-Key is required for bulk saves');
    if (new Set(dto.rows.map((r) => r.studentProfileId)).size !== dto.rows.length) throw new BadRequestException('Each learner may appear only once per batch');
    await this.marking.assertMayMarkAssessment(id);
    const key = `assessment:${this.tenant.userId}:${requestKey}`;
    const path = `/school/assessment-board/${id}/marks`;
    const requestHash = createHash('sha256').update(JSON.stringify({ path, rows: dto.rows })).digest('hex');
    return this.db.$transaction(async (tx: any) => {
      // Serialise retries of the same operation. Tenant is part of the lock key.
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', `${this.org}:${key}`);
      const prior = await tx.idempotencyRecord.findFirst({ where: { organizationId: this.org, key } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException('This save key was already used with a different draft');
        return prior.responseJson;
      }
      const a = await tx.assessment.findFirst({ where: { id }, include: { roster: { include: { members: true } } } });
      if (!a) throw new NotFoundException('Assessment not found');
      if (!a.roster?.frozenAt || ['draft', 'scheduled', 'archived'].includes(a.status)) throw new ConflictException('Publish this assessment against a frozen roster before marking');
      const memberIds = new Set(a.roster.members.map((m: any) => m.studentProfileId));
      if (dto.rows.some((r) => !memberIds.has(r.studentProfileId))) throw new BadRequestException('One or more learners are not on the assessment roster');
      await tx.$queryRawUnsafe('SELECT id FROM "StudentAssessment" WHERE "assessmentId" = $1 AND "organizationId" = $2 ORDER BY id FOR UPDATE', id, this.org);
      const current = await tx.studentAssessment.findMany({ where: { assessmentId: id, studentProfileId: { in: dto.rows.map((r) => r.studentProfileId) } }, include: { markEntries: true } });
      const byStudent = new Map<string, any>(current.map((r: any) => [r.studentProfileId, r]));
      const conflicts = dto.rows.flatMap((r) => {
        const s = byStudent.get(r.studentProfileId);
        return s && s.version !== r.expectedVersion ? [{ studentProfileId: r.studentProfileId, version: s.version, marks: s.effectiveScore, participation: s.participation, comment: s.feedback ?? s.markEntries.find((m: any) => m.round === 'first')?.comment ?? '' }] : [];
      });
      if (conflicts.length) throw new ConflictException({ code: 'MARK_VERSION_CONFLICT', message: 'Some marks changed. No rows from this batch were saved.', conflicts });
      const rows: any[] = [];
      for (const row of dto.rows) {
        const participation = row.participation ?? 'present';
        const score = RESOLVED_WITHOUT_SCORE.includes(participation) || participation === 'missing' ? null : row.marks ?? null;
        const sa = await this.marking.postMark(tx, { assessmentId: id, studentProfileId: row.studentProfileId, score, comment: row.comment, source: 'manual', expectedVersion: row.expectedVersion });
        await tx.studentAssessment.updateMany({ where: { id: sa.id }, data: { participation } });
        rows.push({ studentProfileId: row.studentProfileId, studentAssessmentId: sa.id, version: sa.version, marks: sa.effectiveScore == null ? null : Number(sa.effectiveScore), percentage: sa.percentage == null ? null : Number(sa.percentage), participation, comment: row.comment ?? '', approvalStatus: sa.approvalStatus });
      }
      const response = { rows, saved: rows.length, savedAt: new Date().toISOString() };
      await tx.idempotencyRecord.create({ data: { organizationId: this.org, key, path, method: 'POST', requestHash, status: 'completed', statusCode: 200, responseJson: response, completedAt: new Date() } });
      return response;
    }, { timeout: 30000 });
  }

  async inbox(assessmentId: string) {
    await this.marking.assertMayViewAssessment(assessmentId);
    const assignment = await this.db.assignment.findFirst({ where: { assessmentId }, include: { assessment: true, submissions: { orderBy: [{ submittedAt: 'desc' }, { attemptNo: 'desc' }] } } });
    if (!assignment) return { assignment: null, rubric: null, submissions: [] };
    const rubric = assignment.rubricId ? await this.db.rubric.findFirst({ where: { id: assignment.rubricId }, include: { criteria: { include: { levels: true }, orderBy: { order: 'asc' } } } }) : null;
    return { assignment: { ...assignment, submissions: undefined }, rubric, submissions: assignment.submissions };
  }

  async reconciliation(sourceEntity?: string) {
    if (sourceEntity && !['Assessment', 'HomeworkAssignment', 'HomeworkSubmission'].includes(sourceEntity)) throw new BadRequestException('Unknown reconciliation record type');
    const where = { migrationRunId: '20260906000000_phase4_unified_assessment', resolvedAt: null, ...(sourceEntity ? { sourceEntity } : {}) };
    const [total, reasons, exceptions] = await Promise.all([
      this.db.academicMigrationException.count({ where }),
      this.db.academicMigrationException.groupBy({ by: ['reason'], where, _count: true }),
      this.db.academicMigrationException.findMany({ where, orderBy: { createdAt: 'asc' }, take: 200 }),
    ]);
    return { total, reasons, exceptions, limit: 200 };
  }

  async reconcileContext(id: string, dto: ReconcileAssessmentContextDto) {
    if (!dto.reason.trim()) throw new BadRequestException('A reconciliation reason is required');
    await this.marking.assertMayTeachOffering(dto.courseOfferingId);
    return this.db.$transaction(async (tx: any) => {
      const a = await tx.assessment.findFirst({ where: { id } });
      if (!a) throw new NotFoundException('Assessment not found');
      if (a.courseOfferingId && a.rosterId) throw new ConflictException('This assessment already has an immutable course and roster binding');
      const offering = await this.offering(tx, dto.courseOfferingId, true);
      if (a.subjectId !== offering.subjectId || a.classId !== offering.classId || a.termId !== offering.termId) throw new BadRequestException('Course must match the historical subject, class and term');
      const roster = await this.validateRoster(tx, dto.rosterId, offering);
      const rows = await tx.studentAssessment.findMany({ where: { assessmentId: id } });
      if (rows.some((r: any) => !roster.members.some((m: any) => m.studentProfileId === r.studentProfileId))) throw new BadRequestException('The selected roster would exclude historical learner evidence. Prepare a complete historical roster first.');
      const updated = await tx.assessment.updateMany({ where: { id, version: dto.expectedVersion }, data: { courseOfferingId: offering.id, rosterId: roster.id, version: { increment: 1 } } });
      if (!updated.count) throw new ConflictException('Assessment changed; reload before reconciling');
      await tx.assignment.updateMany({ where: { assessmentId: id }, data: { rosterId: roster.id } });
      if (!['draft', 'scheduled'].includes(a.status)) await tx.studentAssessment.createMany({ skipDuplicates: true, data: roster.members.map((m: any) => ({ organizationId: this.org, assessmentId: id, studentProfileId: m.studentProfileId, classId: m.classId, sectionId: m.sectionId, gradeLevelId: m.gradeLevelId, termId: a.termId, maxScore: a.maxScore, participation: 'missing' })) });
      await tx.academicMigrationException.updateMany({ where: { migrationRunId: '20260906000000_phase4_unified_assessment', sourceEntity: 'Assessment', sourceId: id, resolvedAt: null }, data: { resolvedAt: new Date(), resolutionNote: dto.reason } });
      await this.audit.recordInTx(tx, { entity: 'Assessment', entityId: id, action: 'update', newValues: { reconciliation: dto.reason, courseOfferingId: offering.id, rosterId: roster.id } });
      return tx.assessment.findFirst({ where: { id } });
    });
  }

  async reconcileHomework(homeworkId: string, dto: ReconcileHomeworkDto) {
    if (!dto.reason.trim()) throw new BadRequestException('A reconciliation reason is required');
    return this.db.$transaction(async (tx: any) => {
      const h = await tx.homeworkAssignment.findFirst({ where: { id: homeworkId }, include: { submissions: true } });
      const a = await tx.assessment.findFirst({ where: { id: dto.assessmentId }, include: { roster: { include: { members: true } } } });
      if (!h || !a) throw new NotFoundException('Homework or target assessment not found');
      if (h.classId !== a.classId || h.subjectId !== a.subjectId || (h.termId && h.termId !== a.termId) || (h.assessmentId && h.assessmentId !== a.id)) throw new BadRequestException('Historical homework context does not match the target assessment');
      if (!a.roster?.frozenAt || !a.courseOfferingId || ['draft', 'scheduled', 'archived'].includes(a.status)) throw new BadRequestException('Publish a matching assessment with a frozen roster first');
      if (h.submissions.some((s: any) => !a.roster.members.some((m: any) => m.studentProfileId === s.studentProfileId))) throw new BadRequestException('Every legacy submission must be on the target roster');
      const existing = await tx.assignment.findFirst({ where: { assessmentId: a.id } });
      if (existing?.legacyHomeworkId && existing.legacyHomeworkId !== h.id) throw new ConflictException('Target already maps another legacy assignment');
      const assignment = existing ?? await tx.assignment.create({ data: { organizationId: this.org, assessmentId: a.id, rosterId: a.rosterId, instructions: h.description, attachments: h.attachments } });
      await tx.assignment.updateMany({ where: { id: assignment.id }, data: { legacyHomeworkId: h.id } });
      for (const s of h.submissions) {
        const sa = await tx.studentAssessment.findFirst({ where: { assessmentId: a.id, studentProfileId: s.studentProfileId } });
        if (!sa) throw new BadRequestException('Publish the target learner roster first');
        if (s.score != null && sa.effectiveScore != null && Number(s.score) !== Number(sa.effectiveScore)) throw new ConflictException('Legacy and canonical scores differ; no evidence was changed. Resolve the mark through moderation first.');
        const mapped = await tx.assignmentSubmission.findFirst({ where: { legacyHomeworkSubmissionId: s.id } });
        if (!mapped) {
          const last = await tx.assignmentSubmission.aggregate({ where: { assignmentId: assignment.id, studentAssessmentId: sa.id }, _max: { attemptNo: true } });
          await tx.assignmentSubmission.create({ data: { organizationId: this.org, assignmentId: assignment.id, studentAssessmentId: sa.id, legacyHomeworkSubmissionId: s.id, attemptNo: (last._max.attemptNo ?? 0) + 1, submittedAt: s.submittedAt, content: s.content, attachments: s.attachments, rawScore: s.score, isLate: s.status === 'late' } });
        }
        if (s.score != null && sa.effectiveScore == null) await this.marking.postMark(tx, { studentAssessmentId: sa.id, score: s.score, comment: s.feedback, source: 'import', markerId: s.gradedById, expectedVersion: sa.version });
        if (sa.participation === 'missing' && (s.score != null || s.submittedAt != null)) await tx.studentAssessment.updateMany({ where: { id: sa.id }, data: { participation: 'present' } });
        await tx.academicMigrationException.updateMany({ where: { migrationRunId: '20260906000000_phase4_unified_assessment', sourceEntity: 'HomeworkSubmission', sourceId: s.id }, data: { resolvedAt: new Date(), resolutionNote: dto.reason } });
      }
      await tx.academicMigrationException.updateMany({ where: { migrationRunId: '20260906000000_phase4_unified_assessment', sourceEntity: 'HomeworkAssignment', sourceId: h.id }, data: { resolvedAt: new Date(), resolutionNote: dto.reason } });
      await this.audit.recordInTx(tx, { entity: 'Assignment', entityId: assignment.id, action: 'update', newValues: { legacyHomeworkId: h.id, reason: dto.reason, submissions: h.submissions.length } });
      return { assignmentId: assignment.id, submissions: h.submissions.length };
    }, { timeout: 30000 });
  }

  async evidence(assessmentId: string, studentProfileId: string) {
    await this.marking.assertMayViewAssessment(assessmentId);
    const row = await this.db.studentAssessment.findFirst({ where: { assessmentId, studentProfileId }, include: { markEntries: true, adjustments: { orderBy: { createdAt: 'desc' } }, rubricScores: true, assignmentSubmissions: { orderBy: { attemptNo: 'desc' } } } });
    if (!row) throw new NotFoundException('Learner is not on this assessment');
    const history = await this.db.studentAssessmentHistory.findMany({ where: { studentAssessmentId: row.id }, orderBy: { changedAt: 'desc' } });
    const approvalHistory = await this.db.auditLog.findMany({ where: { entity: 'StudentAssessment', entityId: assessmentId }, select: { id: true, action: true, newValues: true, actorId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { ...row, history, approvalHistory };
  }
}
