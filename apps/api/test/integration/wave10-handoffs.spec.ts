/**
 * Wave 10 — the three cross-module handoffs the E2E audit (2026-09-26) found
 * broken or unenforced, proved against a real database.
 *
 *   H1  Application academic year → enrollment term. A term of another year is
 *       refused by `StudentAdmissionService.admit` itself, not only by the
 *       admissions orchestrator, because the student form, the CSV import and the
 *       front desk all reach `admit` directly.
 *   H2  Enrollment/placement → compulsory course roster. A placement enrols the
 *       learner into the term's compulsory offerings in its own transaction, so
 *       the assessment roster a teacher captures includes learners admitted after
 *       the offering was created. An elective is left alone.
 *   H3  Published results → family-visible report card. `publish` refuses a card
 *       built from live approved marks.
 *
 * Plus the front desk's guardian handling: the Contact is created inside the
 * admission transaction (no orphan when the placement fails) and an existing
 * parent is reused on their second child.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { SequenceService } from '../../src/kernel/sequence/sequence.service';
import { StudentAdmissionService } from '../../src/modules/school/people/student-admission.service';
import { AssessmentWorkflowService } from '../../src/modules/school/assessment/assessment-workflow.service';
import { ReportCardService } from '../../src/modules/school/examinations/examinations.service';
import { reconcileCompulsoryRostersInTx } from '../../src/modules/school/course-offerings/course-roster-reconcile';
import { PlacementService } from '../../src/modules/school/enrollment/placement.service';
import { ensureAcademicSpine } from './_placement';

describeDb('integration: wave 10 cross-module handoffs', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admissions: StudentAdmissionService;
  let assessments: AssessmentWorkflowService;
  let exams: ReportCardService;
  let placements: PlacementService;

  const stamp = Date.now();
  const organizationId = `org_w10_${stamp}`;
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'registrar_w10', permissions: ['*'] }, fn);

  /** 2026 and 2027, each with one term — the year mismatch needs two. */
  let y2026 = { academicYearId: '', termId: '', classId: '', sectionId: null as string | null, classCohortId: '', programmeId: '', gradeLevelId: '' };
  let y2027 = { academicYearId: '', termId: '' };
  let subjectId = '';
  let electiveSubjectId = '';
  let coreOfferingId = '';
  let electiveOfferingId = '';
  let staffProfileId = '';
  let seq = 0;

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `W10-${stamp}`, name: 'Wave 10 Primary', currencyCode: 'UGX' },
    });

    const spine = await ensureAcademicSpine(raw, {
      organizationId,
      yearName: '2026',
      termName: 'Term 1',
      gradeName: 'P4',
      gradeOrder: 4,
      className: 'P4 East',
    });
    // ensureAcademicSpine dates Term 1 Jan 15 – Apr 15, which is in the past for
    // most of the year. Placements are dated inside their term, so widen it to
    // cover today rather than pinning every test to a fake clock.
    await raw.term.update({
      where: { id: spine.termId },
      data: { startDate: new Date('2026-01-15'), endDate: new Date('2026-12-15') },
    });
    y2026 = {
      academicYearId: spine.academicYearId,
      termId: spine.termId,
      classId: spine.classId,
      sectionId: spine.sectionId,
      classCohortId: spine.classCohortId,
      programmeId: spine.programmeId,
      gradeLevelId: spine.gradeLevelId,
    };

    const next = await raw.academicYear.create({
      data: { organizationId, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') },
    });
    y2027 = {
      academicYearId: next.id,
      termId: (
        await raw.term.create({
          data: {
            organizationId,
            academicYearId: next.id,
            name: '2027 Term 1',
            startDate: new Date('2027-02-01'),
            endDate: new Date('2027-05-01'),
          },
        })
      ).id,
    };

    subjectId = (await raw.subject.create({ data: { organizationId, name: 'Mathematics', code: `MTC-${stamp}` } })).id;
    electiveSubjectId = (await raw.subject.create({ data: { organizationId, name: 'French', code: `FRE-${stamp}` } })).id;

    // A teacher, so the offering is assessable at all.
    const teacherPartner = await raw.partner.create({
      data: { organizationId, code: `TCH-${stamp}`, name: 'Teacher Nakato' },
    });
    staffProfileId = (
      await raw.staffProfile.create({
        data: { organizationId, partnerId: teacherPartner.id, employeeNo: `EMP-${stamp}`, joinDate: new Date('2020-01-01') },
      })
    ).id;

    coreOfferingId = await makeOffering('Mathematics P4', subjectId, 'LEARNING_AREA');
    electiveOfferingId = await makeOffering('French P4', electiveSubjectId, 'SUBJECT');
  });

  /**
   * LEARNING_AREA is compulsory by the offering-type rule; a bare SUBJECT with no
   * curriculum opinion is an elective. That is exactly the distinction the
   * reconciliation must respect, so the fixture builds one of each.
   */
  async function makeOffering(name: string, subject: string, offeringType: string): Promise<string> {
    const offering = await raw.courseOffering.create({
      data: {
        organizationId,
        code: `${name.replace(/\W+/g, '-').toUpperCase()}-${stamp}`,
        name,
        academicYearId: y2026.academicYearId,
        termId: y2026.termId,
        programmeId: y2026.programmeId,
        classCohortId: y2026.classCohortId,
        classId: y2026.classId,
        subjectId: subject,
        offeringType: offeringType as any,
        audienceScope: 'COHORT',
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-15'),
      },
    });
    await raw.courseOfferingTeacher.create({
      data: {
        organizationId,
        courseOfferingId: offering.id,
        teacherPartnerId: staffProfileId,
        isResponsible: true,
        effectiveFrom: new Date('2026-01-15'),
      },
    });
    return offering.id;
  }

  /** An application for the 2027 intake. */
  async function makeApplication(academicYearId: string) {
    seq += 1;
    return raw.admissionApplication.create({
      data: {
        organizationId,
        academicYearId,
        applicationNumber: `APP-${stamp}-${seq}`,
        applicantFirstName: 'Aine',
        applicantLastName: `Applicant${seq}`,
        applyingForClassId: y2026.classId,
        status: 'offer_accepted',
      },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    admissions = moduleRef.get(StudentAdmissionService);
    assessments = moduleRef.get(AssessmentWorkflowService);
    exams = moduleRef.get(ReportCardService);
    placements = moduleRef.get(PlacementService);

    // The admission-number sequence is created on first use. Outside a
    // transaction here, rather than inside the first admission's — where it
    // needs a second connection the transaction is already holding.
    await asTenant(() => moduleRef.get(SequenceService).next(`student:${new Date().getUTCFullYear()}`, {}));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /* ── H1: application year → enrollment term ─────────────────────────────── */

  it('refuses a term from another academic year than the application (H1)', async () => {
    const app = await makeApplication(y2027.academicYearId);
    seq += 1;
    await expect(
      asTenant(() =>
        admissions.admit({
          organizationId,
          applicationId: app.id,
          name: `Wrong Year ${seq}`,
          placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `WY-${seq}` },
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Nothing was written: no half-admitted learner left behind.
    const orphan = await raw.studentEnrollment.findFirst({ where: { admissionApplicationId: app.id } });
    expect(orphan).toBeNull();
  });

  it('admits into a term of the application year (H1 happy path)', async () => {
    const app = await makeApplication(y2026.academicYearId);
    seq += 1;
    const result = await asTenant(() =>
      admissions.admit({
        organizationId,
        applicationId: app.id,
        name: `Right Year ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `RY-${seq}` },
      }),
    );
    expect(result.enrollment.academicYearId).toBe(y2026.academicYearId);
  });

  /* ── H2: placement → compulsory course roster ───────────────────────────── */

  it('enrols a newly admitted learner into compulsory offerings, not electives (H2)', async () => {
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Roster Pupil ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `RP-${seq}` },
      }),
    );
    const enrollmentId = admitted.enrollment.id;

    const core = await raw.courseEnrollment.findUnique({
      where: { courseOfferingId_studentEnrollmentId: { courseOfferingId: coreOfferingId, studentEnrollmentId: enrollmentId } },
    });
    expect(core?.status).toBe('ENROLLED');
    expect(core?.source).toBe('COMPULSORY');

    const elective = await raw.courseEnrollment.findUnique({
      where: { courseOfferingId_studentEnrollmentId: { courseOfferingId: electiveOfferingId, studentEnrollmentId: enrollmentId } },
    });
    expect(elective).toBeNull();
  });

  it('never resurrects an opt-out, and reconciles again on a stream move (H2)', async () => {
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Opted Out ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `OO-${seq}` },
      }),
    );
    const key = {
      courseOfferingId_studentEnrollmentId: { courseOfferingId: coreOfferingId, studentEnrollmentId: admitted.enrollment.id },
    };
    // The school decided this learner sits out the core offering.
    await raw.courseEnrollment.update({ where: key, data: { status: 'OPTED_OUT', source: 'OPT_OUT' } });

    // Reconciling again — as a later placement, promotion or roster capture does
    // — must leave that decision alone. A reconciliation that re-enrolled every
    // opt-out on the next class move would quietly undo the school's choice.
    const enrollment = await raw.studentEnrollment.findFirst({ where: { id: admitted.enrollment.id } });
    await asTenant(() =>
      moduleRef.get(PrismaService).client.$transaction((tx: any) =>
        reconcileCompulsoryRostersInTx(tx, {
          organizationId,
          enrollmentId: enrollment!.id,
          termId: y2026.termId,
          classCohortId: y2026.classCohortId,
          sectionId: y2026.sectionId,
          effectiveFrom: new Date('2026-02-01'),
        }),
      ),
    );
    expect((await raw.courseEnrollment.findUnique({ where: key }))?.status).toBe('OPTED_OUT');
  });

  it('reconciles a learner moved into the class mid-term (H2)', async () => {
    // A second class in the same term, so the move is a real placement change.
    const other = await ensureAcademicSpine(raw, {
      organizationId,
      yearName: '2026',
      termName: 'Term 1',
      gradeName: 'P4',
      gradeOrder: 4,
      className: 'P4 West',
    });
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Moved Pupil ${seq}`,
        placement: { termId: y2026.termId, classId: other.classId, rollNumber: `MP-${seq}` },
      }),
    );
    const key = {
      courseOfferingId_studentEnrollmentId: { courseOfferingId: coreOfferingId, studentEnrollmentId: admitted.enrollment.id },
    };
    // P4 West is a different cohort, so the P4 East offering does not cover them.
    expect(await raw.courseEnrollment.findUnique({ where: key })).toBeNull();

    await asTenant(() =>
      placements.move(admitted.enrollment.id, { classId: y2026.classId, effectiveFrom: '2026-10-01' } as any),
    );
    expect((await raw.courseEnrollment.findUnique({ where: key }))?.status).toBe('ENROLLED');
  });

  it('captures an assessment roster that includes the new learner (H2 end to end)', async () => {
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Assessed Pupil ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `AP-${seq}` },
      }),
    );
    const roster = await asTenant(() => assessments.captureRoster(coreOfferingId));
    expect(roster.memberCount).toBeGreaterThan(0);

    const members = await raw.academicRosterMember.findMany({ where: { rosterId: roster.id }, select: { studentProfileId: true } });
    expect(members.map((m) => m.studentProfileId)).toContain(admitted.profile.id);
  });

  /* ── H3: published results → family-visible report card ─────────────────── */

  it('refuses to publish a report card built from live marks (H3)', async () => {
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Card Pupil ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `CP-${seq}` },
      }),
    );
    const card = await raw.reportCard.create({
      data: {
        organizationId,
        studentProfileId: admitted.profile.id,
        termId: y2026.termId,
        payload: { provenance: { source: 'live_spine', isDraft: true } } as any,
      },
    });
    await expect(asTenant(() => exams.publish(card.id))).rejects.toThrow(BadRequestException);

    const after = await raw.reportCard.findFirst({ where: { id: card.id } });
    expect(after?.publishedAt).toBeNull();
  });

  it('refuses a card pinned to a superseded result revision (H3)', async () => {
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Stale Card ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `SC-${seq}` },
      }),
    );
    const resultSet = await raw.resultSet.create({
      data: {
        organizationId,
        termId: y2026.termId,
        scopeType: 'class',
        scopeId: `scope-stale-${stamp}`,
        revision: 2,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    const card = await raw.reportCard.create({
      data: {
        organizationId,
        studentProfileId: admitted.profile.id,
        termId: y2026.termId,
        payload: {
          provenance: { source: 'result_spine', resultSetId: resultSet.id, resultSetRevision: 1 },
        } as any,
      },
    });
    await expect(asTenant(() => exams.publish(card.id))).rejects.toThrow(BadRequestException);
  });

  it('publishes a card pinned to the current published revision (H3 happy path)', async () => {
    seq += 1;
    const admitted = await asTenant(() =>
      admissions.admit({
        organizationId,
        name: `Good Card ${seq}`,
        placement: { termId: y2026.termId, classId: y2026.classId, rollNumber: `GC-${seq}` },
      }),
    );
    const resultSet = await raw.resultSet.create({
      data: {
        organizationId,
        termId: y2026.termId,
        scopeType: 'class',
        scopeId: `scope-good-${stamp}`,
        revision: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    const card = await raw.reportCard.create({
      data: {
        organizationId,
        studentProfileId: admitted.profile.id,
        termId: y2026.termId,
        payload: {
          provenance: { source: 'result_spine', resultSetId: resultSet.id, resultSetRevision: 1 },
        } as any,
      },
    });
    await asTenant(() => exams.publish(card.id));
    const after = await raw.reportCard.findFirst({ where: { id: card.id } });
    expect(after?.publishedAt).not.toBeNull();
  });

  /* ── Front-desk guardian handling ───────────────────────────────────────── */

  it('leaves no orphan contact when the admission fails (P2)', async () => {
    const before = await raw.contact.count({ where: { organizationId } });
    await expect(
      asTenant(() =>
        admissions.register({
          name: 'Failing Pupil',
          classId: y2026.classId,
          // A term that does not exist: the placement fails after the guardian
          // would previously have been created.
          termId: '00000000-0000-0000-0000-000000000000',
          guardianName: 'Orphan Parent',
          guardianPhone: '+256 700 000 111',
        } as any),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(await raw.contact.count({ where: { organizationId } })).toBe(before);
  });

  it('reuses one parent contact across two children (P2)', async () => {
    seq += 1;
    const first = await asTenant(() =>
      admissions.register({
        name: `Sibling One ${seq}`,
        classId: y2026.classId,
        termId: y2026.termId,
        rollNumber: `S1-${seq}`,
        guardianName: 'Maama Nakato',
        guardianPhone: '0790 600 100',
      } as any),
    );
    seq += 1;
    const second = await asTenant(() =>
      admissions.register({
        name: `Sibling Two ${seq}`,
        classId: y2026.classId,
        termId: y2026.termId,
        rollNumber: `S2-${seq}`,
        guardianName: 'Maama Nakato',
        // Same parent, written the way the second form filled it in.
        guardianPhone: '+256790600100',
      } as any),
    );

    const links = await raw.studentGuardian.findMany({
      where: { studentProfileId: { in: [first.profile.id, second.profile.id] } },
      select: { guardianContactId: true },
    });
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.guardianContactId)).size).toBe(1);
  });
});
