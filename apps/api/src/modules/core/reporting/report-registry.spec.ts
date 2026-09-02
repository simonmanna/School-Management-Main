import { BadRequestException, ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import { ReportRegistryService } from './report-registry.service';
import { ReportRunnerService, MAX_REPORT_ROWS } from './report-runner.service';
import type { ReportContextBuilder, ReportDefinition, ReportRow } from './report.types';

/** A context builder that resolves nothing — the engine under test is domain-free. */
const builder: ReportContextBuilder = {
  build: async () => ({
    organizationId: 'org-1',
    userId: 'user-1',
    scope: { effective: 'school', classIds: 'all' as const },
    resolved: { classBasis: 'current' as const, asOf: new Date('2026-08-31T00:00:00Z') },
    logger: { warn: () => undefined },
  }),
};

function makeDef(over: Partial<ReportDefinition<any>> = {}): ReportDefinition<any> {
  return {
    key: 'test.report',
    title: 'Test Report',
    domain: 'student',
    description: 'A report used by the engine tests.',
    permission: 'school:reports:read',
    shape: 'table',
    filters: ['classId', 'search'],
    paging: 'memory',
    columns: [
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'amount', label: 'Amount', type: 'money', total: 'sum' },
      { key: 'score', label: 'Score', type: 'percent', total: 'avg' },
    ],
    run: async () => ({
      rows: [
        { name: 'Beatrice', amount: 100, score: 80 },
        { name: 'Aaron', amount: 250, score: null },
        { name: 'Cynthia', amount: 50, score: 40 },
      ],
    }),
    ...over,
  };
}

function harness(def: ReportDefinition<any>, granted: string[] = ['school:reports:read']) {
  const registry = new ReportRegistryService();
  registry.register('test', [def], builder);
  const permissions = {
    grantedForCaller: async () => granted,
    lookupPermissions: async () => granted,
    hasAll: async (r: string[]) => r.every((p) => granted.includes(p)),
  } as any;
  return { registry, runner: new ReportRunnerService(registry, permissions) };
}

describe('ReportRegistryService', () => {
  it('throws at registration on a duplicate key rather than shadowing', () => {
    const registry = new ReportRegistryService();
    registry.register('a', [makeDef()], builder);
    expect(() => registry.register('b', [makeDef()], builder))
      .toThrow(/Duplicate report key "test\.report"/);
  });

  it('hides definitions the caller cannot run from the catalogue', () => {
    // The existence of a report is itself information: a class teacher must not
    // learn the school keeps a "Bad Debtors" list.
    const registry = new ReportRegistryService();
    registry.register('test', [
      makeDef({ key: 'open.one' }),
      makeDef({ key: 'secret.one', alsoRequires: ['school:reports:finance:read'] }),
    ], builder);

    const visible = registry.catalog(['school:reports:read']).map((c) => c.key);
    expect(visible).toEqual(['open.one']);

    const all = registry.catalog(['school:reports:read', 'school:reports:finance:read']);
    expect(all.map((c) => c.key).sort()).toEqual(['open.one', 'secret.one']);
  });

  it('a wildcard grant sees everything', () => {
    const registry = new ReportRegistryService();
    registry.register('test', [makeDef({ alsoRequires: ['x:y'] })], builder);
    expect(registry.catalog(['*'])).toHaveLength(1);
  });

  it('describe() omits columns for a matrix report and never leaks run()', () => {
    const registry = new ReportRegistryService();
    const def = makeDef({ shape: 'matrix', columns: async () => [] });
    registry.register('test', [def], builder);
    const meta = registry.describe(def);
    expect(meta.columns).toBeUndefined();
    expect((meta as any).run).toBeUndefined();
  });
});

describe('ReportRunnerService', () => {
  it('refuses a report the caller lacks a grant for', async () => {
    const { runner } = harness(
      makeDef({ alsoRequires: ['school:reports:finance:read'] }),
      ['school:reports:read'],
    );
    await expect(runner.run('test.report', { page: 1, pageSize: 25 } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a filter the definition does not declare', async () => {
    // Silently ignoring one is how a class-scoped report becomes school-wide.
    const { runner } = harness(makeDef());
    await expect(runner.run('test.report', {
      page: 1, pageSize: 25, filters: { termId: '11111111-1111-1111-1111-111111111111' },
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('demands the filters the definition requires', async () => {
    const { runner } = harness(makeDef({ requiredFilters: ['classId'] }));
    await expect(runner.run('test.report', { page: 1, pageSize: 25, filters: {} } as any))
      .rejects.toThrow(/requires filter\(s\): classId/);
  });

  it('rejects a sort key that is not a column', async () => {
    // sortBy reaches Prisma orderBy in any paging:'service' definition.
    const { runner } = harness(makeDef());
    await expect(runner.run('test.report', {
      page: 1, pageSize: 25, sortBy: 'name); DROP TABLE',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pages in memory and reports the true total', async () => {
    const { runner } = harness(makeDef());
    const out = await runner.run('test.report', { page: 2, pageSize: 2 } as any);
    expect(out.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(out.data).toHaveLength(1);
  });

  it('totals span the whole report, not the visible page', async () => {
    // A page-local total on a fee report is a number that means nothing and
    // looks authoritative.
    const { runner } = harness(makeDef());
    const out = await runner.run('test.report', { page: 1, pageSize: 1 } as any);
    expect(out.data).toHaveLength(1);
    expect(out.totals?.amount).toBe(400);
  });

  it('averages over rows that carry a value, not over every row', async () => {
    // A blank mark is an absent pupil, not a zero.
    const { runner } = harness(makeDef());
    const out = await runner.run('test.report', { page: 1, pageSize: 25 } as any);
    expect(out.totals?.score).toBe(60);
  });

  it('sorts by the column type, with blanks last', async () => {
    const { runner } = harness(makeDef());
    const byAmount = await runner.run('test.report', {
      page: 1, pageSize: 25, sortBy: 'amount', sortOrder: 'desc',
    } as any);
    expect(byAmount.data.map((r) => r.amount)).toEqual([250, 100, 50]);

    const byScore = await runner.run('test.report', {
      page: 1, pageSize: 25, sortBy: 'score', sortOrder: 'desc',
    } as any);
    expect(byScore.data.map((r) => r.score)).toEqual([80, 40, null]);
  });

  it('refuses rather than truncates past the row cap', async () => {
    // Never silently drop rows from a report: the reader has no way to know.
    const many: ReportRow[] = Array.from({ length: MAX_REPORT_ROWS + 1 }, (_, i) => ({
      name: `p${i}`, amount: 1, score: 1,
    }));
    const { runner } = harness(makeDef({ run: async () => ({ rows: many }) }));
    await expect(runner.run('test.report', { page: 1, pageSize: 25 } as any))
      .rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('flags an as-of it cannot honour instead of laundering it', async () => {
    const { runner } = harness(makeDef({ filters: ['asOf'], asOfMode: 'current-only' }));
    const out = await runner.run('test.report', {
      page: 1, pageSize: 25, filters: { asOf: '2020-01-01' },
    } as any);
    expect(out.notes.join(' ')).toMatch(/cannot reconstruct history/i);
  });

  it('stamps the resolved class basis into the caption', async () => {
    // The single most likely reason two reports disagree about a pupil count.
    const { runner } = harness(makeDef({ classBasisDefault: 'enrollment' }));
    const out = await runner.run('test.report', { page: 1, pageSize: 25 } as any);
    expect(out.caption).toMatch(/Class basis: current/);
  });

  it('trusts a service-paged definition for its own total', async () => {
    const { runner } = harness(makeDef({
      paging: 'service',
      run: async () => ({ rows: [{ name: 'a', amount: 1, score: 1 }], total: 900 }),
    }));
    const out = await runner.run('test.report', { page: 3, pageSize: 10 } as any);
    expect(out.meta).toMatchObject({ page: 3, pageSize: 10, total: 900, totalPages: 90 });
  });

  it('unpaged returns everything for an export', async () => {
    const { runner } = harness(makeDef());
    const out = await runner.run('test.report', { page: 2, pageSize: 1 } as any, true);
    expect(out.data).toHaveLength(3);
    expect(out.meta.page).toBe(1);
  });
});
