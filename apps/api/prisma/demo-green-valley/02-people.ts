/**
 * Green Valley demo — the people.
 *
 * Staff, pupils, guardians, and the handful of logins a demo is driven from.
 *
 * Everybody is fictional. Names are drawn from pools spread across Uganda's
 * main regions, because a Kampala register is not single-ethnicity and a demo
 * whose every pupil is a Mukasa reads as invented. Every identity is derived
 * deterministically from a stable key, so the pupil on roll 14 of P5 North is
 * the same child, with the same guardian and the same birthday, on every run.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PORTAL_ROLE_PRESETS, SCHOOL_ROLE_PRESETS, PERMISSIONS } from '@erp/shared';
import {
  ALL_GRADES, CLASS_SIZE, ENTRY_AGE, FEMALE_NAMES, HOUSES, MALE_NAMES, SURNAMES,
  SCHOOL, int, log, ok, phoneFor, pick, rng, warn, type School,
} from './shared';
import { showcaseStreamName } from './schools';

const DOMAIN = SCHOOL.emailDomain;
const PFX = SCHOOL.codePrefix;
/** The persona stream: its class teacher is `teacher@`, its roll 1 is `pupil@`. */
const SHOW = SCHOOL.showcaseStream;
const SHOW_LABEL = `P5 ${showcaseStreamName(SCHOOL)}`;

/** Overridable, with a default so a dev database seeds without ceremony. */
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD ?? SCHOOL.passwords.staff;
const PORTAL_PASSWORD = process.env.DEMO_PORTAL_PASSWORD ?? SCHOOL.passwords.portal;

export interface DemoPupil {
  id: string;
  partnerId: string;
  name: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
  gradeCode: string;
  /** Stream code, e.g. `NORTH`. */
  streamCode: string;
  gender: 'M' | 'F';
  /** Roll number within the stream, 1-based. */
  roll: number;
  /** Primary guardian's Contact id. */
  guardianContactId: string;
  guardianName: string;
}

export interface DemoStaff {
  /** StaffProfile id. Note: the schema's `teacherPartnerId` fields hold THIS. */
  id: string;
  partnerId: string;
  name: string;
  email: string;
  role: string;
  /** Subject codes this person teaches, empty for non-teaching staff. */
  teaches: string[];
}

/* ───────────────────────────── Named staff ─────────────────────────────────── */

/**
 * The leadership team and the specialist teachers, named so a demo can refer to
 * them by name. Class teachers are generated per stream below.
 */
const LEADERSHIP = [
  { key: 'head', first: 'Emmanuel', last: 'Ssempijja', title: 'Head Teacher', role: 'Head Teacher', login: true },
  { key: 'deputy', first: 'Grace', last: 'Nakato', title: 'Deputy Head Teacher', role: 'Deputy Head', login: true },
  { key: 'dos', first: 'Robert', last: 'Byaruhanga', title: 'Director of Studies', role: 'Director of Studies', login: true },
  { key: 'bursar', first: 'Patrick', last: 'Okello', title: 'Bursar', role: 'Bursar', login: true },
  { key: 'registrar', first: 'Sarah', last: 'Nabirye', title: 'Registrar', role: 'Registrar', login: true },
].map((l) => ({ ...l, ...(SCHOOL.leadership?.[l.key as keyof NonNullable<typeof SCHOOL.leadership>] ?? {}) }));

/**
 * Subject teachers for upper primary, one per PLE subject plus the extras.
 * `login: true` gets an account — a demo needs a teacher to sign in as.
 */
const SUBJECT_TEACHERS = [
  { key: 'eng', first: 'Daphine', last: 'Kyomuhendo', teaches: ['ENG'], login: true },
  { key: 'mtc', first: 'Isaac', last: 'Tumusiime', teaches: ['MTC'], login: true },
  { key: 'sci', first: 'Winnie', last: 'Akello', teaches: ['SCI'], login: true },
  { key: 'sst', first: 'Moses', last: 'Waiswa', teaches: ['SST'], login: false },
  { key: 'eng2', first: 'Juliet', last: 'Nansubuga', teaches: ['ENG'], login: false },
  { key: 'mtc2', first: 'Derrick', last: 'Mugisha', teaches: ['MTC'], login: false },
  { key: 'sci2', first: 'Hope', last: 'Atim', teaches: ['SCI'], login: false },
  { key: 'sst2', first: 'Allan', last: 'Kirunda', teaches: ['SST'], login: false },
  { key: 're', first: 'Ibrahim', last: 'Kasozi', teaches: ['RE'], login: false },
  { key: 'kis', first: 'Fatuma', last: 'Namusoke', teaches: ['KIS'], login: false },
  { key: 'ict', first: 'Trevor', last: 'Ssali', teaches: ['ICT'], login: false },
  { key: 'pe', first: 'Collins', last: 'Opio', teaches: ['PE', 'MDD'], login: false },
  { key: 'art', first: 'Peace', last: 'Ninsiima', teaches: ['ART', 'MDD'], login: false },
  { key: 'lit', first: 'Esther', last: 'Nalubega', teaches: ['LIT1', 'LIT2'], login: false },
  { key: 'num', first: 'Henry', last: 'Kiggundu', teaches: ['NUM'], login: false },
];

export async function seedPeople(prisma: PrismaClient, s: School) {
  const { O } = s;

  // ── Roles ─────────────────────────────────────────────────────────────────
  // Built from the application's own presets, so a demo login holds exactly
  // what that job holds in production.
  //
  // One addition: every staff role that may open the LMS gets
  // `school:lms:read`. The presets do not all carry it, and without it a Head
  // Teacher with `school:courses:write` is refused by the LMS controllers'
  // coarse gate — their course-management grant would be dead on arrival.
  const roleIds = new Map<string, string>();
  type Preset = {
    name: string;
    description?: string;
    dataScope?: string;
    permissions: readonly string[];
  };
  const staffPresets = SCHOOL_ROLE_PRESETS as ReadonlyArray<Preset>;
  for (const preset of staffPresets) {
    const permissions = new Set<string>(preset.permissions);
    const opensLms =
      permissions.has(PERMISSIONS.school.manageCourses) ||
      permissions.has(PERMISSIONS.school.teachCourses) ||
      permissions.has(PERMISSIONS.school.enrolLearners) ||
      permissions.has(PERMISSIONS.school.manageLessonPlans) ||
      permissions.has(PERMISSIONS.school.ownLessonPlans);
    if (opensLms) permissions.add(PERMISSIONS.school.lmsRead);

    const row = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: O, name: preset.name } },
      update: { permissions: [...permissions] },
      create: {
        organizationId: O,
        name: preset.name,
        description: preset.description ?? null,
        permissions: [...permissions],
        ...(preset.dataScope ? { dataScope: preset.dataScope as never } : {}),
      },
    });
    roleIds.set(preset.name, row.id);
  }

  const portalPresets = PORTAL_ROLE_PRESETS as ReadonlyArray<Preset>;
  for (const preset of portalPresets) {
    const row = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: O, name: preset.name } },
      update: { permissions: [...preset.permissions] },
      create: {
        organizationId: O,
        name: preset.name,
        description: preset.description ?? null,
        permissions: [...preset.permissions],
      },
    });
    roleIds.set(preset.name, row.id);
  }
  ok(`roles: ${roleIds.size} (from the application's own presets)`);

  const staffHash = await bcrypt.hash(STAFF_PASSWORD, 10);
  const portalHash = await bcrypt.hash(PORTAL_PASSWORD, 10);

  /**
   * Join a login to the person it belongs to.
   *
   * `EmployeeIdentityService` resolves a user to their staff identity strictly
   * through HR — `HrEmployee.userId` → `partnerId` → `StaffProfile` — and
   * deliberately provides no fallback, so that an unlinked login cannot act as
   * a member of staff. A demo that skips this step gives a teacher a working
   * password and an empty "My courses", which looks like the product is broken.
   */
  async function linkLoginToStaff(opts: {
    userId: string;
    partnerId: string;
    employeeCode: string;
    first: string;
    last: string;
    email: string;
  }): Promise<void> {
    const existing = await prisma.hrEmployee.findFirst({
      where: { organizationId: O, employeeCode: opts.employeeCode },
    });
    if (existing) {
      await prisma.hrEmployee.update({
        where: { id: existing.id },
        data: { userId: opts.userId, partnerId: opts.partnerId },
      });
      return;
    }
    await prisma.hrEmployee.create({
      data: {
        organizationId: O,
        employeeCode: opts.employeeCode,
        userId: opts.userId,
        partnerId: opts.partnerId,
        firstName: opts.first,
        lastName: opts.last,
        email: opts.email,
        employmentType: 'FULL_TIME',
        hireDate: new Date('2023-01-09'),
      },
    });
  }

  /** Create (or refresh) a staff member: Partner + StaffProfile, optionally a login. */
  async function upsertStaff(opts: {
    key: string;
    first: string;
    last: string;
    employeeNo: string;
    title: string;
    roleName: string;
    teaches: string[];
    login: boolean;
  }): Promise<DemoStaff> {
    const name = `${opts.first} ${opts.last}`;
    const email = `${opts.key}@${DOMAIN}`;
    const partner = await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: O, code: `${PFX}-STAFF-${opts.employeeNo}` } },
      update: { name, email, phone: phoneFor(`staff:${opts.key}`), isEmployee: true },
      create: {
        organizationId: O,
        code: `${PFX}-STAFF-${opts.employeeNo}`,
        name,
        email,
        phone: phoneFor(`staff:${opts.key}`),
        isEmployee: true,
        gender: FEMALE_NAMES.includes(opts.first) ? 'F' : 'M',
      },
    });

    const staff = await prisma.staffProfile.upsert({
      where: { organizationId_employeeNo: { organizationId: O, employeeNo: opts.employeeNo } },
      update: { partnerId: partner.id, status: 'active' },
      create: {
        organizationId: O,
        partnerId: partner.id,
        employeeNo: opts.employeeNo,
        joinDate: new Date('2023-01-09'),
        status: 'active',
        staffCategory: opts.teaches.length > 0 ? 'teaching' : 'non_teaching',
      },
    });

    if (opts.login) {
      const roleId = roleIds.get(opts.roleName);
      const user = await prisma.user.upsert({
        where: { organizationId_email: { organizationId: O, email } },
        update: { firstName: opts.first, lastName: opts.last, isActive: true, passwordHash: staffHash },
        create: {
          organizationId: O,
          email,
          passwordHash: staffHash,
          firstName: opts.first,
          lastName: opts.last,
          isActive: true,
        },
      });
      if (roleId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { roles: { set: [{ id: roleId }] } },
        });
      }
      await linkLoginToStaff({
        userId: user.id,
        partnerId: partner.id,
        employeeCode: opts.employeeNo,
        first: opts.first,
        last: opts.last,
        email,
      });
    }

    return { id: staff.id, partnerId: partner.id, name, email, role: opts.title, teaches: opts.teaches };
  }

  // ── Leadership ────────────────────────────────────────────────────────────
  const leadership: DemoStaff[] = [];
  for (const [i, l] of LEADERSHIP.entries()) {
    leadership.push(
      await upsertStaff({
        key: l.key,
        first: l.first,
        last: l.last,
        employeeNo: `${PFX}-A${String(i + 1).padStart(3, '0')}`,
        title: l.title,
        roleName: l.role,
        teaches: [],
        login: l.login,
      }),
    );
  }
  log(`leadership: ${leadership.map((x) => x.role).join(', ')}`);

  // ── Subject teachers ──────────────────────────────────────────────────────
  const subjectTeachers: DemoStaff[] = [];
  for (const [i, t] of SUBJECT_TEACHERS.entries()) {
    subjectTeachers.push(
      await upsertStaff({
        key: t.key,
        first: t.first,
        last: t.last,
        employeeNo: `${PFX}-T${String(i + 1).padStart(3, '0')}`,
        title: 'Subject Teacher',
        roleName: 'Subject Teacher',
        teaches: t.teaches,
        login: t.login,
      }),
    );
  }
  log(`subject teachers: ${subjectTeachers.length}`);

  // ── Class teachers, one per stream ────────────────────────────────────────
  // A class teacher owns the register and the report-card comment, so every
  // stream needs exactly one. Names are generated, because thirty invented
  // biographies add nothing to a demo.
  const classTeachers = new Map<string, DemoStaff>(); // "P5:NORTH" -> staff
  let ctIndex = 0;
  for (const gradeCode of ALL_GRADES) {
    for (const section of s.sectionsByClassCode(gradeCode)) {
      ctIndex += 1;
      const r = rng(`classteacher:${gradeCode}:${section.code}`);
      const female = r() > 0.42;
      const first = pick(female ? FEMALE_NAMES : MALE_NAMES, r);
      const last = pick(SURNAMES, r);
      const staff = await upsertStaff({
        key: `ct-${gradeCode.toLowerCase()}-${section.code.toLowerCase()}`,
        first,
        last,
        employeeNo: `${PFX}-C${String(ctIndex).padStart(3, '0')}`,
        title: 'Class Teacher',
        roleName: 'Class Teacher',
        teaches: [],
        login: false,
      });
      classTeachers.set(`${gradeCode}:${section.code}`, staff);

      // The stream's class teacher, and the class's homeroom teacher for the
      // first stream of each grade.
      await prisma.section.update({ where: { id: section.id }, data: { classTeacherId: staff.id } });
    }
  }
  for (const gradeCode of ALL_GRADES) {
    const first = s.sectionsByClassCode(gradeCode)[0];
    const cls = s.classes.get(gradeCode);
    const ct = first ? classTeachers.get(`${gradeCode}:${first.code}`) : undefined;
    if (cls && ct) {
      await prisma.schoolClass.update({ where: { id: cls.id }, data: { homeroomTeacherId: ct.id } });
    }
  }
  ok(`class teachers: ${classTeachers.size}, one per stream`);

  // ── One demo class teacher gets a login ───────────────────────────────────
  // The P5 showcase-stream teacher is the demo's "teacher persona": the
  // showcase LMS courses and lesson plans belong to them.
  const p5North = classTeachers.get(`P5:${SHOW}`);
  if (p5North) {
    const [first, ...rest] = p5North.name.split(' ');
    const email = `teacher@${DOMAIN}`;
    const user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: O, email } },
      update: { firstName: first, lastName: rest.join(' '), passwordHash: staffHash, isActive: true },
      create: {
        organizationId: O,
        email,
        passwordHash: staffHash,
        firstName: first,
        lastName: rest.join(' '),
        isActive: true,
      },
    });
    const roleId = roleIds.get('Class Teacher');
    if (roleId) {
      await prisma.user.update({ where: { id: user.id }, data: { roles: { set: [{ id: roleId }] } } });
    }
    // Same HR link as every other login, or this teacher sees no classes.
    const p5Staff = await prisma.staffProfile.findFirst({
      where: { organizationId: O, partnerId: p5North.partnerId },
      select: { employeeNo: true },
    });
    if (p5Staff) {
      await linkLoginToStaff({
        userId: user.id,
        partnerId: p5North.partnerId,
        employeeCode: p5Staff.employeeNo,
        first,
        last: rest.join(' '),
        email,
      });
    }
    log(`teacher login: ${email} (${p5North.name}, ${SHOW_LABEL})`);
  }

  // ── Pupils and guardians ──────────────────────────────────────────────────
  const pupils: DemoPupil[] = [];
  let admissionCounter = 0;

  for (const gradeCode of ALL_GRADES) {
    const streams = s.sectionsByClassCode(gradeCode);
    const perStream = CLASS_SIZE[gradeCode] ?? 30;

    for (const section of streams) {
      for (let roll = 1; roll <= perStream; roll += 1) {
        admissionCounter += 1;
        const key = `pupil:${gradeCode}:${section.code}:${roll}`;
        const r = rng(key);
        const female = r() > 0.5;
        const firstName = pick(female ? FEMALE_NAMES : MALE_NAMES, r);
        const lastName = pick(SURNAMES, r);
        const name = `${firstName} ${lastName}`;
        const admissionNo = `${SCHOOL.admissionPrefix}/${String(admissionCounter).padStart(4, '0')}`;

        // Age appropriate to the grade, spread across the year so a class is
        // not thirty children with the same birthday.
        const age = ENTRY_AGE[gradeCode] ?? 6;
        const birthYear = 2026 - age;
        const dob = new Date(Date.UTC(birthYear, int(r, 0, 11), int(r, 1, 28)));

        const partner = await prisma.partner.upsert({
          where: { organizationId_code: { organizationId: O, code: `${PFX}-PUP-${admissionNo.replace('/', '-')}` } },
          update: { name },
          create: {
            organizationId: O,
            code: `${PFX}-PUP-${admissionNo.replace('/', '-')}`,
            name,
            isCustomer: true,
            gender: female ? 'F' : 'M',
          },
        });

        const profile = await prisma.studentProfile.upsert({
          where: { organizationId_admissionNo: { organizationId: O, admissionNo } },
          update: { partnerId: partner.id, status: 'active' },
          create: {
            organizationId: O,
            partnerId: partner.id,
            admissionNo,
            enrollmentDate: new Date(`${birthYear + (ENTRY_AGE[gradeCode] ?? 6) - 0}-02-01`),
            status: 'active',
            dateOfBirth: dob,
            gender: female ? 'F' : 'M',
            nationality: 'UG',
            religion: pick(['Catholic', 'Anglican', 'Muslim', 'Pentecostal', 'Seventh Day Adventist'], r),
            residenceType: r() > 0.82 ? SCHOOL.boarderValue : 'day',
            house: pick(HOUSES, r),
          },
        });

        // ── Guardian ──
        // One guardian per pupil, which is what a register usually carries.
        // The relationship is decided first so the given name can agree with
        // it: a guardian recorded as "mother" must not be called Raymond.
        const relationship = pick(['father', 'mother', 'guardian', 'uncle', 'aunt'], r);
        const guardianIsFemale = relationship === 'mother' || relationship === 'aunt';
        const gFirst = pick(guardianIsFemale ? FEMALE_NAMES : MALE_NAMES, r);
        const guardianName = `${gFirst} ${lastName}`;
        const gPartner = await prisma.partner.upsert({
          where: { organizationId_code: { organizationId: O, code: `${PFX}-GDN-${admissionNo.replace('/', '-')}` } },
          update: { name: guardianName },
          create: {
            organizationId: O,
            code: `${PFX}-GDN-${admissionNo.replace('/', '-')}`,
            name: guardianName,
            phone: phoneFor(`guardian:${admissionNo}`),
            email: null,
            isCustomer: true,
          },
        });
        let contact = await prisma.contact.findFirst({
          where: { organizationId: O, partnerId: gPartner.id, firstName: gFirst, lastName },
        });
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              organizationId: O,
              partnerId: gPartner.id,
              firstName: gFirst,
              lastName,
              phone: phoneFor(`guardian:${admissionNo}`),
            },
          });
        }

        await prisma.studentGuardian.upsert({
          where: {
            studentProfileId_guardianContactId: {
              studentProfileId: profile.id,
              guardianContactId: contact.id,
            },
          },
          update: { isPrimary: true, receivesStatements: true, canPickup: true },
          create: {
            organizationId: O,
            studentProfileId: profile.id,
            guardianContactId: contact.id,
            relationship,
            isPrimary: true,
            canPickup: true,
            receivesStatements: true,
          },
        });

        pupils.push({
          id: profile.id,
          partnerId: partner.id,
          name,
          firstName,
          lastName,
          admissionNo,
          gradeCode,
          streamCode: section.code,
          gender: female ? 'F' : 'M',
          roll,
          guardianContactId: contact.id,
          guardianName,
        });
      }
    }
    log(`${gradeCode.padEnd(7)} ${streams.length} streams x ${perStream} = ${streams.length * perStream} pupils`);
  }
  ok(`pupils: ${pupils.length} with a guardian each`);

  // ── Portal logins for the demo pupil and guardian ─────────────────────────
  // One of each is enough to walk the learner and parent journeys. They are
  // taken from P5 North, the stream whose LMS courses are built out.
  const demoPupil = pupils.find((p) => p.gradeCode === 'P5' && p.streamCode === SHOW && p.roll === 1);
  let portalNote = `no portal logins (${SHOW_LABEL} roll 1 not found)`;
  if (demoPupil) {
    const pupilEmail = `pupil@${DOMAIN}`;
    const pupilUser = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: O, email: pupilEmail } },
      update: { firstName: demoPupil.firstName, lastName: demoPupil.lastName, passwordHash: portalHash, isActive: true },
      create: {
        organizationId: O,
        email: pupilEmail,
        passwordHash: portalHash,
        firstName: demoPupil.firstName,
        lastName: demoPupil.lastName,
        isActive: true,
      },
    });
    const studentRole = roleIds.get('Student');
    if (studentRole) {
      await prisma.user.update({ where: { id: pupilUser.id }, data: { roles: { set: [{ id: studentRole }] } } });
    }
    const existingPupilIdentity = await prisma.portalIdentity.findFirst({
      where: { organizationId: O, userId: pupilUser.id, subjectType: 'student' },
    });
    if (!existingPupilIdentity) {
      await prisma.portalIdentity.create({
        data: {
          organizationId: O,
          userId: pupilUser.id,
          subjectType: 'student',
          studentProfileId: demoPupil.id,
        },
      });
    }

    const guardianEmail = `parent@${DOMAIN}`;
    const guardianUser = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: O, email: guardianEmail } },
      update: { firstName: demoPupil.guardianName.split(' ')[0], lastName: demoPupil.lastName, passwordHash: portalHash, isActive: true },
      create: {
        organizationId: O,
        email: guardianEmail,
        passwordHash: portalHash,
        firstName: demoPupil.guardianName.split(' ')[0],
        lastName: demoPupil.lastName,
        isActive: true,
      },
    });
    const parentRole = roleIds.get('Parent');
    if (parentRole) {
      await prisma.user.update({ where: { id: guardianUser.id }, data: { roles: { set: [{ id: parentRole }] } } });
    }
    const existingGuardianIdentity = await prisma.portalIdentity.findFirst({
      where: { organizationId: O, userId: guardianUser.id, subjectType: 'guardian' },
    });
    if (!existingGuardianIdentity) {
      await prisma.portalIdentity.create({
        data: {
          organizationId: O,
          userId: guardianUser.id,
          subjectType: 'guardian',
          guardianContactId: demoPupil.guardianContactId,
        },
      });
    }

    // A second child for the guardian, so the demo can show the child picker.
    const sibling = pupils.find((p) => p.gradeCode === 'P2' && p.streamCode === SHOW && p.roll === 1);
    if (sibling) {
      await prisma.studentGuardian.upsert({
        where: {
          studentProfileId_guardianContactId: {
            studentProfileId: sibling.id,
            guardianContactId: demoPupil.guardianContactId,
          },
        },
        update: { isPrimary: false, receivesStatements: true },
        create: {
          organizationId: O,
          studentProfileId: sibling.id,
          guardianContactId: demoPupil.guardianContactId,
          // The same contact as the demo pupil's guardian, so the same
          // relationship — a child picker that disagrees with itself is worse
          // than no child picker.
          relationship: 'guardian',
          isPrimary: false,
          canPickup: true,
          receivesStatements: true,
        },
      });
    }

    portalNote = `${pupilEmail} (${demoPupil.name}, ${SHOW_LABEL}) + ${guardianEmail} (${demoPupil.guardianName}, 2 children)`;
  } else {
    warn(`${SHOW_LABEL} roll 1 missing — no portal logins created`);
  }
  ok(`portal logins: ${portalNote}`);

  return {
    leadership,
    subjectTeachers,
    classTeachers,
    pupils,
    roleIds,
    demoPupil,
    passwords: { staff: STAFF_PASSWORD, portal: PORTAL_PASSWORD },
  };
}

export type People = Awaited<ReturnType<typeof seedPeople>>;
