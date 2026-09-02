// Required before importing anything with class-validator decorators; the API
// loads it in main.ts, but a unit spec has no bootstrap.
import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { ALL_PERMISSIONS, PERMISSIONS } from '@erp/shared';
import { buildSchoolReportDefinitions } from '../../src/modules/school/reporting/definitions';
import type { SchoolReportDeps } from '../../src/modules/school/reporting/school-report-deps';
import {
  CLASS_BASES,
  REPORT_DOMAINS,
  REPORT_FILTER_KEYS,
  type ReportColumn,
} from '../../src/modules/core/reporting/report.types';
import { ReportFilterDto } from '../../src/modules/core/reporting/report-params.dto';

/**
 * Catalogue invariants, checked without a database or a Nest container.
 *
 * This spec exists because `permission-catalog-drift.spec.ts` only walks
 * `*.controller.ts`. The reporting layer deliberately has ONE controller and
 * hundreds of permission strings living in definition files, so without this the
 * per-report grants would be entirely unchecked — and a typo in one would not
 * 403, it would silently demand a permission nobody can ever hold.
 *
 * Definitions are data, so a stub deps bag is enough to build them.
 */
const stub = new Proxy({}, {
  get: () => new Proxy(() => undefined, { get: () => undefined, apply: () => undefined }),
}) as unknown as SchoolReportDeps;

describe('school report catalogue', () => {
  const defs = buildSchoolReportDefinitions(stub);

  it('builds a non-empty catalogue', () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  it('every key is unique and dotted lower-kebab', () => {
    const seen = new Set<string>();
    for (const d of defs) {
      expect(d.key).toMatch(/^[a-z][a-z-]*\.[a-z0-9][a-z0-9-]*$/);
      expect(seen.has(d.key)).toBe(false);
      seen.add(d.key);
    }
  });

  it('every permission exists in ALL_PERMISSIONS', () => {
    // A key absent from the catalogue is UNGRANTABLE (roles.service.ts rejects
    // it), so the route would 403 forever with no way to fix it from the UI.
    const missing: string[] = [];
    for (const d of defs) {
      for (const p of [d.permission, ...(d.alsoRequires ?? [])]) {
        if (!(ALL_PERMISSIONS as readonly string[]).includes(p)) {
          missing.push(`${d.key} -> ${p}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every declared filter is a known filter key', () => {
    for (const d of defs) {
      for (const f of d.filters) {
        expect(REPORT_FILTER_KEYS).toContain(f);
      }
    }
  });

  it('ReportFilterDto validates exactly the declared filter keys', () => {
    // The global ValidationPipe runs with `whitelist: true, forbidNonWhitelisted:
    // true`. A key in REPORT_FILTER_KEYS with no matching DTO property would be
    // REJECTED at the wire even though a definition declares it; a DTO property
    // with no key would be a filter no definition can ever ask for. Both
    // directions are checked.
    const validated = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(ReportFilterDto, '', false, false)
        .map((m) => m.propertyName),
    );

    const missingFromDto = REPORT_FILTER_KEYS.filter((k) => !validated.has(k));
    expect(missingFromDto).toEqual([]);

    const orphanedInDto = [...validated].filter(
      (p) => !(REPORT_FILTER_KEYS as readonly string[]).includes(p),
    );
    expect(orphanedInDto).toEqual([]);
  });

  it('required filters are a subset of declared filters', () => {
    for (const d of defs) {
      for (const r of d.requiredFilters ?? []) {
        expect(d.filters).toContain(r);
      }
    }
  });

  it('every domain is a known domain', () => {
    for (const d of defs) expect(REPORT_DOMAINS).toContain(d.domain);
  });

  it('class basis defaults are valid', () => {
    for (const d of defs) {
      if (d.classBasisDefault) expect(CLASS_BASES).toContain(d.classBasisDefault);
    }
  });

  it('a definition declaring classBasis as a filter also declares a default', () => {
    // Otherwise the user can pick a basis the report was never designed for and
    // the caption would claim a basis the query did not use.
    for (const d of defs) {
      if (d.filters.includes('classBasis')) {
        expect(d.classBasisDefault).toBeDefined();
      }
    }
  });

  it('static columns are non-empty, uniquely keyed and sortable by default', () => {
    for (const d of defs) {
      if (typeof d.columns === 'function') continue;
      const columns = d.columns as ReportColumn[];
      expect(columns.length).toBeGreaterThan(0);
      const keys = columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      if (d.defaultSort) expect(keys).toContain(d.defaultSort.key);
      if (d.groupBy) expect(keys).toContain(d.groupBy);
    }
  });

  it('a money column implies the finance grant', () => {
    // "Who owes money" must never be reachable with only the generic report
    // grant, whichever domain the report happens to be filed under.
    for (const d of defs) {
      if (typeof d.columns === 'function') continue;
      const hasMoney = (d.columns as ReportColumn[]).some((c) => c.type === 'money');
      if (!hasMoney) continue;
      const grants = [d.permission, ...(d.alsoRequires ?? [])];
      expect(grants).toContain(PERMISSIONS.school.readFinanceReports);
    }
  });

  it('a drilldown to another report names a report that exists', () => {
    const keys = new Set(defs.map((d) => d.key));
    for (const d of defs) {
      if (typeof d.columns === 'function') continue;
      for (const c of d.columns as ReportColumn[]) {
        if (c.link && 'reportKey' in c.link) {
          expect(keys.has(c.link.reportKey)).toBe(true);
        }
      }
    }
  });

  it('every definition declares a paging strategy and a run function', () => {
    for (const d of defs) {
      expect(['service', 'memory', 'none']).toContain(d.paging);
      expect(typeof d.run).toBe('function');
    }
  });

  it('an as-of filter is only offered by a report that can honour or flag it', () => {
    for (const d of defs) {
      if (d.filters.includes('asOf')) {
        expect(['as-of', 'current-only']).toContain(d.asOfMode);
      }
    }
  });
});
