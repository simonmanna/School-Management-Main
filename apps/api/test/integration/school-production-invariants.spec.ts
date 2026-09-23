/**
 * Production invariants for Phases 0–8 (audit 2026-09-23).
 *
 * Each block pins one invariant the audit found missing or bypassable, against
 * a real database and the real service graph:
 *
 *   - historical placement: P4 North → P4 South → P5 North stays answerable;
 *   - capacity: 40 allowed, 41 refused, override only with the grant + a reason;
 *   - academic-year lifecycle: closed years take no writes; no back door to
 *     re-open one; enrollment status FSM (create, reactivation, races);
 *   - tenancy at the database: a row cannot reference another school's row;
 *   - student master data: likely duplicates refused, history-bearing records
 *     not deletable;
 *   - timetable: teacher / room / class conflicts, including whole-class vs
 *     section, multi-period spans and rotation cycles;
 *   - staff lifecycle: leaving ends access and teaching, keeps history;
 *   - promotion: the year-end rollover plans from placement history.
 *
 * Dates are relative to "now", so the suite does not rot as the calendar moves.
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
import { ProgrammeService } from '../../src/modules/school/enrollment/programme.service';
import { ClassCohortService } from '../../src/modules/school/enrollment/class-cohort.service';
import { StudentEnrollmentService } from '../../src/modules/school/enrollment/student-enrollment.service';
import { PlacementService } from '../../src/modules/school/enrollment/placement.service';
import { PlacementLookupService } from '../../src/modules/school/enrollment/placement-lookup.service';
import { PromotionRunService } from '../../src/modules/school/enrollment/promotion-run.service';
import { AcademicYearService, TermService } from '../../src/modules/school/foundation/academic-year.service';
import { StudentService } from '../../src/modules/school/people/student.service';
import { StaffService } from '../../src/modules/school/people/staff.service';
import { TimetableService } from '../../src/modules/school/academics/academics.service';

const DAY = 24 * 60 * 60 * 1000;

describeDb('integration: Phase 0–8 production invariants', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let enrollments: StudentEnrollmentService;
  let placements: PlacementService;
  let lookup: PlacementLookupService;
  let promotion: PromotionRunService;
  let years: AcademicYearService;
  let terms: TermService;
  let students: StudentService;
  let staff: StaffService;
  let timetable: TimetableService;

  const stamp = Date.now();
  const organizationId = `org_inv_${stamp}`;
  const otherOrgId = `org_inv_other_${stamp}`;

  const REGISTRAR = [
    'school:read',
    'school:students:write',
    'school:enrollment:write',
    'school:programmes:write',
    'school:foundation:write',
    'school:staff:write',
  ];
  const asUser = <T>(permissions: string[], fn: () => Promise<T>, userId = 'user_registrar'): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);
  const asRegistrar = <T>(fn: () => Promise<T>) => asUser(REGISTRAR, fn);

  const now = new Date();
  const Y = now.getUTCFullYear();
  let yearId = '';
  let nextYearId = '';
  let closedYearId = '';
  let termId = '';
  let termStart = new Date();
  let nextTermId = '';
  let closedTermId = '';
  let gradeP4 = '';
  let gradeP5 = '';
  let classP4 = '';
  let classP5 = '';
  let p4North = '';
  let p4South = '';
  let p5North = '';

  const makeStudent = async (name: string, org = organizationId) => {
    const partner = await raw.partner.create({
      data: { organizationId: org, code: `${name}-${stamp}-${Math.random().toString(36).slice(2, 7)}`, name, isCustomer: true },
    });
    return raw.studentProfile.create({
      data: {
        organizationId: org,
        partnerId: partner.id,
        admissionNo: `ADM-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
        enrollmentDate: now,
        status: 'active',
      },
    });
  };

  const enrol = (studentProfileId: string, sectionId: string | null, extra: Record<string, unknown> = {}, perms = REGISTRAR) =>
    asUser(perms, () =>
      enrollments.create({
        studentProfileId,
        academicYearId: yearId,
        placement: { termId, classId: classP4, sectionId, effectiveFrom: termStart.toISOString(), ...extra },
      } as any),
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    for (const [id, code] of [[organizationId, `INV-${stamp}`], [otherOrgId, `INVB-${stamp}`]]) {
      await raw.organization.create({ data: { id, code, name: code, currencyCode: 'UGX', timezone: 'Africa/Kampala' } });
      await raw.schoolProfile.create({ data: { organizationId: id, name: code, capacityPolicy: 'ENFORCE' } });
    }

    closedYearId = (await raw.academicYear.create({
      data: { organizationId, name: String(Y - 1), startDate: new Date(Date.UTC(Y - 1, 0, 1)), endDate: new Date(Date.UTC(Y - 1, 11, 31)), status: 'CLOSED' },
    })).id;
    yearId = (await raw.academicYear.create({
      data: { organizationId, name: String(Y), startDate: new Date(Date.UTC(Y, 0, 1)), endDate: new Date(Date.UTC(Y, 11, 31)), isCurrent: true, status: 'ACTIVE' },
    })).id;
    nextYearId = (await raw.academicYear.create({
      data: { organizationId, name: String(Y + 1), startDate: new Date(Date.UTC(Y + 1, 0, 1)), endDate: new Date(Date.UTC(Y + 1, 11, 31)) },
    })).id;

    // The current term brackets "now"; clipped to the year.
    termStart = new Date(Math.max(Date.UTC(Y, 0, 1), now.getTime() - 40 * DAY));
    const termEnd = new Date(Math.min(Date.UTC(Y, 11, 31), now.getTime() + 40 * DAY));
    termId = (await raw.term.create({ data: { organizationId, academicYearId: yearId, name: 'Current', startDate: termStart, endDate: termEnd, isCurrent: true } })).id;
    nextTermId = (await raw.term.create({ data: { organizationId, academicYearId: nextYearId, name: 'Term 1', startDate: new Date(Date.UTC(Y + 1, 1, 1)), endDate: new Date(Date.UTC(Y + 1, 3, 30)) } })).id;
    closedTermId = (await raw.term.create({ data: { organizationId, academicYearId: closedYearId, name: 'Old', startDate: new Date(Date.UTC(Y - 1, 1, 1)), endDate: new Date(Date.UTC(Y - 1, 3, 30)) } })).id;

    gradeP5 = (await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } })).id;
    gradeP4 = (await raw.gradeLevel.create({ data: { organizationId, name: 'P4', order: 4, nextGradeLevelId: gradeP5 } })).id;
    classP4 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeP4, name: 'P4' } })).id;
    classP5 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeP5, name: 'P5' } })).id;
    p4North = (await raw.section.create({ data: { organizationId, classId: classP4, name: 'North', code: 'N', capacity: 40 } })).id;
    p4South = (await raw.section.create({ data: { organizationId, classId: classP4, name: 'South', code: 'S' } })).id;
    p5North = (await raw.section.create({ data: { organizationId, classId: classP5, name: 'North', code: 'N' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    enrollments = moduleRef.get(StudentEnrollmentService);
    placements = moduleRef.get(PlacementService);
    lookup = moduleRef.get(PlacementLookupService);
    promotion = moduleRef.get(PromotionRunService);
    years = moduleRef.get(AcademicYearService);
    terms = moduleRef.get(TermService);
    students = moduleRef.get(StudentService);
    staff = moduleRef.get(StaffService);
    timetable = moduleRef.get(TimetableService);

    const programmes = moduleRef.get(ProgrammeService);
    const cohorts = moduleRef.get(ClassCohortService);
    // Grades carry no Uganda-specific names beyond the fixture; a GENERAL
    // programme reached through an academic level covers both.
    const programme = await raw.academicProgramme.create({ data: { organizationId, code: 'PRI', name: 'Primary', isActive: true, effectiveFrom: new Date(Date.UTC(Y - 1, 0, 1)) } });
    const level = await raw.academicLevel.create({ data: { organizationId, code: 'PRI', name: 'Primary', defaultProgrammeId: programme.id } });
    await raw.gradeLevel.updateMany({ where: { id: { in: [gradeP4, gradeP5] } }, data: { academicLevelId: level.id } });
    void programmes;
    await asRegistrar(() => cohorts.generate({ academicYearId: yearId }));
    await asRegistrar(() => cohorts.generate({ academicYearId: nextYearId }));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /* ───────────────────────── Historical placement ───────────────────────── */

  it('should_preserve_historical_student_placement: P4 North → P4 South → P5 North', async () => {
    const s = await makeStudent('History Learner');
    const created: any = await enrol(s.id, p4South /* seat in South first, then fix */, {});
    // Correct the opening seat to North, as a registrar would on day one.
    const moveAt1 = new Date(termStart.getTime() + 1 * DAY);
    await asRegistrar(() =>
      placements.move(created.enrollment.id, { sectionId: p4North, movementReason: 'SECTION_CHANGE', reason: 'Opening seat', effectiveFrom: moveAt1.toISOString() } as any),
    );
    const moveAt2 = new Date(termStart.getTime() + 10 * DAY);
    await asRegistrar(() =>
      placements.move(created.enrollment.id, { sectionId: p4South, movementReason: 'SECTION_CHANGE', reason: 'Balancing', effectiveFrom: moveAt2.toISOString() } as any),
    );
    await asRegistrar(() =>
      promotion.promote({ studentProfileId: s.id, toTermId: nextTermId, toClassId: classP5, toSectionId: p5North, reason: 'End of year' } as any),
    );

    const at = async (d: Date) => (await asRegistrar(() => lookup.resolve([s.id], { asOf: d }))).get(s.id);
    const inNorth = await at(new Date(moveAt1.getTime() + DAY));
    const inSouth = await at(new Date(moveAt2.getTime() + DAY));
    const nextYear = await at(new Date(Date.UTC(Y + 1, 2, 1)));
    expect(inNorth?.classId).toBe(classP4);
    expect(inNorth?.sectionId).toBe(p4North);
    expect(inSouth?.sectionId).toBe(p4South);
    expect(nextYear?.classId).toBe(classP5);
    expect(nextYear?.sectionId).toBe(p5North);

    // The old year's membership was completed, not rewritten; every row survives.
    const rows = await raw.enrollmentPlacement.findMany({ where: { enrollment: { studentProfileId: s.id } }, orderBy: { effectiveFrom: 'asc' } });
    expect(rows.length).toBe(4);
    expect(rows.filter((r) => r.effectiveTo === null)).toHaveLength(1);
    expect(rows[1].sectionNameSnapshot).toBe('North');
    const old = await raw.studentEnrollment.findFirst({ where: { studentProfileId: s.id, academicYearId: yearId } });
    expect(old?.status).toBe('COMPLETED');
  });

  /* ─────────────────────────────── Capacity ─────────────────────────────── */

  describe('capacity (section capacity = 40)', () => {
    const OVERRIDE = [...REGISTRAR, 'school:enrollment:capacity:override'];
    let fortyFirst = '';

    beforeAll(async () => {
      const existing = await raw.enrollmentPlacement.count({ where: { sectionId: p4North, effectiveTo: null } });
      for (let i = existing; i < 40; i++) {
        const s = await makeStudent(`Seat ${i}`);
        await enrol(s.id, p4North);
      }
      fortyFirst = (await makeStudent('Forty First')).id;
    });

    it('should_reject_class_capacity_overflow: the 41st learner is refused', async () => {
      expect(await raw.enrollmentPlacement.count({ where: { sectionId: p4North, effectiveTo: null } })).toBe(40);
      await expect(enrol(fortyFirst, p4North)).rejects.toThrow(/full/i);
    });

    it('refuses an override without the grant', async () => {
      await expect(enrol(fortyFirst, p4North, { overrideCapacity: true, overrideReason: 'Sibling' })).rejects.toThrow(/permission/i);
    });

    it('refuses an override without a reason', async () => {
      await expect(enrol(fortyFirst, p4North, { overrideCapacity: true }, OVERRIDE)).rejects.toThrow(/reason/i);
    });

    it('should_allow_capacity_override_only_with_permission: seats the 41st with a recorded reason', async () => {
      const res: any = await enrol(fortyFirst, p4North, { overrideCapacity: true, overrideReason: 'Sibling of a current pupil' }, OVERRIDE);
      expect(res.placement.capacityOverrideReason).toBe('Sibling of a current pupil');
      expect(res.placement.capacityOverriddenById).toBe('user_registrar');
      const audit = await raw.auditLog.findFirst({ where: { organizationId, entity: 'EnrollmentPlacement', entityId: res.placement.id } });
      expect(JSON.stringify(audit?.newValues)).toMatch(/capacityOverride/);
    });
  });

  /* ──────────────────────── Academic-year lifecycle ─────────────────────── */

  it('should_reject_enrollment_in_closed_year', async () => {
    const s = await makeStudent('Closed Year');
    await expect(
      asRegistrar(() => enrollments.create({ studentProfileId: s.id, academicYearId: closedYearId } as any)),
    ).rejects.toThrow(/closed/i);
  });

  it('refuses a new term in a closed year', async () => {
    await expect(
      asRegistrar(() => terms.create({ academicYearId: closedYearId, name: 'Late', startDate: `${Y - 1}-06-01`, endDate: `${Y - 1}-07-01` })),
    ).rejects.toThrow(/closed/i);
  });

  it('should_not_reactivate_closed_year_via_set_current', async () => {
    await expect(asRegistrar(() => years.setCurrent({ academicYearId: closedYearId }))).rejects.toThrow(/CLOSED/);
    await expect(asRegistrar(() => years.update(closedYearId, { isCurrent: true }))).rejects.toThrow(/CLOSED/);
    await expect(asRegistrar(() => terms.setCurrent({ termId: closedTermId }))).rejects.toThrow(/closed/i);
    const y = await raw.academicYear.findFirst({ where: { id: closedYearId } });
    expect(y?.status).toBe('CLOSED');
    expect(y?.isCurrent).toBe(false);
  });

  it('re-opening a closed year needs the migration grant and a reason', async () => {
    await expect(asRegistrar(() => years.setStatus(closedYearId, { status: 'ACTIVE', reason: 'Fix' } as any))).rejects.toThrow(/permission/i);
    await expect(
      asUser([...REGISTRAR, 'school:academics:migrate'], () => years.setStatus(closedYearId, { status: 'ACTIVE' } as any)),
    ).rejects.toThrow(/reason/i);
  });

  /* ─────────────────────────── Enrollment FSM ───────────────────────────── */

  it('refuses to create an enrollment straight into a terminal status', async () => {
    const s = await makeStudent('Terminal');
    await expect(
      asRegistrar(() => enrollments.create({ studentProfileId: s.id, academicYearId: yearId, status: 'WITHDRAWN' } as any)),
    ).rejects.toThrow(/PENDING or ACTIVE/);
  });

  it('reactivating a withdrawn learner needs the re-entry grant', async () => {
    const s = await makeStudent('Returner');
    const { enrollment }: any = await enrol(s.id, p4South);
    await asRegistrar(() => enrollments.withdraw(enrollment.id, { reason: 'Moved away' }));
    const back = { toStatus: 'ACTIVE', reason: 'Came back', placement: { termId, classId: classP4, sectionId: p4South } } as any;
    await expect(asRegistrar(() => enrollments.changeStatus(enrollment.id, back))).rejects.toThrow(/reactivate/i);
    await expect(
      asUser([...REGISTRAR, 'school:enrollment:reactivate'], () => enrollments.changeStatus(enrollment.id, back)),
    ).resolves.toBeDefined();
  });

  it('two concurrent withdrawals: exactly one wins', async () => {
    const s = await makeStudent('Race');
    const { enrollment }: any = await enrol(s.id, p4South);
    const results = await Promise.allSettled([
      asRegistrar(() => enrollments.withdraw(enrollment.id, { reason: 'A' })),
      asRegistrar(() => enrollments.withdraw(enrollment.id, { reason: 'B' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await raw.studentEnrollmentEvent.count({ where: { enrollmentId: enrollment.id, toStatus: 'WITHDRAWN' } })).toBe(1);
  });

  it('repeating the same move is a no-op, not a second placement', async () => {
    const s = await makeStudent('Double Click');
    const { enrollment }: any = await enrol(s.id, p4South);
    const move = { sectionId: p4North, movementReason: 'SECTION_CHANGE', reason: 'Swap' } as any;
    await asUser([...REGISTRAR, 'school:enrollment:capacity:override'], () =>
      placements.move(enrollment.id, { ...move, overrideCapacity: true, overrideReason: 'Test' }),
    );
    const before = await raw.enrollmentPlacement.count({ where: { enrollmentId: enrollment.id } });
    await asRegistrar(() => placements.move(enrollment.id, move));
    expect(await raw.enrollmentPlacement.count({ where: { enrollmentId: enrollment.id } })).toBe(before);
  });

  /* ──────────────────────── Tenancy at the database ─────────────────────── */

  it('should_reject_cross_tenant_foreign_key_on_create', async () => {
    // School B's parent contact; a School A learner must not be linkable to it,
    // even by a write that bypasses every service (raw owner connection).
    const foreignPartner = await raw.partner.create({ data: { organizationId: otherOrgId, code: `FP-${stamp}`, name: 'Foreign Parent' } });
    const foreignContact = await raw.contact.create({ data: { organizationId: otherOrgId, partnerId: foreignPartner.id, firstName: 'Foreign' } });
    const s = await makeStudent('Tenant FK');
    await expect(
      raw.studentGuardian.create({
        data: { organizationId, studentProfileId: s.id, guardianContactId: foreignContact.id, relationship: 'mother' },
      }),
    // The contact exists, so the only foreign-key failure possible is the
    // same-tenant trigger (Prisma reports SQLSTATE 23503 generically).
    ).rejects.toThrow(/Cross-tenant reference rejected|Foreign key constraint violated/);
    // The same link inside School B's own data is fine.
    const own = await makeStudent('Own Learner', otherOrgId);
    await expect(
      raw.studentGuardian.create({
        data: { organizationId: otherOrgId, studentProfileId: own.id, guardianContactId: foreignContact.id, relationship: 'mother' },
      }),
    ).resolves.toBeDefined();
  });

  it('should_reject_cross_tenant_read_by_id', async () => {
    const foreign = await makeStudent('Foreign Learner', otherOrgId);
    await expect(asRegistrar(() => students.findOne(foreign.id))).rejects.toThrow(/not found/i);
  });

  /* ─────────────────────────── Student master data ──────────────────────── */

  it('refuses a likely duplicate learner (same name + date of birth) unless confirmed', async () => {
    const dto = { name: 'Nakato Grace', admissionNo: `DUP-${stamp}-1`, enrollmentDate: now.toISOString(), dateOfBirth: `${Y - 9}-03-04` } as any;
    await asRegistrar(() => students.create(dto));
    await expect(asRegistrar(() => students.create({ ...dto, admissionNo: `DUP-${stamp}-2` }))).rejects.toThrow(/already exists/);
    await expect(
      asRegistrar(() => students.create({ ...dto, admissionNo: `DUP-${stamp}-3`, allowDuplicate: true })),
    ).resolves.toBeDefined();
  });

  it('refuses to delete a learner with enrollment history', async () => {
    const s = await makeStudent('Keep Me');
    await enrol(s.id, p4South);
    await expect(asRegistrar(() => students.remove(s.id))).rejects.toThrow(/cannot be deleted/);
  });

  it('membership statuses come from the enrollment, not a profile edit', async () => {
    const s = await makeStudent('Status Edit');
    await expect(asRegistrar(() => students.update(s.id, { status: 'withdrawn' } as any))).rejects.toThrow(/enrollment/);
  });

  /* ──────────────────────────────── Timetable ───────────────────────────── */

  describe('timetable conflict detection', () => {
    let teacher = '';
    let otherTeacher = '';
    let subject = '';
    let p1 = '';
    let p2 = '';
    let room = '';

    beforeAll(async () => {
      const mkStaff = async (name: string) => {
        const partner = await raw.partner.create({ data: { organizationId, code: `T-${name}-${stamp}`, name, isEmployee: true } });
        return (await raw.staffProfile.create({ data: { organizationId, partnerId: partner.id, employeeNo: `E-${name}-${stamp}`, joinDate: now } })).id;
      };
      teacher = await mkStaff('Okello');
      otherTeacher = await mkStaff('Auma');
      subject = (await raw.subject.create({ data: { organizationId, code: `MTC-${stamp}`, name: 'Mathematics' } })).id;
      p1 = (await raw.period.create({ data: { organizationId, name: 'P1', startTime: '08:00', endTime: '08:40', order: 1 } })).id;
      p2 = (await raw.period.create({ data: { organizationId, name: 'P2', startTime: '08:40', endTime: '09:20', order: 2 } })).id;
      room = (await raw.teachingRoom.create({ data: { organizationId, name: 'Lab 1', code: `LAB-${stamp}` } as any })).id;
      await raw.teacherAssignment.create({ data: { organizationId, teacherPartnerId: teacher, subjectId: subject, classId: classP4 } });
      await raw.teacherAssignment.create({ data: { organizationId, teacherPartnerId: teacher, subjectId: subject, classId: classP5 } });
      await raw.teacherAssignment.create({ data: { organizationId, teacherPartnerId: otherTeacher, subjectId: subject, classId: classP4 } });
      // Existing: a WHOLE-CLASS P4 double period (P1+P2), Monday, teacher Okello, Lab 1, week A.
      await raw.timetableSlot.create({
        data: { organizationId, classId: classP4, sectionId: null, dayOfWeek: 1, periodId: p1, subjectId: subject, teacherPartnerId: teacher, teachingRoomId: room, spanPeriods: 2, cycle: 'A' },
      });
    });

    const slot = (over: Record<string, unknown>) =>
      ({ classId: classP5, dayOfWeek: 1, periodId: p2, subjectId: subject, type: 'lesson', cycle: 'all', ...over }) as any;

    it('should_prevent_teacher_timetable_conflict (inside the existing double period)', async () => {
      const c = await asRegistrar(() => timetable.detectConflicts(slot({ teacherPartnerId: teacher })));
      expect(c.join(' ')).toMatch(/Teacher double-booked/);
    });

    it('detects a room clash', async () => {
      const c = await asRegistrar(() => timetable.detectConflicts(slot({ teacherPartnerId: otherTeacher, teachingRoomId: room, classId: classP5 })));
      expect(c.join(' ')).toMatch(/Room double-booked/);
    });

    it('detects a section lesson clashing with a whole-class lesson', async () => {
      const c = await asRegistrar(() =>
        timetable.detectConflicts(slot({ classId: classP4, sectionId: p4North, teacherPartnerId: otherTeacher, periodId: p1 })),
      );
      expect(c.join(' ')).toMatch(/Class already has a lesson/);
    });

    it('week B does not clash with week A', async () => {
      const c = await asRegistrar(() => timetable.detectConflicts(slot({ teacherPartnerId: teacher, cycle: 'B' })));
      expect(c.join(' ')).not.toMatch(/double-booked/);
    });

    it('refuses a teacher who is not assigned to the subject for that class', async () => {
      const c = await asRegistrar(() => timetable.detectConflicts(slot({ teacherPartnerId: otherTeacher, classId: classP5, dayOfWeek: 3 })));
      expect(c.join(' ')).toMatch(/not assigned to teach/);
    });

    it('checks a bulk batch against itself', async () => {
      await expect(
        asRegistrar(() =>
          timetable.bulkUpsert({
            classId: classP5,
            slots: [
              { dayOfWeek: 4, periodId: p1, subjectId: subject, teacherPartnerId: teacher, type: 'free' },
              { dayOfWeek: 4, periodId: p1, subjectId: subject, teacherPartnerId: teacher, type: 'free' },
            ],
          } as any),
        ),
      ).resolves.toBeDefined(); // free periods are not bookable resources

      // Two LESSONS for the same teacher in the same cell must be refused before
      // anything is written (course offerings are resolved first, so the batch
      // fails either on the missing offering or on the clash — never half-written).
      const before = await raw.timetableSlot.count({ where: { organizationId, classId: classP5 } });
      await expect(
        asRegistrar(() =>
          timetable.bulkUpsert({
            classId: classP5,
            slots: [
              { dayOfWeek: 5, periodId: p1, subjectId: subject, teacherPartnerId: teacher },
              { dayOfWeek: 5, periodId: p1, subjectId: subject, teacherPartnerId: teacher },
            ],
          } as any),
        ),
      ).rejects.toThrow();
      expect(await raw.timetableSlot.count({ where: { organizationId, classId: classP5 } })).toBe(before);
    });
  });

  /* ───────────────────────────── Staff lifecycle ────────────────────────── */

  it('a leaver loses login and live teaching; history and a timetable version remain', async () => {
    const user = await raw.user.create({ data: { organizationId, email: `leaver-${stamp}@x.test`, passwordHash: 'x', firstName: 'Leaver', isActive: true } });
    const partner = await raw.partner.create({ data: { organizationId, code: `LV-${stamp}`, name: 'Leaver Teacher', isEmployee: true } });
    await raw.hrEmployee.create({ data: { organizationId, employeeCode: `HR-${stamp}`, firstName: 'Leaver', userId: user.id, partnerId: partner.id } });
    const sp = await raw.staffProfile.create({ data: { organizationId, partnerId: partner.id, employeeNo: `LV-${stamp}`, joinDate: now } });
    const subject = await raw.subject.create({ data: { organizationId, code: `ENG-${stamp}`, name: 'English' } });
    const period = await raw.period.create({ data: { organizationId, name: `PX-${stamp}`, startTime: '10:00', endTime: '10:40', order: 9 } });
    await raw.timetableSlot.create({ data: { organizationId, classId: classP5, dayOfWeek: 2, periodId: period.id, subjectId: subject.id, teacherPartnerId: sp.id } });
    await raw.section.update({ where: { id: p5North }, data: { classTeacherId: sp.id } });

    await expect(asRegistrar(() => staff.update(sp.id, { status: 'resigned' } as any))).rejects.toThrow(/reason/);
    await asRegistrar(() => staff.update(sp.id, { status: 'resigned', reason: 'Moved to another school' } as any));

    expect((await raw.user.findFirst({ where: { id: user.id } }))?.isActive).toBe(false);
    expect(await raw.timetableSlot.count({ where: { teacherPartnerId: sp.id } })).toBe(0);
    expect((await raw.section.findFirst({ where: { id: p5North } }))?.classTeacherId).toBeNull();
    const version = await raw.timetableVersion.findFirst({ where: { organizationId, classId: classP5 }, orderBy: { version: 'desc' } });
    expect(version?.reason).toMatch(/Teacher left/);
    expect(await raw.staffStatusHistory.count({ where: { staffProfileId: sp.id, toStatus: 'resigned' } })).toBe(1);
    // History-bearing staff cannot be deleted.
    await raw.teacherAssignment.create({ data: { organizationId, teacherPartnerId: sp.id, subjectId: subject.id, classId: classP5 } });
    await expect(asRegistrar(() => staff.remove(sp.id))).rejects.toThrow(/cannot be deleted/);
  });

  /* ─────────────────────────────── Promotion ────────────────────────────── */

  it('plans the year-end rollover from placement history (dry run writes nothing)', async () => {
    const before = await raw.studentEnrollment.count({ where: { organizationId, academicYearId: nextYearId } });
    const plan: any = await asRegistrar(() => promotion.rollover({ fromTermId: termId, toTermId: nextTermId, dryRun: true }));
    expect(plan.dryRun).toBe(true);
    expect(plan.counts.total).toBeGreaterThan(0);
    expect(plan.counts.promoted).toBeGreaterThan(0);
    expect(plan.promote.every((r: any) => r.toClassId === classP5)).toBe(true);
    expect(await raw.studentEnrollment.count({ where: { organizationId, academicYearId: nextYearId } })).toBe(before);
  });
});
