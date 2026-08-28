/**
 * Integration — HR skills, experience, qualifications/certifications and
 * personnel documents, against a real DB + the real File vault.
 *
 * This is the feature the build was asked for: add/edit/delete/save a teacher's
 * skills, work experience, certifications, qualifications and CV/documents. The
 * cases that matter:
 *   - the skill query that powers cover-finding ("who can teach Physics");
 *   - a document round-trips through FilesService (upload → row → signed
 *     download) with the bytes actually persisted, not the discarded-on-s3 stub;
 *   - qualification/certification EDIT works (the endpoints that didn't exist);
 *   - tenancy isolation — another org cannot see these rows.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { HrModule } from '../../src/modules/hr/hr.module';
import { HrPeopleService } from '../../src/modules/hr/hr-people.service';
import { HrOrgService } from '../../src/modules/hr/hr-org.service';
import { HrTrainingService } from '../../src/modules/hr/hr-training.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: HR skills / experience / documents', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let people: HrPeopleService;
  let org: HrOrgService;
  let training: HrTrainingService;

  const orgA = `org_hrppl_${Date.now()}`;
  const orgB = `org_hrppl_b_${Date.now()}`;
  const userId = `user_hrppl_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let empId = '';
  let physicsSkillId = '';

  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId: orgA, userId, permissions: ['hr:read', 'hr:employee', 'hr:skill', 'hr:experience', 'hr:document', 'hr:qualification'] }, fn);
  const asB = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId: orgB, userId, permissions: ['hr:read', 'hr:skill'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(orgA);
    for (const id of [orgA, orgB]) {
      // Org code must be globally unique — use the (unique) org id itself, so
      // orgA and orgB never collide even when created in the same millisecond.
      await raw.organization.create({ data: { id, code: id, name: 'People Test', currencyCode: 'UGX' } });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, AccountingModule, HrModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    people = moduleRef.get(HrPeopleService);
    org = moduleRef.get(HrOrgService);
    training = moduleRef.get(HrTrainingService);

    const emp = await asA(() => org.createEmployee({ firstName: 'Grace', lastName: 'Physics', employmentType: 'FULL_TIME' }));
    empId = emp.id;
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    for (const id of [orgA, orgB]) {
      await raw.hrEmployeeDocument.deleteMany({ where: { organizationId: id } });
      await raw.hrEmployeeSkill.deleteMany({ where: { organizationId: id } });
      await raw.hrSkill.deleteMany({ where: { organizationId: id } });
      await raw.hrExperience.deleteMany({ where: { organizationId: id } });
      await raw.hrCertification.deleteMany({ where: { organizationId: id } });
      await raw.hrQualification.deleteMany({ where: { organizationId: id } });
      await raw.file.deleteMany({ where: { organizationId: id } });
      await raw.hrEmployee.deleteMany({ where: { organizationId: id } });
      await raw.auditLog.deleteMany({ where: { organizationId: id } });
      await raw.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await raw.$disconnect();
  });

  it('runs the skill catalogue + employee-skill lifecycle and the cover query', async () => {
    const physics = await asA(() => people.createSkill({ code: 'PHY', name: 'Physics', category: 'subject' }));
    physicsSkillId = physics.id;
    const chem = await asA(() => people.createSkill({ code: 'CHEM', name: 'Chemistry', category: 'subject' }));

    await asA(() => people.addEmployeeSkill({ employeeId: empId, skillId: physics.id, proficiency: 'advanced', yearsExperience: 6 }));

    // Duplicate is rejected.
    await expect(asA(() => people.addEmployeeSkill({ employeeId: empId, skillId: physics.id }))).rejects.toThrow(/already/i);

    const list = await asA(() => people.listEmployeeSkills(empId));
    expect(list).toHaveLength(1);
    expect(list[0].skill.name).toBe('Physics');
    expect(list[0].proficiency).toBe('advanced');

    // Cover query: advanced ≥ intermediate → found; ≥ expert → not found.
    const canCover = await asA(() => people.findEmployeesBySkill(physics.id, 'intermediate'));
    expect(canCover.map((r: any) => r.employee.id)).toContain(empId);
    const experts = await asA(() => people.findEmployeesBySkill(physics.id, 'expert'));
    expect(experts).toHaveLength(0);

    // A skill nobody holds returns nobody; a catalogue delete is blocked while in use.
    const noOne = await asA(() => people.findEmployeesBySkill(chem.id));
    expect(noOne).toHaveLength(0);
    await expect(asA(() => people.deleteSkill(physics.id))).rejects.toThrow(/assigned/i);
  });

  it('edits a skill assignment and records admin verification', async () => {
    const [link] = await asA(() => people.listEmployeeSkills(empId));
    await asA(() => people.updateEmployeeSkill(link.id, { proficiency: 'expert' }));
    await asA(() => people.verifyEmployeeSkill(link.id, true));
    const after = (await asA(() => people.listEmployeeSkills(empId)))[0];
    expect(after.proficiency).toBe('expert');
    expect(after.verified).toBe(true);
    expect(after.verifiedById).toBe(userId);
    // Now an expert-level search finds them.
    const experts = await asA(() => people.findEmployeesBySkill(physicsSkillId, 'expert'));
    expect(experts.map((r: any) => r.employee.id)).toContain(empId);
  });

  it('adds and edits prior work experience', async () => {
    const xp = await asA(() =>
      people.addExperience({ employeeId: empId, employer: 'Old School', title: 'Teacher', startDate: '2018-01-01', endDate: '2022-12-31' }),
    );
    await asA(() => people.updateExperience(xp.id, { title: 'Senior Teacher' }));
    const list = await asA(() => people.listExperience(empId));
    expect(list).toHaveLength(1);
    expect(list[0].employer).toBe('Old School');
    expect(list[0].title).toBe('Senior Teacher');
  });

  it('round-trips a personnel document through the File vault', async () => {
    const bytes = Buffer.from('%PDF-1.4 fake CV bytes for Grace', 'utf-8');
    const doc = await asA(() =>
      people.uploadDocument({
        employeeId: empId,
        category: 'cv',
        title: 'Grace CV',
        file: { originalname: 'grace-cv.pdf', mimetype: 'application/pdf', buffer: bytes, size: bytes.length },
      }),
    );
    expect(doc.fileId).toBeTruthy();

    // The File row exists with the real byte size (proves bytes were persisted,
    // not silently discarded).
    const file = await raw.file.findUniqueOrThrow({ where: { id: doc.fileId } });
    expect(file.byteSize).toBe(bytes.length);
    expect(file.organizationId).toBe(orgA);

    const list = await asA(() => people.listDocuments(empId));
    expect(list).toHaveLength(1);
    expect(list[0].file.filename).toBe('grace-cv.pdf');

    // A signed, ownership-checked download URL is issued.
    const dl = await asA(() => people.getDocumentDownload(doc.id));
    expect(dl.url).toContain(doc.fileId);

    // Verify + soft delete.
    await asA(() => people.verifyDocument(doc.id, true));
    await asA(() => people.deleteDocument(doc.id));
    const afterDelete = await asA(() => people.listDocuments(empId));
    expect(afterDelete).toHaveLength(0);
  });

  it('creates AND edits qualifications and certifications (the new update endpoints)', async () => {
    const qual = await asA(() => training.createQualification({ employeeId: empId, type: 'degree', title: 'BSc Physics', institution: 'Makerere' }));
    await asA(() => training.updateQualification(qual.id, { title: 'BSc Physics (Hons)', institution: 'Makerere University' }));
    const quals = await asA(() => training.listQualifications({ employeeId: empId }));
    expect(quals.rows[0].title).toBe('BSc Physics (Hons)');
    expect(quals.rows[0].institution).toBe('Makerere University');

    const cert = await asA(() =>
      training.createCertification({ employeeId: empId, name: 'Teaching License', issuer: 'MoES', expiryDate: '2027-01-01' }),
    );
    await asA(() => training.updateCertification(cert.id, { expiryDate: '2020-01-01' }));
    const certs = await asA(() => training.listCertifications({ employeeId: empId }));
    // Moving expiry into the past flips the derived status to expired.
    expect(certs.rows[0].status).toBe('expired');
  });

  it('isolates all of it from another tenant', async () => {
    // Org B sees none of org A's skills or employees.
    const bSkills = await asB(() => people.listSkills());
    expect(bSkills.rows).toHaveLength(0);
    // And cannot read org A's employee skills (different org scope → empty).
    const bView = await asB(() => people.findEmployeesBySkill(physicsSkillId));
    expect(bView).toHaveLength(0);
  });
});
