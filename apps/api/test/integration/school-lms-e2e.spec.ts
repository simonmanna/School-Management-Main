/**
 * Integration — the whole learner journey against a real DB.
 *
 * This is the join the product actually sells: an LMS activity is not a separate
 * gradebook, it is a front door onto the assessment spine. So the flow under test
 * is end to end —
 *
 *   teacher adds an assignment
 *     → the spine mints ONE Assessment and fans out StudentAssessment rows
 *     → the pupil submits
 *     → the teacher marks
 *     → the mark is withheld until moderation approves it
 *     → once approved it reaches the pupil, the envelope and the term result
 *
 * The withholding step is the one most easily lost in a refactor, so it is
 * asserted from three different readers.
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
import { AssessmentWorkflowService } from '../../src/modules/school/assessment/assessment-workflow.service';
import { CourseService } from '../../src/modules/school/lms/moodle/course/course.service';
import { CourseModuleService } from '../../src/modules/school/lms/moodle/course/module.service';
import { ViewEnvelopeService } from '../../src/modules/school/lms/moodle/course/view-envelope.service';
import { LearnerService } from '../../src/modules/school/lms/moodle/learner/learner.service';
import { CompletionService } from '../../src/modules/school/lms/moodle/completion/completion.service';
import { CourseBackupService } from '../../src/modules/school/lms/moodle/backup/course-backup.service';
import { LmsOrphanCheckService } from '../../src/modules/school/lms/moodle/maintenance/orphan-check.service';
import type { PortalClaim } from '../../src/kernel/auth/portal-identity.types';

describeDb('integration: LMS → assessment → result, end to end', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let courses: CourseService;
  let modules: CourseModuleService;
  let envelope: ViewEnvelopeService;
  let learner: LearnerService;
  let completion: CompletionService;
  let backup: CourseBackupService;

  const organizationId = `org_e2e_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let termId = '', term2Id = '', classId = '', subjectId = '', yearId = '', curriculumId = '';
  let gradeLevelId = '', programmeId = '';
  let workflow: AssessmentWorkflowService;
  let studentProfileId = '', studentUserId = '';
  let offeringId = '', offering2Id = '', sectionId = '', assignModuleId = '';

  const staffPerms = [
    'school:read', 'school:lms:read', 'school:courses:write', 'school:grades:write',
    'school:enrol:write', 'school:assessments:write',
  ];
  const asStaff = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'e2e_teacher', permissions: staffPerms }, fn);
  const asStudent = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      {
        organizationId, userId: studentUserId, permissions: ['school:read'],
        portal: { kind: 'student', studentProfileId } as PortalClaim,
      },
      fn,
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' }, update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `E2E-${Date.now()}`, name: 'E2E School', currencyCode: 'UGX' },
    });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    yearId = year.id;
    termId = (await raw.term.create({
      data: { organizationId, academicYearId: yearId, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
    })).id;
    term2Id = (await raw.term.create({
      data: { organizationId, academicYearId: yearId, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-15') },
    })).id;

    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S3', order: 10 } });
    gradeLevelId = grade.id;
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S3 E2E' } })).id;
    programmeId = (await raw.academicProgramme.create({
      data: {
        organizationId, code: 'LOWER_SECONDARY', name: 'Lower Secondary (S1–S4)',
        stage: 'LOWER_SECONDARY', curriculumAuthority: 'UNEB', effectiveFrom: new Date('2026-01-01'),
      },
    })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'MTH', name: 'Mathematics' } })).id;
    curriculumId = (await raw.curriculum.create({
      data: { organizationId, academicYearId: yearId, classId, name: 'Maths S3', status: 'published' },
    })).id;

    const partner = await raw.partner.create({ data: { organizationId, name: 'Nakato Grace', code: `P-E2E-${Date.now()}` } });
    studentProfileId = (await raw.studentProfile.create({
      data: {
        organizationId, partnerId: partner.id, admissionNo: `ADM-E2E-${Date.now()}`,
        currentClassId: classId, enrollmentDate: new Date('2026-01-15'), status: 'active',
      },
    })).id;
    studentUserId = (await raw.user.create({
      data: { organizationId, email: `pupil-${Date.now()}@example.test`, passwordHash: 'x', firstName: 'Grace', lastName: 'N', isActive: true },
    })).id;
    await raw.portalIdentity.create({
      data: { organizationId, userId: studentUserId, subjectType: 'student', studentProfileId },
    });

    // Phase 2's rule: an offering an assessment hangs off must be PUBLISHED or
    // ACTIVE and must name a responsible teacher. The fixture predates it and
    // left both at their defaults, so publishing an assessment was refused.
    const teacherPartner = await raw.partner.create({
      data: { organizationId, name: 'Mr Ochieng', code: `T-E2E-${Date.now()}`, isEmployee: true },
    });
    const teacherStaffId = (await raw.staffProfile.create({
      data: { organizationId, partnerId: teacherPartner.id, employeeNo: `STF-E2E-${Date.now()}`, joinDate: new Date('2026-01-05') },
    })).id;

    const mkOffering = (tId: string) => raw.courseOffering.create({
      data: {
        organizationId, academicYearId: yearId, termId: tId, subjectId, classId, curriculumId,
        // Phase 2 gave an offering an operator-facing name; the fixture never set
        // one, so the course page fell back to the "Course offering" default and
        // the "shows a name, not a uuid" assertion had nothing to find.
        name: 'Mathematics S3',
        status: 'PUBLISHED',
        format: 'weeks', numSections: 4, visible: true, completionEnabled: true, showGradesToStudents: true,
      },
    });
    offeringId = (await mkOffering(termId)).id;
    offering2Id = (await mkOffering(term2Id)).id;
    for (const oId of [offeringId, offering2Id]) {
      await raw.courseOfferingTeacher.create({
        data: {
          organizationId, courseOfferingId: oId, teacherPartnerId: teacherStaffId,
          role: 'LEAD', isResponsible: true, effectiveFrom: new Date('2026-01-05'),
        },
      });
    }

    // The pupil is on the course. Enrolment records HOW they got in, so it needs
    // a method row — the same shape roster sync produces.
    const method = await raw.courseEnrolmentMethod.create({
      data: { organizationId, courseOfferingId: offeringId, method: 'manual', enabled: true },
    });
    await raw.courseEnrolment.create({
      data: { organizationId, courseOfferingId: offeringId, methodId: method.id, studentProfileId, status: 'active' },
    });

    // `CourseEnrolment` above is the LMS's own record of HOW the pupil got onto
    // the course. `CourseEnrollment` below is the canonical academic one, hung
    // off the official StudentEnrollment — and since Phase 4 it is what the
    // grade bridge freezes a roster from, so without it adding a gradable
    // activity is refused ("Prepare official course enrollment…"). Two models,
    // one letter apart, and the fixture only had the first.
    const officialEnrollment = await raw.studentEnrollment.create({
      data: {
        organizationId, studentProfileId, academicYearId: yearId, programmeId, gradeLevelId,
        admissionDate: new Date('2026-01-15'), status: 'ACTIVE',
      },
    });
    for (const oId of [offeringId, offering2Id]) {
      await raw.courseEnrollment.create({
        data: {
          organizationId, courseOfferingId: oId, studentEnrollmentId: officialEnrollment.id,
          source: 'COMPULSORY', status: 'ENROLLED', startDate: new Date('2026-01-15'),
        },
      });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    courses = moduleRef.get(CourseService);
    modules = moduleRef.get(CourseModuleService);
    envelope = moduleRef.get(ViewEnvelopeService);
    learner = moduleRef.get(LearnerService);
    completion = moduleRef.get(CompletionService);
    workflow = moduleRef.get(AssessmentWorkflowService);
    backup = moduleRef.get(CourseBackupService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('1. a teacher builds the course spine', async () => {
    const sections = await asStaff(() => courses.ensureSections(offeringId));
    expect(sections.length).toBeGreaterThan(0);
    sectionId = sections.find((s) => s.sectionNo === 1)!.id;
    expect(sectionId).toBeTruthy();
  });

  it('2. adding a gradable activity mints exactly ONE assessment and fans the roster out', async () => {
    const cm = await asStaff(() =>
      modules.add(offeringId, {
        activityType: 'assign', sectionId,
        name: 'Algebra homework', intro: '<p>Do questions 1–10.</p>',
        maxScore: 20, submissionTypes: ['online_text'],
        completionMode: 'automatic', completionRules: { submit: true },
      } as any),
    );
    assignModuleId = cm.id;
    expect(cm.assessmentId).toBeTruthy();

    // ADR-014's rule: a grade-bearing module owns exactly one Assessment.
    const assessments = await raw.assessment.findMany({
      where: { organizationId, sourceType: 'lms_activity', sourceRef: cm.id },
    });
    expect(assessments).toHaveLength(1);
    expect(Number(assessments[0].maxScore)).toBe(20);

    // Adding the activity freezes a roster from the official course enrollment
    // but leaves the assessment in DRAFT: since Phase 4, publication is the act
    // that fans learners out, and it belongs to the Assessment Board rather than
    // to whoever dropped an activity onto a course page.
    expect(assessments[0].status).toBe('draft');
    expect(assessments[0].rosterId).toBeTruthy();
    const before = await raw.studentAssessment.count({ where: { organizationId, assessmentId: cm.assessmentId! } });
    expect(before).toBe(0);

    // Publishing it through the canonical path is what gives the enrolled pupil
    // a row to be marked in.
    await asStaff(() => workflow.transition(cm.assessmentId!, { action: 'publish', expectedVersion: assessments[0].version } as any));

    const rows = await raw.studentAssessment.findMany({
      where: { organizationId, assessmentId: cm.assessmentId!, studentProfileId },
    });
    expect(rows).toHaveLength(1);
  });

  it('3. the sanitiser cleaned the teacher\'s HTML on write', async () => {
    const cm = await raw.courseModule.findFirst({ where: { id: assignModuleId } });
    const inst = await raw.modAssign.findFirst({ where: { id: cm!.instanceId } });
    expect(inst!.intro).toBe('<p>Do questions 1–10.</p>');

    await asStaff(() => modules.updateInstance(assignModuleId, { intro: '<p>ok</p><script>alert(1)</script>' }));
    const after = await raw.modAssign.findFirst({ where: { id: cm!.instanceId } });
    // Stored inert, so every future reader is safe without remembering to clean.
    expect(after!.intro).toBe('<p>ok</p>');
    expect(after!.intro).not.toContain('script');
  });

  it('4. the course page shows the activity by NAME, not by uuid', async () => {
    const page = await asStaff(() => courses.coursePage(offeringId, { canViewHidden: true }));
    const found = page.sections.flatMap((s) => s.modules).find((m) => m.id === assignModuleId);
    expect(found?.name).toBe('Algebra homework');
    expect(page.course.name).toContain('Mathematics');
    expect(page.course.name).not.toMatch(/^[0-9a-f-]{36}$/);
  });

  it('5. the pupil submits their work', async () => {
    await asStudent(() => modules.action(assignModuleId, 'submit', { content: 'x = 4' }));
    const sub = await raw.modAssignSubmission.findFirst({
      where: { organizationId, courseModuleId: assignModuleId, studentProfileId },
    });
    expect(sub?.status).toBe('submitted');
    expect(sub?.content).toBe('x = 4');
  });

  it('6. submitting satisfied the automatic completion rule', async () => {
    const state = await asStudent(async () => {
      const cm = await raw.courseModule.findFirst({ where: { id: assignModuleId } });
      return completion.recomputeAuto(cm as any, studentProfileId);
    });
    expect(state).toBe('complete');

    const pct = await asStudent(() => envelope.progressFor(offeringId, studentProfileId));
    expect(pct.completed).toBe(1);
    expect(pct.percent).toBeGreaterThan(0);
  });

  it('7. a mark entered but NOT yet approved is withheld from the pupil', async () => {
    await asStaff(() => modules.action(assignModuleId, 'grade', { studentProfileId, score: 17, asStudent: studentProfileId }));

    const sa = await raw.studentAssessment.findFirst({
      where: { organizationId, studentProfileId, assessment: { sourceRef: assignModuleId } },
    });
    expect(Number(sa!.effectiveScore)).toBe(17);
    // The score exists in the spine…
    expect(sa!.approvalStatus).not.toBe('approved');

    // …but no reader shows it to the learner yet. A newly minted LMS grade item
    // is `hiddenFromStudents` (Moodle's behaviour, and the bridge's), so the
    // envelope omits the grade block entirely rather than returning an unreleased
    // one — a stronger guarantee than this case used to assert, and the reason it
    // reads `?.` rather than a bare property.
    const cm = await raw.courseModule.findFirst({ where: { id: assignModuleId } });
    const [view] = await asStudent(() =>
      envelope.moduleViews([cm as any], { studentProfileId, showGrades: true }),
    );
    expect(view.grade?.released ?? false).toBe(false);
    expect(view.grade?.score ?? null).toBeNull();

    const recent = await asStudent(() => learner.recentGrades());
    expect(recent.find((g) => g.score === 17)).toBeUndefined();
  });

  it('8. approving and releasing shows the mark to every reader at once', async () => {
    await raw.studentAssessment.updateMany({
      where: { organizationId, studentProfileId, assessment: { sourceRef: assignModuleId } },
      data: { approvalStatus: 'approved' },
    });

    // Approval is not publication. `release_marks` is the deliberate second act
    // that unhides the item and stamps `marksReleaseAt`, and it is what every
    // reader keys off — so the release goes through the canonical path here
    // rather than being simulated with a column update.
    const assessment = await raw.assessment.findFirst({ where: { organizationId, sourceRef: assignModuleId } });
    await asStaff(() =>
      workflow.transition(assessment!.id, { action: 'release_marks', expectedVersion: assessment!.version } as any),
    );

    const cm = await raw.courseModule.findFirst({ where: { id: assignModuleId } });
    const [view] = await asStudent(() =>
      envelope.moduleViews([cm as any], { studentProfileId, showGrades: true }),
    );
    expect(view.grade?.released).toBe(true);
    expect(view.grade?.score).toBe(17);
    expect(view.grade?.maxScore).toBe(20);

    const recent = await asStudent(() => learner.recentGrades());
    expect(recent.some((g) => g.score === 17)).toBe(true);
  });

  it('9. the learner dashboard shows the course with real progress', async () => {
    const dash = await asStudent(() => learner.dashboard());
    expect(dash.student.studentProfileId).toBe(studentProfileId);
    expect(dash.courses.some((c) => c.id === offeringId)).toBe(true);
    const course = dash.courses.find((c) => c.id === offeringId)!;
    expect(course.progress.completed).toBe(1);
  });

  it('10. a pupil cannot read another pupil\'s activity', async () => {
    const otherPartner = await raw.partner.create({ data: { organizationId, name: 'Other', code: `P-OTH-${Date.now()}` } });
    const other = await raw.studentProfile.create({
      data: {
        organizationId, partnerId: otherPartner.id, admissionNo: `ADM-OTH-${Date.now()}`,
        currentClassId: classId, enrollmentDate: new Date(), status: 'active',
      },
    });
    await expect(
      asStudent(() => modules.view(assignModuleId, { asStudent: other.id })),
    ).rejects.toThrow(/only act as yourself/i);
  });

  it('11. rollover clones the structure into the next term without the pupil\'s work', async () => {
    const result = await asStaff(() => backup.rollover({ fromTermId: termId, toTermId: term2Id }));
    expect(result.rolled).toHaveLength(1);
    expect(result.rolled[0].to).toBe(offering2Id);

    const cloned = await raw.courseModule.findMany({
      where: { organizationId, courseOfferingId: offering2Id, deletedAt: null },
    });
    expect(cloned).toHaveLength(1);
    expect(cloned[0].id).not.toBe(assignModuleId);

    // Structure only: no submissions and no completions came across.
    const carried = await raw.modAssignSubmission.findMany({
      where: { organizationId, courseModuleId: cloned[0].id },
    });
    expect(carried).toHaveLength(0);
    const completions = await raw.courseModuleCompletion.findMany({
      where: { organizationId, courseModuleId: cloned[0].id },
    });
    expect(completions).toHaveLength(0);
    // …and no stale deadline that would read as overdue on day one.
    expect(cloned[0].dueAt).toBeNull();
  });

  it('12. running rollover a second time does not duplicate the course', async () => {
    const again = await asStaff(() => backup.rollover({ fromTermId: termId, toTermId: term2Id }));
    expect(again.rolled).toHaveLength(0);
    expect(again.unmatched[0].reason).toMatch(/already has activities/);
    const cloned = await raw.courseModule.findMany({
      where: { organizationId, courseOfferingId: offering2Id, deletedAt: null },
    });
    expect(cloned).toHaveLength(1);
  });

  it('13. the orphan reconciler notices a module whose instance vanished', async () => {
    const cm = await raw.courseModule.findFirst({ where: { id: assignModuleId } });
    await raw.modAssign.deleteMany({ where: { id: cm!.instanceId } });

    const orphanCheck = moduleRef.get(LmsOrphanCheckService);
    const orphans = await asStaff(() => orphanCheck.scan(organizationId));
    expect(orphans.some((o) => o.courseModuleId === assignModuleId && o.reason === 'missing_instance')).toBe(true);
  });
});
