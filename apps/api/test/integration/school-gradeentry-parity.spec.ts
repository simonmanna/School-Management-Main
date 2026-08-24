/**
 * B6 gate — the pre-flip proof.
 *
 * Before `GradeEntry` is sealed read-only, prove that the spine already carries
 * every historic exam mark it should: for every `GradeEntry` row, the projected
 * `StudentAssessment` (reached through the `Assessment` keyed by
 * (organizationId, 'exam_session', sourceRef=examScheduleId)) must have the SAME
 * effectiveScore and the SAME approvalStatus.
 *
 * The match is ORG-SCOPED: `schooldb-planet` holds many orgs, so we carry each
 * GradeEntry's org through and look the Assessment up by (org, sourceRef). A
 * naive single-org lookup would false-positive every other org's rows as orphans.
 *
 * If this passes, the irreversible flip in B6 is safe: dropping the
 * `grade_entry`/`shadow` report-card branches and the GradeEntry write path
 * cannot change any historic result, because the spine already holds an
 * identical copy. Run against a live Postgres (DATABASE_URL). If parity fails,
 * B6 MUST NOT run.
 */
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';

describeDb('integration: GradeEntry → spine parity (B6 gate)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  beforeAll(async () => {
    await raw.$connect();
  });
  afterAll(async () => {
    await raw.$disconnect();
  });

  it('every GradeEntry is mirrored by a spine StudentAssessment with identical score + status', async () => {
    const total = await raw.gradeEntry.count();
    expect(total).toBeGreaterThan(0); // there is exam history to protect

    // Resolve each GradeEntry's org via its ExamSchedule → Exam. Prisma can't
    // reach orgId from GradeEntry in one include, so join in SQL.
    const rows = (await raw.$queryRawUnsafe(`
      SELECT ge."examScheduleId"        AS schedule_id,
             ge."studentProfileId"      AS student_id,
             ge."marksObtained"         AS ge_score,
             ge."status"                AS ge_status,
             e."organizationId"         AS org_id
      FROM "GradeEntry" ge
      JOIN "ExamSchedule" es ON es."id" = ge."examScheduleId"
      JOIN "Exam" e          ON e."id"  = es."examId"
      LIMIT 500000
    `)) as Array<{
      schedule_id: string;
      student_id: string;
      ge_score: any;
      ge_status: string;
      org_id: string;
    }>;

    expect(rows.length).toBeGreaterThan(0);

    // All exam_session Assessments (the projection minted one per schedule).
    const assessments = await raw.assessment.findMany({
      where: { sourceType: 'exam_session', deletedAt: null },
      select: { id: true, organizationId: true, sourceRef: true },
    });
    // key: org|sourceRef -> assessmentId
    const assessmentByOrgSchedule = new Map<string, string>();
    for (const a of assessments) {
      assessmentByOrgSchedule.set(`${a.organizationId}|${a.sourceRef}`, a.id);
    }

    const spineSas = await raw.studentAssessment.findMany({
      where: { assessmentId: { in: assessments.map((a) => a.id) }, deletedAt: null },
      select: {
        id: true,
        assessmentId: true,
        studentProfileId: true,
        effectiveScore: true,
        approvalStatus: true,
      },
    });
    // key: assessmentId|studentProfileId
    const spine = new Map<string, { effectiveScore: any; approvalStatus: string }>();
    for (const sa of spineSas) {
      spine.set(`${sa.assessmentId}|${sa.studentProfileId}`, {
        effectiveScore: sa.effectiveScore,
        approvalStatus: sa.approvalStatus,
      });
    }

    const scoreMismatches: string[] = [];
    const statusMismatches: string[] = [];
    const orphanEntries: string[] = []; // no spine StudentAssessment at all

    for (const r of rows) {
      const key = `${r.org_id}|${r.schedule_id}`;
      const assessmentId = assessmentByOrgSchedule.get(key);
      if (!assessmentId) {
        orphanEntries.push(`${r.org_id}:${r.schedule_id}:${r.student_id}`);
        continue;
      }
      const s = spine.get(`${assessmentId}|${r.student_id}`);
      if (!s) {
        orphanEntries.push(`${r.org_id}:${r.schedule_id}:${r.student_id}`);
        continue;
      }
      const ge = r.ge_score == null ? null : Number(r.ge_score);
      const sp = s.effectiveScore == null ? null : Number(s.effectiveScore);
      if (ge !== sp) {
        // tolerate float dust within 0.01
        if (ge == null || sp == null || Math.abs(ge - sp) > 0.01) {
          scoreMismatches.push(`${r.org_id}:${r.schedule_id}:${r.student_id} ge=${ge} spine=${sp}`);
        }
      }
      if (r.ge_status !== s.approvalStatus) {
        statusMismatches.push(`${r.org_id}:${r.schedule_id}:${r.student_id} ge=${r.ge_status} spine=${s.approvalStatus}`);
      }
    }

    expect(orphanEntries).toEqual([]);
    expect(scoreMismatches).toEqual([]);
    expect(statusMismatches).toEqual([]);
  });

  it('no StudentAssessment on the exam spine is missing its GradeEntry source (production orgs)', async () => {
    // The inverse: every projected exam StudentAssessment must trace back to a
    // GradeEntry, so the flip does not invent marks that never existed.
    // Scoped to non-test orgs: spec fixtures (org_ub_*) legitimately mint spine
    // rows without a legacy GradeEntry, which is not a real divergence.
    const orphans = (await raw.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS n
      FROM "StudentAssessment" sa
      JOIN "Assessment" a ON a."id" = sa."assessmentId"
      WHERE a."sourceType" = 'exam_session'
        AND a."organizationId" NOT LIKE 'org_ub_%'
        AND sa."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "GradeEntry" ge
          WHERE ge."examScheduleId" = a."sourceRef"
            AND ge."studentProfileId" = sa."studentProfileId"
        )
    `)) as any[];
    expect(orphans[0].n).toBe(0);
  });
});
