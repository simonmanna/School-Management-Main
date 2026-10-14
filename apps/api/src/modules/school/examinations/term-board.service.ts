import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AcademicRosterService } from '../assessment/roster.service';
import { ResultRunService } from '../assessment/result-run.service';
import { ReportCardService } from './examinations.service';

/**
 * The Director of Studies' term at a glance (review A15, Phase 1.5–1.6).
 *
 * The end of term used to be the same five steps repeated for every class:
 * capture and freeze the class list, work out results, release them, build the
 * report cards, release them. This board shows every class's progress in one
 * table and runs each step for all classes at once. Each bulk step:
 *   - is the existing single-class service call, made per class, so every
 *     rule (approval gate, publish gate, amendment chain) still applies;
 *   - reports per class what happened and why anything was skipped, rather
 *     than failing the whole term on one class.
 *
 * Class lists are captured and frozen AUTOMATICALLY when results are worked
 * out for a class that has none (Phase 1.6) — the list is a fact about the
 * term's placements, not a chore for the academic office.
 */
type Outcome = { classId: string; className: string; ok: boolean; detail: string };

@Injectable()
export class TermBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly rosters: AcademicRosterService,
    private readonly results: ResultRunService,
    private readonly cards: ReportCardService,
  ) {}

  private async termOf(termId: string) {
    const term = await (this.prisma.client as any).term.findFirst({ where: { id: termId }, select: { id: true, name: true, academicYearId: true } });
    if (!term) throw new NotFoundException('Term not found.');
    return term;
  }

  /** One row per active class: class list, exams, results, report cards, comments. */
  async board(termId: string) {
    const db = this.prisma.client as any;
    const term = await this.termOf(termId);
    const classes = await db.schoolClass.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, displayOrder: true,
        gradeLevel: { select: { order: true, academicLevel: { select: { name: true, stage: true } } } },
      },
    });
    classes.sort((a: any, b: any) => (a.gradeLevel?.order ?? 0) - (b.gradeLevel?.order ?? 0) || a.displayOrder - b.displayOrder);
    const classIds = classes.map((c: any) => c.id);

    const [rosters, exams, sets] = await Promise.all([
      db.academicRoster.findMany({
        where: { termId, scopeType: 'class', classId: { in: classIds }, sectionId: null, subjectId: null, deletedAt: null },
        select: { id: true, classId: true, frozenAt: true, createdAt: true, _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      db.exam.findMany({
        where: { termId, deletedAt: null },
        select: { id: true, name: true, startDate: true, schedules: { select: { id: true, classId: true, marksLockedAt: true } } },
        orderBy: { startDate: 'asc' },
      }),
      db.resultSet.findMany({
        where: { termId, scopeType: 'class', scopeId: { in: classIds }, deletedAt: null },
        select: { id: true, scopeId: true, status: true, revision: true },
        orderBy: { revision: 'desc' },
      }),
    ]);

    // Exam papers: how many marks are in (a mark or a recorded absence) and approved.
    const scheduleIds = exams.flatMap((e: any) => e.schedules.map((s: any) => s.id));
    const papers = scheduleIds.length
      ? await db.assessment.findMany({
          where: { sourceType: 'exam_session', sourceRef: { in: scheduleIds }, deletedAt: null },
          select: { id: true, sourceRef: true },
        })
      : [];
    const paperIds = papers.map((p: any) => p.id);
    const [entered, approved] = paperIds.length
      ? await Promise.all([
          db.studentAssessment.groupBy({
            by: ['assessmentId'],
            where: { assessmentId: { in: paperIds }, OR: [{ originalScore: { not: null } }, { participation: { in: ['absent', 'exempt', 'excused'] } }] },
            _count: { _all: true },
          }),
          db.studentAssessment.groupBy({
            by: ['assessmentId'],
            where: { assessmentId: { in: paperIds }, approvalStatus: 'approved' },
            _count: { _all: true },
          }),
        ])
      : [[], []];
    const scheduleOfPaper = new Map(papers.map((p: any) => [p.id, p.sourceRef]));
    const enteredBySchedule = new Map<string, number>(entered.map((e: any) => [scheduleOfPaper.get(e.assessmentId), e._count._all]));
    const approvedBySchedule = new Map<string, number>(approved.map((e: any) => [scheduleOfPaper.get(e.assessmentId), e._count._all]));

    // Pupils per class this term, then report cards and comments for them.
    const sizes = await this.placementSizes(classIds, termId);
    const latestRoster = new Map<string, any>();
    for (const r of rosters) if (!latestRoster.has(r.classId)) latestRoster.set(r.classId, r);
    const frozenRosterIds = [...latestRoster.values()].filter((r) => r.frozenAt).map((r) => r.id);
    const members = frozenRosterIds.length
      ? await db.academicRosterMember.findMany({ where: { rosterId: { in: frozenRosterIds } }, select: { rosterId: true, studentProfileId: true } })
      : [];
    const pupilsByClass = new Map<string, string[]>();
    for (const [classId, r] of latestRoster) {
      if (r.frozenAt) pupilsByClass.set(classId, members.filter((m: any) => m.rosterId === r.id).map((m: any) => m.studentProfileId));
    }
    const allPupils = [...new Set([...pupilsByClass.values()].flat())];
    const cardRows = allPupils.length
      ? await db.reportCard.findMany({
          where: { termId, studentProfileId: { in: allPupils } },
          select: { studentProfileId: true, publishedAt: true, classTeacherComment: true, principalComment: true, payload: true },
        })
      : [];
    const cardOf = new Map(cardRows.map((c: any) => [c.studentProfileId, c]));
    const latestSet = new Map<string, any>();
    for (const s of sets) if (!latestSet.has(s.scopeId)) latestSet.set(s.scopeId, s);

    return {
      term,
      classes: classes.map((c: any) => {
        const roster = latestRoster.get(c.id);
        const pupils = pupilsByClass.get(c.id) ?? [];
        const cards = pupils.map((id) => cardOf.get(id)).filter(Boolean) as any[];
        const built = cards.filter((x) => x.payload && (x.payload as any).sections).length;
        return {
          classId: c.id,
          className: c.name,
          level: c.gradeLevel?.academicLevel?.name ?? null,
          stage: c.gradeLevel?.academicLevel?.stage ?? null,
          pupils: sizes.get(c.id) ?? 0,
          classList: roster ? { rosterId: roster.id, frozen: !!roster.frozenAt, members: roster._count.members } : null,
          exams: exams
            .map((e: any) => {
              const sch = e.schedules.filter((s: any) => s.classId === c.id);
              if (!sch.length) return null;
              const expected = sch.length * (sizes.get(c.id) ?? 0);
              return {
                examId: e.id,
                name: e.name,
                papers: sch.length,
                expected,
                entered: sch.reduce((n: number, s: any) => n + (enteredBySchedule.get(s.id) ?? 0), 0),
                approved: sch.reduce((n: number, s: any) => n + (approvedBySchedule.get(s.id) ?? 0), 0),
                locked: sch.filter((s: any) => !!s.marksLockedAt).length,
              };
            })
            .filter(Boolean),
          results: latestSet.get(c.id) ? { resultSetId: latestSet.get(c.id).id, status: latestSet.get(c.id).status, revision: latestSet.get(c.id).revision } : null,
          reportCards: {
            pupils: pupils.length,
            built,
            released: cards.filter((x) => x.publishedAt).length,
            classTeacherComments: cards.filter((x) => x.classTeacherComment).length,
            headComments: cards.filter((x) => x.principalComment).length,
          },
        };
      }),
    };
  }

  private async placementSizes(classIds: string[], termId: string): Promise<Map<string, number>> {
    const db = this.prisma.client as any;
    const term = await db.term.findFirst({ where: { id: termId }, select: { academicYearId: true } });
    const rows = await db.enrollmentPlacement.findMany({
      where: {
        termId,
        classCohort: { classId: { in: classIds }, academicYearId: term?.academicYearId },
        enrollment: { status: 'ACTIVE' },
      },
      select: { classCohort: { select: { classId: true } }, enrollment: { select: { studentProfileId: true } } },
    });
    const seen = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = seen.get(r.classCohort.classId) ?? new Set<string>();
      set.add(r.enrollment.studentProfileId);
      seen.set(r.classCohort.classId, set);
    }
    return new Map([...seen.entries()].map(([k, v]) => [k, v.size]));
  }

  private async classesFor(termId: string, classIds?: string[]) {
    const db = this.prisma.client as any;
    return db.schoolClass.findMany({
      where: { isActive: true, ...(classIds?.length ? { id: { in: classIds } } : {}) },
      select: { id: true, name: true },
    });
  }

  /** The class's frozen class list for the term — captured and frozen now if it has none. */
  private async ensureFrozenList(termId: string, classId: string): Promise<{ rosterId: string; created: boolean } | null> {
    const db = this.prisma.client as any;
    const existing = await db.academicRoster.findFirst({
      where: { termId, scopeType: 'class', classId, sectionId: null, subjectId: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, frozenAt: true, _count: { select: { members: true } } },
    });
    if (existing?.frozenAt) return { rosterId: existing.id, created: false };
    if (existing && existing._count.members > 0) {
      await this.rosters.freeze(existing.id);
      return { rosterId: existing.id, created: false };
    }
    const captured: any = await this.rosters.capture({ termId, classId, scopeType: 'class' } as any);
    if (!captured?.members?.length) return null;
    await this.rosters.freeze(captured.id);
    return { rosterId: captured.id, created: true };
  }

  /** Capture and lock every class's list for the term (classes with pupils only). */
  async lockClassLists(dto: { termId: string; classIds?: string[] }) {
    await this.termOf(dto.termId);
    const out: Outcome[] = [];
    for (const c of await this.classesFor(dto.termId, dto.classIds)) {
      try {
        const r = await this.ensureFrozenList(dto.termId, c.id);
        out.push({ classId: c.id, className: c.name, ok: !!r, detail: r ? (r.created ? 'Class list captured and locked' : 'Already locked') : 'No pupils placed in this class' });
      } catch (e) {
        out.push({ classId: c.id, className: c.name, ok: false, detail: (e as Error).message });
      }
    }
    return this.summary(out);
  }

  /** Work out results for every class — locking any class list that is not yet locked. */
  async computeAll(dto: { termId: string; classIds?: string[] }) {
    await this.termOf(dto.termId);
    const out: Outcome[] = [];
    for (const c of await this.classesFor(dto.termId, dto.classIds)) {
      try {
        const list = await this.ensureFrozenList(dto.termId, c.id);
        if (!list) {
          out.push({ classId: c.id, className: c.name, ok: false, detail: 'No pupils placed in this class' });
          continue;
        }
        const rs: any = await this.results.compute({ termId: dto.termId, rosterId: list.rosterId } as any);
        out.push({ classId: c.id, className: c.name, ok: true, detail: `Worked out (version ${rs.revision})` });
      } catch (e) {
        out.push({ classId: c.id, className: c.name, ok: false, detail: (e as Error).message });
      }
    }
    return this.summary(out);
  }

  /** Release every class's latest worked-out results that pass the publish gate. */
  async publishAll(dto: { termId: string; classIds?: string[] }) {
    await this.termOf(dto.termId);
    const db = this.prisma.client as any;
    const out: Outcome[] = [];
    for (const c of await this.classesFor(dto.termId, dto.classIds)) {
      const latest = await db.resultSet.findFirst({
        where: { termId: dto.termId, scopeType: 'class', scopeId: c.id, deletedAt: null },
        orderBy: { revision: 'desc' },
        select: { id: true, status: true },
      });
      if (!latest) { out.push({ classId: c.id, className: c.name, ok: false, detail: 'Results not worked out yet' }); continue; }
      if (['published', 'locked'].includes(latest.status)) { out.push({ classId: c.id, className: c.name, ok: true, detail: 'Already released' }); continue; }
      try {
        const ready = await this.results.readiness(latest.id);
        if (!ready.ready) {
          out.push({ classId: c.id, className: c.name, ok: false, detail: ready.conflicts[0]?.detail ?? 'Not ready to release' });
          continue;
        }
        await this.results.publish(latest.id);
        out.push({ classId: c.id, className: c.name, ok: true, detail: 'Released to families' });
      } catch (e) {
        out.push({ classId: c.id, className: c.name, ok: false, detail: (e as Error).message });
      }
    }
    return this.summary(out);
  }

  /** Build every class's report cards from its released results. */
  async buildCards(dto: { termId: string; classIds?: string[] }) {
    await this.termOf(dto.termId);
    const out: Outcome[] = [];
    for (const c of await this.classesFor(dto.termId, dto.classIds)) {
      try {
        const r = await this.cards.generateForClass({ classId: c.id, termId: dto.termId });
        out.push({
          classId: c.id, className: c.name, ok: r.skipped.length === 0,
          detail: `${r.generated} built${r.skipped.length ? `, ${r.skipped.length} not built (${r.skipped[0].reason})` : ''}`,
        });
      } catch (e) {
        out.push({ classId: c.id, className: c.name, ok: false, detail: (e as Error).message });
      }
    }
    return this.summary(out);
  }

  /** Release every built report card. */
  async releaseCards(dto: { termId: string; classIds?: string[] }) {
    await this.termOf(dto.termId);
    const out: Outcome[] = [];
    for (const c of await this.classesFor(dto.termId, dto.classIds)) {
      try {
        const r = await this.cards.publishForClass({ classId: c.id, termId: dto.termId });
        out.push({
          classId: c.id, className: c.name, ok: r.notGenerated === 0 && r.awaitingResults === 0,
          detail: `${r.published} released${r.alreadyPublished ? `, ${r.alreadyPublished} already out` : ''}${r.notGenerated ? `, ${r.notGenerated} not built` : ''}${r.awaitingResults ? `, ${r.awaitingResults} awaiting results` : ''}`,
        });
      } catch (e) {
        out.push({ classId: c.id, className: c.name, ok: false, detail: (e as Error).message });
      }
    }
    return this.summary(out);
  }

  private summary(outcomes: Outcome[]) {
    if (outcomes.length === 0) throw new BadRequestException('No classes to act on.');
    return { done: outcomes.filter((o) => o.ok).length, total: outcomes.length, outcomes };
  }
}
