import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Paper, Question, QuestionBank } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { MarkingService } from '../assessment/marking.service';
import { CbtResultBridgeService } from '../assessment/cbt-result-bridge.service';
import { markResponse, totalAuto, type MarkableQuestion } from './cbt-marking';
import type {
  CreatePaperDto,
  CreateQuestionBankDto,
  CreateQuestionDto,
  SaveResponseDto,
  StartAttemptDto,
  SubmitAttemptDto,
} from './cbt.dto';

// ── authoring ───────────────────────────────────────────────────────────────
@Injectable()
export class QuestionBankService extends BaseCrudService<QuestionBank, CreateQuestionBankDto, Partial<CreateQuestionBankDto>> {
  protected readonly entityName = 'QuestionBank';
  protected readonly searchFields = ['name', 'description'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.questionBank as unknown as CrudDelegate);
  }
}

@Injectable()
export class QuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async createFull(dto: CreateQuestionDto): Promise<Question> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const bank = await tx.questionBank.findFirst({ where: { id: dto.bankId } });
      if (!bank) throw new NotFoundException(`QuestionBank ${dto.bankId} not found`);
      const q = await tx.question.create({
        data: {
          organizationId,
          bankId: dto.bankId,
          type: dto.type,
          prompt: dto.prompt,
          marks: dto.marks ?? 1,
          answerKey: (dto.answerKey as any) ?? {},
          tags: (dto.tags as any) ?? [],
          difficulty: dto.difficulty ?? null,
        },
      });
      for (const [i, o] of (dto.options ?? []).entries()) {
        await tx.questionOption.create({
          data: { organizationId, questionId: q.id, label: o.label, isCorrect: !!o.isCorrect, order: o.order ?? i },
        });
      }
      await this.audit.recordInTx(tx, { entity: 'Question', entityId: q.id, action: 'create', newValues: { bankId: dto.bankId, type: dto.type } });
      return tx.question.findFirst({ where: { id: q.id }, include: { options: true } });
    });
  }

  /** Fork a question into a new version (editing must not change graded history). */
  async fork(id: string): Promise<Question> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const src = await tx.question.findFirst({ where: { id }, include: { options: true } });
      if (!src) throw new NotFoundException(`Question ${id} not found`);
      const next = await tx.question.create({
        data: {
          organizationId, bankId: src.bankId, type: src.type, prompt: src.prompt, marks: src.marks,
          answerKey: src.answerKey, tags: src.tags, difficulty: src.difficulty, version: src.version + 1,
        },
      });
      for (const o of src.options) {
        await tx.questionOption.create({ data: { organizationId, questionId: next.id, label: o.label, isCorrect: o.isCorrect, order: o.order } });
      }
      await tx.question.updateMany({ where: { id }, data: { supersededById: next.id, isActive: false } });
      return tx.question.findFirst({ where: { id: next.id }, include: { options: true } });
    });
  }

  async list(bankId: string) {
    return this.prisma.client.question.findMany({ where: { bankId, isActive: true }, include: { options: true }, orderBy: { createdAt: 'asc' } });
  }
}

@Injectable()
export class PaperService extends BaseCrudService<Paper, CreatePaperDto, Partial<CreatePaperDto>> {
  protected readonly entityName = 'Paper';
  protected readonly searchFields = ['name'];
  constructor(private readonly prisma: PrismaService, private readonly tenant: TenantContextService) {
    super(prisma.client.paper as unknown as CrudDelegate);
  }

  /** Attach a question to a fixed paper and refresh the paper's total marks. */
  async addQuestion(paperId: string, questionId: string, order?: number, marks?: number) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const paper = await tx.paper.findFirst({ where: { id: paperId } });
      if (!paper) throw new NotFoundException(`Paper ${paperId} not found`);
      const q = await tx.question.findFirst({ where: { id: questionId } });
      if (!q) throw new NotFoundException(`Question ${questionId} not found`);
      await tx.paperQuestion.upsert({
        where: { paperId_questionId: { paperId, questionId } },
        create: { organizationId, paperId, questionId, order: order ?? 0, marks: marks ?? q.marks },
        update: { order: order ?? 0, marks: marks ?? q.marks },
      });
      const pqs = await tx.paperQuestion.findMany({ where: { paperId } });
      let total = new Prisma.Decimal(0);
      for (const pq of pqs) {
        const src = await tx.question.findFirst({ where: { id: pq.questionId } });
        total = total.add(new Prisma.Decimal(pq.marks ?? src?.marks ?? 0));
      }
      await tx.paper.updateMany({ where: { id: paperId }, data: { totalMarks: total } });
      return tx.paper.findFirst({ where: { id: paperId }, include: { questions: true } });
    });
  }
}

// ── attempt engine ────────────────────────────────────────────────────────────
interface RealisedQuestion {
  questionId: string;
  type: string;
  marks: number;
  prompt: string;
  options: Array<{ id: string; label: string; isCorrect: boolean }>;
  answerKey: any;
}

@Injectable()
export class CbtAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly marking: MarkingService,
    private readonly bridge: CbtResultBridgeService,
  ) {}

  /** Assemble the questions for a paper — fixed list, or a random draw from a bank. */
  private async realise(tx: any, paper: any): Promise<RealisedQuestion[]> {
    let questionIds: string[];
    if (paper.isRandom) {
      const bp = paper.blueprint ?? {};
      const pool = await tx.question.findMany({ where: { bankId: bp.bankId, isActive: true } });
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      questionIds = shuffled.slice(0, bp.count ?? pool.length).map((q: any) => q.id);
    } else {
      const pqs = await tx.paperQuestion.findMany({ where: { paperId: paper.id }, orderBy: { order: 'asc' } });
      questionIds = pqs.map((pq: any) => pq.questionId);
    }
    const out: RealisedQuestion[] = [];
    for (const qid of questionIds) {
      const q = await tx.question.findFirst({ where: { id: qid }, include: { options: true } });
      if (!q) continue;
      out.push({
        questionId: q.id, type: q.type, marks: Number(q.marks), prompt: q.prompt,
        options: q.options.map((o: any) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })),
        answerKey: q.answerKey,
      });
    }
    return out;
  }

  /** Student-facing view of the attempt — answer keys + option correctness stripped. */
  private strip(attempt: any) {
    const realised: RealisedQuestion[] = (attempt.realisedQuestions ?? []) as any;
    return {
      id: attempt.id,
      paperId: attempt.paperId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      maxScore: attempt.maxScore,
      questions: realised.map((q) => ({ questionId: q.questionId, type: q.type, marks: q.marks, prompt: q.prompt, options: q.options.map((o) => ({ id: o.id, label: o.label })) })),
    };
  }

  async start(dto: StartAttemptDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const paper = await tx.paper.findFirst({ where: { id: dto.paperId } });
      if (!paper) throw new NotFoundException(`Paper ${dto.paperId} not found`);
      const realised = await this.realise(tx, paper);
      if (realised.length === 0) throw new BadRequestException('Paper has no questions to sit');
      const maxScore = realised.reduce((acc, q) => acc.add(new Prisma.Decimal(q.marks)), new Prisma.Decimal(0));
      const priorAttempts = await tx.quizAttempt.count({ where: { paperId: dto.paperId, studentProfileId: dto.studentProfileId } });
      const expiresAt = new Date(Date.now() + paper.durationMinutes * 60_000);

      // If this paper is sat as an LMS quiz activity, bind the attempt to that
      // activity's StudentAssessment now. Without the link, `finalize` mints a
      // SECOND, quiz-sourced assessment for the same sitting, and the LMS
      // plugin's own grade sync mints a third — so one attempt contributed
      // twice to the term aggregate.
      const studentAssessmentId =
        dto.studentAssessmentId ?? (await this.resolveLmsStudentAssessment(tx, dto.paperId, dto.studentProfileId));

      const attempt = await tx.quizAttempt.create({
        data: {
          organizationId,
          paperId: dto.paperId,
          studentProfileId: dto.studentProfileId,
          studentAssessmentId,
          attemptNumber: priorAttempts + 1,
          status: 'in_progress',
          startedAt: new Date(),
          expiresAt,
          realisedQuestions: realised as any,
          maxScore,
        },
      });
      await tx.attemptEvent.create({ data: { organizationId, attemptId: attempt.id, type: 'start', payload: { paperId: dto.paperId } } });
      return this.strip(attempt);
    });
  }

  /**
   * When a paper is the question bank behind a `mod_quiz` activity, that
   * activity already owns an Assessment (sourceType `lms_activity`). Return the
   * student's row on it — creating it if the roster fan-out missed them — so
   * the attempt posts into the grade item the course already shows, instead of
   * minting a parallel one.
   *
   * Returns null for a paper sat outside the LMS; those still go through the
   * CBT result bridge in `finalize`.
   */
  private async resolveLmsStudentAssessment(tx: any, paperId: string, studentProfileId: string): Promise<string | null> {
    const modQuiz = await tx.modQuiz.findFirst({ where: { questionPaperId: paperId }, select: { id: true } });
    if (!modQuiz) return null;

    const cm = await tx.courseModule.findFirst({
      where: { activityType: 'quiz', instanceId: modQuiz.id, assessmentId: { not: null }, deletedAt: null },
      select: { assessmentId: true },
    });
    if (!cm?.assessmentId) return null;

    const assessment = await tx.assessment.findFirst({ where: { id: cm.assessmentId, deletedAt: null } });
    if (!assessment) return null;

    const sa = await tx.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId: assessment.id, studentProfileId } },
      create: {
        organizationId: this.tenant.organizationId,
        assessmentId: assessment.id,
        studentProfileId,
        classId: assessment.classId,
        termId: assessment.termId,
        maxScore: assessment.maxScore,
      },
      update: {},
    });
    return sa.id;
  }

  async saveResponse(dto: SaveResponseDto) {
    const organizationId = this.tenant.organizationId;

    // Server-authoritative expiry — the client clock is never trusted. Auto-submit
    // in its OWN transaction (so it commits) before refusing the late save.
    const pre = await this.prisma.client.quizAttempt.findFirst({ where: { id: dto.attemptId } });
    if (!pre) throw new NotFoundException(`QuizAttempt ${dto.attemptId} not found`);
    if (pre.status !== 'in_progress') throw new BadRequestException(`Attempt is '${pre.status}', not accepting responses`);
    if (new Date() > pre.expiresAt) {
      await this.prisma.client.$transaction((tx: any) => this.finalize(tx, pre, 'auto_submitted'));
      throw new BadRequestException('Attempt has expired');
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const attempt = await tx.quizAttempt.findFirst({ where: { id: dto.attemptId } });
      if (!attempt) throw new NotFoundException(`QuizAttempt ${dto.attemptId} not found`);
      if (attempt.status !== 'in_progress') throw new BadRequestException(`Attempt is '${attempt.status}', not accepting responses`);

      const realised: RealisedQuestion[] = attempt.realisedQuestions as any;
      const rq = realised.find((q) => q.questionId === dto.questionId);
      if (!rq) throw new BadRequestException('Question is not part of this attempt');

      const existing = await tx.quizResponse.findFirst({ where: { attemptId: dto.attemptId, questionId: dto.questionId } });

      // Idempotent by clientEventId; stale/out-of-order sequences are discarded.
      if (existing) {
        if (dto.clientEventId && existing.clientEventId === dto.clientEventId) return existing;
        if (dto.sequenceNumber <= existing.sequenceNumber) return existing; // highest valid wins
      }

      const mark = markResponse(rq as MarkableQuestion, dto.response);
      const saved = await tx.quizResponse.upsert({
        where: { attemptId_questionId: { attemptId: dto.attemptId, questionId: dto.questionId } },
        create: {
          organizationId, attemptId: dto.attemptId, questionId: dto.questionId,
          clientEventId: dto.clientEventId ?? null, sequenceNumber: dto.sequenceNumber,
          response: (dto.response as any) ?? {}, autoScore: mark.score, isCorrect: mark.isCorrect, needsManual: mark.needsManual,
        },
        update: {
          clientEventId: dto.clientEventId ?? null, sequenceNumber: dto.sequenceNumber,
          response: (dto.response as any) ?? {}, autoScore: mark.score, isCorrect: mark.isCorrect, needsManual: mark.needsManual,
        },
      });
      await tx.quizAttempt.updateMany({ where: { id: dto.attemptId }, data: { serverSequence: Math.max(attempt.serverSequence, dto.sequenceNumber), version: { increment: 1 } } });
      await tx.attemptEvent.create({ data: { organizationId, attemptId: dto.attemptId, type: 'answer_saved', payload: { questionId: dto.questionId, sequenceNumber: dto.sequenceNumber } } });
      return saved;
    });
  }

  async submit(dto: SubmitAttemptDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const attempt = await tx.quizAttempt.findFirst({ where: { id: dto.attemptId } });
      if (!attempt) throw new NotFoundException(`QuizAttempt ${dto.attemptId} not found`);
      if (['submitted', 'auto_submitted'].includes(attempt.status)) {
        return tx.quizAttempt.findFirst({ where: { id: dto.attemptId } }); // idempotent
      }
      const status = new Date() > attempt.expiresAt ? 'auto_submitted' : 'submitted';
      return this.finalize(tx, attempt, status);
    });
  }

  /** Total the auto-marked responses, close the attempt, and post to the spine. */
  private async finalize(tx: any, attempt: any, status: 'submitted' | 'auto_submitted') {
    const organizationId = this.tenant.organizationId;
    const realised: RealisedQuestion[] = attempt.realisedQuestions as any;
    const responses = await tx.quizResponse.findMany({ where: { attemptId: attempt.id } });

    const items = realised.map((rq) => ({
      question: rq as MarkableQuestion,
      response: responses.find((r: any) => r.questionId === rq.questionId)?.response ?? {},
    }));
    const { autoScore, manualPending } = totalAuto(items);

    await tx.quizAttempt.updateMany({
      where: { id: attempt.id },
      data: { status, submittedAt: new Date(), autoScore, manualPending, version: { increment: 1 } },
    });
    await tx.attemptEvent.create({ data: { organizationId, attemptId: attempt.id, type: status, payload: { autoScore: autoScore.toString(), manualPending } } });

    // Post the auto-marked total to the assessment spine.
    if (manualPending === 0) {
      if (attempt.studentAssessmentId) {
        await this.marking.postMark(tx, {
          studentAssessmentId: attempt.studentAssessmentId,
          score: autoScore,
          source: 'quiz',
          comment: `cbt:${attempt.id}`,
          onOutOfRange: 'clamp',
        });
      } else {
        // P1-A: ensure the quiz lands in the spine even when not pre-linked, so
        // it counts toward the term result aggregation.
        const paper = await tx.paper.findFirst({
          where: { id: attempt.paperId },
        });
        await this.bridge.postAttempt(tx, {
          organizationId,
          quizAttemptId: attempt.id,
          paperId: attempt.paperId,
          studentProfileId: attempt.studentProfileId,
          autoScore: Number(autoScore),
          maxScore: Number(attempt.maxScore),
          subjectId: paper?.subjectId ?? null,
        });
      }
    }

    this.events.publish(EVENTS.SchoolQuizAttemptSubmitted, {
      organizationId,
      attemptId: attempt.id,
      studentProfileId: attempt.studentProfileId,
      autoScore: autoScore.toString(),
      manualPending,
    });
    return tx.quizAttempt.findFirst({ where: { id: attempt.id } });
  }

  async getForStudent(attemptId: string) {
    const attempt = await this.prisma.client.quizAttempt.findFirst({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException(`QuizAttempt ${attemptId} not found`);
    return this.strip(attempt);
  }

  /**
   * Who sat this attempt. Separate from `getForStudent` because that deliberately
   * strips identity and answer keys out of its payload, so the caller cannot use
   * it to authorise anything.
   */
  async ownerOf(attemptId: string): Promise<string | null> {
    const row = await this.prisma.client.quizAttempt.findFirst({
      where: { id: attemptId },
      select: { studentProfileId: true },
    });
    return row?.studentProfileId ?? null;
  }
}
