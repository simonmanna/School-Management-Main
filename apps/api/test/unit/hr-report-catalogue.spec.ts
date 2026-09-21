// Required before importing anything with class-validator decorators; the API
// loads it in main.ts, but a unit spec has no bootstrap.
import 'reflect-metadata';
import { ALL_PERMISSIONS } from '@erp/shared';
import { buildHrReportDefinitions } from '../../src/modules/hr/reporting/definitions';
import type { HrReportDeps } from '../../src/modules/hr/reporting/hr-report-deps';
import {
  REPORT_DOMAINS,
  REPORT_FILTER_KEYS,
} from '../../src/modules/core/reporting/report.types';

/**
 * Catalogue invariants for the HR namespace.
 *
 * The school catalogue has the same spec, and neither covers the other: a typo
 * in an HR report's permission string would not 403, it would demand a
 * permission nobody can ever be granted, and the report would simply never run
 * for anyone. Definitions are data, so a stub deps bag is enough.
 */
const stub = new Proxy({}, {
  get: () => new Proxy(() => undefined, { get: () => undefined, apply: () => undefined }),
}) as unknown as HrReportDeps;

describe('HR report catalogue', () => {
  const defs = buildHrReportDefinitions(stub);

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
      for (const f of d.filters) expect(REPORT_FILTER_KEYS).toContain(f);
    }
  });

  it('required filters are a subset of declared filters', () => {
    for (const d of defs) {
      for (const r of d.requiredFilters ?? []) expect(d.filters).toContain(r);
    }
  });

  it('every domain is a known domain', () => {
    for (const d of defs) expect(REPORT_DOMAINS).toContain(d.domain);
  });

  it('every default sort names a real column', () => {
    for (const d of defs) {
      if (!d.defaultSort) continue;
      // A column list resolved at run time cannot be checked statically.
      if (typeof d.columns === 'function') continue;
      const keys = d.columns.map((c) => c.key);
      expect(keys).toContain(d.defaultSort.key);
    }
  });

  it('no HR report is readable without the HR report grant', () => {
    // `hr:reports:read` is the route grant AND every definition's base
    // permission. A definition that named something else would be reachable by
    // a caller the controller never intended to let in.
    for (const d of defs) expect(d.permission).toBe('hr:reports:read');
  });

  it('every report that discloses individual pay also requires hr:payroll', () => {
    // The rule this encodes: seeing the staff list and seeing what colleagues
    // earn are different disclosures. A payroll report that forgot
    // `alsoRequires` would be visible to every holder of hr:reports:read.
    const payDisclosing = defs.filter(
      (d) => d.domain === 'payroll' || d.key === 'hr.salary-by-grade',
    );
    expect(payDisclosing.length).toBeGreaterThan(0);
    for (const d of payDisclosing) {
      expect(d.alsoRequires ?? []).toContain('hr:payroll');
    }
  });

  it('no workforce report leaks pay without the payroll grant', () => {
    const moneyColumnKeys = ['baseSalary', 'netPay', 'grossPay', 'avgSalary', 'minSalary', 'maxSalary'];
    for (const d of defs) {
      if ((d.alsoRequires ?? []).includes('hr:payroll')) continue;
      if (typeof d.columns === 'function') continue;
      const leaked = d.columns.filter((c) => moneyColumnKeys.includes(c.key)).map((c) => c.key);
      expect({ key: d.key, leaked }).toEqual({ key: d.key, leaked: [] });
    }
  });
});
