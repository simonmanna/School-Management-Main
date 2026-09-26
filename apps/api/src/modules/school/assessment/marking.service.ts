import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StudentAssessment } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { EVENTS, PERMISSIONS } from '@erp/shared';
import { computeEffective } from './assessment-math';
import { assertTermWritable } from '../foundation/academic-year-guard';
import type { AppendAdjustmentDto, MarkingApprovalDto, RecordMarkDto, SetParticipationDto } from './dto.types';

/** Tags a MarkEntry synthesised by `healLedgerlessScore`, so healed rows stay findable. */
export const HEAL_COMMENT = 'auto-healed:legacy-direct-write';

/**
 * StudentAssessment + the two mark-producing ledgers (MarkEntry rounds and the
 * append-only MarkAdjustment ledger). The canonical `originalScore` /
 * `effectiveScore` / `percentage` on a StudentAssessment are always DERIVED —
 * never written directly — by `recompute`, which runs the pure kernel over the
 * current marks and adjustments. Any write that can change the score calls it.
 */
@Injectable()
export class MarkingService {
  private readonly logger = new Logger(MarkingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly employeeIdentity: EmployeeIdentityService,
    private readonly dataScope: DataScopeService,
  ) {}

  /**
   * May this caller write marks for this assessment?
   *
   * `school:grades:write` is the org-wide entry grant — a data-entry clerk typing
   * up a whole exam holds it and needs it. A teacher marking their own papers
   * from home holds `school:grades:own` instead, which is only meaningful if
   * something checks whose assessment it is. `Assessment.teacherPartnerId` holds
   * a `StaffProfile.id`, which is what `isSelfTeacher` compares against.
   *
   * An assessment with no teacher recorded stays office-only: an owner-scoped
   * caller cannot claim an unowned paper by being first to mark it.
   *
   * This is entry, never approval. `approveGrades` is a separate grant on a
   * separate route, so a teacher still cannot approve their own marks.
   */
  async assertMayMarkAssessment(assessmentId: string | null | undefined): Promise<void> {
    const perms: string[] = this.tenant.store?.permissions ?? [];
    if (perms.includes(PERMISSIONS.school.enterGrades) || perms.includes('*')) return;
    if (!perms.includes(PERMISSIONS.school.ownGrades) && !perms.includes(PERMISSIONS.school.gradeAssignments)) throw new ForbiddenException('Mark entry permission is required');

    if (!assessmentId) throw new ForbiddenException('You may only mark your own assessments');
    const assessment = await this.prisma.client.assessment.findFirst({
      where: { id: assessmentId, organizationId: this.tenant.organizationId },
      select: { teacherPartnerId: true, courseOfferingId: true },
    });
    if (assessment?.courseOfferingId) {
      await this.assertMayTeachOffering(assessment.courseOfferingId);
      return;
    }
    if (!assessment?.teacherPartnerId) {
      throw new ForbiddenException('You may only mark your own assessments');
    }
    // Single ownership implementation: DataScopeService asserts the caller owns
    // (is) this teacher record. A teacher with `school:grades:own` and the
    // matching staff profile passes; an office clerk without the broad grant
    // does not.
    await this.dataScope.assertOwnsStaffRecord(assessment.teacherPartnerId);
  }

  /** Course allocation, including effective-dated team teachers and substitutes. */
  async assertMayTeachOffering(courseOfferingId: string): Promise<void> {
    const perms: string[] = this.tenant.store?.permissions ?? [];
    if (perms.some((p) => ['*', PERMISSIONS.school.enterGrades, PERMISSIONS.school.manageAssessments].includes(p))) return;
    if (!perms.includes(PERMISSIONS.school.ownGrades) && !perms.includes(PERMISSIONS.school.gradeAssignments)) throw new ForbiddenException('Assessment entry permission is required');
    const teacherPartnerId = await this.employeeIdentity.staffProfileIdForCaller();
    const now = new Date();
    const allocation = teacherPartnerId && await this.prisma.client.courseOfferingTeacher.findFirst({
      where: { courseOfferingId, teacherPartnerId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    });
    if (!allocation) throw new ForbiddenException('You may only assess courses you currently teach');
  }

  async readScope(): Promise<any> {
    const perms: string[] = this.tenant.store?.permissions ?? [];
    if (perms.some((p) => ['*', PERMISSIONS.school.manageAssessments, PERMISSIONS.school.enterGrades, PERMISSIONS.school.approveGrades, PERMISSIONS.school.moderateMarks].includes(p))) return {};
    const teacherPartnerId = await this.employeeIdentity.staffProfileIdForCaller();
    if (!teacherPartnerId) throw new ForbiddenException('Assessment detail is restricted to authorised teaching staff');
    const now = new Date();
    return { OR: [{ courseOfferingId: null, teacherPartnerId }, { courseOffering: { teachers: { some: { teacherPartnerId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } } } }] };
  }

  async assertMayViewAssessment(id: string) {
    const row = await this.prisma.client.assessment.findFirst({ where: { id, ...(await this.readScope()) } });
    if (!row) throw new NotFoundException('Assessment not found or not assigned to you');
  }

  /**
   * Recompute a StudentAssessment's derived scores from its marks + adjustments.
   * MUST be called inside the same transaction as any mark/adjustment write so
   * the derived fields never lag the ledgers. Bumps `version`.
   */
  async recompute(
    tx: any,
    studentAssessmentId: string,
    opts: { heal?: boolean } = {},
  ): Promise<void> {
    const sa = await tx.studentAssessment.findFirst({ where: { id: studentAssessmentId } });
    if (!sa) throw new NotFoundException(`StudentAssessment ${studentAssessmentId} not found`);
    const [storedEntries, adjustments] = await Promise.all([
      tx.markEntry.findMany({ where: { studentAssessmentId } }),
      tx.markAdjustment.findMany({ where: { studentAssessmentId } }),
    ]);
    let entries = storedEntries;

    // `heal: false` says the empty ledger is INTENTIONAL — the caller just
    // cleared the round. Without it, the self-heal below cannot tell a
    // deliberate clear apart from a legacy orphan and puts the mark straight
    // back, so erasing a mark (or marking a student absent after entering one)
    // silently did nothing.
    if (opts.heal !== false) {
      entries = await this.healLedgerlessScore(tx, sa, entries, adjustments);
    }

    const { originalScore, effectiveScore, percentage } = computeEffective(
      entries.map((e: any) => ({ round: e.round, score: e.score })),
      adjustments.map((a: any) => ({ sequence: a.sequence, delta: a.delta, replacementScore: a.replacementScore })),
      sa.maxScore,
    );
    await tx.studentAssessment.updateMany({
      where: { id: studentAssessmentId },
      data: { originalScore, effectiveScore, percentage, version: { increment: 1 } },
    });
  }

  /**
   * TEMPORARY (remove two releases after 2026-08-21, then throw instead).
   *
   * Some historic rows carry an `effectiveScore` that was written STRAIGHT onto
   * the StudentAssessment, with no MarkEntry behind it — the LMS grade bridge
   * and the homework bridge both did this. `computeEffective` returns all-null
   * when there is no ledger, so recomputing such a row would DELETE the mark.
   *
   * Rather than let that happen, adopt the orphaned score into the ledger it
   * should always have had. The row is left arithmetically identical; it simply
   * gains the `first` round that explains its score. The comment tag makes every
   * healed row findable, and the warn tells us whether a writer is still
   * bypassing `postMark`.
   */
  private async healLedgerlessScore(tx: any, sa: any, entries: any[], adjustments: any[]): Promise<any[]> {
    if (entries.length > 0 || sa.effectiveScore == null) return entries;
    const hasReplacement = adjustments.some((a: any) => a.replacementScore !== null && a.replacementScore !== undefined);
    if (hasReplacement) return entries;

    const healed = await tx.markEntry.create({
      data: {
        organizationId: sa.organizationId,
        studentAssessmentId: sa.id,
        markerId: sa.enteredById ?? null,
        round: 'first',
        score: sa.effectiveScore,
        comment: HEAL_COMMENT,
      },
    });
    this.logger.warn(
      `Healed ledger-less score on StudentAssessment ${sa.id} (assessment ${sa.assessmentId}, ` +
        `score ${String(sa.effectiveScore)}) — a writer set effectiveScore without a MarkEntry.`,
    );
    return [healed];
  }

  /** Ensure a StudentAssessment row exists for (assessment, student); returns it. */
  private async ensureRow(tx: any, assessmentId: string, studentProfileId: string, snapshot: Partial<StudentAssessment> = {}) {
    const assessment = await tx.assessment.findFirst({ where: { id: assessmentId } });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);
    if (assessment.rosterId) {
      const member = await tx.academicRosterMember.findFirst({ where: { rosterId: assessment.rosterId, studentProfileId } });
      if (!member) throw new BadRequestException('Learner is not on the frozen assessment roster');
      snapshot = { ...snapshot, classId: member.classId, sectionId: member.sectionId, gradeLevelId: member.gradeLevelId };
    }
    const existing = await tx.studentAssessment.findFirst({ where: { assessmentId, studentProfileId } });
    if (existing) return existing;
    return tx.studentAssessment.create({
      data: {
        organizationId: this.tenant.organizationId,
        assessmentId,
        studentProfileId,
        maxScore: assessment.maxScore,
        classId: snapshot.classId ?? assessment.classId,
        termId: snapshot.termId ?? assessment.termId,
        sectionId: snapshot.sectionId ?? null,
        gradeLevelId: snapshot.gradeLevelId ?? null,
      },
    });
  }

  /**
   * THE write path. Every producer of a mark — exam projection, assignment,
   * homework, quiz, LMS activity, gradebook cell, CSV import — goes through
   * here, inside the caller's transaction.
   *
   * Before this existed each producer reimplemented the sequence, and they
   * disagreed on all three of the things that matter: `recordMark` threw on an
   * out-of-range score while the LMS bridge silently clamped it; only the LMS
   * bridge checked `lockedAt`, so exam and assignment marks could be written to
   * a locked grade item; and two producers skipped the MarkEntry ledger
   * altogether, leaving scores a later recompute would erase.
   *
   * Address the row either by `studentAssessmentId`, or by
   * `assessmentId` + `studentProfileId` (which creates it if absent).
   */
  async postMark(
    tx: any,
    input: {
      studentAssessmentId?: string;
      assessmentId?: string;
      studentProfileId?: string;
      /** null clears this round — the student reverts to having no mark. */
      score: Prisma.Decimal.Value | null;
      round?: string;
      source: 'exam' | 'assignment' | 'homework' | 'quiz' | 'lms' | 'manual' | 'import' | 'override';
      markerId?: string | null;
      comment?: string | null;
      snapshot?: { classId?: string; sectionId?: string; gradeLevelId?: string; termId?: string };
      /** Import paths clamp; interactive paths throw. Default: throw. */
      onOutOfRange?: 'throw' | 'clamp';
      /** Only the exam projection and backfills may re-post an approved mark. */
      allowWhenApproved?: boolean;
      writeHistory?: boolean;
      /**
       * Optimistic concurrency. The version the caller believes it is editing;
       * a mismatch means someone else has written since they read, so the write
       * is refused rather than silently overwriting them.
       *
       * This guard was documented as living here after the GradeEntry retirement
       * but was never actually implemented — `version` was only ever incremented.
       * Two markers on the same paper could therefore clobber each other, last
       * write winning, with no error.
       */
      expectedVersion?: number;
    },
  ): Promise<StudentAssessment> {
    const round = input.round ?? 'first';

    let sa: any;
    if (input.studentAssessmentId) {
      sa = await tx.studentAssessment.findFirst({ where: { id: input.studentAssessmentId } });
      if (!sa) throw new NotFoundException(`StudentAssessment ${input.studentAssessmentId} not found`);
    } else {
      if (!input.assessmentId || !input.studentProfileId) {
        throw new BadRequestException('postMark needs a studentAssessmentId, or an assessmentId + studentProfileId');
      }
      sa = await this.ensureRow(tx, input.assessmentId, input.studentProfileId, input.snapshot ?? {});
    }

    const assessment = await tx.assessment.findFirst({ where: { id: sa.assessmentId } });
    if (assessment?.courseOfferingId) {
      if (!assessment.rosterId || ['draft', 'scheduled', 'archived'].includes(assessment.status)) {
        throw new ConflictException('Publish this assessment to its frozen roster before marking');
      }
      const roster = await tx.academicRoster.findFirst({ where: { id: assessment.rosterId } });
      if (!roster?.frozenAt) throw new ConflictException('Assessment roster must be frozen before marking');
    }
    // A closed or archived year's marks are history (re-audit #3). Exams,
    // attendance and billing already refused; the marking ledger — which every
    // gradebook, homework and LMS mark goes through — did not. Backfills that
    // re-project an approved exam mark are the one legitimate late writer.
    if (!input.allowWhenApproved) await this.assertYearOpen(tx, assessment);
    if (assessment?.lockedAt) {
      // 409, not 400: a locked item is a STATE conflict, not a malformed
      // request, and the marks workspace already contracts on 409 for its own
      // lock check. Two codes for one condition made the web show two messages.
      throw new ConflictException('This grade item is locked. Unlock it before changing marks.');
    }
    if (['approved', 'submitted'].includes(sa.approvalStatus) && !input.allowWhenApproved) {
      throw new ConflictException('Submitted and approved marks are read-only. Return submitted marks or request an adjustment.');
    }
    // A stale editor loses. 409, like the lock check above: the request is
    // well-formed, the STATE has moved on.
    if (input.expectedVersion != null && sa.version !== input.expectedVersion) {
      throw new ConflictException({ code: 'MARK_VERSION_CONFLICT', message: 'These marks changed since you loaded them. Compare the server value before retrying.', conflicts: [{ studentProfileId: sa.studentProfileId, studentAssessmentId: sa.id, expectedVersion: input.expectedVersion, version: sa.version, marks: sa.effectiveScore, participation: sa.participation }] });
    }

    // Claim the version before changing the ledger. A read-then-compare alone
    // lets two simultaneous transactions both pass with the same old version.
    const claimed = await tx.studentAssessment.updateMany({
      where: { id: sa.id, version: sa.version, approvalStatus: sa.approvalStatus },
      data: { version: { increment: 1 } },
    });
    if (claimed.count === 0) throw new ConflictException({ code: 'MARK_VERSION_CONFLICT', message: 'This mark changed while saving. Reload to compare before retrying.', conflicts: [{ studentProfileId: sa.studentProfileId }] });

    if (input.score === null) {
      await tx.markEntry.deleteMany({ where: { studentAssessmentId: sa.id, round } });
    } else {
      const max = new Prisma.Decimal(sa.maxScore);
      let score = new Prisma.Decimal(input.score);
      if (score.lessThan(0) || score.greaterThan(max)) {
        if (input.onOutOfRange !== 'clamp') {
          throw new BadRequestException(`Score ${score.toString()} out of range [0, ${max.toString()}]`);
        }
        score = score.lessThan(0) ? new Prisma.Decimal(0) : max;
      }
      await tx.markEntry.upsert({
        where: { studentAssessmentId_round: { studentAssessmentId: sa.id, round } },
        create: {
          organizationId: sa.organizationId,
          studentAssessmentId: sa.id,
          markerId: input.markerId ?? this.tenant.userId ?? null,
          round,
          score,
          comment: input.comment ?? null,
        },
        update: { score, comment: input.comment ?? null, markerId: input.markerId ?? this.tenant.userId ?? null },
      });
    }

    if (input.writeHistory !== false) {
      await tx.studentAssessmentHistory.create({
        data: {
          organizationId: sa.organizationId,
          studentAssessmentId: sa.id,
          oldScore: sa.effectiveScore,
          newScore: input.score === null ? null : new Prisma.Decimal(input.score),
          source: input.source,
          changedById: input.markerId ?? this.tenant.userId ?? null,
        },
      });
    }

    await this.recompute(tx, sa.id, { heal: input.score !== null });
    await tx.studentAssessment.updateMany({
      where: { id: sa.id },
      data: {
        status: input.score === null ? 'assigned' : 'graded',
        enteredById: input.markerId ?? this.tenant.userId ?? null,
        // Stamped here, alongside the identity. submit() used to backfill
        // enteredAt, which only worked because it was also overwriting
        // enteredById; now that submission records its own actor, the entry
        // time belongs to the write that actually entered the mark.
        enteredAt: new Date(),
        ...(input.comment !== undefined ? { feedback: input.comment } : {}),
      },
    });
    await this.audit.recordInTx(tx, {
      entity: 'StudentAssessment',
      entityId: sa.id,
      action: 'update',
      newValues: { action: 'post_mark', source: input.source, round, score: input.score },
    });

    return tx.studentAssessment.findFirst({ where: { id: sa.id } });
  }

  /** Set a student's participation (present/absent/exempt/…) on an assessment. */
  /**
   * P0-5: the same two gates `postMark` applies, for the paths that change what
   * a mark means without going through it.
   *
   * `setParticipation` and `appendAdjustment` both alter the result — one by
   * making a score non-scoring, the other by moving `effectiveScore` — but
   * neither passed through `postMark`, so a locked or already-approved
   * assessment could still be edited by either. A lock that only holds against
   * one of three doors is not a lock.
   */
  /** Refuse marking writes into a CLOSED or ARCHIVED academic year. */
  private async assertYearOpen(tx: any, assessment: { termId?: string | null } | null) {
    if (assessment?.termId) await assertTermWritable(tx, this.tenant.organizationId, assessment.termId);
  }

  private async assertAssessmentMutable(tx: any, sa: { id: string; assessmentId: string; approvalStatus: string }) {
    const assessment = await tx.assessment.findFirst({ where: { id: sa.assessmentId } });
    await this.assertYearOpen(tx, assessment);
    if (assessment?.lockedAt) {
      throw new ConflictException('This grade item is locked. Unlock it before changing marks.');
    }
    if (['approved', 'submitted'].includes(sa.approvalStatus)) {
      throw new BadRequestException('Submitted and approved marks are read-only');
    }
  }

  async setParticipation(dto: SetParticipationDto) {
    // Marking a pupil absent from a paper changes what their result means, so it
    // is held to the same ownership rule as entering the mark itself.
    await this.assertMayMarkAssessment(dto.assessmentId);
    return this.prisma.client.$transaction((tx: any) => this.setParticipationInTx(tx, dto));
  }

  /**
   * The one participation writer, callable from another module's transaction.
   *
   * Phase 5 needs this: approving an aegrotat or an exemption is an exam-office
   * act, decided under `school:exams:consideration`, that has to land on the
   * learner's assessment row in the same transaction as the decision. Routing it
   * back through `setParticipation` would have demanded a marking grant the exam
   * officer has no reason to hold; duplicating the write would have created a
   * second participation writer. Authorization is the CALLER's responsibility —
   * `setParticipation` above still checks marking ownership before calling in.
   */
  async setParticipationInTx(
    tx: any,
    dto: SetParticipationDto & { reason?: string },
  ): Promise<StudentAssessment> {
    const row = await this.ensureRow(tx, dto.assessmentId, dto.studentProfileId, {
      classId: dto.classId,
      sectionId: dto.sectionId,
      gradeLevelId: dto.gradeLevelId,
      termId: dto.termId,
    });
    await this.assertAssessmentMutable(tx, row as any);
    await tx.studentAssessment.updateMany({
      where: { id: row.id },
      data: { participation: dto.participation, version: { increment: 1 } },
    });
    await this.audit.recordInTx(tx, {
      entity: 'StudentAssessment',
      entityId: row.id,
      action: 'update',
      newValues: { participation: dto.participation, ...(dto.reason ? { reason: dto.reason } : {}) },
    });
    return tx.studentAssessment.findFirst({ where: { id: row.id } });
  }

  /**
   * Record one marker round, via `postMark` — the ONE writer.
   *
   * This used to upsert `MarkEntry` itself. That made `POST /school/marking/mark`
   * the only mark-writing route in the system with no lock check, no
   * `StudentAssessmentHistory` row and no optimistic-concurrency guard — and it
   * is the route the parent-portal teacher screen posts to, so the least
   * supervised client had the least protected path. It is now a thin adapter
   * over the same pipeline the board, the gradebook and the exam workspace use.
   */
  async recordMark(dto: RecordMarkDto) {
    // Resolved before the transaction opens: an authorization failure should not
    // hold a write lock on the marking ledgers while it is decided.
    const owner = await this.prisma.client.studentAssessment.findFirst({
      where: { id: dto.studentAssessmentId },
      select: { assessmentId: true },
    });
    await this.assertMayMarkAssessment(owner?.assessmentId);

    return this.prisma.client.$transaction((tx: any) =>
      this.postMark(tx, {
        studentAssessmentId: dto.studentAssessmentId,
        score: dto.score,
        round: dto.round,
        comment: dto.comment ?? null,
        source: 'manual',
        expectedVersion: dto.expectedVersion,
      }),
    );
  }

  /**
   * Append an adjustment to the immutable ledger (moderation, scaling, penalty,
   * correction), assign the next sequence, and recompute. The DB trigger blocks
   * any later edit/delete of the row.
   */
  async appendAdjustment(dto: AppendAdjustmentDto) {
    const organizationId = this.tenant.organizationId;
    const hasDelta = dto.delta !== undefined && dto.delta !== null;
    const hasReplacement = dto.replacementScore !== undefined && dto.replacementScore !== null;
    if (hasDelta === hasReplacement) {
      throw new BadRequestException('Provide exactly one of delta or replacementScore');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const sa = await tx.studentAssessment.findFirst({ where: { id: dto.studentAssessmentId } });
      if (!sa) throw new NotFoundException(`StudentAssessment ${dto.studentAssessmentId} not found`);
      await this.assertAssessmentMutable(tx, sa as any);

      const last = await tx.markAdjustment.findFirst({
        where: { studentAssessmentId: dto.studentAssessmentId },
        orderBy: { sequence: 'desc' },
      });
      const sequence = (last?.sequence ?? 0) + 1;

      await tx.markAdjustment.create({
        data: {
          organizationId,
          studentAssessmentId: dto.studentAssessmentId,
          sequence,
          kind: dto.kind,
          delta: hasDelta ? dto.delta : null,
          replacementScore: hasReplacement ? dto.replacementScore : null,
          reason: dto.reason,
          requestedById: this.tenant.userId ?? null,
        },
      });
      await this.recompute(tx, dto.studentAssessmentId);
      await this.audit.recordInTx(tx, {
        entity: 'MarkAdjustment',
        entityId: dto.studentAssessmentId,
        action: 'adjust',
        newValues: { sequence, kind: dto.kind, reason: dto.reason },
      });
      this.events.publish(EVENTS.SchoolMarksModerated, {
        organizationId,
        studentAssessmentId: dto.studentAssessmentId,
        kind: dto.kind,
        sequence,
      });
      return tx.studentAssessment.findFirst({ where: { id: dto.studentAssessmentId } });
    });
  }

  /**
   * Marking-approval workflow for a whole assessment's StudentAssessments,
   * mirroring the GradeEntry FSM with the same segregation of duty: the person
   * who entered a mark cannot approve it.
   */
  async markingApproval(dto: MarkingApprovalDto) {
    const organizationId = this.tenant.organizationId;
    const actorId = this.tenant.userId ?? null;
    // Submitting is the marker's own act and follows the marker's rule. Approve
    // and reject are gated at the controller on `school:grades:approve`, which no
    // teacher role holds — the segregation of duty is that separation, not this
    // check, and this must not be read as authorising it.
    if (dto.action === 'submit' || dto.action === 'resubmit') {
      await this.assertMayMarkAssessment(dto.assessmentId);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM "StudentAssessment" WHERE "assessmentId" = $1 AND "organizationId" = $2 ORDER BY id FOR UPDATE', dto.assessmentId, organizationId);
      const rows = await tx.studentAssessment.findMany({ where: { assessmentId: dto.assessmentId } });
      if (rows.length === 0) throw new NotFoundException(`No student assessments for assessment ${dto.assessmentId}`);
      const assessment = await tx.assessment.findFirst({ where: { id: dto.assessmentId }, include: { roster: { include: { members: true } } } });
      await this.assertYearOpen(tx, assessment);
      if (assessment?.courseOfferingId) {
        if (!assessment.roster?.frozenAt || ['draft', 'scheduled', 'archived'].includes(assessment.status)) throw new BadRequestException('A published assessment and frozen roster are required');
        const rosterIds = new Set(assessment.roster.members.map((m: any) => m.studentProfileId));
        if (rosterIds.size !== rows.length || rows.some((r: any) => !rosterIds.has(r.studentProfileId))) throw new BadRequestException('Assessment learners do not match the frozen roster');
        if (dto.action !== 'reject' && rows.some((r: any) => r.effectiveScore == null && !['absent', 'exempt', 'excused', 'malpractice', 'withdrawn', 'not_enrolled'].includes(r.participation))) throw new BadRequestException('Every learner needs a score or a resolved participation outcome');
      }
      if (dto.action === 'reject' && !dto.reason?.trim()) throw new BadRequestException('Give a reason for returning marks');

      if (dto.action === 'submit' || dto.action === 'resubmit') {
        // Resubmit is the second half of the reject loop: marks sent back are
        // `rejected`, and a marker fixing them must be able to send them on
        // again without an admin resetting the row by hand.
        const from = dto.action === 'resubmit' ? 'rejected' : 'draft';
        // enteredById is the person who ENTERED the mark and must survive
        // submission. Overwriting it with the submitter collapsed two distinct
        // actors into one field, so a marker whose work someone else submitted
        // could then approve their own marks — and runPublishGate's
        // SOD_VIOLATION check, which compares the same two columns, could not
        // see it either. Entered / submitted / approved are three facts.
        const res = await tx.studentAssessment.updateMany({
          where: { assessmentId: dto.assessmentId, approvalStatus: from },
          data: {
            approvalStatus: 'submitted',
            submittedById: actorId,
            submittedAt: new Date(),
            rejectionReason: null,
            version: { increment: 1 },
          },
        });
        await this.audit.recordInTx(tx, { entity: 'StudentAssessment', entityId: dto.assessmentId, action: 'update', newValues: { action: dto.action, count: res.count } });
        return { updated: res.count };
      }

      if (dto.action === 'approve') {
        const submitted = rows.filter((r: any) => r.approvalStatus === 'submitted');
        if (submitted.some((r: any) => r.enteredById && r.enteredById === actorId)) {
          throw new BadRequestException('You entered one or more of these marks and cannot approve them (segregation of duty).');
        }
        // Submitting is also an act of authorship over the batch: the person who
        // sent marks for approval does not get to approve them either.
        if (submitted.some((r: any) => r.submittedById && r.submittedById === actorId)) {
          throw new BadRequestException('You submitted these marks for approval and cannot approve them (segregation of duty).');
        }
        const res = await tx.studentAssessment.updateMany({
          where: { assessmentId: dto.assessmentId, approvalStatus: 'submitted' },
          data: { approvalStatus: 'approved', approvedById: actorId, approvedAt: new Date(), version: { increment: 1 } },
        });
        await this.audit.recordInTx(tx, { entity: 'StudentAssessment', entityId: dto.assessmentId, action: 'approve', newValues: { count: res.count } });
        this.events.publish(EVENTS.SchoolMarksApproved, { organizationId, assessmentId: dto.assessmentId, approvedById: actorId ?? '', count: res.count });
        return { updated: res.count };
      }

      // reject — the reason is part of the record, not a toast the marker missed
      const res = await tx.studentAssessment.updateMany({
        where: { assessmentId: dto.assessmentId, approvalStatus: 'submitted' },
        data: { approvalStatus: 'rejected', rejectionReason: dto.reason ?? null, version: { increment: 1 } },
      });
      await this.audit.recordInTx(tx, { entity: 'StudentAssessment', entityId: dto.assessmentId, action: 'reject', newValues: { reason: dto.reason ?? null, count: res.count } });
      return { updated: res.count };
    });
  }

  /**
   * The marks for one assessment, with the pupil's name attached.
   *
   * The name used to be left off, and the client was expected to join it from a
   * roster call — which the marking screen never did, so it listed a column
   * headed "Student" containing the first eight characters of a row id. Ordering
   * by name rather than by id also puts the sheet in register order.
   */
  async byAssessment(assessmentId: string) {
    await this.assertMayViewAssessment(assessmentId);
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: { assessmentId },
      include: { markEntries: true, adjustments: { orderBy: { sequence: 'asc' } } },
    });
    if (rows.length === 0) return rows;

    const profiles = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: rows.map((r) => r.studentProfileId) } },
      include: { partner: true },
    });
    const byId = new Map(profiles.map((p: any) => [p.id, p]));

    return rows
      .map((r) => {
        const p: any = byId.get(r.studentProfileId);
        return {
          ...r,
          studentName: (p?.partner?.name as string | undefined) ?? null,
          admissionNo: (p?.admissionNo as string | undefined) ?? null,
        };
      })
      .sort((a, b) => (a.studentName ?? '').localeCompare(b.studentName ?? ''));
  }

  async byStudent(studentProfileId: string, termId?: string) {
    return this.prisma.client.studentAssessment.findMany({
      where: { studentProfileId, ...(termId ? { termId } : {}), assessment: await this.readScope() },
      include: { assessment: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
