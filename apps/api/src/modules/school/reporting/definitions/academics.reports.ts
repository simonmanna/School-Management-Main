import { PERMISSIONS } from '@erp/shared';
import type { ReportColumn, ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Academic-domain reports.
 *
 * All three read the RESULT SPINE (StudentSubjectResult / StudentTermResult),
 * never `GradeEntry` — that table was sealed read-only at the B6 migration, so a
 * report built on it silently freezes at the cutover and returns only
 * pre-cutover pupils while looking perfectly plausible. The existing dashboard
 * was bitten by exactly this.
 *
 * They also read from a RESULT SET rather than from raw marks, so every figure
 * is pinned to a revision and reproducible. Ranks are the ones the result run
 * computed under the school's own ranking policy — never re-derived here, or the
 * report would be a second, competing answer to "who came first".
 */
export function academicsReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'academics.class-broadsheet',
      title: 'Class Broadsheet',
      domain: 'academics',
      description:
        'Every pupil against every subject for a result set, with mean, aggregate and position.',
      permission: PERMISSIONS.school.readReports,
      shape: 'matrix',
      filters: ['resultSetId', 'termId', 'classId', 'classBasis'],
      requiredFilters: ['resultSetId'],
      // The frozen academic roster is the only defensible membership for a
      // results document: `currentClassId` would rewrite last term's broadsheet
      // every time a pupil is moved.
      classBasisDefault: 'roster',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 600,
      defaultSort: { key: 'classRank', order: 'asc' },
      // Subject columns are only knowable once the result set is read.
      columns: async () => [],
      async run(ctx, params) {
        const rs: any = await deps.resultRun.findResultSet(params.resultSetId);
        const subjectIds = [...new Set((rs.subjectResults as any[]).map((r) => r.subjectId))];
        const names = await deps.resolver.subjectNames(subjectIds);
        const directory = await deps.resolver.studentDirectory(
          (rs.termResults as any[]).map((t) => t.studentProfileId),
        );

        const bySubject = new Map<string, Map<string, any>>();
        for (const sr of rs.subjectResults as any[]) {
          if (!bySubject.has(sr.studentProfileId)) bySubject.set(sr.studentProfileId, new Map());
          bySubject.get(sr.studentProfileId)!.set(sr.subjectId, sr);
        }

        const rows = (rs.termResults as any[]).map((t) => {
          const d = directory.get(t.studentProfileId);
          const marks = bySubject.get(t.studentProfileId) ?? new Map();
          const row: Record<string, unknown> = {
            studentProfileId: t.studentProfileId,
            admissionNo: d?.admissionNo ?? '',
            studentName: d?.name ?? t.studentProfileId,
            meanPercent: t.meanPercent == null ? null : Number(t.meanPercent),
            aggregate: t.aggregate == null ? null : Number(t.aggregate),
            division: t.division ?? '',
            classRank: t.classRank == null ? null : Number(t.classRank),
          };
          for (const sid of subjectIds) {
            const m = marks.get(sid);
            row[`subject_${sid}`] = m?.finalPercent == null ? null : Number(m.finalPercent);
            row[`grade_${sid}`] = m?.grade ?? '';
          }
          return row;
        });

        const columns: ReportColumn[] = [
          { key: 'admissionNo', label: 'Adm No', type: 'string', width: 10 },
          { key: 'studentName', label: 'Name', type: 'string', width: 22 },
          ...subjectIds.flatMap((sid): ReportColumn[] => [
            { key: `subject_${sid}`, label: names.get(sid) ?? 'Subject', type: 'percent', width: 8, total: 'avg' },
            { key: `grade_${sid}`, label: 'Gr', type: 'string', width: 5 },
          ]),
          { key: 'meanPercent', label: 'Mean', type: 'percent', width: 8, total: 'avg' },
          { key: 'aggregate', label: 'Agg', type: 'int', width: 6 },
          { key: 'division', label: 'Div', type: 'string', width: 6 },
          { key: 'classRank', label: 'Pos', type: 'int', width: 6 },
        ];

        return {
          rows,
          columns,
          caption: `Result set revision ${rs.revision} · status ${rs.status}`,
          notes: rs.status !== 'published'
            ? [`This result set is "${rs.status}", not published. Figures may still change.`]
            : [],
        };
      },
    },

    {
      key: 'academics.subject-performance',
      title: 'Subject Performance',
      domain: 'academics',
      description: 'Mean, median and pass rate per subject for a result set.',
      permission: PERMISSIONS.school.readAnalytics,
      shape: 'table',
      filters: ['resultSetId', 'termId'],
      requiredFilters: ['resultSetId'],
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'mean', order: 'desc' },
      columns: [
        { key: 'subjectName', label: 'Subject', type: 'string', width: 24 },
        { key: 'count', label: 'Pupils', type: 'int', width: 10, total: 'sum' },
        { key: 'mean', label: 'Mean', type: 'percent', width: 10, total: 'avg' },
        { key: 'median', label: 'Median', type: 'percent', width: 10 },
        { key: 'passRate', label: 'Pass rate', type: 'percent', width: 12, total: 'avg' },
      ],
      async run(ctx, params) {
        const result = await deps.analytics.subjectPerformance(params.resultSetId);
        const names = await deps.resolver.subjectNames(result.subjects.map((s: any) => s.subjectId));
        return {
          rows: result.subjects.map((s: any) => ({
            ...s,
            subjectName: names.get(s.subjectId) ?? s.subjectId,
          })),
          caption: `Result set revision ${result.resultSetRevision}`,
        };
      },
    },

    {
      key: 'academics.at-risk',
      title: 'At-Risk Students',
      domain: 'academics',
      description:
        'Pupils flagged for intervention, each with the rule that flagged them — not a bare score.',
      permission: PERMISSIONS.school.readAnalytics,
      shape: 'table',
      filters: ['resultSetId', 'termId'],
      requiredFilters: ['resultSetId'],
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'meanPercent', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'meanPercent', label: 'Mean', type: 'percent', width: 10 },
        { key: 'failingSubjects', label: 'Failing', type: 'int', width: 9 },
        { key: 'reasons', label: 'Why flagged', type: 'string', width: 34 },
      ],
      async run(ctx, params) {
        const result = await deps.analytics.atRisk(params.resultSetId);
        return {
          rows: result.register.map((r: any) => ({
            ...r,
            // The rules are the point of this report — keep them readable.
            reasons: Array.isArray(r.reasons) ? r.reasons.join(', ') : String(r.reasons ?? ''),
          })),
          caption: `Pass mark ${result.passMark}% · result set revision ${result.resultSetRevision}`,
        };
      },
    },

    {
      key: 'academics.report-card',
      title: 'Student Report Card',
      domain: 'academics',
      description: 'Official report card PDF for one pupil (or a whole class) using the school\'s configured template. Lists pupils with their report card status; click a row to generate the PDF.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['studentProfileId', 'resultSetId', 'termId', 'classId', 'classBasis'],
      requiredFilters: ['resultSetId'],
      classBasisDefault: 'roster',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 600,
      defaultSort: { key: 'classRank', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Adm No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'className', label: 'Class', type: 'string', width: 12 },
        { key: 'meanPercent', label: 'Mean', type: 'percent', width: 10 },
        { key: 'classRank', label: 'Pos', type: 'int', width: 8 },
        { key: 'hasReportCard', label: 'Ready', type: 'bool', width: 8 },
        { key: 'reportCardId', label: 'Card ID', type: 'string', width: 16, hideOn: ['screen'] },
      ],
      async run(ctx, params) {
        // If studentProfileId is provided, render single card; otherwise render all in class
        const rs = await deps.resultRun.findResultSet(params.resultSetId);
        if (!rs) {
          return { rows: [], notes: ['Result set not found.'] };
        }

        const rsWithRelations = rs as any;
        // Resolve the student set (roster-based = frozen academic membership)
        const studentIds = (rsWithRelations.termResults ?? []).map((t: any) => t.studentProfileId);
        const directory = await deps.resolver.studentDirectory(studentIds);

        let targetIds: string[];
        if (params.studentProfileId) {
          targetIds = [params.studentProfileId];
        } else {
          // Filter by class if provided
          const classIds = ctx.resolved.classIds;
          targetIds = studentIds.filter((id: string) => {
            const d = directory.get(id);
            return classIds?.length ? classIds.includes(d?.classId ?? '') : true;
          });
        }

        if (targetIds.length === 0) {
          return { rows: [], notes: ['No pupils match the filters.'] };
        }

        // Find existing report cards for these students
        const reportCards = await (deps.reportCardPdf as any).prisma.client.reportCard.findMany({
          where: { studentProfileId: { in: targetIds }, termId: rs.termId },
          orderBy: { generatedAt: 'desc' },
        });
        const cardByStudent = new Map<string, string>();
        for (const card of reportCards) {
          if (!cardByStudent.has(card.studentProfileId)) {
            cardByStudent.set(card.studentProfileId, card.id);
          }
        }

        // For catalogue display, show the pupils with their stats
        const rows = targetIds.map((id: string) => {
          const d = directory.get(id);
          const tr = (rsWithRelations.termResults ?? []).find((t: any) => t.studentProfileId === id);
          return {
            studentProfileId: id,
            admissionNo: d?.admissionNo ?? '',
            studentName: d?.name ?? id,
            className: d?.className ?? '',
            meanPercent: tr?.meanPercent == null ? null : Number(tr.meanPercent),
            classRank: tr?.classRank == null ? null : Number(tr.classRank),
            hasReportCard: cardByStudent.has(id),
            reportCardId: cardByStudent.get(id) ?? '',
          };
        });

        const readyCount = rows.filter((r) => r.hasReportCard).length;
        return {
          rows,
          caption: `Report cards for result set revision ${rs.revision} · ${readyCount}/${rows.length} ready`,
          notes: [
            ...(rs.status !== 'published'
              ? [`This result set is "${rs.status}", not published. Figures may still change.`]
              : []),
            ...(readyCount < rows.length
              ? [`${rows.length - readyCount} pupil(s) have no report card yet — generate from Examinations module.`]
              : []),
          ],
        };
      },
    },

    // ==================== PHASE 2 — MANAGEMENT REPORTS ====================

    {
      key: 'academics.performance-summary',
      title: 'Academic Performance Summary',
      domain: 'academics',
      description: 'Term-over-term class performance: mean, pass rate, top/bottom performers, and subject-level breakdown.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['academicYearId', 'termId', 'campusId', 'gradeLevelId', 'classId', 'classBasis'],
      classBasisDefault: 'roster',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 1_000,
      defaultSort: { key: 'termName', order: 'asc' },
      columns: [
        { key: 'termName', label: 'Term', type: 'string', width: 16 },
        { key: 'academicYearName', label: 'Academic Year', type: 'string', width: 16 },
        { key: 'className', label: 'Class', type: 'string', width: 16 },
        { key: 'gradeLevelName', label: 'Grade', type: 'string', width: 12 },
        { key: 'pupils', label: 'Pupils', type: 'int', width: 8, total: 'sum' },
        { key: 'meanPercent', label: 'Mean %', type: 'percent', width: 10, total: 'avg' },
        { key: 'passRate', label: 'Pass Rate %', type: 'percent', width: 12, total: 'avg' },
        { key: 'distinctions', label: 'Distinctions', type: 'int', width: 12, total: 'sum' },
        { key: 'credits', label: 'Credits', type: 'int', width: 10, total: 'sum' },
        { key: 'passes', label: 'Passes', type: 'int', width: 10, total: 'sum' },
        { key: 'fails', label: 'Fails', type: 'int', width: 8, total: 'sum' },
        { key: 'topStudent', label: 'Top Student', type: 'string', width: 20 },
        { key: 'topMean', label: 'Top Mean %', type: 'percent', width: 12 },
      ],
      async run(ctx) {
        const academicYearId = ctx.resolved.academicYearId;
        const classIds = ctx.resolved.classIds;

        if (!academicYearId) {
          return { rows: [], notes: ['Select an academic year to see performance trends.'] };
        }

        // Get all terms for this academic year
        const terms = await (deps.analytics as any).prisma.client.term.findMany({
          where: { academicYearId, organizationId: ctx.organizationId },
          orderBy: { startDate: 'asc' },
          include: { academicYear: true },
        });

        if (terms.length === 0) {
          return { rows: [], notes: ['No terms found for this academic year.'] };
        }

        // Get classes in scope
        const classes = await deps.resolver.classesWithCapacity(classIds);
        const scopedClassIds = classes.map((c: any) => c.id);

        const rows: any[] = [];

        for (const term of terms) {
          // Find published result sets for this term
          const resultSets = await (deps.analytics as any).prisma.client.resultSet.findMany({
            where: {
              organizationId: ctx.organizationId,
              termId: term.id,
              scopeType: 'class',
              scopeId: { in: scopedClassIds },
              status: 'published',
            },
            include: { termResults: true, subjectResults: true },
            orderBy: { revision: 'desc' },
          });

          // Group by class (take latest revision per class)
          const latestByClass = new Map<string, any>();
          for (const rs of resultSets) {
            if (!latestByClass.has(rs.scopeId)) {
              latestByClass.set(rs.scopeId, rs);
            }
          }

          for (const classId of scopedClassIds) {
            const classInfo = classes.find((c: any) => c.id === classId);
            const rs = latestByClass.get(classId);
            if (!rs) {
              rows.push({
                termName: term.name,
                academicYearName: term.academicYear?.name ?? '',
                classId,
                className: classInfo?.name ?? classId,
                gradeLevelName: classInfo?.gradeLevelName ?? '',
                pupils: 0,
                meanPercent: null,
                passRate: null,
                distinctions: 0,
                credits: 0,
                passes: 0,
                fails: 0,
                topStudent: '',
                topMean: null,
              });
              continue;
            }

            const termResults = rs.termResults as any[];
            const subjectResults = rs.subjectResults as any[];
            const subjectIds = [...new Set(subjectResults.map((s: any) => s.subjectId))];
            const names = await deps.resolver.subjectNames(subjectIds);

            const bySubject = new Map<string, Map<string, any>>();
            for (const sr of subjectResults) {
              if (!bySubject.has(sr.studentProfileId)) bySubject.set(sr.studentProfileId, new Map());
              bySubject.get(sr.studentProfileId)!.set(sr.subjectId, sr);
            }

            let totalMean = 0;
            let passCount = 0;
            let distinctions = 0, credits = 0, passes = 0, fails = 0;
            let topStudent = '';
            let topMean = 0;

            for (const tr of termResults) {
              const mean = tr.meanPercent == null ? 0 : Number(tr.meanPercent);
              totalMean += mean;
              if (mean >= 50) passCount++;
              if (mean >= 80) distinctions++;
              else if (mean >= 65) credits++;
              else if (mean >= 50) passes++;
              else fails++;

              if (mean > topMean) {
                topMean = mean;
                const d = await deps.resolver.studentDirectory([tr.studentProfileId]);
                const student = d.get(tr.studentProfileId);
                topStudent = student?.name ?? tr.studentProfileId;
              }
            }

            const pupils = termResults.length;
            const meanPercent = pupils > 0 ? totalMean / pupils : 0;
            const passRate = pupils > 0 ? (passCount / pupils) * 100 : 0;

            rows.push({
              termName: term.name,
              academicYearName: term.academicYear?.name ?? '',
              classId,
              className: classInfo?.name ?? classId,
              gradeLevelName: classInfo?.gradeLevelName ?? '',
              pupils,
              meanPercent,
              passRate,
              distinctions,
              credits,
              passes,
              fails,
              topStudent,
              topMean,
            });
          }
        }

        return {
          rows,
          caption: `Performance summary for ${terms.length} term(s) · ${scopedClassIds.length} class(es)`,
        };
      },
    },
  ];
}
