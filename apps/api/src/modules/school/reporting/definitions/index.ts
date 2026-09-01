import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { SchoolReportDeps } from '../school-report-deps';
import { academicsReports } from './academics.reports';
import { admissionsReports } from './admissions.reports';
import { attendanceReports } from './attendance.reports';
import { curriculumReports } from './curriculum.reports';
import { enrollmentReports } from './enrollment.reports';
import { feesReports } from './fees.reports';
import { financeReports } from './finance.reports';
import { studentReports } from './student.reports';
import { teacherReports } from './teacher.reports';
import { timetableReports } from './timetable.reports';

/**
 * The school report catalogue.
 *
 * Adding a report is adding one entry to one of these files — no controller, no
 * route, no page, no export code. The catalogue, the filter bar, the table, the
 * CSV/XLSX/PDF exports and the permission check all come from the entry itself.
 *
 * Phase 1 ships the fourteen reports a school opens daily. Phases 2–4 (admissions,
 * timetable, meals, inventory, LMS, GL, audit, saved/scheduled) add files here
 * against the same contract.
 */
export function buildSchoolReportDefinitions(deps: SchoolReportDeps): ReportDefinition<any>[] {
  const defs = [
    ...studentReports(deps),
    ...enrollmentReports(deps),
    ...attendanceReports(deps),
    ...feesReports(deps),
    ...academicsReports(deps),
    ...teacherReports(deps),
    ...admissionsReports(deps),
    ...timetableReports(deps),
    ...curriculumReports(deps),
    ...financeReports(deps),
  ];

  // Fail at boot, not on the click. A shadowed key is a report that silently
  // stops matching its own test.
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.key)) throw new Error(`Duplicate school report key "${d.key}"`);
    seen.add(d.key);
  }
  return defs;
}
