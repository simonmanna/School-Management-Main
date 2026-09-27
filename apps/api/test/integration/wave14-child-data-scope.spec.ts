/**
 * Wave 14 — audit 2026-09-27 F01, F02, F06, against a real database.
 *
 * D01: nursery care, immunisation, pick-up and incident records follow the same
 *      pupil scope as the pupil screens. An unassigned, other-stream or former
 *      teacher reads and writes nothing; a denial changes nothing.
 * D02: the report centre never shows more pupils than the pupil screens do.
 * D06: a canPickup guardian is released without an override; the authority is
 *      stored; a retry is the same handover.
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
import { CareLogService } from '../../src/modules/school/early-years/care-log.service';
import { PickupService } from '../../src/modules/school/early-years/pickup.service';
import { IncidentService } from '../../src/modules/school/early-years/incident.service';
import { ImmunisationService } from '../../src/modules/school/early-years/immunisation.service';
import { ReportRunnerService } from '../../src/modules/core/reporting/report-runner.service';
import { StudentService } from '../../src/modules/school/people/student.service';
import { ensureAcademicSpine, linkLearner, type AcademicSpine } from './_placement';

describeDb('integration: wave 14 child-data scope (F01/F02/F06)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let careLogs: CareLogService;
  let pickup: PickupService;
  let incidents: IncidentService;
  let immunisations: ImmunisationService;
  let reports: ReportRunnerService;
  let students: StudentService;

  const stamp = Date.now();
  const organizationId = `org_w14a_${stamp}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  /** The Class Teacher preset's early-years and report grants. */
  const TEACHER = [
    'school:read', 'school:carelog:write', 'school:incidents:read', 'school:incidents:write',
    'school:medical:read', 'school:reports:read', 'school:reports:export', 'school:pickup:release',
  ];
  const ADMIN = ['*', ...Object.values(PERMISSIONS.school as Record<string, string>)];

  const as = <T>(userId: string, permissions: string[], fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);

  let spine: AcademicSpine;
  let redId = '';
  let blueId = '';
  let redPupil = '';
  let bluePupil = '';
  let redGuardianLink = '';
  let blueGuardianLink = '';
  let redLogId = '';
  let blueLogId = '';
  let blueIncidentId = '';
  let blueDoseId = '';

  const users: Record<string, string> = {};
  const staff: Record<string, string> = {};

  const makeUser = async (tag: string, dataScope: 'class' | 'school', withStaff: boolean) => {
    const permissions = dataScope === 'school' ? ['*'] : TEACHER;
    const role = await raw.role.create({ data: { organizationId, name: `W14 ${tag} ${stamp}`, dataScope, permissions } as any });
    const user = await raw.user.create({
      data: {
        organizationId, email: `w14-${tag}-${stamp}@school.test`, passwordHash: 'x', firstName: tag, lastName: 'T',
        isActive: true, roles: { connect: { id: role.id } },
      } as any,
    });
    users[tag] = user.id;
    if (!withStaff) return;
    const partner = await raw.partner.create({
      data: { organizationId, code: `W14-T-${tag}-${stamp}`, name: `${tag} Teacher`, isEmployee: true },
    });
    staff[tag] = (
      await raw.staffProfile.create({
        data: { organizationId, partnerId: partner.id, employeeNo: `W14-${tag}-${stamp}`, joinDate: new Date('2026-01-01'), staffCategory: 'teaching' } as any,
      })
    ).id;
    await raw.hrEmployee.create({
      data: { organizationId, employeeCode: `W14-${tag}-${stamp}`, userId: user.id, partnerId: partner.id, firstName: tag, lastName: 'T' } as any,
    });
  };

  let seq = 0;
  const makePupil = async (name: string, sectionId: string) => {
    seq += 1;
    const partner = await raw.partner.create({ data: { organizationId, code: `W14-P-${stamp}-${seq}`, name } });
    const profile = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: `W14-${seq}`, enrollmentDate: new Date('2026-01-20') },
    });
    await linkLearner(raw, { spine, studentProfileId: profile.id, sectionId, effectiveFrom: new Date('2026-01-20') });
    const contact = await raw.contact.create({
      data: { organizationId, partnerId: partner.id, firstName: `${name} Parent`, lastName: 'Guardian', phone: `+2567000${seq}000` } as any,
    });
    const link = await raw.studentGuardian.create({
      data: { organizationId, studentProfileId: profile.id, guardianContactId: contact.id, relationship: 'mother', canPickup: true } as any,
    });
    return { id: profile.id, guardianLinkId: link.id };
  };

  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W14A-${stamp}`, name: 'Green Valley', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley', gradingSystem: 'PLE' } as any });

    spine = await ensureAcademicSpine(raw, { organizationId, yearName: '2026', gradeName: 'Baby', className: 'Baby', sectionName: 'Red' });
    redId = spine.sectionId!;
    blueId = (await raw.section.create({ data: { organizationId, classId: spine.classId, name: 'Blue' } })).id;
    await raw.term.update({ where: { id: spine.termId }, data: { isCurrent: true, endDate: new Date('2026-12-15') } });

    const red = await makePupil('Atim', redId);
    const blue = await makePupil('Okello', blueId);
    redPupil = red.id;
    bluePupil = blue.id;
    redGuardianLink = red.guardianLinkId;
    blueGuardianLink = blue.guardianLinkId;

    await makeUser('head', 'school', false);
    await makeUser('unassigned', 'class', false); // audit fixture: no staff record, no class
    await makeUser('redTeacher', 'class', true);
    await makeUser('former', 'class', true);
    await raw.section.update({ where: { id: redId }, data: { classTeacherId: staff.redTeacher } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    careLogs = moduleRef.get(CareLogService);
    pickup = moduleRef.get(PickupService);
    incidents = moduleRef.get(IncidentService);
    immunisations = moduleRef.get(ImmunisationService);
    reports = moduleRef.get(ReportRunnerService);
    students = moduleRef.get(StudentService);

    // The head writes the day for both children, a dose and a serious incident.
    await as(users.head, ADMIN, async () => {
      redLogId = (await careLogs.upsert({ studentProfileId: redPupil, onDate: today, teacherNote: 'Red private note' } as any)).id;
      blueLogId = (await careLogs.upsert({ studentProfileId: bluePupil, onDate: today, teacherNote: 'Blue private note' } as any)).id;
      blueDoseId = (await immunisations.upsert({ studentProfileId: bluePupil, vaccine: 'Measles', administeredOn: '2025-06-01', nextDueOn: today } as any)).id;
      blueIncidentId = (
        await incidents.create({ studentProfileId: bluePupil, kind: 'SAFEGUARDING', severity: 'SERIOUS', occurredAt: new Date().toISOString(), description: 'Blue safeguarding' } as any)
      ).id;
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const denied = async (p: Promise<unknown>) => {
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
  };

  describe('D01 — an unassigned teacher reads and writes nothing', () => {
    const u = () => users.unassigned;

    it('the ordinary pupil list is empty (the baseline the audit compared against)', async () => {
      const list: any = await as(u(), TEACHER, () => (students as any).list({}));
      const rows = Array.isArray(list) ? list : list.data ?? list.items ?? [];
      expect(rows).toHaveLength(0);
    });

    it('care logs, immunisations, collectors, incidents and the gate log are all refused or empty', async () => {
      await denied(as(u(), TEACHER, () => careLogs.forStudent(bluePupil)));
      await denied(as(u(), TEACHER, () => careLogs.forClass(spine.classId, today)));
      await denied(as(u(), TEACHER, () => immunisations.forStudent(bluePupil)));
      await denied(as(u(), TEACHER, () => immunisations.dueForClass(spine.classId)));
      await denied(as(u(), TEACHER, () => pickup.whoMayCollect(bluePupil)));
      await denied(as(u(), TEACHER, () => pickup.history(bluePupil)));
      await denied(as(u(), TEACHER, () => incidents.forStudent(bluePupil)));
      const outstanding = await as(u(), TEACHER, () => incidents.outstanding());
      expect(outstanding).toHaveLength(0);
      const gate = await as(u(), TEACHER, () => pickup.releasesOn(today));
      expect(gate).toHaveLength(0);
    });

    it('writes are refused and change nothing', async () => {
      await denied(as(u(), TEACHER, () => careLogs.upsert({ studentProfileId: bluePupil, onDate: today, teacherNote: 'tampered' } as any)));
      await denied(as(u(), TEACHER, () => careLogs.setShared(blueLogId, true)));
      await denied(as(u(), TEACHER, () => incidents.notifyGuardian(blueIncidentId, { how: 'phone' } as any)));
      await denied(as(u(), TEACHER, () => immunisations.remove(blueDoseId)));
      await denied(as(u(), TEACHER, () => pickup.release({ studentProfileId: bluePupil, studentGuardianId: blueGuardianLink } as any)));
      const log = await raw.childCareLog.findUnique({ where: { id: blueLogId } });
      expect(log?.teacherNote).toBe('Blue private note');
      expect(log?.sharedAt).toBeNull();
      expect((await raw.childIncident.findUnique({ where: { id: blueIncidentId } }))?.guardianNotifiedAt).toBeNull();
      expect((await raw.immunisationRecord.findUnique({ where: { id: blueDoseId } }))?.deletedAt).toBeNull();
      expect(await raw.pickupEvent.count({ where: { studentProfileId: bluePupil } })).toBe(0);
    });
  });

  describe('D01 — a stream teacher sees their stream only', () => {
    const t = () => users.redTeacher;

    it('reads their own pupil, including health and the guardian contact', async () => {
      const logs = await as(t(), TEACHER, () => careLogs.forStudent(redPupil));
      expect(logs.map((l: any) => l.id)).toContain(redLogId);
      await expect(as(t(), TEACHER, () => immunisations.forStudent(redPupil))).resolves.toBeDefined();
      const collectors = await as(t(), TEACHER, () => pickup.whoMayCollect(redPupil));
      expect(collectors.guardians).toHaveLength(1);
    });

    it('the class day lists only their stream; the other stream is refused', async () => {
      const day = await as(t(), TEACHER, () => careLogs.forClass(spine.classId, today));
      expect(day.children.map((c: any) => c.studentProfileId)).toEqual([redPupil]);
      await denied(as(t(), TEACHER, () => careLogs.forClass(spine.classId, today, blueId)));
      await denied(as(t(), TEACHER, () => careLogs.forStudent(bluePupil)));
      await denied(as(t(), TEACHER, () => incidents.forStudent(bluePupil)));
      const outstanding = await as(t(), TEACHER, () => incidents.outstanding());
      expect(outstanding.map((i: any) => i.id)).not.toContain(blueIncidentId);
    });

    it('may write their own pupil’s day', async () => {
      const row = await as(t(), TEACHER, () => careLogs.upsert({ studentProfileId: redPupil, onDate: today, activities: 'Sand play' } as any));
      expect(row.id).toBe(redLogId);
    });
  });

  describe('D01 — a former teacher loses access on the next request', () => {
    it('reads while assigned, is refused after the assignment is removed', async () => {
      await raw.section.update({ where: { id: blueId }, data: { classTeacherId: staff.former } });
      await expect(as(users.former, TEACHER, () => careLogs.forStudent(bluePupil))).resolves.toBeDefined();
      await raw.section.update({ where: { id: blueId }, data: { classTeacherId: null } });
      await denied(as(users.former, TEACHER, () => careLogs.forStudent(bluePupil)));
    });
  });

  describe('D02 — reports never widen an empty assignment', () => {
    const register = (userId: string, perms: string[]) =>
      as(userId, perms, () => reports.run('student.register', { filters: { termId: spine.termId } } as any, true));

    it('an unassigned teacher gets an empty register', async () => {
      const out = await register(users.unassigned, TEACHER);
      expect(out.data).toHaveLength(0);
    });

    it('a stream teacher gets their stream only', async () => {
      const out = await register(users.redTeacher, TEACHER);
      expect(out.data.map((r: any) => r.studentProfileId)).toEqual([redPupil]);
    });

    it('the head gets the whole class, matching the database', async () => {
      const out = await register(users.head, ADMIN);
      expect(new Set(out.data.map((r: any) => r.studentProfileId))).toEqual(new Set([redPupil, bluePupil]));
    });

    it('a pupil-level report for someone outside scope is refused', async () => {
      await denied(
        as(users.unassigned, TEACHER, () =>
          reports.run('student.profile', { filters: { studentProfileId: bluePupil } } as any),
        ),
      );
    });
  });

  describe('D06 — the ordinary guardian handover', () => {
    it('releases to a canPickup guardian with no override, and stores the authority', async () => {
      const ev: any = await as(users.redTeacher, TEACHER, () =>
        pickup.release({ studentProfileId: redPupil, studentGuardianId: redGuardianLink, idempotencyKey: `k-${stamp}` } as any),
      );
      expect(ev.authorizationSource).toBe('guardian');
      expect(ev.studentGuardianId).toBe(redGuardianLink);
      expect(ev.overrideReason).toBeNull();
      expect(ev.releasedById).toBe(users.redTeacher);
      expect(ev.collectedByName).toContain('Atim Parent');
    });

    it('a retry or second click is the same handover', async () => {
      const again: any = await as(users.redTeacher, TEACHER, () =>
        pickup.release({ studentProfileId: redPupil, studentGuardianId: redGuardianLink, idempotencyKey: `k-${stamp}` } as any),
      );
      const click: any = await as(users.redTeacher, TEACHER, () =>
        pickup.release({ studentProfileId: redPupil, studentGuardianId: redGuardianLink } as any),
      );
      expect(again.id).toBe(click.id);
      expect(await raw.pickupEvent.count({ where: { studentProfileId: redPupil } })).toBe(1);
    });

    it("another child's guardian, or a guardian taken off the list, is refused", async () => {
      await expect(
        as(users.head, ADMIN, () => pickup.release({ studentProfileId: bluePupil, studentGuardianId: redGuardianLink } as any)),
      ).rejects.toThrow(/not linked to this child/);
      await raw.studentGuardian.update({ where: { id: blueGuardianLink }, data: { canPickup: false } });
      await expect(
        as(users.head, ADMIN, () => pickup.release({ studentProfileId: bluePupil, studentGuardianId: blueGuardianLink } as any)),
      ).rejects.toThrow(/pick-up list/);
      expect(await raw.pickupEvent.count({ where: { studentProfileId: bluePupil } })).toBe(0);
    });

    it('an override needs its own grant and a reason', async () => {
      await raw.section.update({ where: { id: blueId }, data: { classTeacherId: staff.redTeacher } });
      await denied(
        as(users.redTeacher, TEACHER, () =>
          pickup.release({ studentProfileId: bluePupil, collectedByName: 'Uncle Joe', overrideReason: 'Mother phoned' } as any),
        ),
      );
      const ev: any = await as(users.head, ADMIN, () =>
        pickup.release({ studentProfileId: bluePupil, collectedByName: 'Uncle Joe', overrideReason: 'Mother phoned' } as any),
      );
      expect(ev.authorizationSource).toBe('override');
      expect(ev.overrideReason).toBe('Mother phoned');
      await raw.section.update({ where: { id: blueId }, data: { classTeacherId: null } });
    });
  });
});
