/**
 * Early years (nursery) — Wave 12, against a real database.
 *
 * A nursery is not a small primary school, and these are the four things the
 * rest of the school module cannot record: the day itself, who may collect a
 * child, what happened when something went wrong, and which doses are due. Plus
 * the two placement warnings a seat count cannot give: age band and the
 * staff-to-child ratio.
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
import { StudentAdmissionService } from '../../src/modules/school/people/student-admission.service';
import { CareLogService } from '../../src/modules/school/early-years/care-log.service';
import { PickupService } from '../../src/modules/school/early-years/pickup.service';
import { IncidentService } from '../../src/modules/school/early-years/incident.service';
import { ImmunisationService } from '../../src/modules/school/early-years/immunisation.service';
import { SequenceService } from '../../src/kernel/sequence/sequence.service';
import { ensureAcademicSpine } from './_placement';

describeDb('integration: early years (nursery)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admissions: StudentAdmissionService;
  let careLogs: CareLogService;
  let pickup: PickupService;
  let incidents: IncidentService;
  let immunisations: ImmunisationService;

  const stamp = Date.now();
  const organizationId = `org_ey_${stamp}`;
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'teacher_ey', permissions: ['*'] }, fn);
  /** A second person, so sign-off is never by the recorder. */
  const asHead = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'head_ey', permissions: ['*'] }, fn);

  const today = new Date();
  const onDate = today.toISOString().slice(0, 10);

  let termId = '';
  let classId = '';
  let topClassGradeId = '';
  let ownerPartnerId = '';
  let seq = 0;

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  /** A child of a given age in months at the start of term. */
  const admitChild = async (ageMonths: number, name?: string) => {
    seq += 1;
    const dob = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - ageMonths, 15));
    return asTenant(() =>
      admissions.admit({
        organizationId,
        name: name ?? `Nursery Child ${seq}`,
        dateOfBirth: dob.toISOString(),
        placement: { termId, classId, rollNumber: `EY-${seq}` },
      }),
    );
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
      data: { id: organizationId, code: `EY-${stamp}`, name: 'Early Years School', currencyCode: 'UGX' },
    });
    ownerPartnerId = (
      await raw.partner.create({ data: { organizationId, code: `EY-${stamp}`, name: 'Early Years School', isCompany: true } })
    ).id;

    const spine = await ensureAcademicSpine(raw, {
      organizationId,
      yearName: String(today.getUTCFullYear()),
      termName: 'Term 1',
      gradeName: 'Top Class',
      gradeOrder: 3,
      className: 'Top Class',
    });
    termId = spine.termId;
    classId = spine.classId;
    topClassGradeId = spine.gradeLevelId;
    // The term must contain today: placements are dated inside their term.
    await raw.term.update({
      where: { id: termId },
      data: {
        startDate: new Date(Date.UTC(today.getUTCFullYear(), 0, 15)),
        endDate: new Date(Date.UTC(today.getUTCFullYear(), 11, 15)),
      },
    });
    // Top Class admits four- and five-year-olds, one adult to eight children.
    const level = await raw.academicLevel.create({
      data: {
        organizationId,
        code: `PRE-${stamp}`,
        name: 'Nursery',
        stage: 'PRE_PRIMARY',
        displayOrder: 1,
        staffChildRatio: 8,
      },
    });
    await raw.gradeLevel.update({
      where: { id: topClassGradeId },
      data: { academicLevelId: level.id, minAgeMonths: 48, maxAgeMonths: 71 },
    });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    admissions = moduleRef.get(StudentAdmissionService);
    careLogs = moduleRef.get(CareLogService);
    pickup = moduleRef.get(PickupService);
    incidents = moduleRef.get(IncidentService);
    immunisations = moduleRef.get(ImmunisationService);

    await asTenant(() => moduleRef.get(SequenceService).next(`student:${new Date().getUTCFullYear()}`, {}));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /* ── The day ────────────────────────────────────────────────────────────── */

  it('writes the day across the day, then shares it once', async () => {
    const child = await admitChild(55);

    // Morning: how they arrived.
    await asTenant(() =>
      careLogs.upsert({ studentProfileId: child.profile.id, onDate, arrivalMood: 'tearful' }),
    );
    // Lunchtime: a second call adds without wiping the morning.
    const afterLunch = await asTenant(() =>
      careLogs.upsert({
        studentProfileId: child.profile.id,
        onDate,
        meals: [{ meal: 'lunch', portion: 'most', note: 'left the beans' }],
        naps: [{ from: '13:00', to: '14:15' }],
      }),
    );
    expect(afterLunch.arrivalMood).toBe('tearful');
    expect((afterLunch.meals as any[])[0].portion).toBe('most');

    // One log per child per day, however many times the room writes to it.
    expect(await raw.childCareLog.count({ where: { studentProfileId: child.profile.id } })).toBe(1);

    const shared = await asTenant(() => careLogs.setShared(afterLunch.id, true));
    expect(shared.sharedAt).not.toBeNull();

    // A parent has now read it, so it does not change quietly.
    await expect(
      asTenant(() => careLogs.upsert({ studentProfileId: child.profile.id, onDate, teacherNote: 'actually…' })),
    ).rejects.toThrow(BadRequestException);

    await asTenant(() => careLogs.setShared(afterLunch.id, false));
    const corrected = await asTenant(() =>
      careLogs.upsert({ studentProfileId: child.profile.id, onDate, teacherNote: 'Settled after breakfast.' }),
    );
    expect(corrected.teacherNote).toBe('Settled after breakfast.');
  });

  it("shows the room every child placed in it, log or no log", async () => {
    const child = await admitChild(52, `Blank Log Child ${stamp}`);
    const day = await asTenant(() => careLogs.forClass(classId, onDate));
    const row = day.children.find((c: any) => c.studentProfileId === child.profile.id);
    expect(row).toBeTruthy();
    expect(row!.log).toBeNull();
  });

  /* ── The gate ───────────────────────────────────────────────────────────── */

  it('refuses to release a child to someone not on the list, and records an override', async () => {
    const child = await admitChild(53);

    await expect(
      asTenant(() => pickup.release({ studentProfileId: child.profile.id, collectedByName: 'A stranger' })),
    ).rejects.toThrow(BadRequestException);
    expect(await raw.pickupEvent.count({ where: { studentProfileId: child.profile.id } })).toBe(0);

    // It must still be possible in a real emergency — with a written reason.
    const forced = await asTenant(() =>
      pickup.release({
        studentProfileId: child.profile.id,
        collectedByName: 'Neighbour, mother in hospital',
        overrideReason: 'Mother admitted to hospital; head teacher authorized by phone.',
      }),
    );
    expect(forced.overrideReason).toContain('head teacher');
    expect(forced.authorizationId).toBeNull();
  });

  it('releases to a live authorization and refuses a withdrawn one', async () => {
    const child = await admitChild(54);
    const aunt = await raw.contact.create({
      data: { organizationId, partnerId: ownerPartnerId, firstName: 'Aunt', lastName: 'Nabirye', phone: '+256700111222' },
    });
    const auth = await asTenant(() =>
      pickup.create({ studentProfileId: child.profile.id, contactId: aunt.id, relationship: 'aunt' }),
    );

    const list = await asTenant(() => pickup.whoMayCollect(child.profile.id));
    expect(list.authorizations.map((a: any) => a.name)).toContain('Aunt Nabirye');

    const event = await asTenant(() =>
      pickup.release({ studentProfileId: child.profile.id, authorizationId: auth.id }),
    );
    expect(event.collectedByName).toBe('Aunt Nabirye');

    // Withdrawn, not deleted: the history stays, and the gate closes.
    await asHead(() => pickup.revoke(auth.id, { reason: 'Custody order' }));
    await expect(
      asTenant(() => pickup.release({ studentProfileId: child.profile.id, authorizationId: auth.id })),
    ).rejects.toThrow(BadRequestException);
    const history = await asTenant(() => pickup.history(child.profile.id));
    expect(history).toHaveLength(1);
    expect(history[0].revokeReason).toBe('Custody order');
  });

  it('needs a day for a one-off authorization', async () => {
    const child = await admitChild(50);
    await expect(
      asTenant(() =>
        pickup.create({ studentProfileId: child.profile.id, kind: 'ONE_OFF', personName: 'The driver' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  /* ── The incident log ───────────────────────────────────────────────────── */

  it('will not sign off an incident before the family has been told', async () => {
    const child = await admitChild(56);
    const incident = await asTenant(() =>
      incidents.create({
        studentProfileId: child.profile.id,
        kind: 'INJURY',
        severity: 'MODERATE',
        occurredAt: new Date().toISOString(),
        description: 'Fell from the climbing frame, grazed left knee.',
        actionTaken: 'Cleaned and dressed; watched for the rest of the morning.',
        bodyPart: 'left knee',
      }),
    );

    await expect(asHead(() => incidents.review(incident.id, {}))).rejects.toThrow(BadRequestException);

    // The outstanding list is the head teacher's to-do, not a browse.
    const before = await asHead(() => incidents.outstanding());
    expect(before.find((r: any) => r.id === incident.id)!.needs).toContain('tell the family');

    await asTenant(() => incidents.notifyGuardian(incident.id, { how: 'phone' }));
    const reviewed = await asHead(() => incidents.review(incident.id, { reviewNotes: 'Frame checked.' }));
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(reviewed.reviewedById).toBe('head_ey');
    expect(reviewed.recordedById).toBe('teacher_ey');

    const after = await asHead(() => incidents.outstanding());
    expect(after.find((r: any) => r.id === incident.id)).toBeUndefined();
  });

  it('refuses an incident dated in the future', async () => {
    const child = await admitChild(51);
    await expect(
      asTenant(() =>
        incidents.create({
          studentProfileId: child.profile.id,
          kind: 'OTHER',
          occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
          description: 'Tomorrow.',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  /* ── Immunisation ───────────────────────────────────────────────────────── */

  it('distinguishes a dose, an exemption and no record at all', async () => {
    const dosed = await admitChild(57, `Dosed Child ${stamp}`);
    const exempt = await admitChild(58, `Exempt Child ${stamp}`);
    const unknown = await admitChild(59, `Unknown Child ${stamp}`);

    await asTenant(() =>
      immunisations.upsert({
        studentProfileId: dosed.profile.id,
        vaccine: 'Measles-Rubella',
        doseLabel: 'dose 1',
        administeredOn: '2024-03-01',
        nextDueOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      }),
    );
    await asTenant(() =>
      immunisations.upsert({
        studentProfileId: exempt.profile.id,
        vaccine: 'Measles-Rubella',
        exemptionReason: 'Medical exemption, letter on file.',
      }),
    );
    // Neither a dose nor a reason is not a record.
    await expect(
      asTenant(() => immunisations.upsert({ studentProfileId: unknown.profile.id, vaccine: 'Measles-Rubella' })),
    ).rejects.toThrow(BadRequestException);

    const report = await asTenant(() => immunisations.dueForClass(classId, { withinDays: 30 }));
    expect(report.due.map((d: any) => d.studentProfileId)).toContain(dosed.profile.id);
    // The list that matters: a child nobody has asked about is invisible in a
    // report built only from the rows that exist.
    expect(report.noRecord.map((d: any) => d.studentProfileId)).toContain(unknown.profile.id);
    expect(report.noRecord.map((d: any) => d.studentProfileId)).not.toContain(exempt.profile.id);
  });

  /* ── Placement warnings ─────────────────────────────────────────────────── */

  it('warns when a child is outside the grade age band, without refusing', async () => {
    // Top Class admits 48–71 months. Two years old is well short of it.
    const tooYoung = await admitChild(26, `Too Young ${stamp}`);
    expect(tooYoung.warnings.join(' ')).toMatch(/Younger than Top Class admits/);
    // Admitted anyway: the head teacher decides, not the software.
    expect(tooYoung.enrollment).not.toBeNull();

    const tooOld = await admitChild(96, `Too Old ${stamp}`);
    expect(tooOld.warnings.join(' ')).toMatch(/Older than Top Class admits/);
  });

  it('warns when the room is over the staff-to-child ratio', async () => {
    // The ratio is 1:8 and the class has no teacher assigned, so the floor of one
    // adult applies: the ninth child trips it.
    const placed = await raw.enrollmentPlacement.count({ where: { organizationId, termId, effectiveTo: null } });
    for (let i = placed; i < 9; i += 1) await admitChild(55);
    const next = await admitChild(55);
    expect(next.warnings.join(' ')).toMatch(/over the Nursery ratio of 1:8/);
  });
});
