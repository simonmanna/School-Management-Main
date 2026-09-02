import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Enrollment-domain reports.
 *
 * `enrollment.by-class` is the capacity view management actually asks for:
 * "P1: 48 / 50 → 96%". Capacity comes from `SchoolClass.capacity`; the head
 * count comes from Enrollment for the term, NOT from `currentClassId`, so a
 * pupil moved after enrollment does not silently inflate one class and deflate
 * another mid-term.
 */
export function enrollmentReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'enrollment.by-class',
      title: 'Enrollment Summary by Class',
      domain: 'enrollment',
      description: 'Head count against capacity for every class, with utilisation.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['academicYearId', 'termId', 'campusId', 'gradeLevelId', 'classBasis'],
      classBasisDefault: 'enrollment',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'className', order: 'asc' },
      columns: [
        { key: 'className', label: 'Class', type: 'string', width: 16,
          link: { reportKey: 'student.register', paramFrom: { classId: 'classId' } } },
        { key: 'gradeLevelName', label: 'Grade', type: 'string', width: 12 },
        { key: 'campusName', label: 'Campus', type: 'string', width: 12 },
        { key: 'enrolled', label: 'Enrolled', type: 'int', width: 10, total: 'sum' },
        { key: 'male', label: 'Male', type: 'int', width: 8, total: 'sum' },
        { key: 'female', label: 'Female', type: 'int', width: 8, total: 'sum' },
        { key: 'capacity', label: 'Capacity', type: 'int', width: 10, total: 'sum' },
        { key: 'available', label: 'Available', type: 'int', width: 10, total: 'sum' },
        { key: 'utilisation', label: 'Utilisation', type: 'percent', width: 12 },
      ],
      async run(ctx) {
        const termId = ctx.resolved.termId;
        if (!termId) {
          return {
            rows: [],
            notes: ['No term is marked current, and none was selected. Choose a term.'],
          };
        }

        const classes = await deps.resolver.classesWithCapacity(ctx.resolved.classIds);
        const enrollments = await deps.enrollment.list(ctx.organizationId, { termId, status: 'enrolled' });

        const byClass = new Map<string, { enrolled: number; male: number; female: number }>();
        for (const e of enrollments as any[]) {
          const bucket = byClass.get(e.classId) ?? { enrolled: 0, male: 0, female: 0 };
          bucket.enrolled += 1;
          if (e.student?.gender === 'male') bucket.male += 1;
          if (e.student?.gender === 'female') bucket.female += 1;
          byClass.set(e.classId, bucket);
        }

        const rows = classes.map((c) => {
          const b = byClass.get(c.id) ?? { enrolled: 0, male: 0, female: 0 };
          return {
            classId: c.id,
            className: c.name,
            gradeLevelName: c.gradeLevelName,
            campusName: c.campusName,
            enrolled: b.enrolled,
            male: b.male,
            female: b.female,
            capacity: c.capacity,
            // Negative when a class is over-subscribed — shown rather than
            // clamped to zero, because that is precisely the case to act on.
            available: c.capacity - b.enrolled,
            utilisation: c.capacity > 0 ? (b.enrolled / c.capacity) * 100 : 0,
          };
        });

        const over = rows.filter((r) => r.available < 0);
        return {
          rows,
          notes: over.length
            ? [`${over.length} class(es) are over capacity: ${over.map((r) => r.className).join(', ')}.`]
            : [],
        };
      },
    },

    // ==================== PHASE 2 — MANAGEMENT REPORTS ====================

    {
      key: 'enrollment.trends',
      title: 'Enrollment Trends',
      domain: 'enrollment',
      description: 'Term-over-term enrollment headcount by class/grade/campus, with net change and growth rate.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['academicYearId', 'campusId', 'gradeLevelId', 'classId', 'classBasis'],
      classBasisDefault: 'enrollment',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 1_000,
      defaultSort: { key: 'termName', order: 'asc' },
      columns: [
        { key: 'termName', label: 'Term', type: 'string', width: 16 },
        { key: 'academicYearName', label: 'Academic Year', type: 'string', width: 16 },
        { key: 'className', label: 'Class', type: 'string', width: 16 },
        { key: 'gradeLevelName', label: 'Grade', type: 'string', width: 12 },
        { key: 'campusName', label: 'Campus', type: 'string', width: 12 },
        { key: 'enrolled', label: 'Enrolled', type: 'int', width: 10, total: 'sum' },
        { key: 'male', label: 'Male', type: 'int', width: 8, total: 'sum' },
        { key: 'female', label: 'Female', type: 'int', width: 8, total: 'sum' },
        { key: 'capacity', label: 'Capacity', type: 'int', width: 10, total: 'sum' },
        { key: 'utilisation', label: 'Utilisation %', type: 'percent', width: 12 },
        { key: 'netChange', label: 'Net Change', type: 'int', width: 12 },
        { key: 'growthRate', label: 'Growth %', type: 'percent', width: 12 },
      ],
      async run(ctx) {
        const academicYearId = ctx.resolved.academicYearId;
        const classIds = ctx.resolved.classIds;

        if (!academicYearId) {
          return { rows: [], notes: ['Select an academic year to see trends.'] };
        }

        // Get all terms for this academic year
        const terms = await (deps.enrollment as any).prisma.client.term.findMany({
          where: { academicYearId, organizationId: ctx.organizationId },
          orderBy: { startDate: 'asc' },
        });

        if (terms.length === 0) {
          return { rows: [], notes: ['No terms found for this academic year.'] };
        }

        // Get all classes in scope
        const classes = await deps.resolver.classesWithCapacity(classIds);
        const scopedClassIds = classes.map((c: any) => c.id);

        const rows: any[] = [];
        let prevEnrolled: Record<string, number> = {};

        for (const term of terms) {
          const enrollments = await deps.enrollment.list(ctx.organizationId, {
            termId: term.id,
            status: 'enrolled',
          });

          const byClass = new Map<string, { enrolled: number; male: number; female: number }>();
          for (const e of enrollments as any[]) {
            if (scopedClassIds.length && !scopedClassIds.includes(e.classId)) continue;
            const bucket = byClass.get(e.classId) ?? { enrolled: 0, male: 0, female: 0 };
            bucket.enrolled += 1;
            if (e.student?.gender === 'male') bucket.male += 1;
            if (e.student?.gender === 'female') bucket.female += 1;
            byClass.set(e.classId, bucket);
          }

          for (const classId of scopedClassIds) {
            const classInfo = classes.find((c: any) => c.id === classId);
            const b = byClass.get(classId) ?? { enrolled: 0, male: 0, female: 0 };
            const prev = prevEnrolled[classId] ?? 0;
            const netChange = b.enrolled - prev;
            const growthRate = prev > 0 ? (netChange / prev) * 100 : 0;
            prevEnrolled[classId] = b.enrolled;

            rows.push({
              termName: term.name,
              academicYearName: term.academicYear?.name ?? '',
              classId,
              className: classInfo?.name ?? classId,
              gradeLevelName: classInfo?.gradeLevelName ?? '',
              campusName: classInfo?.campusName ?? '',
              enrolled: b.enrolled,
              male: b.male,
              female: b.female,
              capacity: classInfo?.capacity ?? 0,
              utilisation: (classInfo?.capacity ?? 0) > 0 ? (b.enrolled / (classInfo?.capacity ?? 0)) * 100 : 0,
              netChange,
              growthRate,
            });
          }
        }

        return {
          rows,
          caption: `Enrollment trends for ${terms.length} term(s) · ${scopedClassIds.length} class(es)`,
        };
      },
    },
  ];
}
