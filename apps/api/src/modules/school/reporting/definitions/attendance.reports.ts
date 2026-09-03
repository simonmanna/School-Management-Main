import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Attendance-domain reports.
 *
 * Present/absent/late are NEVER decided from a string literal here. Schools
 * configure their own status codes (`AttendanceStatusConfig`), and a report that
 * hardcodes `status === 'present'` silently reports zero attendance the day a
 * school renames its codes or adds "sick — excused". The semantics come from the
 * config's `isPresent` / `isAbsent` / `isLate` flags, which is what
 * StudentAttendanceService.report already does internally.
 */
export function attendanceReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'attendance.daily-register',
      title: 'Daily Attendance Register',
      domain: 'attendance',
      description: 'The register for one class on one day, pupil by pupil.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['classId', 'dateFrom', 'termId'],
      requiredFilters: ['classId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'admissionNo', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 26 },
        { key: 'status', label: 'Status', type: 'enum', width: 12 },
        { key: 'statusLabel', label: 'Meaning', type: 'string', width: 14 },
        { key: 'remarks', label: 'Remarks', type: 'string', width: 24 },
      ],
      async run(ctx, params) {
        // The register is for a DAY: dateFrom is that day, defaulting to today.
        const date = params.dateFrom ? new Date(params.dateFrom) : new Date();
        date.setHours(0, 0, 0, 0);
        const rows = await deps.attendance.dailyRegister(params.classId, date);

        return {
          rows: rows.map((r: any) => ({
            studentProfileId: r.studentProfileId,
            admissionNo: r.studentProfile?.admissionNo ?? '',
            studentName: r.studentProfile?.partner?.name ?? r.studentProfile?.admissionNo ?? '',
            status: r.status,
            statusLabel: r.statusConfig?.label ?? r.status,
            remarks: r.remarks ?? r.notes ?? '',
          })),
          caption: `Register for ${date.toISOString().slice(0, 10)}`,
          notes: rows.length === 0
            ? ['No register has been marked for this class on this date.']
            : [],
        };
      },
    },

    {
      key: 'attendance.class-summary',
      title: 'Class Attendance Summary',
      domain: 'attendance',
      description: 'Present, absent and late totals per day for a class over a date range.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['classId', 'dateFrom', 'dateTo', 'termId'],
      requiredFilters: ['classId', 'dateFrom', 'dateTo'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'date', order: 'asc' },
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 12 },
        { key: 'day', label: 'Day', type: 'string', width: 8 },
        { key: 'marked', label: 'Marked', type: 'int', width: 10, total: 'sum' },
        { key: 'present', label: 'Present', type: 'int', width: 10, total: 'sum' },
        { key: 'late', label: 'Late', type: 'int', width: 8, total: 'sum' },
        { key: 'absent', label: 'Absent', type: 'int', width: 10, total: 'sum' },
        { key: 'attendanceRate', label: 'Attendance', type: 'percent', width: 12, total: 'avg' },
      ],
      async run(ctx, params) {
        const report = await deps.attendance.report(params.classId, params.dateFrom, params.dateTo);

        // Reuse the service's own status catalogue rather than re-deciding what
        // "present" means. isLate counts as attending — a late pupil is at school.
        const byCode = new Map<string, any>(report.statuses.map((c: any) => [c.code, c]));
        const rows = report.byDate.map((d: any) => {
          let present = 0; let late = 0; let absent = 0;
          for (const [code, n] of Object.entries(d.counts as Record<string, number>)) {
            const cfg = byCode.get(code);
            if (cfg?.isPresent) present += n;
            else if (cfg?.isLate) late += n;
            else if (cfg?.isAbsent) absent += n;
          }
          const attending = present + late;
          return {
            date: d.date,
            day: d.day,
            marked: d.total,
            present,
            late,
            absent,
            attendanceRate: d.total > 0 ? (attending / d.total) * 100 : 0,
          };
        });

        const s = report.summary;
        const overall = s.total > 0 ? ((s.present + s.late) / s.total) * 100 : 0;
        return {
          rows,
          caption: `Overall attendance ${Math.round(overall * 10) / 10}% across ${s.total} marks`,
        };
      },
    },

    {
      key: 'attendance.below-threshold',
      title: 'Students Below Attendance Threshold',
      domain: 'attendance',
      description:
        'Pupils whose attendance has fallen under the configured minimum — the intervention list.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['classId', 'campusId', 'gradeLevelId', 'dateFrom', 'dateTo'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'attendancePercent', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12 },
        { key: 'studentName', label: 'Name', type: 'string', width: 26 },
        { key: 'className', label: 'Class', type: 'string', width: 12 },
        { key: 'attendancePercent', label: 'Attendance', type: 'percent', width: 12 },
        { key: 'shortfall', label: 'Below by', type: 'percent', width: 12 },
      ],
      async run(ctx, params) {
        // The service takes a day count; derive it from the window so the filter
        // bar stays date-based like every other report.
        const window = ctx.resolved.window;
        const days = window
          ? Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000))
          : 30;

        const { floor, flagged } = await deps.attendance.belowThresholdStudents(
          ctx.organizationId,
          days,
          params.classId ?? null,
        );

        const directory = await deps.resolver.studentDirectory(
          flagged.map((f: any) => f.studentProfileId),
        );
        const classIds = ctx.resolved.classIds;

        const rows = flagged
          .map((f: any) => {
            const d = directory.get(f.studentProfileId);
            return {
              studentProfileId: f.studentProfileId,
              admissionNo: d?.admissionNo ?? '',
              studentName: d?.name ?? f.studentProfileId,
              className: d?.className ?? '',
              classId: d?.classId ?? null,
              attendancePercent: f.pct,
              shortfall: Math.round((floor - f.pct) * 100) / 100,
            };
          })
          // belowThresholdStudents only narrows by a single classId; campus and
          // grade filters (and the caller's data scope) are applied here.
          .filter((r) => (classIds ? (r.classId ? classIds.includes(r.classId) : false) : true));

        return {
          rows,
          caption: `Threshold ${floor}% over the last ${days} day(s)`,
        };
      },
    },

    {
      key: 'attendance.student-history',
      title: 'Student Attendance History',
      description: 'Attendance record for one pupil across a date range — every day, every status, running total.',
      domain: 'attendance',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['studentProfileId', 'dateFrom', 'dateTo', 'termId'],
      requiredFilters: ['studentProfileId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 200,
      defaultSort: { key: 'date', order: 'desc' },
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 14 },
        { key: 'day', label: 'Day', type: 'string', width: 10 },
        { key: 'statusLabel', label: 'Status', type: 'string', width: 12 },
        { key: 'statusConfig', label: 'Meaning', type: 'string', width: 14 },
        { key: 'remarks', label: 'Remarks', type: 'string', width: 38 },
      ],
      async run(ctx, params) {
        const dateFrom = params.dateFrom ? new Date(params.dateFrom) : new Date();
        const dateTo = params.dateTo ? new Date(params.dateTo) : new Date();
        dateFrom.setHours(0, 0, 0, 0);
        dateTo.setHours(0, 0, 0, 0);

        // Resolve the pupil's current class via the directory resolver, which
        // already joins StudentProfile → Student → Person and current enrolment.
        const dir = await deps.resolver.studentDirectory([params.studentProfileId]);
        const profile = dir.get(params.studentProfileId);
        if (!profile) {
          return {
            rows: [],
            notes: [`No student found with id ${params.studentProfileId}.`],
          };
        }

        const rows: any[] = [];
        for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
          const day = new Date(d);
          const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });

          const classId = profile.classId;
          if (!classId) {
            rows.push({
              date: day.toISOString().slice(0, 10),
              day: dayName,
              statusLabel: null,
              statusConfig: null,
              remarks: 'No class enrolled',
            });
            continue;
          }

          const dayRegister = await deps.attendance.dailyRegister(classId, day);
          const pupilRow = dayRegister.find(
            (r: any) => r.studentProfileId === params.studentProfileId,
          );

          if (!pupilRow) {
            rows.push({
              date: day.toISOString().slice(0, 10),
              day: dayName,
              statusLabel: null,
              statusConfig: null,
              remarks: 'No record',
            });
          } else {
            rows.push({
              date: day.toISOString().slice(0, 10),
              day: dayName,
              statusLabel: pupilRow.status,
              statusConfig: pupilRow.statusConfig?.label ?? pupilRow.status,
              remarks: (pupilRow as any).remarks ?? '',
            });
          }
        }

        return {
          rows,
          caption: `Attendance history for ${profile.name ?? params.studentProfileId}`,
        };
      },
    },

    // ==================== PHASE 2 — MANAGEMENT REPORTS ====================

    {
      key: 'attendance.trends',
      title: 'Attendance Trends',
      domain: 'attendance',
      description: 'Term-over-term attendance rates by class/grade, with present/absent/late breakdown and trend direction.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['academicYearId', 'termId', 'campusId', 'gradeLevelId', 'classId', 'classBasis'],
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
        { key: 'totalMarks', label: 'Total Marks', type: 'int', width: 12, total: 'sum' },
        { key: 'present', label: 'Present', type: 'int', width: 10, total: 'sum' },
        { key: 'late', label: 'Late', type: 'int', width: 8, total: 'sum' },
        { key: 'absent', label: 'Absent', type: 'int', width: 10, total: 'sum' },
        { key: 'attendanceRate', label: 'Attendance %', type: 'percent', width: 12, total: 'avg' },
        { key: 'trend', label: 'Trend', type: 'string', width: 10 },
      ],
      async run(ctx) {
        const academicYearId = ctx.resolved.academicYearId;
        const classIds = ctx.resolved.classIds;

        if (!academicYearId) {
          return { rows: [], notes: ['Select an academic year to see trends.'] };
        }

        // Get all terms for this academic year
        const terms = await (deps.attendance as any).prisma.client.term.findMany({
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
        const prevRate: Record<string, number> = {};

        for (const term of terms) {
          for (const classId of scopedClassIds) {
            const classInfo = classes.find((c: any) => c.id === classId);
            if (!classInfo) continue;

            // Get attendance report for this class for the full term
            const report = await deps.attendance.report(classId, term.startDate, term.endDate);

            // Reuse the service's own status catalogue
            const byCode = new Map<string, any>(report.statuses.map((c: any) => [c.code, c]));
            let present = 0, late = 0, absent = 0, total = 0;
            for (const d of report.byDate) {
              for (const [code, n] of Object.entries(d.counts as Record<string, number>)) {
                const cfg = byCode.get(code);
                if (cfg?.isPresent) present += n;
                else if (cfg?.isLate) late += n;
                else if (cfg?.isAbsent) absent += n;
                total += n;
              }
            }
            const attending = present + late;
            const rate = total > 0 ? (attending / total) * 100 : 0;
            const prev = prevRate[classId];
            let trend = '→';
            if (prev !== undefined) {
              trend = rate > prev + 0.5 ? '↑' : rate < prev - 0.5 ? '↓' : '→';
            }
            prevRate[classId] = rate;

            rows.push({
              termName: term.name,
              academicYearName: term.academicYear?.name ?? '',
              classId,
              className: classInfo.name,
              gradeLevelName: classInfo.gradeLevelName,
              campusName: classInfo.campusName,
              totalMarks: total,
              present,
              late,
              absent,
              attendanceRate: rate,
              trend,
            });
          }
        }

        return {
          rows,
          caption: `Attendance trends for ${terms.length} term(s) · ${scopedClassIds.length} class(es)`,
        };
      },
    },
  ];
}
