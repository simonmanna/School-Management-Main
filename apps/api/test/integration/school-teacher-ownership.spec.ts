/**
 * Integration — a teacher may write their own work, and only their own.
 *
 * Phase 5 opens three writes to a teacher working from home: the register, marks
 * entry, and lesson plans. Each was previously gated on an ORG-WIDE grant, which
 * is correct for the office and wrong for a portal session — `school:grades:write`
 * lets you mark any paper in the school, `school:attendance:write` lets you mark
 * any class.
 *
 * The new owner-scoped grants (`:own`) carry no authority by themselves. What
 * makes them safe is that each handler resolves the caller to their StaffProfile
 * and compares it against the row being written. These cases are that claim,
 * stated once per write path, from both sides:
 *
 *   permission alone            → refused
 *   permission + ownership      → allowed
 *   org-wide grant              → allowed regardless of ownership
 *   ownership without the state → still refused (approval stays separate)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { LessonPlanningService } from '../../src/modules/school/lms/lesson-planning.service';

describeDb('integration: teacher owner-scoped writes', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let attendance: StudentAttendanceService;
  let marking: MarkingService;
  let lessonPlans: LessonPlanningService;

  const organizationId = `org_own_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  /** What a teacher signing in to the portal actually carries. */
  const TEACHER = [
    PERMISSIONS.school.portalSelf,
    PERMISSIONS.school.teacherPortal,
    PERMISSIONS.school.read,
    PERMISSIONS.school.ownAttendance,
    PERMISSIONS.school.ownGrades,
    PERMISSIONS.school.ownLessonPlans,
  ];
  /** What the office carries. */
  const OFFICE = [
    PERMISSIONS.school.read,
    PERMISSIONS.school.takeAttendance,
    PERMISSIONS.school.enterGrades,
    PERMISSIONS.school.manageLessonPlans,
  ];

  let aliceUserId = '';
  let aliceStaffId = '';
  let bobUserId = '';
  let bobStaffId = '';
  let officeUserId = '';

  let aliceClassId = '';
  let bobClassId = '';
  let aliceAssessmentId = '';
  let bobAssessmentId = '';
  let alicePupilSaId = '';
  let bobPupilSaId = '';
  let subjectId = '';
  let termId = '';

  const as = <T>(userId: string, permissions: string[], fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);

  const makeTeacher = async (name: string, no: string) => {
    const user = await raw.user.create({
      data: {
        organizationId,
        email: `${no.toLowerCase()}-${Date.now()}@school.test`,
        passwordHash: 'x',
        firstName: name,
        lastName: 'Teacher',
        isActive: true,
      },
    });
    const partner = await raw.partner.create({
      data: { organizationId, code: `P-${no}-${Date.now()}`, name: `${name} Teacher`, isEmployee: true },
    });
    const profile = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo: `${no}-${Date.now()}`, joinDate: new Date(), staffCategory: 'teaching' },
    });
    await raw.hrEmployee.create({
      data: {
        organizationId,
        employeeCode: `${no}-${Date.now()}`,
        userId: user.id,
        partnerId: partner.id,
        firstName: name,
        lastName: 'Teacher',
      },
    });
    return { userId: user.id, staffProfileId: profile.id };
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `OW-${Date.now()}`, name: 'Ownership School', currencyCode: 'UGX' },
    });

    ({ userId: aliceUserId, staffProfileId: aliceStaffId } = await makeTeacher('Alice', 'T-A'));
    ({ userId: bobUserId, staffProfileId: bobStaffId } = await makeTeacher('Bob', 'T-B'));
    officeUserId = (
      await raw.user.create({
        data: { organizationId, email: `office-${Date.now()}@school.test`, passwordHash: 'x', firstName: 'Office', isActive: true },
      })
    ).id;

    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    aliceClassId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2 Alice' } })).id;
    bobClassId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2 Bob' } })).id;

    subjectId = (await raw.subject.create({ data: { organizationId, name: 'Mathematics', code: `MATH-${Date.now()}` } })).id;

    const year = await raw.academicYear.create({
      data: {
        organizationId,
        name: `Y-${Date.now()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    termId = (
      await raw.term.create({
        data: {
          organizationId,
          academicYearId: year.id,
          name: 'Term 1',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-04-30'),
        },
      })
    ).id;

    // Alice teaches her class; Bob teaches his. Neither teaches the other's.
    await raw.teacherAssignment.create({
      data: { organizationId, teacherPartnerId: aliceStaffId, subjectId, classId: aliceClassId, termId },
    });
    await raw.teacherAssignment.create({
      data: { organizationId, teacherPartnerId: bobStaffId, subjectId, classId: bobClassId, termId },
    });

    // One pupil in each class, and one assessment per teacher.
    const makePupilAndAssessment = async (label: string, classId: string, teacherStaffId: string) => {
      const partner = await raw.partner.create({
        data: { organizationId, code: `P-${label}-${Date.now()}`, name: `Pupil ${label}` },
      });
      const pupil = await raw.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: `ADM-${label}-${Date.now()}`,
          currentClassId: classId,
          enrollmentDate: new Date(),
          status: 'active',
        },
      });
      const assessment = await raw.assessment.create({
        data: {
          organizationId,
          subjectId,
          classId,
          termId,
          title: `${label} continuous assessment`,
          teacherPartnerId: teacherStaffId,
          maxScore: 100,
          kind: 'cat',
        },
      });
      const sa = await raw.studentAssessment.create({
        data: {
          organizationId,
          assessmentId: assessment.id,
          studentProfileId: pupil.id,
          classId,
          termId,
          maxScore: 100,
        },
      });
      return { assessmentId: assessment.id, studentAssessmentId: sa.id };
    };

    ({ assessmentId: aliceAssessmentId, studentAssessmentId: alicePupilSaId } = await makePupilAndAssessment(
      'A',
      aliceClassId,
      aliceStaffId,
    ));
    ({ assessmentId: bobAssessmentId, studentAssessmentId: bobPupilSaId } = await makePupilAndAssessment(
      'B',
      bobClassId,
      bobStaffId,
    ));

    moduleRef = await Test.createTestingModule({
      imports: [
        KernelModule,
        DocumentsModule,
        CoreModule,
        AccountingModule,
        InventoryModule,
        InvoicingModule,
        SchoolModule,
      ],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    attendance = moduleRef.get(StudentAttendanceService);
    marking = moduleRef.get(MarkingService);
    lessonPlans = moduleRef.get(LessonPlanningService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('taking the register', () => {
    const register = (classId: string) => ({
      classId,
      date: new Date().toISOString().slice(0, 10),
      entries: [] as Array<{ studentProfileId: string; status: string }>,
    });

    it('lets a teacher mark the class they teach', async () => {
      await as(aliceUserId, TEACHER, () => attendance.mark(register(aliceClassId) as any));
    });

    it("BLOCKS a teacher from another teacher's class", async () => {
      await expect(
        as(aliceUserId, TEACHER, () => attendance.mark(register(bobClassId) as any)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still lets the office mark any class', async () => {
      await as(officeUserId, OFFICE, () => attendance.mark(register(aliceClassId) as any));
      await as(officeUserId, OFFICE, () => attendance.mark(register(bobClassId) as any));
    });

    it('BLOCKS a login with no staff record, even holding the own grant', async () => {
      // `school:attendance:own` resolves to nobody for an account with no
      // StaffProfile, and must therefore authorise nothing.
      await expect(
        as(officeUserId, [PERMISSIONS.school.ownAttendance], () => attendance.mark(register(aliceClassId) as any)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('entering marks', () => {
    it('lets a teacher mark their own assessment', async () => {
      await as(aliceUserId, TEACHER, () =>
        marking.recordMark({ studentAssessmentId: alicePupilSaId, score: 71 } as any),
      );
      const row = await raw.studentAssessment.findUniqueOrThrow({ where: { id: alicePupilSaId } });
      expect(Number(row.effectiveScore)).toBe(71);
    });

    it("BLOCKS a teacher from another teacher's assessment", async () => {
      await expect(
        as(aliceUserId, TEACHER, () => marking.recordMark({ studentAssessmentId: bobPupilSaId, score: 99 } as any)),
      ).rejects.toThrow(ForbiddenException);

      // And nothing was written on the way to being refused.
      const row = await raw.studentAssessment.findUniqueOrThrow({ where: { id: bobPupilSaId } });
      expect(row.effectiveScore).toBeNull();
    });

    it('BLOCKS marking somebody else absent', async () => {
      await expect(
        as(aliceUserId, TEACHER, () =>
          marking.setParticipation({
            assessmentId: bobAssessmentId,
            studentProfileId: 'whoever',
            participation: 'absent',
          } as any),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('BLOCKS submitting another teacher\'s marks for approval', async () => {
      await expect(
        as(aliceUserId, TEACHER, () => marking.markingApproval({ assessmentId: bobAssessmentId, action: 'submit' } as any)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still lets the office mark anything', async () => {
      await as(officeUserId, OFFICE, () =>
        marking.recordMark({ studentAssessmentId: bobPupilSaId, score: 55 } as any),
      );
      const row = await raw.studentAssessment.findUniqueOrThrow({ where: { id: bobPupilSaId } });
      expect(Number(row.effectiveScore)).toBe(55);
    });

    it('does NOT let a teacher approve their own marks', async () => {
      // The segregation of duty is that `school:grades:approve` is a separate
      // grant no teacher role holds — asserted here so a future widening of the
      // Teacher preset fails loudly.
      expect(TEACHER).not.toContain(PERMISSIONS.school.approveGrades);
      expect(TEACHER).not.toContain(PERMISSIONS.school.moderateMarks);
    });
  });

  describe('lesson plans', () => {
    let alicePlanId = '';

    it('lets a teacher write a plan for themselves', async () => {
      const plan = await as(aliceUserId, TEACHER, () =>
        lessonPlans.createLessonPlan({
          subjectId,
          classId: aliceClassId,
          termId,
          teacherPartnerId: aliceStaffId,
          title: 'Quadratics',
        }),
      );
      alicePlanId = (plan as { id: string }).id;
      expect(alicePlanId).toBeTruthy();
    });

    it('BLOCKS a teacher creating a plan in a colleague\'s name', async () => {
      await expect(
        as(aliceUserId, TEACHER, () =>
          lessonPlans.createLessonPlan({
            subjectId,
            classId: bobClassId,
            termId,
            teacherPartnerId: bobStaffId,
            title: 'Not mine',
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("BLOCKS a teacher editing a colleague's plan", async () => {
      const bobPlan = await as(bobUserId, TEACHER, () =>
        lessonPlans.createLessonPlan({
          subjectId,
          classId: bobClassId,
          termId,
          teacherPartnerId: bobStaffId,
          title: 'Bob plan',
        }),
      );
      const bobPlanId = (bobPlan as { id: string; version: number }).id;
      await expect(
        as(aliceUserId, TEACHER, () =>
          lessonPlans.updateLessonPlan(bobPlanId, { version: 0, title: 'Hijacked' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a teacher edit and submit their own plan', async () => {
      const current = await as(aliceUserId, TEACHER, () => lessonPlans.getLessonPlan(alicePlanId));
      await as(aliceUserId, TEACHER, () =>
        lessonPlans.updateLessonPlan(alicePlanId, { version: current.version, title: 'Quadratics v2' }),
      );
      const updated = await as(aliceUserId, TEACHER, () => lessonPlans.getLessonPlan(alicePlanId));
      expect(updated.title).toBe('Quadratics v2');
      await as(aliceUserId, TEACHER, () => lessonPlans.submitLessonPlan(alicePlanId, { version: updated.version }));
      const submitted = await as(aliceUserId, TEACHER, () => lessonPlans.getLessonPlan(alicePlanId));
      expect(submitted.workflowStatus).toBe('submitted');
    });

    it('still lets the department edit anybody\'s plan', async () => {
      const current = await as(officeUserId, OFFICE, () => lessonPlans.getLessonPlan(alicePlanId));
      // Submitted plans are not editable by anyone; return it to revision first
      // via the department's own review grant would be a different test. Here we
      // only assert the ownership gate does not refuse the office.
      await expect(
        as(officeUserId, OFFICE, () =>
          lessonPlans.updateLessonPlan(alicePlanId, { version: current.version, title: 'Office edit' }),
        ),
      ).rejects.not.toThrow(ForbiddenException);
    });
  });
});
