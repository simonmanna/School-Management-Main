/**
 * Wave 6 · the role matrix (E2E audit §D) as a table, decided by the REAL
 * PermissionsGuard against the REAL controller metadata.
 *
 * Integration specs call services with `permissions: []`, so nothing ever
 * asked "can a Class Teacher reach this route?". Each row below runs the
 * production guard with a preset's grants and asserts allow / deny.
 */
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PORTAL_ROLE_PRESETS, SCHOOL_ROLE_PRESETS } from '@erp/shared';
import { PermissionsGuard } from '../../src/kernel/auth/guards/permissions.guard';
import { SchoolFinanceQueryController } from '../../src/modules/school/fees/school-finance-query.controller';
import { SchoolPaymentController } from '../../src/modules/school/fees/billing.controller';
import { AdmissionsController } from '../../src/modules/school/admissions/admissions.controller';
import { StudentController } from '../../src/modules/school/people/student.controller';
import { StudentAttendanceController } from '../../src/modules/school/attendance/student-attendance.controller';
import { StudentEnrollmentController } from '../../src/modules/school/enrollment/enrollment.controller';
import { ReportingController } from '../../src/modules/school/reporting/reporting.controller';

const presets = [...SCHOOL_ROLE_PRESETS, ...PORTAL_ROLE_PRESETS];
const grantsOf = (name: string) => {
  const p = presets.find((x) => x.name === name);
  if (!p) throw new Error(`No preset ${name}`);
  return [...p.permissions] as string[];
};

async function decide(role: string, controller: any, method: string): Promise<'allow' | 'deny'> {
  const permissions = grantsOf(role);
  const resolver = { sessionState: jest.fn(async () => ({ permissions })) };
  const tenant = { store: { permissions } };
  const guard = new PermissionsGuard(new Reflector(), resolver as any, tenant as any);
  const handler = controller.prototype[method];
  if (typeof handler !== 'function') throw new Error(`${controller.name}#${method} does not exist`);
  const ctx = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ auth: { sub: 'u1', organizationId: 'o1', permissions } }) }),
  } as any;
  try {
    return (await guard.canActivate(ctx)) ? 'allow' : 'deny';
  } catch (e) {
    if (e instanceof ForbiddenException) return 'deny';
    throw e;
  }
}

type Row = [string, any, string, Record<string, 'allow' | 'deny'>];

// area / controller / handler → expected verdict per preset
const MATRIX: Row[] = [
  ['fees: read invoices', SchoolFinanceQueryController, 'listInvoices',
    { 'Class Teacher': 'deny', 'Subject Teacher': 'deny', Bursar: 'allow', 'Head Teacher': 'allow', Registrar: 'deny', Parent: 'deny' }],
  ['fees: collect', SchoolPaymentController, 'collect',
    { Bursar: 'allow', 'Head Teacher': 'deny', 'Class Teacher': 'deny', Registrar: 'deny' }],
  ['fees: request refund', SchoolPaymentController, 'refund',
    { Bursar: 'allow', 'Class Teacher': 'deny', Registrar: 'deny' }],
  ['fees: release refund', SchoolPaymentController, 'approveRefund',
    { 'Head Teacher': 'allow', Bursar: 'deny', 'Class Teacher': 'deny' }],
  ['reports: finance dashboard', ReportingController, 'financeDashboard',
    { 'Head Teacher': 'allow', Bursar: 'allow', 'Class Teacher': 'deny', Registrar: 'deny' }],
  ['admissions: decide', AdmissionsController, 'recordDecision',
    { 'Head Teacher': 'allow', 'Deputy Head': 'allow', Registrar: 'deny', Bursar: 'deny', 'Class Teacher': 'deny' }],
  ['admissions: take fee', AdmissionsController, 'payApplicationFee',
    { Bursar: 'allow', Registrar: 'deny', 'Class Teacher': 'deny' }],
  ['admissions: waive fee', AdmissionsController, 'waiveApplicationFee',
    { 'Head Teacher': 'allow', Bursar: 'deny', Registrar: 'deny' }],
  ['students: register', StudentController, 'register',
    { Registrar: 'allow', 'Class Teacher': 'deny', Bursar: 'deny', Parent: 'deny' }],
  ['enrollment: place', StudentEnrollmentController, 'create',
    { Registrar: 'allow', 'Class Teacher': 'deny', Bursar: 'deny' }],
  ['attendance: mark register', StudentAttendanceController, 'mark',
    { 'Class Teacher': 'allow', 'Subject Teacher': 'allow', Bursar: 'deny', Parent: 'deny', Student: 'deny' }],
];

describe('preset × route matrix (real PermissionsGuard, real controller metadata)', () => {
  const cases = MATRIX.flatMap(([area, ctrl, method, expected]) =>
    Object.entries(expected).map(([role, verdict]) => [area, role, verdict, ctrl, method] as const),
  );
  it.each(cases)('%s — %s → %s', async (_area, role, verdict, ctrl, method) => {
    expect(await decide(role, ctrl, method)).toBe(verdict);
  });
});
