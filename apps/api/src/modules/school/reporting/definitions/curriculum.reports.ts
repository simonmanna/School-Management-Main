import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Curriculum-domain reports.
 *
 * Reads from the AcademicsService which manages curriculum versions and
 * course offerings. Coverage compares what's taught vs what's planned.
 */
export function curriculumReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'curriculum.coverage',
      title: 'Curriculum Coverage',
      domain: 'curriculum',
      description: 'Planned vs. delivered curriculum by class: topics covered, hours delivered, and gaps.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['academicYearId', 'termId', 'campusId', 'gradeLevelId', 'classId', 'classBasis'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 1_000,
      defaultSort: { key: 'className', order: 'asc' },
      columns: [
        { key: 'className', label: 'Class', type: 'string', width: 16 },
        { key: 'gradeLevelName', label: 'Grade', type: 'string', width: 12 },
        { key: 'subjectName', label: 'Subject', type: 'string', width: 20 },
        { key: 'teacherName', label: 'Teacher', type: 'string', width: 20 },
        { key: 'plannedTopics', label: 'Planned Topics', type: 'int', width: 14, total: 'sum' },
        { key: 'coveredTopics', label: 'Covered Topics', type: 'int', width: 14, total: 'sum' },
        { key: 'coveragePct', label: 'Coverage %', type: 'percent', width: 12 },
        { key: 'plannedHours', label: 'Planned Hours', type: 'int', width: 14, total: 'sum' },
        { key: 'deliveredHours', label: 'Delivered Hours', type: 'int', width: 14, total: 'sum' },
        { key: 'hoursCoverage', label: 'Hours Coverage %', type: 'percent', width: 14 },
        { key: 'status', label: 'Status', type: 'enum', width: 12 },
      ],
      async run(ctx) {
        const academicYearId = ctx.resolved.academicYearId;
        const termId = ctx.resolved.termId;
        const classIds = ctx.resolved.classIds;

        if (!academicYearId) {
          return { rows: [], notes: ['Select an academic year to see curriculum coverage.'] };
        }

        // Get published curriculum versions for these classes
        const curricula = await (deps.timetable as any).prisma.client.curriculum.findMany({
          where: {
            organizationId: ctx.organizationId,
            academicYearId,
            classId: { in: classIds },
            status: 'published',
          },
          include: {
            class: { include: { gradeLevel: true } },
            topics: { orderBy: { order: 'asc' } },
          },
        });

        if (curricula.length === 0) {
          return { rows: [], notes: ['No published curricula found for these classes.'] };
        }

        // Get timetable slots to know teacher assignments and period counts
        const slots = await (deps.timetable as any).prisma.client.timetableSlot.findMany({
          where: { classId: { in: classIds } },
          include: { subject: true, teacher: true, period: true },
        });

        // Get lesson plans for the term to see what was actually taught
        const lessonPlans = await (deps.timetable as any).prisma.client.lessonPlan.findMany({
          where: {
            organizationId: ctx.organizationId,
            classId: { in: classIds },
            termId: termId ?? undefined,
            status: { in: ['approved', 'archived'] },
          },
          include: { subject: true, class: true },
        });

        // Group lesson plans by class+subject
        const deliveredByClassSubject = new Map<string, { topics: Set<string>; hours: number }>();
        for (const lp of lessonPlans) {
          const key = `${lp.classId}|${lp.subjectId}`;
          const entry = deliveredByClassSubject.get(key) ?? { topics: new Set<string>(), hours: 0 };
          if (lp.topic) entry.topics.add(lp.topic);
          if (lp.durationMinutes) entry.hours += Math.round(lp.durationMinutes / 60);
          deliveredByClassSubject.set(key, entry);
        }

        const rows: any[] = [];

        for (const curriculum of curricula) {
          // Get subjects taught in this class
          const classSlots = slots.filter((s: any) => s.classId === curriculum.classId);
          const subjectsTaught = new Map<string, { teacherName: string; periods: number }>();

          for (const slot of classSlots) {
            const key = slot.subjectId;
            const existing = subjectsTaught.get(key);
            if (!existing || slot.teacher?.name) {
              subjectsTaught.set(key, {
                teacherName: slot.teacher?.name ?? '',
                periods: (existing?.periods ?? 0) + 1,
              });
            }
          }

          // For each subject in curriculum, check coverage
          for (const [subjectId, subjectInfo] of subjectsTaught) {
            const curriculumSubject = curriculum.topics.find((t: any) => t.subjectId === subjectId);
            const plannedTopics = curriculumSubject?.topics?.length ?? 0;
            const plannedHours = subjectInfo.periods; // approximate from timetable

            const delivered = deliveredByClassSubject.get(`${curriculum.classId}|${subjectId}`);
            const coveredTopics = delivered?.topics.size ?? 0;
            const deliveredHours = delivered?.hours ?? 0;

            const coveragePct = plannedTopics > 0 ? (coveredTopics / plannedTopics) * 100 : 0;
            const hoursCoverage = plannedHours > 0 ? (deliveredHours / plannedHours) * 100 : 0;

            let status = 'on_track';
            if (coveragePct < 50) status = 'behind';
            else if (coveragePct < 80) status = 'at_risk';

            rows.push({
              classId: curriculum.classId,
              className: curriculum.class?.name ?? '',
              gradeLevelName: curriculum.class?.gradeLevel?.name ?? '',
              subjectId,
              subjectName: curriculumSubject?.subjectName ?? subjectId,
              teacherName: subjectInfo.teacherName,
              plannedTopics,
              coveredTopics,
              coveragePct,
              plannedHours,
              deliveredHours,
              hoursCoverage,
              status,
            });
          }
        }

        return {
          rows,
          caption: `Curriculum coverage for ${curricula.length} published curricula · ${classIds?.length ?? 0} class(es)`,
        };
      },
    },
  ];
}