/**
 * Every school business action has at least one non-Administrator preset able
 * to perform it (E2E audit P1, handover Wave 2.3).
 *
 * The permission guard requires ALL listed permissions. Refund, admission-fee
 * pay/waive and admission decisions each demanded a pair no preset held, and
 * adjustment approval, write-off and period close were held by no preset at
 * all — so a real school could only do them as Administrator, which is exactly
 * the all-powerful account segregation of duties exists to avoid. This spec
 * parses every controller's @RequirePermissions and checks each route against
 * SCHOOL_ROLE_PRESETS + PORTAL_ROLE_PRESETS. role-presets.spec.ts keeps the SoD
 * rules; together they say "someone can, and not the wrong someone".
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PERMISSIONS, PORTAL_ROLE_PRESETS, SCHOOL_ROLE_PRESETS } from '@erp/shared';

const SRC = join(__dirname, '..', '..', 'src');

/** Deliberately Administrator-only. Each needs a reason. */
const ADMIN_ONLY: Record<string, string> = {
  // One-off legacy data migration tool; not a school workflow.
  'school:academics:migrate': 'legacy migration tooling',
};

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.controller.ts') ? [f] : [];
  });

const resolve = (expr: string): string => {
  const e = expr.trim();
  if (/^['"]/.test(e)) return e.slice(1, -1);
  let v: any = PERMISSIONS;
  for (const part of e.replace(/^PERMISSIONS\./, '').split('.')) v = v?.[part];
  if (typeof v !== 'string') throw new Error(`Unresolvable permission expression: ${e}`);
  return v;
};

interface Route { where: string; handler: string; perms: string[] }

function schoolRoutes(): Route[] {
  const out: Route[] = [];
  for (const f of walk(SRC)) {
    const src = readFileSync(f, 'utf8');
    const re = /@RequirePermissions\(([^)]*)\)\s*\n\s*(?:@\w+\([^)]*\)\s*\n\s*)*(\w+)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const perms = m[1].split(',').map((s) => s.trim()).filter(Boolean).map(resolve);
      if (!perms.some((p) => p.startsWith('school:'))) continue;
      out.push({ where: relative(SRC, f), handler: m[2], perms });
    }
  }
  return out;
}

describe('every school action is performable by a non-Administrator preset', () => {
  const presets = [...SCHOOL_ROLE_PRESETS, ...PORTAL_ROLE_PRESETS];
  const routes = schoolRoutes();

  it('found the routes (guards against a parser that matches nothing)', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('no route needs a permission combination only the Administrator holds', () => {
    const orphaned = routes
      .filter((r) => !r.perms.some((p) => p in ADMIN_ONLY))
      .filter((r) => !presets.some((preset) => r.perms.every((p) => preset.permissions.includes(p))))
      .map((r) => `${r.where} ${r.handler}: ${r.perms.join(' + ')}`);
    expect(orphaned).toEqual([]);
  });

  it.each([
    ['request a refund', 'Bursar', ['school:fees:refund']],
    ['approve (pay out) a refund', 'Head Teacher', ['school:fees:refund:approve']],
    ['take an admission fee', 'Bursar', ['school:fees:collect']],
    ['charge an admission fee', 'Registrar', ['school:admissions:write', 'school:admissions:fee']],
    ['waive an admission fee', 'Head Teacher', ['school:fees:waiver:approve']],
    ['decide an application', 'Head Teacher', ['school:admissions:decide']],
    ['approve a fee adjustment', 'Head Teacher', ['school:fees:adjustment:approve']],
    ['write off a bad debt', 'Head Teacher', ['school:fees:writeoff']],
    ['close a fee period', 'Head Teacher', ['school:fees:period:close']],
  ])('%s: the %s preset can', (_action, role, perms) => {
    const preset = presets.find((p) => p.name === role)!;
    expect(perms.filter((p) => !preset.permissions.includes(p))).toEqual([]);
  });

  it('the person who requests a refund is never the preset that releases it', () => {
    const bursar = presets.find((p) => p.name === 'Bursar')!;
    expect(bursar.permissions).toContain('school:fees:refund');
    expect(bursar.permissions).not.toContain('school:fees:refund:approve');
  });
});
