import * as fs from 'fs';
import * as path from 'path';
import { SCHOOL_ROLE_PRESETS, PORTAL_ROLE_PRESETS } from '@erp/shared';

/**
 * E2E audit S5 — finance reads are not a `school:read` privilege.
 *
 * Every staff preset holds `school:read`. When the fee routes were gated on it,
 * a class teacher, the librarian or the cook could read any family's balance,
 * ledger, invoices and receipts (with guardian phone numbers). Finance reads
 * now need `school:fees:read`. This ratchet keeps any fee route from sliding
 * back onto the broad grant.
 */
const SCHOOL = path.resolve(__dirname, '../../src/modules/school');

function controllersIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.controller.ts'))
    .map((f) => path.join(dir, f));
}

describe('finance read permission', () => {
  it('gates no fee route on the broad school:read grant', () => {
    const offenders: string[] = [];
    for (const file of controllersIn(path.join(SCHOOL, 'fees'))) {
      const src = fs.readFileSync(file, 'utf-8');
      if (/RequirePermissions\([^)]*PERMISSIONS\.school\.read\b[,)]/.test(src)) offenders.push(path.basename(file));
    }
    expect(offenders).toEqual([]);
  });

  it('gates the fee dashboards and the student statement on school:fees:read', () => {
    const reporting = fs.readFileSync(path.join(SCHOOL, 'reporting/reporting.controller.ts'), 'utf-8');
    for (const route of ['finance', 'outstanding-by-class', 'daily-collections']) {
      const block = reporting.slice(reporting.indexOf(`@Get('${route}')`), reporting.indexOf(`@Get('${route}')`) + 120);
      expect(block).toContain('PERMISSIONS.school.readFees');
    }
    const student = fs.readFileSync(path.join(SCHOOL, 'people/student.controller.ts'), 'utf-8');
    const block = student.slice(student.indexOf("@Get(':id/statement')"), student.indexOf("@Get(':id/statement')") + 120);
    expect(block).toContain('PERMISSIONS.school.readFees');
  });

  it('gives finance reads only to finance-facing presets', () => {
    const holders = [...SCHOOL_ROLE_PRESETS, ...PORTAL_ROLE_PRESETS]
      .filter((p) => p.permissions.includes('school:fees:read'))
      .map((p) => p.name)
      .sort();
    expect(holders).toEqual(['Bursar', 'Head Teacher']);
  });
});
