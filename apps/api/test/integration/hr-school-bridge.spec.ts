/**
 * Integration — the Phase 2 Partner bridge between the school roster and the
 * HR payroll record.
 *
 * The invariant: `StaffProfile` and `HrEmployee` are two facets of ONE person,
 * joined through the shared master-data `Partner` (ADR-008). What must hold:
 *   - a staff member created school-side lands in the `schoolOnly` bucket;
 *   - creating their HR record reuses the SAME Partner (never a second one);
 *   - an HR-only employee can be linked to an existing roster entry;
 *   - a Partner can never be claimed by two employees (the 1:1 is enforced);
 *   - unlinking is non-destructive.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { HrModule } from '../../src/modules/hr/hr.module';
import { HrReconciliationService } from '../../src/modules/hr/hr-reconciliation.service';
import { HrOrgService } from '../../src/modules/hr/hr-org.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: HR ↔ school staff bridge', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let recon: HrReconciliationService;
  let org: HrOrgService;

  const organizationId = `org_bridge_${Date.now()}`;
  const userId = `user_bridge_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let alicePartnerId = '';
  let aliceStaffId = '';
  let bobPartnerId = '';
  let bobStaffId = '';

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['hr:read', 'hr:employee', 'hr:employee_identity'] }, fn);

  /** Create a school-side staff member the way StaffService does: Partner + profile. */
  const makeStaff = async (name: string, employeeNo: string) => {
    const partner = await raw.partner.create({
      data: { organizationId, code: `P-${employeeNo}`, name, isEmployee: true, email: `${employeeNo.toLowerCase()}@school.test` },
    });
    const profile = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo, joinDate: new Date('2024-01-15'), staffCategory: 'teaching' },
    });
    return { partnerId: partner.id, staffProfileId: profile.id };
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationId, name: 'Bridge Test', currencyCode: 'UGX' } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, AccountingModule, HrModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    recon = moduleRef.get(HrReconciliationService);
    org = moduleRef.get(HrOrgService);

    ({ partnerId: alicePartnerId, staffProfileId: aliceStaffId } = await makeStaff('Alice Teacher', 'STF-001'));
    ({ partnerId: bobPartnerId, staffProfileId: bobStaffId } = await makeStaff('Bob Teacher', 'STF-002'));
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    await raw.hrSalaryChange.deleteMany({ where: { organizationId } });
    await raw.hrEmploymentAction.deleteMany({ where: { organizationId } });
    await raw.hrEmployee.deleteMany({ where: { organizationId } });
    await raw.staffProfile.deleteMany({ where: { organizationId } });
    await raw.partner.deleteMany({ where: { organizationId } });
    await raw.auditLog.deleteMany({ where: { organizationId } });
    await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await raw.$disconnect();
  });

  it('reports school-side staff with no payroll record as schoolOnly', async () => {
    const view = await asAdmin(() => recon.overview());
    expect(view.counts.staffProfiles).toBe(2);
    expect(view.counts.linked).toBe(0);
    expect(view.counts.schoolOnly).toBe(2);
    expect(view.schoolOnly.map((s: any) => s.employeeNo).sort()).toEqual(['STF-001', 'STF-002']);
  });

  it('creates the HR record from a roster entry, reusing the SAME Partner', async () => {
    const emp = await asAdmin(() => recon.createEmployeeFromStaff(aliceStaffId));

    // The critical assertion: one Partner, two facets — not a duplicate person.
    expect(emp.partnerId).toBe(alicePartnerId);
    expect(emp.employeeCode).toBe('STF-001');
    // Identity is carried across from the Partner, not re-typed.
    expect(emp.firstName).toBe('Alice');
    expect(emp.lastName).toBe('Teacher');
    expect(emp.email).toBe('stf-001@school.test');

    const partnersNamedAlice = await raw.partner.count({ where: { organizationId, name: 'Alice Teacher' } });
    expect(partnersNamedAlice).toBe(1);

    const view = await asAdmin(() => recon.overview());
    expect(view.counts.linked).toBe(1);
    expect(view.counts.schoolOnly).toBe(1);
    expect(view.counts.hrOnly).toBe(0);
  });

  it('refuses to create a second HR record for the same person', async () => {
    await expect(asAdmin(() => recon.createEmployeeFromStaff(aliceStaffId))).rejects.toThrow(/already linked/i);
  });

  it('links an HR-only employee to an existing roster entry', async () => {
    const carol = await asAdmin(() => org.createEmployee({ firstName: 'Carol', lastName: 'Newcomer', employeeCode: 'EMP-CAROL' }));
    let view = await asAdmin(() => recon.overview());
    expect(view.counts.hrOnly).toBe(1);

    await asAdmin(() => recon.link(carol.id, bobStaffId));

    const after = await raw.hrEmployee.findUniqueOrThrow({ where: { id: carol.id } });
    expect(after.partnerId).toBe(bobPartnerId);

    view = await asAdmin(() => recon.overview());
    expect(view.counts.linked).toBe(2);
    expect(view.counts.hrOnly).toBe(0);
    expect(view.counts.schoolOnly).toBe(0);
  });

  it('never lets two employees claim the same person', async () => {
    const dave = await asAdmin(() => org.createEmployee({ firstName: 'Dave', lastName: 'Dup', employeeCode: 'EMP-DAVE' }));
    // Bob's roster entry is already taken by Carol's employee record.
    await expect(asAdmin(() => recon.link(dave.id, bobStaffId))).rejects.toThrow(/already linked/i);
  });

  it('unlinks without destroying either side', async () => {
    const carol = await raw.hrEmployee.findFirstOrThrow({ where: { organizationId, employeeCode: 'EMP-CAROL' } });
    await asAdmin(() => recon.unlink(carol.id));

    const after = await raw.hrEmployee.findUniqueOrThrow({ where: { id: carol.id } });
    expect(after.partnerId).toBeNull();
    // Both records still exist — unlink is not a delete.
    expect(await raw.staffProfile.count({ where: { organizationId, id: bobStaffId } })).toBe(1);
    expect(await raw.hrEmployee.count({ where: { organizationId, id: carol.id } })).toBe(1);
  });

  it('creates a roster entry from an HR-only employee, minting one Partner', async () => {
    const erin = await asAdmin(() => org.createEmployee({ firstName: 'Erin', lastName: 'Payroll', employeeCode: 'EMP-ERIN' }));
    const profile = await asAdmin(() => recon.createStaffFromEmployee(erin.id));

    const after = await raw.hrEmployee.findUniqueOrThrow({ where: { id: erin.id } });
    expect(after.partnerId).toBeTruthy();
    // Both facets point at the one newly-minted Partner.
    expect(profile.partnerId).toBe(after.partnerId);
    expect(profile.employeeNo).toBe('EMP-ERIN');

    const partner = await raw.partner.findUniqueOrThrow({ where: { id: after.partnerId! } });
    expect(partner.name).toBe('Erin Payroll');
    expect(partner.isEmployee).toBe(true);
  });
});
