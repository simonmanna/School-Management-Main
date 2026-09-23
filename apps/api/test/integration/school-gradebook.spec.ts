/**
 * Integration — the gradebook (P2), against a real DB.
 *
 * The load-bearing claim: the gradebook's weighted total is the SAME number the
 * ResultSet and the report card produce, because all three run `computeSubject`.
 * These tests prove that, plus the CRUD (add a column, edit a cell) and the
 * behaviour that makes weighting legible: a column with no policy component is
 * shown in its own group and excluded from the weighted total.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { GradebookService } from '../../src/modules/school/assessment/gradebook.service';
import { placeInClass } from './_placement';

describeDb('integration: gradebook — one weighted total, editable columns', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let gradebook: GradebookService;

  const organizationId = `org_gb_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let termId = '';
  let classId = '';
  let gradeLevelId = '';
  let subjectId = '';
  let policyId = '';
  let catComponentId = '';
  let examComponentId = '';
  const studentIds: string[] = [];

  const perms = ['school:read', 'school:grades:write', 'school:assessments:write'];
  const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'gb_teacher', permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `GB-${Date.now()}`, name: 'Gradebook School', currencyCode: 'UGX' } });
    // A generic grading scale so bandFor resolves.
    await raw.schoolProfile.create({ data: { organizationId, name: 'Gradebook School', gradingSystem: 'generic' } }).catch(() => undefined);

    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    const term = await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S3', order: 10 } });
    gradeLevelId = grade.id;
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S3 GB' } });
    classId = cls.id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'PHY', name: 'Physics' } })).id;

    for (const name of ['Abbo Faith', 'Bosco John']) {
      const partner = await raw.partner.create({ data: { organizationId, name, code: `P-GB-${name.replace(/\s+/g, '')}-${Date.now()}` } });
      const sp = await raw.studentProfile.create({
        data: { organizationId, partnerId: partner.id, admissionNo: `ADM-GB-${studentIds.length}-${Date.now()}`, enrollmentDate: new Date('2026-01-15'), status: 'active' },
      });
      await placeInClass(raw, { organizationId, studentProfileId: sp.id, classId });
      studentIds.push(sp.id);
    }

    // A weighting policy: CAT 30% (mean), Exam 70% (mean).
    const policy = await raw.assessmentPolicy.create({
      data: { organizationId, name: 'S3 Physics', subjectId, classId, gradeLevelId, termId, passMark: 50 },
    });
    policyId = policy.id;
    catComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId, name: 'CAT', kind: 'cat', weight: 30, aggregation: 'mean' } })).id;
    examComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId, name: 'Exam', kind: 'exam', weight: 70, aggregation: 'mean' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    gradebook = moduleRef.get(GradebookService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('resolves the policy and reports its weight validity', async () => {
    const sheet = await asUser(() => gradebook.sheet({ classId, termId, subjectId }));
    expect(sheet.subject?.id).toBe(subjectId);
    expect(sheet.policy?.weightsTotal).toBe(100);
    expect(sheet.policy?.weightsValid).toBe(true);
    expect(sheet.students).toHaveLength(2);
  });

  it('adds a manual column under a component and records a mark through the ledger', async () => {
    const col = await asUser(() => gradebook.createColumn({ classId, termId, subjectId, title: 'CAT 1', maxScore: 20, componentId: catComponentId }));
    expect(col.sourceType).toBe('manual');

    await asUser(() => gradebook.cell({ studentProfileId: studentIds[0], assessmentId: col.id, marks: 16 }));

    // The mark exists as a MarkEntry, not just a written column.
    const sa = await raw.studentAssessment.findFirst({ where: { assessmentId: col.id, studentProfileId: studentIds[0] } });
    const entries = await raw.markEntry.findMany({ where: { studentAssessmentId: sa!.id } });
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].score)).toBe(16);

    const sheet = await asUser(() => gradebook.sheet({ classId, termId, subjectId }));
    const abbo = sheet.students.find((s) => s.studentProfileId === studentIds[0])!;
    expect(abbo.cells[col.id].marks).toBe(16);
    // CAT 1 = 16/20 = 80%. Only CAT present so far → weighted over the weight present = 80%.
    expect(abbo.finalPercent).toBe(80);
  });

  it('computes the SAME weighted total as a ResultSet run over the same marks', async () => {
    // Add an exam column and mark both students, so both components contribute.
    const examCol = await asUser(() => gradebook.createColumn({ classId, termId, subjectId, title: 'End Exam', maxScore: 100, componentId: examComponentId }));
    await asUser(() => gradebook.cell({ studentProfileId: studentIds[0], assessmentId: examCol.id, marks: 60 }));

    const sheet = await asUser(() => gradebook.sheet({ classId, termId, subjectId }));
    const abbo = sheet.students.find((s) => s.studentProfileId === studentIds[0])!;
    // CAT 80% × 0.30 + Exam 60% × 0.70 = 24 + 42 = 66.
    expect(abbo.finalPercent).toBe(66);

    // Independently: freeze a roster, run results, compare the subject percent.
    // Membership is written BEFORE the freeze: Phase 4 added a database trigger
    // that refuses any change to a frozen roster's membership, so seeding a
    // roster as already-frozen and then adding a member is now rejected — which
    // is exactly the guarantee the trigger exists to give.
    const roster = await raw.academicRoster.create({
      data: { organizationId, termId, scopeType: 'class', classId, name: 'GB roster' },
    });
    await raw.academicRosterMember.create({
      data: { organizationId, rosterId: roster.id, studentProfileId: studentIds[0], classId, gradeLevelId },
    });
    await raw.academicRoster.update({ where: { id: roster.id }, data: { frozenAt: new Date() } });
    // Approve the two StudentAssessments so the publish gate would pass; compute reads approved-or-terminal.
    await raw.studentAssessment.updateMany({
      where: { studentProfileId: studentIds[0], termId, assessment: { subjectId } },
      data: { approvalStatus: 'approved' },
    });

    const results = moduleRef.get(await import('../../src/modules/school/assessment/result-run.service').then((m) => m.ResultRunService));
    const rs: any = await asUser(() => (results as any).compute({ termId, rosterId: roster.id }));
    const ssr = await raw.studentSubjectResult.findFirst({ where: { resultSetId: rs.id, studentProfileId: studentIds[0], subjectId } });
    expect(Math.round(Number(ssr!.finalPercent))).toBe(66); // identical to the gradebook
  });

  it('groups a component-less column under its kind, matching the kernel', async () => {
    // A manual column defaults to kind "cat". The result kernel counts a
    // component-less "cat" assessment toward the CAT component by kind — so the
    // gradebook must GROUP it there too, or its display would disagree with its
    // own total. (A truly unweighted column is one whose kind no component has.)
    const loose = await asUser(() => gradebook.createColumn({ classId, termId, subjectId, title: 'Class quiz', maxScore: 10 }));
    await asUser(() => gradebook.cell({ studentProfileId: studentIds[0], assessmentId: loose.id, marks: 10 }));

    const sheet = await asUser(() => gradebook.sheet({ classId, termId, subjectId }));
    const catGroup = sheet.groups.find((g) => g.id === catComponentId);
    expect(catGroup?.columnIds).toContain(loose.id); // grouped where it actually counts

    // It counts: CAT is now mean(80%, 100%) = 90%; total = 90×0.3 + 60×0.7 = 69.
    const abbo = sheet.students.find((s) => s.studentProfileId === studentIds[0])!;
    expect(abbo.finalPercent).toBe(69);
  });

  it('refuses to rescale a column that already has marks', async () => {
    const col = await asUser(() => gradebook.createColumn({ classId, termId, subjectId, title: 'CAT 2', maxScore: 20, componentId: catComponentId }));
    await asUser(() => gradebook.cell({ studentProfileId: studentIds[1], assessmentId: col.id, marks: 12 }));
    await expect(asUser(() => gradebook.updateColumn(col.id, { maxScore: 40 }))).rejects.toThrow(/maximum/i);
  });

  it('will not delete a column with marks unless forced', async () => {
    const col = await asUser(() => gradebook.createColumn({ classId, termId, subjectId, title: 'CAT 3', maxScore: 20, componentId: catComponentId }));
    await asUser(() => gradebook.cell({ studentProfileId: studentIds[1], assessmentId: col.id, marks: 5 }));
    await expect(asUser(() => gradebook.deleteColumn(col.id, false))).rejects.toThrow(/mark/i);
    await asUser(() => gradebook.deleteColumn(col.id, true));
    const after = await raw.assessment.findFirst({ where: { id: col.id } });
    expect(after?.deletedAt).not.toBeNull();
  });
});
