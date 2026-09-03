import { PERMISSIONS } from '@erp/shared';
import type { ReportColumn, ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';
import type { ResultSet } from '@prisma/client';

/**
 * Teacher-specific reports.
 *
 * These reports use the 'staff' domain and are scoped to the teacher's own
 * classes/subjects via data scoping. A teacher with `class` or `own` data scope
 * will only see their assigned classes.
 */
export function teacherReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    // ==================== TEACHER ATTENDANCE ====================
    {
      key: 'staff.my-attendance-register',
      title: 'My Attendance Register',
      domain: 'staff',
      description: 'Daily register for my assigned class(es). Pre-filters to my classes.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['dateFrom', 'termId', 'classId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'admissionNo', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Adm No', type: 'string', width: 10 },
        { key: 'studentName', label: 'Name', type: 'string', width: 26 },
        { key: 'status', label: 'Status', type: 'enum', width: 12 },
        { key: 'statusLabel', label: 'Meaning', type: 'string', width: 14 },
        { key: 'remarks', label: 'Remarks', type: 'string', width: 24 },
      ],
      async run(ctx, params) {
        const classIds = ctx.resolved.classIds;
        if (!classIds?.length) {
          return { rows: [], notes: ['No classes assigned to you.'] };
        }
        const classId = params.classId ?? classIds[0];
        const date = params.dateFrom ? new Date(params.dateFrom) : new Date();
        date.setHours(0, 0, 0, 0);
        const rows = await deps.attendance.dailyRegister(classId, date);

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
      key: 'staff.my-attendance-summary',
      title: 'My Class Attendance Summary',
      domain: 'staff',
      description: 'Attendance trends for my class(es) over a date range.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['dateFrom', 'dateTo', 'termId', 'classId'],
      requiredFilters: ['dateFrom', 'dateTo'],
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
        { key: 'attendanceRate', label: 'Attendance %', type: 'percent', width: 12, total: 'avg' },
      ],
      async run(ctx, params) {
        const classIds = ctx.resolved.classIds;
        if (!classIds?.length) {
          return { rows: [], notes: ['No classes assigned to you.'] };
        }
        const classId = params.classId ?? classIds[0];
        const report = await deps.attendance.report(classId, params.dateFrom, params.dateTo);

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

    // ==================== TEACHER CLASS LIST ====================
    {
      key: 'staff.my-class-list',
      title: 'My Class List',
      domain: 'staff',
      description: 'All pupils in my assigned class(es) with key details.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['termId', 'status', 'gender', 'residenceType', 'house', 'classId', 'sectionId', 'streamId', 'search'],
      classBasisDefault: 'enrollment',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'admissionNo', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Adm No', type: 'string', width: 10,
          link: { route: '/school/students/:studentProfileId', paramFrom: { studentProfileId: 'studentProfileId' } } },
        { key: 'studentName', label: 'Name', type: 'string', width: 24 },
        { key: 'gender', label: 'Gender', type: 'string', width: 8 },
        { key: 'className', label: 'Class', type: 'string', width: 12 },
        { key: 'sectionName', label: 'Section', type: 'string', width: 10 },
        { key: 'streamName', label: 'Stream', type: 'string', width: 10 },
        { key: 'rollNumber', label: 'Roll No', type: 'string', width: 8 },
        { key: 'residenceType', label: 'Residence', type: 'string', width: 10 },
        { key: 'house', label: 'House', type: 'string', width: 10 },
        { key: 'status', label: 'Status', type: 'enum', width: 10 },
        { key: 'enrolledAt', label: 'Enrolled', type: 'date', width: 12 },
      ],
      async run(ctx, params) {
        const classIds = ctx.resolved.classIds;
        if (!classIds?.length) {
          return { rows: [], notes: ['No classes assigned to you.'] };
        }

        const termId = ctx.resolved.termId;
        if (!termId) {
          return { rows: [], notes: ['No term is marked current, and none was selected.'] };
        }

        const rows = await deps.enrollment.list(ctx.organizationId, {
          termId,
          status: params.status?.length === 1 ? params.status[0] : undefined,
        });

        const search = params.search?.trim().toLowerCase();

        const mapped = rows
          .filter((e: any) => classIds.includes(e.classId))
          .filter((e: any) => (params.sectionId ? e.sectionId === params.sectionId : true))
          .filter((e: any) => (params.streamId ? e.streamId === params.streamId : true))
          .filter((e: any) => (params.status?.length ? params.status.includes(e.status) : true))
          .filter((e: any) => (params.gender ? e.student?.gender === params.gender : true))
          .filter((e: any) => (params.residenceType ? e.student?.residenceType === params.residenceType : true))
          .filter((e: any) => (params.house ? e.student?.house === params.house : true))
          .map((e: any) => ({
            studentProfileId: e.studentProfileId,
            admissionNo: e.student?.admissionNo ?? '',
            studentName: e.student?.partner?.name ?? e.student?.admissionNo ?? '',
            gender: e.student?.gender ?? '',
            className: e.schoolClass?.name ?? '',
            sectionName: e.section?.name ?? '',
            streamName: e.stream?.name ?? '',
            rollNumber: e.rollNumber ?? '',
            residenceType: e.student?.residenceType ?? '',
            house: e.student?.house ?? '',
            status: e.status,
            enrolledAt: e.enrolledAt,
            termName: e.term?.name ?? '',
          }))
          .filter((r) =>
            !search
            || r.studentName.toLowerCase().includes(search)
            || r.admissionNo.toLowerCase().includes(search));

        return {
          rows: mapped,
          caption: mapped[0]?.termName ? `Term: ${mapped[0].termName}` : undefined,
        };
      },
    },

    // ==================== TEACHER SUBJECT PERFORMANCE ====================
    {
      key: 'academics.my-subject-performance',
      title: 'My Subject Performance',
      domain: 'academics',
      description: 'Performance analysis for my subject(s) across my class(es).',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['resultSetId', 'termId', 'classId'],
      requiredFilters: ['resultSetId'],
      classBasisDefault: 'roster',
      asOfMode: 'live',
      paging: 'memory',
      defaultSort: { key: 'className', order: 'asc' },
      columns: [
        { key: 'className', label: 'Class', type: 'string', width: 14 },
        { key: 'subjectName', label: 'Subject', type: 'string', width: 18 },
        { key: 'pupils', label: 'Pupils', type: 'int', width: 8, total: 'sum' },
        { key: 'mean', label: 'Mean %', type: 'percent', width: 10, total: 'avg' },
        { key: 'median', label: 'Median %', type: 'percent', width: 10 },
        { key: 'passRate', label: 'Pass Rate %', type: 'percent', width: 12, total: 'avg' },
        { key: 'distinctions', label: 'Distinctions', type: 'int', width: 12, total: 'sum' },
        { key: 'credits', label: 'Credits', type: 'int', width: 10, total: 'sum' },
        { key: 'passes', label: 'Passes', type: 'int', width: 10, total: 'sum' },
        { key: 'fails', label: 'Fails', type: 'int', width: 8, total: 'sum' },
      ],
      async run(ctx, params) {
        const classIds = ctx.resolved.classIds;
        if (!classIds?.length) {
          return { rows: [], notes: ['No classes assigned to you.'] };
        }

        const rs = await deps.resultRun.findResultSet(params.resultSetId);
        const rsWithRelations = rs as ResultSet & { subjectResults: any[]; termResults: any[] };
        const subjectIds = [...new Set(rsWithRelations.subjectResults.map((r) => r.subjectId))];
        const names = await deps.resolver.subjectNames(subjectIds);

        const studentIds = rsWithRelations.termResults
          .filter((t: any) => classIds.includes(t.studentProfile?.currentClassId ?? ''))
          .map((t: any) => t.studentProfileId);

        const subjectResults = rsWithRelations.subjectResults.filter((s: any) => studentIds.includes(s.studentProfileId));

        const bySubject = new Map<string, any[]>();
        for (const sr of subjectResults) {
          const key = sr.subjectId;
          if (!bySubject.has(key)) bySubject.set(key, []);
          bySubject.get(key)!.push(sr);
        }

        const rows = [];
        for (const [subjectId, results] of bySubject) {
          const scores = results.map((r) => r.finalPercent).filter((v: any) => v != null) as number[];
          const sorted = [...scores].sort((a, b) => a - b);
          const count = scores.length;
          if (count === 0) continue;

          const mean = scores.reduce((a, b) => a + b, 0) / count;
          const median = sorted[Math.floor(count / 2)];
          const passMark = 50;
          const passRate = (scores.filter((s) => s >= passMark).length / count) * 100;
          const distinctions = scores.filter((s) => s >= 80).length;
          const credits = scores.filter((s) => s >= 65 && s < 80).length;
          const passes = scores.filter((s) => s >= 50 && s < 65).length;
          const fails = scores.filter((s) => s < 50).length;

          rows.push({
            subjectId,
            subjectName: names.get(subjectId) ?? subjectId,
            className: 'All My Classes',
            pupils: count,
            mean,
            median,
            passRate,
            distinctions,
            credits,
            passes,
            fails,
          });
        }

        return {
          rows,
          caption: `Result set revision ${rs.revision} · status ${rs.status}`,
          notes: rs.status !== 'published'
            ? [`This result set is "${rs.status}", not published. Figures may still change.`]
            : [],
        };
      },
    },

    // ==================== PHASE 2 — MANAGEMENT REPORTS ====================

    {
      key: 'staff.workload',
      title: 'Teacher Workload',
      domain: 'staff',
      description: 'Timetable load, teaching hours, subject assignments, and class counts per teacher.',
      permission: PERMISSIONS.school.readReports,
      alsoRequires: [PERMISSIONS.school.readAnalytics],
      shape: 'table',
      filters: ['termId', 'campusId', 'gradeLevelId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 500,
      defaultSort: { key: 'periodsPerWeek', order: 'desc' },
      columns: [
        { key: 'teacherName', label: 'Teacher', type: 'string', width: 24 },
        { key: 'staffNumber', label: 'Staff No', type: 'string', width: 12 },
        { key: 'department', label: 'Department', type: 'string', width: 18 },
        { key: 'classesAssigned', label: 'Classes', type: 'int', width: 8, total: 'sum' },
        { key: 'subjectsTaught', label: 'Subjects', type: 'int', width: 10, total: 'sum' },
        { key: 'periodsPerWeek', label: 'Periods/Week', type: 'int', width: 12, total: 'sum' },
        { key: 'teachingHours', label: 'Hours/Week', type: 'int', width: 12 },
        { key: 'classDetails', label: 'Classes Taught', type: 'string', width: 40 },
      ],
      async run(ctx) {
        const classIds = ctx.resolved.classIds;
        const organizationId = ctx.organizationId;

        // `resolved.classIds` is absent when no class filter narrowed the scope,
        // and `{ in: undefined }` is a Prisma validation error rather than "all
        // classes" — which is why this report threw for an unfiltered run. Omit
        // the predicate entirely in that case; the tenancy extension still scopes
        // the query to the organization.
        // RPT-01: reads go through the canonical lookup surface. The include
        // shape (teacher → partner + department, schoolClass → gradeLevel) now
        // lives there, so every report sees the same slot.
        const slots = await deps.lookup.timetableSlotsDetailed({ classIds });

        // Group by teacher
        const byTeacher = new Map<string, any>();
        for (const slot of slots) {
          const tpId = slot.teacherPartnerId;
          if (!tpId) continue;
          const entry = byTeacher.get(tpId) ?? {
            teacherPartnerId: tpId,
            teacherName: slot.teacher?.partner?.name ?? '',
            staffNumber: slot.teacher?.employeeNo ?? '',
            department: slot.teacher?.department?.name ?? '',
            subjects: new Set<string>(),
            classes: new Set<string>(),
            classDetails: new Map<string, string>(),
            periodCount: 0,
          };
          entry.subjects.add(slot.subject?.name ?? '');
          entry.classes.add(slot.schoolClass?.name ?? '');
          entry.classDetails.set(slot.schoolClass?.name ?? '', slot.subject?.name ?? '');
          entry.periodCount += 1;
          byTeacher.set(tpId, entry);
        }

        // Get period duration for hours calculation
        const periods = await deps.lookup.periods();
        const periodMinutes = periods.reduce((sum: number, p: any) => sum + (Number(p.durationMinutes) || 40), 0);
        const avgPeriodMin = periods.length > 0 ? periodMinutes / periods.length : 40;

        const rows = Array.from(byTeacher.values()).map((t) => ({
          teacherPartnerId: t.teacherPartnerId,
          teacherName: t.teacherName,
          staffNumber: t.staffNumber,
          department: t.department,
          classesAssigned: t.classes.size,
          subjectsTaught: t.subjects.size,
          periodsPerWeek: t.periodCount,
          teachingHours: Math.round((t.periodCount * avgPeriodMin) / 60),
          classDetails: (Array.from(t.classDetails.entries()) as [string, string][])
            .map((entry: [string, string]) => `${entry[0]} (${entry[1]})`)
            .join(', '),
        }));

        return {
          rows,
          caption: `Teacher workload for ${rows.length} teacher(s) · ${classIds?.length ?? 0} class(es) in scope`,
        };
      },
    },
  ];
}