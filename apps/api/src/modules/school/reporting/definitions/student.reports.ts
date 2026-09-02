import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Student-domain reports.
 *
 * `student.register` is the most-used report in the building: Academic Year →
 * Term → Class → Section → Stream → Pupil → Admission No. It runs on the
 * `enrollment` basis because a register is a statement about a TERM, not about
 * where a pupil happens to be sitting today — the two diverge the moment
 * anybody is moved mid-term, and a register built on `currentClassId` would
 * quietly rewrite history every time that happened.
 */
export function studentReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'student.register',
      title: 'Student Register',
      domain: 'student',
      description:
        'Every enrolled pupil for a term, with class, section, stream and admission number.',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: [
        'academicYearId', 'termId', 'campusId', 'gradeLevelId', 'classId',
        'sectionId', 'streamId', 'status', 'gender', 'residenceType', 'house',
        'studentCategoryId', 'search', 'classBasis',
      ],
      classBasisDefault: 'enrollment',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 5_000,
      defaultSort: { key: 'admissionNo', order: 'asc' },
      columns: [
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 12,
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
        const termId = ctx.resolved.termId;
        if (!termId) {
          return {
            rows: [],
            notes: ['No term is marked current, and none was selected. Choose a term to run this register.'],
          };
        }

        const rows = await deps.enrollment.list(ctx.organizationId, {
          termId,
          status: params.status?.length === 1 ? params.status[0] : undefined,
        });

        const classIds = ctx.resolved.classIds;
        const search = params.search?.trim().toLowerCase();

        const mapped = rows
          .filter((e: any) => (classIds ? classIds.includes(e.classId) : true))
          .filter((e: any) => (params.sectionId ? e.sectionId === params.sectionId : true))
          .filter((e: any) => (params.streamId ? e.streamId === params.streamId : true))
          // Multi-value status is filtered here; the service takes only one.
          .filter((e: any) => (params.status?.length ? params.status.includes(e.status) : true))
          .filter((e: any) => (params.gender ? e.student?.gender === params.gender : true))
          .filter((e: any) => (params.residenceType ? e.student?.residenceType === params.residenceType : true))
          .filter((e: any) => (params.house ? e.student?.house === params.house : true))
          .filter((e: any) => (params.studentCategoryId ? e.student?.studentCategoryId === params.studentCategoryId : true))
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
          caption: rows[0]?.term?.name ? `Term: ${rows[0].term.name}` : undefined,
        };
      },
    },

    {
      key: 'student.profile',
      title: 'Student Profile',
      description: "A single pupil's full profile: personal data, current enrolment, contacts, and photo.",
      domain: 'student',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['studentProfileId', 'academicYearId', 'termId'],
      requiredFilters: ['studentProfileId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'none',
      defaultSort: { key: 'field', order: 'asc' },
      columns: [
        { key: 'section', label: 'Section', type: 'string', width: 20 },
        { key: 'field', label: 'Field', type: 'string', width: 20 },
        { key: 'value', label: 'Value', type: 'string', width: 40 },
      ],
      async run(ctx, params) {
        // Resolve the single pupil via the directory resolver — it already
        // joins StudentProfile → Student → Person → User and picks the current
        // enrolment for the resolved term.
        const profile = await deps.resolver.studentDirectory(
          [params.studentProfileId],
        ).then((map: any) => map.get(params.studentProfileId));

        if (!profile) {
          return {
            rows: [],
            notes: [`No student found with id ${params.studentId}.`],
          };
        }

        const rows: Array<{ section: string; field: string; value: string | null }> = [];

        // ── Personal ──
        rows.push({ section: 'Personal', field: 'Admission No', value: profile.admissionNo ?? null });
        rows.push({ section: 'Personal', field: 'Full Name', value: profile.name ?? null });
        rows.push({ section: 'Personal', field: 'Gender', value: profile.gender ?? null });
        rows.push({ section: 'Personal', field: 'Date of Birth', value: profile.dateOfBirth ?? null });
        rows.push({ section: 'Personal', field: 'Residence Type', value: profile.residenceType ?? null });
        rows.push({ section: 'Personal', field: 'House', value: profile.house ?? null });
        rows.push({ section: 'Personal', field: 'Student Category', value: profile.studentCategory ?? null });

        // ── Enrolment (current) ──
        if (profile.currentEnrolment) {
          const e = profile.currentEnrolment;
          rows.push({ section: 'Enrolment', field: 'Class', value: e.className ?? null });
          rows.push({ section: 'Enrolment', field: 'Section', value: e.sectionName ?? null });
          rows.push({ section: 'Enrolment', field: 'Stream', value: e.streamName ?? null });
          rows.push({ section: 'Enrolment', field: 'Roll No', value: e.rollNumber ?? null });
          rows.push({ section: 'Enrolment', field: 'Status', value: e.status ?? null });
          rows.push({ section: 'Enrolment', field: 'Enrolled On', value: e.enrolledAt ?? null });
        }

        // ── Contact / Guardian ──
        if (profile.guardian) {
          const g = profile.guardian;
          rows.push({ section: 'Contact', field: 'Guardian Name', value: g.name ?? null });
          rows.push({ section: 'Contact', field: 'Relationship', value: g.relationship ?? null });
          rows.push({ section: 'Contact', field: 'Phone', value: g.phone ?? null });
          rows.push({ section: 'Contact', field: 'Email', value: g.email ?? null });
          rows.push({ section: 'Contact', field: 'Address', value: g.address ?? null });
        }

        return {
          rows,
          caption: `Student profile for ${profile.name ?? profile.admissionNo ?? params.studentId}`,
        };
      },
    },
  ];
}
