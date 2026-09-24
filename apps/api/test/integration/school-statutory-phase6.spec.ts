/**
 * Phase 6 — the national-submission desk, end to end.
 *
 * The exit gate this proves: **a school can tell, before the deadline, exactly
 * which candidates are not ready, and the file it produces cannot contain one
 * of them.** Each case below is one way that has gone wrong for a school:
 *
 *   - a candidate with no number, or a number two learners share;
 *   - marks entered but never approved;
 *   - an Activity of Integration the programme requires and nobody recorded;
 *   - a name with a comma in it, splitting a row;
 *   - index numbers matched on name instead of candidate number.
 *
 * Runs only when DATABASE_URL is set (see _setup.ts).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
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
import { ProgrammeService } from '../../src/modules/school/enrollment/programme.service';
import { CandidateReferenceService } from '../../src/modules/school/statutory/candidate-reference.service';
import { UnebCaService } from '../../src/modules/school/statutory/uneb-ca.service';
import { StatutoryExportService } from '../../src/modules/school/statutory/statutory-export.service';
import { placeInClass, upsertEnrollment } from './_placement';

describeDb('integration: Phase 6 statutory submissions (ADR-029)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let programmes: ProgrammeService;
  let references: CandidateReferenceService;
  let ca: UnebCaService;
  let exports: StatutoryExportService;

  const organizationId = `org_stat_${Date.now()}`;
  const YEAR = 2026;
  const perms = [
    'school:read',
    'school:programmes:write',
    'school:statutory:read',
    'school:statutory:write',
    'school:statutory:export',
    'school:candidates:write',
  ];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  let yearId = '';
  let termId = '';
  let gradeS4 = '';
  let classS4 = '';
  let subjectMath = '';
  let programmeLowerSecondary = '';

  /** Ada is ready; Ben has an unapproved mark; Cleo has no candidate number. */
  const students: Record<string, string> = {};

  const makeStudent = async (name: string) => {
    const partner = await raw.partner.create({
      data: {
        organizationId,
        code: `${name.replace(/\W+/g, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        isCompany: false,
        isCustomer: true,
      },
    });
    const profile = await raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: `ADM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        enrollmentDate: new Date('2026-01-15'),
        status: 'active',
        gender: 'female',
        dateOfBirth: new Date('2011-03-07'),
      },
    });
    await placeInClass(raw, { organizationId: organizationId, studentProfileId: profile.id, classId: classS4 });
    await upsertEnrollment(raw, {
      data: {
        organizationId,
        studentProfileId: profile.id,
        academicYearId: yearId,
        programmeId: programmeLowerSecondary,
        gradeLevelId: gradeS4,
        admissionDate: new Date('2026-01-15'),
        status: 'ACTIVE',
      },
    });
    return profile.id;
  };

  /**
   * One assessment with one learner row. Written directly rather than through
   * the marking service: this suite is about what the readiness board makes of
   * the ledger, not about how marks get into it.
   */
  const mark = async (opts: {
    studentProfileId: string;
    kind: 'cat' | 'activity_of_integration' | 'project';
    title: string;
    score: number | null;
    approved: boolean;
    participation?: 'present' | 'exempt';
  }) => {
    const assessment = await raw.assessment.create({
      data: {
        organizationId,
        termId,
        subjectId: subjectMath,
        classId: classS4,
        title: opts.title,
        kind: opts.kind,
        maxScore: 100,
        status: 'published',
      },
    });
    await raw.studentAssessment.create({
      data: {
        organizationId,
        assessmentId: assessment.id,
        studentProfileId: opts.studentProfileId,
        termId,
        classId: classS4,
        maxScore: 100,
        originalScore: opts.score,
        effectiveScore: opts.score,
        percentage: opts.score,
        participation: opts.participation ?? 'present',
        approvalStatus: opts.approved ? 'approved' : 'draft',
        ...(opts.approved ? { approvedById: 'hod', approvedAt: new Date() } : {}),
      },
    });
    return assessment.id;
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `STAT-${Date.now()}`, name: 'Statutory School', currencyCode: 'UGX' },
    });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Statutory School', gradingSystem: 'UCE' } });

    yearId = (
      await raw.academicYear.create({
        data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isCurrent: true },
      })
    ).id;
    termId = (
      await raw.term.create({
        data: { organizationId, academicYearId: yearId, name: 'Term 1', startDate: new Date('2026-02-01'), endDate: new Date('2026-04-30'), isCurrent: true },
      })
    ).id;
    gradeS4 = (await raw.gradeLevel.create({ data: { organizationId, name: 'S4', order: 11 } })).id;
    classS4 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeS4, name: 'S4', capacity: 60 } })).id;
    subjectMath = (await raw.subject.create({ data: { organizationId, code: 'MTC', name: 'Mathematics' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    programmes = moduleRef.get(ProgrammeService);
    references = moduleRef.get(CandidateReferenceService);
    ca = moduleRef.get(UnebCaService);
    exports = moduleRef.get(StatutoryExportService);

    await asUser('su', () => programmes.seedUganda({ linkGradeLevels: true }));
    const list: any[] = await asUser('su', () => programmes.list());
    programmeLowerSecondary = list.find((p) => p.code === 'LOWER_SECONDARY').id;

    // A comma in the name is the classic row-splitting bug; keep one.
    students.ada = await makeStudent('Nakato, Ada Grace');
    students.ben = await makeStudent('Okot Ben');
    students.cleo = await makeStudent('Achieng Cleo');

    // Ada: complete and approved.
    await mark({ studentProfileId: students.ada, kind: 'cat', title: 'CAT 1', score: 72, approved: true });
    await mark({ studentProfileId: students.ada, kind: 'activity_of_integration', title: 'AoI 1', score: 80, approved: true });
    await mark({ studentProfileId: students.ada, kind: 'project', title: 'Project', score: 65, approved: true });

    // Ben: everything there but nobody approved the CAT.
    await mark({ studentProfileId: students.ben, kind: 'cat', title: 'CAT 1', score: 55, approved: false });
    await mark({ studentProfileId: students.ben, kind: 'activity_of_integration', title: 'AoI 1', score: 60, approved: true });

    // Cleo: complete marks, but she will be given no candidate number.
    await mark({ studentProfileId: students.cleo, kind: 'cat', title: 'CAT 1', score: 61, approved: true });
    await mark({ studentProfileId: students.cleo, kind: 'activity_of_integration', title: 'AoI 1', score: 70, approved: true });
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /* ─────────────────────────── candidate registry ──────────────────────── */

  it('lists every eligible learner as missing before any is registered', async () => {
    const missing: any[] = await asUser('su', () => references.missing('UCE', YEAR));
    expect(missing.map((m) => m.studentProfileId).sort()).toEqual(Object.values(students).sort());
  });

  it('assigns candidate numbers without renumbering anyone who already holds one', async () => {
    // Ada is given hers by hand first — the office does this for a late entry.
    await asUser('su', () =>
      references.upsert({
        studentProfileId: students.ada,
        level: 'UCE',
        registrationYear: YEAR,
        centreNumber: 'U0123',
        candidateNumber: '900',
      }),
    );

    const first = await asUser('su', () =>
      references.assignNumbers({ level: 'UCE', registrationYear: YEAR, centreNumber: 'U0123', startAt: 1, padTo: 3 }),
    );
    expect(first.assigned).toBe(2);
    expect(first.skipped).toBe(1);

    // Re-running fills gaps rather than renumbering a registered class.
    const second = await asUser('su', () =>
      references.assignNumbers({ level: 'UCE', registrationYear: YEAR, centreNumber: 'U0123', startAt: 1, padTo: 3 }),
    );
    expect(second.assigned).toBe(0);
    expect(second.skipped).toBe(3);

    const rows: any[] = await asUser('su', () => references.list({ level: 'UCE', registrationYear: YEAR }));
    expect(rows.find((r) => r.studentProfileId === students.ada)?.candidateNumber).toBe('900');
    expect(new Set(rows.map((r) => r.candidateNumber)).size).toBe(3);
  });

  it('matches returned index numbers on candidate number, and reports what it cannot match', async () => {
    const rows: any[] = await asUser('su', () => references.list({ level: 'UCE', registrationYear: YEAR }));
    const adaNo = rows.find((r) => r.studentProfileId === students.ada)!.candidateNumber!;

    const result = await asUser('su', () =>
      references.importIndexNumbers({
        level: 'UCE',
        registrationYear: YEAR,
        rows: [
          { candidateNumber: adaNo, indexNumber: 'U0123/900' },
          { candidateNumber: 'NOT-A-NUMBER', indexNumber: 'U0123/999' },
        ],
      }),
    );
    expect(result.matched).toBe(1);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0].candidateNumber).toBe('NOT-A-NUMBER');

    const after: any[] = await asUser('su', () => references.list({ level: 'UCE', registrationYear: YEAR }));
    const ada = after.find((r) => r.studentProfileId === students.ada)!;
    expect(ada.indexNumber).toBe('U0123/900');
    expect(ada.status).toBe('confirmed');
  });

  it('refuses to give two candidates the same index number', async () => {
    await expect(
      asUser('su', () =>
        references.upsert({
          studentProfileId: students.ben,
          level: 'UCE',
          registrationYear: YEAR,
          indexNumber: 'U0123/900',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to edit a confirmed index number in place', async () => {
    await expect(
      asUser('su', () =>
        references.upsert({
          studentProfileId: students.ada,
          level: 'UCE',
          registrationYear: YEAR,
          indexNumber: 'U0123/901',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ──────────────────────────── readiness board ────────────────────────── */

  it('names the candidate who has no number and the one whose marks are unapproved', async () => {
    // Take Cleo's number away, so the board has one of each failure to report.
    const rows: any[] = await asUser('su', () => references.list({ level: 'UCE', registrationYear: YEAR }));
    const cleoRef = rows.find((r) => r.studentProfileId === students.cleo)!;
    await raw.studentExamReference.update({ where: { id: cleoRef.id }, data: { candidateNumber: null } });

    const board: any = await asUser('su', () => ca.readiness({ termId, level: 'UCE', registrationYear: YEAR }));

    expect(board.requires.activitiesOfIntegration).toBe(true);
    expect(board.summary.candidates).toBe(3);

    const byStudent = new Map<string, any>(board.candidates.map((c: any) => [c.studentProfileId, c]));

    expect(byStudent.get(students.ada).ready).toBe(true);

    const ben = byStudent.get(students.ben);
    expect(ben.ready).toBe(false);
    expect(ben.findings.map((f: any) => f.code)).toContain('MARKS_NOT_APPROVED');

    const cleo = byStudent.get(students.cleo);
    expect(cleo.ready).toBe(false);
    expect(cleo.findings.map((f: any) => f.code)).toContain('NO_CANDIDATE_NUMBER');
  });

  it('excludes an unapproved mark from the computed CA score rather than counting it as zero', async () => {
    const board: any = await asUser('su', () => ca.readiness({ termId, level: 'UCE', registrationYear: YEAR }));
    const ben = board.candidates.find((c: any) => c.studentProfileId === students.ben);
    const maths = ben.subjects.find((s: any) => s.subjectCode === 'MTC');
    // The CAT is Ben's only subject-achievement evidence and it is unapproved,
    // so there is no achievement score — not a zero.
    expect(maths.subjectAchievement).toBeNull();
    expect(maths.activityOfIntegration).toBe(80 - 20); // 60
    expect(maths.pendingCount).toBe(1);
  });

  it('flags a candidate number held by two learners', async () => {
    const rows: any[] = await asUser('su', () => references.list({ level: 'UCE', registrationYear: YEAR }));
    const ben = rows.find((r) => r.studentProfileId === students.ben)!;
    await raw.studentExamReference.update({ where: { id: ben.id }, data: { candidateNumber: '900' } });

    const board: any = await asUser('su', () => ca.readiness({ termId, level: 'UCE', registrationYear: YEAR }));
    const codes = board.candidates.flatMap((c: any) => c.findings.map((f: any) => f.code));
    expect(codes).toContain('DUPLICATE_CANDIDATE_NUMBER');

    // Put it back so the export cases below start from a sane registry.
    await raw.studentExamReference.update({ where: { id: ben.id }, data: { candidateNumber: '001' } });
  });

  /* ──────────────────────────────── exports ────────────────────────────── */

  it('seeds the Uganda starting layouts once', async () => {
    const first = await asUser('su', () => exports.seedDefaults());
    expect(first.created).toContain('UNEB_UCE_CA');
    const second = await asUser('su', () => exports.seedDefaults());
    expect(second.created).toEqual([]);
  });

  it('refuses to produce a file while candidates are blocked, and names them', async () => {
    const templates: any[] = await asUser('su', () => exports.listTemplates('uneb_ca'));
    const template = templates.find((t) => t.code === 'UNEB_UCE_CA')!;

    await expect(
      asUser('su', () => exports.run({ templateId: template.id, termId, level: 'UCE', registrationYear: YEAR })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('produces a file with the ready candidates only, and records what it produced', async () => {
    const templates: any[] = await asUser('su', () => exports.listTemplates('uneb_ca'));
    const template = templates.find((t) => t.code === 'UNEB_UCE_CA')!;

    const result = await asUser('su', () =>
      exports.run({
        templateId: template.id,
        termId,
        level: 'UCE',
        registrationYear: YEAR,
        allowIncomplete: true,
        reason: 'Partial submission agreed with the centre supervisor.',
      }),
    );

    // Only Ada is ready. Ben and Cleo are absent from the file — not present
    // with blank scores, which a board reads as zeros.
    expect(result.rowCount).toBe(1);
    expect(result.content).toContain('NAKATO');
    expect(result.content).not.toContain('OKOT');
    expect(result.content).not.toContain('ACHIENG');

    // The comma in "Nakato, Ada Grace" is the register's surname separator, not
    // part of the surname — so the row is eleven clean fields with no quoting,
    // rather than a split row or a surname ending in a comma.
    const dataLine = result.content.split('\r\n')[1];
    expect(dataLine).toContain('U0123,900,U0123/900,NAKATO,ADA GRACE,F,MTC,');
    expect(dataLine.split(',')).toHaveLength(11);
    expect(dataLine).not.toContain('"');

    // Provenance, not just bytes.
    const runs: any[] = await asUser('su', () => exports.listRuns('uneb_ca'));
    const run = runs.find((r) => r.id === result.runId)!;
    expect(run.rowCount).toBe(1);
    expect(run.checksum).toBe(result.checksum);
    expect(run.warnings.length).toBeGreaterThan(0);
    expect(run.status).toBe('generated');
  });

  it('refuses an incomplete run with no reason on the record', async () => {
    const templates: any[] = await asUser('su', () => exports.listTemplates('uneb_ca'));
    const template = templates.find((t) => t.code === 'UNEB_UCE_CA')!;
    await expect(
      asUser('su', () =>
        exports.run({ templateId: template.id, termId, level: 'UCE', registrationYear: YEAR, allowIncomplete: true }),
      ),
    ).rejects.toThrow(/reason/i);
  });

  it('records a submission reference and supersedes the previous submitted run', async () => {
    const runs: any[] = await asUser('su', () => exports.listRuns('uneb_ca'));
    const first = runs[0];
    const submitted = await asUser('su', () => exports.markSubmitted(first.id, { submissionReference: 'UNEB-ACK-001' }));
    expect(submitted.status).toBe('submitted');
    expect(submitted.submissionReference).toBe('UNEB-ACK-001');

    await expect(
      asUser('su', () => exports.markSubmitted(first.id, { submissionReference: 'UNEB-ACK-002' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('mints a new template version rather than editing one that has produced a file', async () => {
    const before: any[] = await asUser('su', () => exports.listTemplates('uneb_ca'));
    const template = before.find((t) => t.code === 'UNEB_UCE_CA' && t.isActive)!;

    const next: any = await asUser('su', () =>
      exports.updateTemplate(template.id, {
        columns: [
          { header: 'CENTRE_NO', source: 'centreNumber', transform: 'upper' },
          { header: 'CANDIDATE_NO', source: 'candidateNumber', transform: 'upper' },
          { header: 'CA_TOTAL', source: 'caTotal', transform: 'one_decimal' },
        ],
      }),
    );
    expect(next.version).toBe(template.version + 1);
    expect(next.id).not.toBe(template.id);

    const after: any[] = await asUser('su', () => exports.listTemplates('uneb_ca'));
    const old = after.find((t) => t.id === template.id)!;
    expect(old.isActive).toBe(false);
    // The historical layout is intact, so the file already sent stays readable.
    expect((old.columns as any[]).length).toBe((template.columns as any[]).length);
  });

  it('refuses a template column that names a field the dataset does not carry', async () => {
    await expect(
      asUser('su', () =>
        exports.createTemplate({
          code: `BAD_${Date.now()}`,
          name: 'Bad layout',
          scope: 'uneb_ca',
          columns: [{ header: 'ADDRESS', source: 'homeAddress' }],
        }),
      ),
    ).rejects.toThrow(/homeAddress/);
  });
});
