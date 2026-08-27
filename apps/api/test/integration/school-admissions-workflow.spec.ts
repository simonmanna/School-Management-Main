/**
 * Integration — the configurable admission workflow, against a real database.
 *
 * The property this suite exists to protect:
 *
 *   **Configuration removes STAGES. It never removes CONDITIONS.**
 *
 * A school can configure `Application → Enrollment` and enrol straight from
 * `submitted`. It still cannot enrol an applicant whose required documents are
 * unverified, whose application fee is outstanding, or whose class is full.
 *
 * And the second property, asserted explicitly because it is easy to regress:
 *
 *   **Nothing is synthesized.** A skipped stage writes no status row and no
 *   artifact, so `offer_issued` always means an offer really was issued. Skipping
 *   is recorded as `skippedStages` on the one REAL transition that happened.
 *
 * Same DB requirements as school-happy-path.spec.ts (RLS-inert target).
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
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';
import { AdmissionsWorkflowService } from '../../src/modules/school/admissions/admissions-workflow.service';
import { PRESETS } from '../../src/modules/school/admissions/admission-workflow.schema';

describeDb('integration: configurable admission workflow', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admissions: AdmissionsService;
  let workflows: AdmissionsWorkflowService;

  const organizationId = `org_wf_${Date.now()}`;
  const userId = 'registrar_1';
  let academicYearId = '';
  let termId = '';
  let classId = '';
  let simpleCycleId = '';
  let selectiveCycleId = '';
  let simpleWorkflowId = '';
  let selectiveWorkflowId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['school:admissions:write'] }, fn);

  let seq = 0;
  const newApplicant = () => {
    seq += 1;
    return { first: `Cand${seq}`, last: `Test${Date.now()}${seq}` };
  };

  async function createApp(admissionCycleId: string, asDraft = false) {
    const who = newApplicant();
    return asTenant(() =>
      admissions.create({
        academicYearId,
        admissionCycleId,
        applicantFirstName: who.first,
        applicantLastName: who.last,
        applyingForClassId: classId,
        asDraft,
      } as any),
    ) as Promise<any>;
  }

  /** A required-but-unverified document. ApplicationDocument needs a real File row. */
  async function addUnverifiedDoc(applicationId: string, type: string) {
    const file = await raw.file.create({
      data: {
        organizationId,
        filename: `${type}.pdf`,
        contentType: 'application/pdf',
        byteSize: 1024,
        storageKey: `wf/${type}/${applicationId}`,
      },
    });
    return raw.applicationDocument.create({
      data: { organizationId, applicationId, fileId: file.id, type, required: true, verified: false },
    });
  }

  const enroll = (applicationId: string, name = 'Enrolled Student') =>
    asTenant(() =>
      admissions.enroll({
        applicationId,
        classId,
        termId,
        rollNumber: String(seq),
        student: { name },
      } as any),
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `WF-${Date.now()}`, name: 'Workflow School', currencyCode: 'UGX' },
    });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    academicYearId = year.id;
    const term = await raw.term.create({
      data: {
        organizationId,
        academicYearId: year.id,
        name: 'Term 1',
        startDate: new Date('2026-01-15'),
        endDate: new Date('2026-04-15'),
        isCurrent: true,
      },
    });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 East' } });
    classId = cls.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    admissions = moduleRef.get(AdmissionsService);
    workflows = moduleRef.get(AdmissionsWorkflowService);

    const simple: any = await asTenant(() =>
      workflows.create({ name: 'Direct Admission', presetKey: 'simple' }),
    );
    simpleWorkflowId = simple.id;
    const selective: any = await asTenant(() =>
      workflows.create({ name: 'Selective Admission', presetKey: 'selective' }),
    );
    selectiveWorkflowId = selective.id;

    const c1 = await raw.admissionCycle.create({
      data: { organizationId, academicYearId, name: 'Simple 2026', workflowId: simpleWorkflowId },
    });
    simpleCycleId = c1.id;
    const c2 = await raw.admissionCycle.create({
      data: { organizationId, academicYearId, name: 'Selective 2026', workflowId: selectiveWorkflowId },
    });
    selectiveCycleId = c2.id;
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  // ───────────────────────── Simple: Application → Enrollment ─────────────────────────

  it('simple: enrols straight from submitted, writing ONE real transition', async () => {
    const app = await createApp(simpleCycleId);
    expect(app.status).toBe('submitted');

    const res: any = await enroll(app.id, 'Direct Entry');
    expect(res.studentProfile.id).toBeTruthy();

    const after = await raw.admissionApplication.findFirst({ where: { id: app.id } });
    expect(after!.status).toBe('enrolled');

    const history = await raw.admissionStatusHistory.findMany({
      where: { applicationId: app.id },
      orderBy: { changedAt: 'asc' },
    });
    // create() logs its own row; beyond that there is exactly ONE transition, and it
    // is the real one the operator performed.
    const transitions = history.filter((h) => h.action !== 'create');
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromStatus).toBe('submitted');
    expect(transitions[0].toStatus).toBe('enrolled');
    expect(transitions[0].action).toBe('enroll');
    expect([...transitions[0].skippedStages].sort()).toEqual(
      ['APPLICANT_ACCEPTANCE', 'DECISION', 'EVALUATION', 'OFFER'].sort(),
    );

    // No fabricated lifecycle statuses anywhere in the trail.
    const statuses = history.map((h) => h.toStatus);
    expect(statuses).not.toContain('accepted');
    expect(statuses).not.toContain('offer_issued');
    expect(statuses).not.toContain('offer_accepted');

    // And no fabricated artifacts: a report asking "how many offers did we make?"
    // must not count this applicant.
    expect(await raw.offerLetter.count({ where: { applicationId: app.id } })).toBe(0);
    expect(await raw.admissionDecision.count({ where: { applicationId: app.id } })).toBe(0);
    expect(await raw.admissionFee.count({ where: { applicationId: app.id } })).toBe(0);
  });

  it('simple: a draft can never be enrolled, whatever the workflow says', async () => {
    const app = await createApp(simpleCycleId, true);
    expect(app.status).toBe('draft');
    await expect(enroll(app.id)).rejects.toThrow();
    expect(await raw.enrollment.count({ where: { applicationId: app.id } })).toBe(0);
  });

  it('simple: an unverified required document still blocks enrollment', async () => {
    // The workflow removed the stages. It did not remove the conditions.
    const app = await createApp(simpleCycleId);
    await addUnverifiedDoc(app.id, 'birth_certificate');
    await expect(enroll(app.id)).rejects.toThrow(/required documents not verified/);
    expect(await raw.enrollment.count({ where: { applicationId: app.id } })).toBe(0);
  });

  it('simple: an outstanding application fee still blocks enrollment', async () => {
    const app = await createApp(simpleCycleId);
    await raw.admissionFee.create({
      data: { organizationId, applicationId: app.id, amount: 50000, paid: false },
    });
    await expect(enroll(app.id)).rejects.toThrow(/fee outstanding/);
  });

  it('simple: a full class still blocks enrollment', async () => {
    const app = await createApp(simpleCycleId);
    await raw.admissionCapacity.create({
      data: {
        organizationId,
        admissionCycleId: simpleCycleId,
        classId,
        sectionId: '__none__',
        streamId: '__none__',
        capacity: 1,
        reservedCapacity: 0,
        claimedSeats: 1,
      },
    });
    await expect(enroll(app.id)).rejects.toThrow(/no seats available/);
    await raw.admissionCapacity.deleteMany({ where: { organizationId, admissionCycleId: simpleCycleId } });
  });

  it('simple: enrolling the same application twice yields exactly one student', async () => {
    // Direct enrollment makes a double-click far easier to hit than it used to be.
    const app = await createApp(simpleCycleId);
    await enroll(app.id, 'Only Once');
    await enroll(app.id, 'Only Once').catch(() => undefined);

    expect(await raw.enrollment.count({ where: { applicationId: app.id } })).toBe(1);
    const profiles = await raw.studentProfile.findMany({
      where: { enrollments: { some: { applicationId: app.id } } },
    });
    expect(profiles).toHaveLength(1);
  });

  // ───────────────────────── Selective: nothing may be jumped ─────────────────────────

  it('selective: refuses to enrol from submitted and names the blocking stage', async () => {
    const app = await createApp(selectiveCycleId);
    await expect(enroll(app.id)).rejects.toThrow(/Evaluation stage is required/);
  });

  it('selective: the full path enrols', async () => {
    const app = await createApp(selectiveCycleId);
    await asTenant(() => admissions.review(app.id, 'review'));
    await asTenant(() => admissions.review(app.id, 'screen'));
    await asTenant(() => admissions.review(app.id, 'schedule_interview'));
    await asTenant(() => admissions.review(app.id, 'complete_interview'));
    await asTenant(() => admissions.review(app.id, 'score'));
    await asTenant(() => admissions.review(app.id, 'accept', 'strong candidate'));
    await asTenant(() => admissions.issueOffer(app.id, {} as any));
    await asTenant(() => admissions.acceptOffer(app.id));

    const res: any = await enroll(app.id, 'Selective Entry');
    expect(res.studentProfile.id).toBeTruthy();

    const history = await raw.admissionStatusHistory.findMany({ where: { applicationId: app.id } });
    // Every stage really happened, so nothing is recorded as skipped.
    for (const row of history) expect(row.skippedStages).toEqual([]);
    expect(await raw.offerLetter.count({ where: { applicationId: app.id } })).toBe(1);
  });

  // ──────────────────────────── Snapshot immutability ────────────────────────────

  it('an application keeps its workflow when the workflow itself is edited', async () => {
    const app = await createApp(selectiveCycleId);
    await asTenant(() => workflows.update(selectiveWorkflowId, { stages: PRESETS.simple.stages }));

    // The application was created under Selective and stays under Selective.
    await expect(enroll(app.id)).rejects.toThrow(/Evaluation stage is required/);

    // Restore for later assertions.
    await asTenant(() => workflows.applyPreset(selectiveWorkflowId, 'selective'));
  });

  it('an application keeps its workflow when the cycle is reassigned; new ones get the new one', async () => {
    const before = await createApp(selectiveCycleId);
    await asTenant(() => workflows.assignToCycle(selectiveCycleId, simpleWorkflowId));
    const after = await createApp(selectiveCycleId);

    // The pre-existing application still has to clear evaluation...
    await expect(enroll(before.id)).rejects.toThrow(/Evaluation stage is required/);
    // ...while a new one in the same cycle enrols directly.
    await expect(enroll(after.id, 'After Reassign')).resolves.toBeDefined();

    await asTenant(() => workflows.assignToCycle(selectiveCycleId, selectiveWorkflowId));
  });

  it('an application with no snapshot behaves as the built-in Standard workflow', async () => {
    // Every application that predates this feature is in this state.
    const app = await createApp(simpleCycleId);
    await raw.admissionApplication.update({
      where: { id: app.id },
      data: { workflowSnapshot: undefined, workflowId: null },
    });
    await raw.$executeRawUnsafe(
      `UPDATE "AdmissionApplication" SET "workflowSnapshot" = NULL WHERE id = $1`,
      app.id,
    );

    // Standard requires decision → offer → acceptance, so a direct enrol is refused.
    await expect(enroll(app.id)).rejects.toThrow(/Decision stage is required/);

    const resolved: any = await asTenant(() => admissions.applicationWorkflow(app.id));
    expect(resolved.workflow.inherited).toBe(true);
    expect(resolved.nextRequiredStage).toBe('DECISION');
  });

  // ────────────────────────────── Workflow lifecycle ──────────────────────────────

  it('refuses to delete a workflow that is still in use, and archives otherwise', async () => {
    await expect(asTenant(() => workflows.archive(simpleWorkflowId))).rejects.toThrow(/still in use/);

    const spare: any = await asTenant(() => workflows.create({ name: `Spare ${Date.now()}`, presetKey: 'standard' }));
    const archived: any = await asTenant(() => workflows.archive(spare.id));
    expect(archived.active).toBe(false);
    // Archived means "unassignable", never "gone".
    expect(await raw.admissionWorkflow.count({ where: { id: spare.id } })).toBe(1);
    await expect(asTenant(() => workflows.assignToCycle(simpleCycleId, spare.id))).rejects.toThrow(/archived/);
  });

  it('rejects a required Evaluation that no activity can complete', async () => {
    await expect(
      asTenant(() =>
        workflows.create({
          name: `Impossible ${Date.now()}`,
          stages: [
            { stage: 'EVALUATION', mode: 'required', steps: { screening: 'skip', interview: 'skip', exam: 'skip' } },
          ],
        }),
      ),
    ).rejects.toThrow(/at least one required activity/);
  });

  it('does not expose another organization’s workflow', async () => {
    const otherOrgId = `org_wf_other_${Date.now()}`;
    await setOrg(otherOrgId);
    await raw.organization.create({
      data: { id: otherOrgId, code: `WFO-${Date.now()}`, name: 'Other School', currencyCode: 'UGX' },
    });
    const foreign = await raw.admissionWorkflow.create({
      data: { organizationId: otherOrgId, name: 'Foreign', presetKey: 'simple', stages: PRESETS.simple.stages as any },
    });
    await setOrg(organizationId);

    await expect(asTenant(() => workflows.assignToCycle(simpleCycleId, foreign.id))).rejects.toThrow(/not found/);
  });

  // ─────────────────────────────── The UI contract ───────────────────────────────

  it('reports workflow state and eligibility as separate facts', async () => {
    const app = await createApp(simpleCycleId);
    await addUnverifiedDoc(app.id, 'transcript');

    const res: any = await asTenant(() => admissions.applicationWorkflow(app.id));
    // The workflow says Enroll is the next thing to do...
    expect(res.nextRequiredStage).toBe('ENROLLMENT');
    expect(res.requiredActions).toContain('enroll');
    // ...and eligibility, separately, says it cannot happen yet and why.
    expect(res.eligibility.status).toBe('BLOCKED');
    expect(res.eligibility.missing.join(' ')).toMatch(/required documents not verified/);

    // The backend is authoritative: a client ignoring BLOCKED is still refused.
    await expect(enroll(app.id)).rejects.toThrow(/required documents not verified/);
  });

  it('offers no workflow action on a terminal application', async () => {
    const app = await createApp(simpleCycleId);
    await asTenant(() => admissions.review(app.id, 'withdraw', 'applicant moved away'));

    const res: any = await asTenant(() => admissions.applicationWorkflow(app.id));
    expect(res.nextRequiredStage).toBeNull();
    expect(res.requiredActions).toEqual([]);
    expect(res.optionalActions).toEqual([]);
    await expect(enroll(app.id)).rejects.toThrow();
  });
});
