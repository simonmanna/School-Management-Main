import { PERMISSIONS } from '@erp/shared';
import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';

/**
 * Admissions-domain reports.
 *
 * Applications are queried through AdmissionsService.listWithWorkflow — never
 * raw Prisma. A report that reads `admissionApplication` directly would miss
 * the workflow resolution, the offer-letter linkage, and the audit trail that
 * `listWithWorkflow` joins in. The service is the single author of the
 * "what is this application's current state" answer.
 */
export function admissionsReports(deps: SchoolReportDeps): ReportDefinition<any>[] {
  return [
    {
      key: 'admissions.applications',
      title: 'Applications',
      description: 'All admission applications with status, class applied for, and workflow stage.',
      domain: 'admissions',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['academicYearId', 'status', 'termId', 'campusId', 'gradeLevelId', 'dateFrom', 'dateTo', 'search'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'memory',
      rowCapHint: 2_000,
      defaultSort: { key: 'applicationNumber', order: 'asc' },
      columns: [
        { key: 'applicationNumber', label: 'Application No', type: 'string', width: 16 },
        { key: 'applicantName', label: 'Applicant', type: 'string', width: 24 },
        { key: 'admissionNo', label: 'Admission No', type: 'string', width: 14 },
        { key: 'applyingForClassName', label: 'Class', type: 'string', width: 12 },
        { key: 'status', label: 'Status', type: 'enum', width: 12 },
        { key: 'submittedAt', label: 'Submitted', type: 'date', width: 12 },
        { key: 'decisionDate', label: 'Decided', type: 'date', width: 12 },
        { key: 'sourceOfEnquiry', label: 'Source', type: 'string', width: 14 },
      ],
      async run(ctx, params) {
        const { organizationId } = ctx;

        // Delegate to the canonical service for the workflow resolution, but
        // we need to filter ourselves since listWithWorkflow doesn't take
        // arbitrary filters. Use the service's list with query params.
        const query: Record<string, unknown> = { page: 1, pageSize: 1000 };
        const page = await deps.admissions.listWithWorkflow(query);

        let rows: any[] = page.data ?? [];

        // Apply filters
        if (params.academicYearId) {
          rows = rows.filter((r: any) => r.academicYearId === params.academicYearId);
        }
        if (params.status?.length) {
          rows = rows.filter((r: any) => params.status!.includes(r.status));
        }
        if (params.search) {
          const q = params.search.toLowerCase();
          rows = rows.filter((r: any) =>
            `${r.applicantFirstName} ${r.applicantLastName}`.toLowerCase().includes(q)
            || r.applicationNumber?.toLowerCase().includes(q)
            || r.admissionNo?.toLowerCase().includes(q)
          );
        }
        // Date range
        const from = params.dateFrom ? new Date(params.dateFrom) : null;
        const to = params.dateTo ? new Date(params.dateTo) : null;
        if (from || to) {
          rows = rows.filter((r: any) => {
            const d = r.submittedAt ? new Date(r.submittedAt) : null;
            if (!d) return false;
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
          });
        }

        const classIds = ctx.resolved.classIds;
        let filtered = rows;
        if (classIds) {
          filtered = rows.filter((r: any) => r.applyingForClassId && classIds.includes(r.applyingForClassId));
        }

        return {
          rows: filtered.map((r: any) => ({
            applicationNumber: r.applicationNumber ?? '',
            applicantName: `${r.applicantFirstName ?? ''} ${r.applicantLastName ?? ''}`.trim(),
            admissionNo: r.enrolledStudent?.admissionNo ?? '',
            applyingForClassName: r.applyingForClass?.name ?? '',
            status: r.status,
            submittedAt: r.submittedAt,
            decisionDate: r.decisionDate ?? null,
            sourceOfEnquiry: r.sourceOfEnquiry ?? '',
          })),
          caption: `${filtered.length} application(s)`,
        };
      },
    },

    {
      key: 'admissions.funnel',
      title: 'Admission Funnel',
      description: 'Application count at each stage of the pipeline (submitted → enrolled).',
      domain: 'admissions',
      permission: PERMISSIONS.school.readReports,
      shape: 'table',
      filters: ['academicYearId', 'termId', 'campusId', 'gradeLevelId'],
      classBasisDefault: 'current',
      asOfMode: 'live',
      paging: 'none',
      defaultSort: { key: 'stageOrder', order: 'asc' },
      columns: [
        { key: 'stage', label: 'Stage', type: 'string', width: 24 },
        { key: 'count', label: 'Applications', type: 'int', width: 12, total: 'sum' },
        { key: 'conversionPct', label: 'Conversion %', type: 'percent', width: 14 },
      ],
      async run(ctx, params) {
        const stageOrder = ['submitted', 'under_review', 'screening', 'interviewed', 'scored', 'accepted', 'offer_issued', 'offer_accepted', 'enrolled'];
        const labels: Record<string, string> = {
          submitted: 'Submitted',
          under_review: 'Under Review',
          screening: 'Screening',
          interviewed: 'Interviewed',
          scored: 'Scored',
          accepted: 'Accepted',
          offer_issued: 'Offer Issued',
          offer_accepted: 'Offer Accepted',
          enrolled: 'Enrolled',
          rejected: 'Rejected',
          waitlisted: 'Waitlisted',
          withdrawn: 'Withdrawn',
        };

        const query: Record<string, unknown> = { page: 1, pageSize: 1000 };
        const page = await deps.admissions.listWithWorkflow(query);
        let rows: any[] = page.data ?? [];

        // Filter by academic year
        if (params.academicYearId) {
          rows = rows.filter((r: any) => r.academicYearId === params.academicYearId);
        }
        // Filter by class
        const classIds = ctx.resolved.classIds;
        if (classIds) {
          rows = rows.filter((r: any) => r.applyingForClassId && classIds.includes(r.applyingForClassId));
        }

        const total = rows.length;
        const byStage: Record<string, number> = {};
        for (const r of rows) {
          byStage[r.status] = (byStage[r.status] ?? 0) + 1;
        }

        // Build the funnel: ordered stages + terminal statuses
        const funnelStages = [...stageOrder, 'rejected', 'waitlisted', 'withdrawn'] as const;
        const result: Array<Record<string, unknown>> = [];
        let cumulative = 0;
        for (const stage of funnelStages) {
          const count = byStage[stage] ?? 0;
          cumulative += count;
          result.push({
            stageOrder: funnelStages.indexOf(stage),
            stage: labels[stage] ?? stage,
            count,
            conversionPct: total > 0 ? (cumulative / total) * 100 : 0,
          });
        }

        return {
          rows: result,
          caption: `Total applications: ${total}`,
        };
      },
    },
  ];
}
