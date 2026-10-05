/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 15 — human resources and payroll.
 *
 * The teaching staff exist already (stage 2). A school this size also runs on
 * cooks, matrons, drivers and bus attendants, guards, cleaners, a nurse, a
 * storekeeper, a librarian, an accounts assistant and an HR officer — about
 * thirty-five people who never appear on a timetable. This stage hires them,
 * gives everyone a department, a position on a grade, a salary a Kampala
 * private primary actually pays, bank or mobile-money details, an NSSF number
 * and a TIN; seeds Uganda's statutory deductions (PAYE, NSSF 5%/10%, LST);
 * and then runs the year: leave requests, salary advances and staff loans,
 * month-end payroll calculated, approved, paid by Stanbic batch and MoMo, and
 * PAYE / NSSF remitted by the 15th.
 */
import * as bcrypt from 'bcryptjs';
import { SCHOOL_ROLE_PRESETS } from '@erp/shared';
import type { PrismaClient } from '@prisma/client';
import type { School } from '../shared';
import { SCHOOL, ok, log, rng, pick, int, phoneFor, MALE_NAMES, FEMALE_NAMES, SURNAMES } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso, schoolDaysIso, PUBLIC_HOLIDAYS_2026 } from './kit';
import type { Books } from './13-accounts';

const PFX = SCHOOL.codePrefix;
const DOMAIN = SCHOOL.emailDomain;

/* ─────────────────────────── Organisation shape ───────────────────────────── */

const DEPARTMENTS = [
  { code: 'ADMIN', name: 'Administration' },
  { code: 'FIN', name: 'Finance & Accounts' },
  { code: 'TEACH-NUR', name: 'Nursery Section' },
  { code: 'TEACH-LP', name: 'Lower Primary (P.1–P.3)' },
  { code: 'TEACH-UP', name: 'Upper Primary (P.4–P.7)' },
  { code: 'BOARD', name: 'Boarding & Welfare' },
  { code: 'KITCHEN', name: 'Catering & Kitchen' },
  { code: 'TRANSPORT', name: 'Transport' },
  { code: 'SEC', name: 'Security & Grounds' },
  { code: 'SUP', name: 'Support Services' },
];

const GRADES = [
  { code: 'G1', name: 'G1 – Support Staff', min: 250_000, mid: 330_000, max: 450_000 },
  { code: 'G2', name: 'G2 – Skilled Support', min: 450_000, mid: 650_000, max: 1_000_000 },
  { code: 'G3', name: 'G3 – Teaching Staff', min: 650_000, mid: 950_000, max: 1_300_000 },
  { code: 'G4', name: 'G4 – Senior Staff', min: 1_200_000, mid: 1_700_000, max: 2_300_000 },
  { code: 'G5', name: 'G5 – School Leadership', min: 2_200_000, mid: 2_900_000, max: 4_000_000 },
];

const POSITIONS = [
  { code: 'HEAD-TCH', name: 'Head Teacher', dept: 'ADMIN', grade: 'G5', salary: 3_500_000 },
  { code: 'DEP-HEAD', name: 'Deputy Head Teacher', dept: 'ADMIN', grade: 'G5', salary: 2_400_000 },
  { code: 'DOS', name: 'Director of Studies', dept: 'ADMIN', grade: 'G4', salary: 2_100_000 },
  { code: 'BURSAR', name: 'Bursar', dept: 'FIN', grade: 'G4', salary: 1_900_000 },
  { code: 'HR-OFF', name: 'HR & Administration Officer', dept: 'ADMIN', grade: 'G4', salary: 1_300_000 },
  { code: 'REGISTRAR', name: 'Registrar / Secretary', dept: 'ADMIN', grade: 'G3', salary: 1_050_000 },
  { code: 'ACCT', name: 'Accounts Assistant', dept: 'FIN', grade: 'G2', salary: 850_000 },
  { code: 'NUR-TCH', name: 'Nursery Teacher', dept: 'TEACH-NUR', grade: 'G3', salary: 750_000 },
  { code: 'CLASS-TCH', name: 'Class Teacher', dept: 'TEACH-LP', grade: 'G3', salary: 950_000 },
  { code: 'SUBJ-TCH', name: 'Subject Teacher', dept: 'TEACH-UP', grade: 'G3', salary: 1_100_000 },
  { code: 'NURSE', name: 'School Nurse', dept: 'BOARD', grade: 'G2', salary: 950_000 },
  { code: 'MATRON', name: 'Matron', dept: 'BOARD', grade: 'G1', salary: 450_000 },
  { code: 'CATERING', name: 'Catering Supervisor', dept: 'KITCHEN', grade: 'G2', salary: 650_000 },
  { code: 'COOK', name: 'Cook', dept: 'KITCHEN', grade: 'G1', salary: 380_000 },
  { code: 'TRANS-OFF', name: 'Transport Officer', dept: 'TRANSPORT', grade: 'G2', salary: 900_000 },
  { code: 'DRIVER', name: 'Driver', dept: 'TRANSPORT', grade: 'G2', salary: 650_000 },
  { code: 'BUS-ATT', name: 'Bus Attendant', dept: 'TRANSPORT', grade: 'G1', salary: 300_000 },
  { code: 'GUARD', name: 'Security Guard', dept: 'SEC', grade: 'G1', salary: 350_000 },
  { code: 'GROUNDS', name: 'Groundsman', dept: 'SEC', grade: 'G1', salary: 280_000 },
  { code: 'CLEANER', name: 'Cleaner', dept: 'SUP', grade: 'G1', salary: 280_000 },
  { code: 'STORE', name: 'Storekeeper', dept: 'SUP', grade: 'G2', salary: 550_000 },
  { code: 'LIBRARIAN', name: 'Librarian', dept: 'SUP', grade: 'G2', salary: 650_000 },
];

/** Recurring pay by grade (salary structures). Amounts per month. */
const COMPONENTS = [
  { code: 'HOUSING', name: 'Housing Allowance', type: 'ALLOWANCE' as const },
  { code: 'TRANSPORT', name: 'Transport Allowance', type: 'ALLOWANCE' as const },
  { code: 'RESP', name: 'Responsibility Allowance', type: 'ALLOWANCE' as const },
  { code: 'DUTY', name: 'Duty Allowance', type: 'ALLOWANCE' as const },
  { code: 'SACCO', name: 'Sunrise Staff SACCO Savings', type: 'DEDUCTION' as const, category: 'OTHER_PAYABLE', taxable: false },
  { code: 'WELFARE', name: 'Staff Welfare Fund', type: 'DEDUCTION' as const, category: 'OTHER_PAYABLE', taxable: false },
];
const STRUCTURES: Record<string, Record<string, number>> = {
  G1: { DUTY: 30_000, WELFARE: 5_000 },
  G2: { DUTY: 50_000, TRANSPORT: 50_000, WELFARE: 10_000, SACCO: 30_000 },
  G3: { TRANSPORT: 100_000, WELFARE: 10_000, SACCO: 50_000 },
  G4: { TRANSPORT: 150_000, RESP: 250_000, WELFARE: 10_000, SACCO: 100_000 },
  G5: { HOUSING: 600_000, TRANSPORT: 300_000, RESP: 350_000, WELFARE: 20_000, SACCO: 150_000 },
};

/** Uganda statutory rates — see prisma/seed-hr-uganda.ts for the reasoning. */
const STATUTORY_FROM = new Date('2024-07-01T00:00:00.000Z');
const PAYE_BANDS = [
  { from: 0, to: 235_000, rate: 0 },
  { from: 235_000, to: 335_000, rate: 0.1 },
  { from: 335_000, to: 410_000, rate: 0.2 },
  { from: 410_000, to: 10_000_000, rate: 0.3 },
  { from: 10_000_000, to: null, rate: 0.4 },
];
const LST_BANDS = [
  { from: 100_000, to: 200_000, annual: 5_000 },
  { from: 200_000, to: 300_000, annual: 10_000 },
  { from: 300_000, to: 400_000, annual: 20_000 },
  { from: 400_000, to: 500_000, annual: 30_000 },
  { from: 500_000, to: 600_000, annual: 40_000 },
  { from: 600_000, to: 700_000, annual: 60_000 },
  { from: 700_000, to: 800_000, annual: 70_000 },
  { from: 800_000, to: 900_000, annual: 80_000 },
  { from: 900_000, to: 1_000_000, annual: 90_000 },
  { from: 1_000_000, to: null, annual: 100_000 },
];

/* ─────────────────────────── Non-teaching staff ───────────────────────────── */

type SupportSpec = {
  code: string;
  position: string;
  gender: 'M' | 'F';
  login?: { key: string; role: string };
  hired?: string;
  leaves?: string;
  employmentType?: 'FULL_TIME' | 'CONTRACT' | 'PROBATION';
};

/** The thirty-seven people who keep the school running. Names are generated. */
const SUPPORT: SupportSpec[] = [
  { code: 'S001', position: 'ACCT', gender: 'F', login: { key: 'accounts', role: 'Bursar' } },
  { code: 'S002', position: 'HR-OFF', gender: 'F', login: { key: 'hr', role: 'HR Officer' } },
  { code: 'S003', position: 'TRANS-OFF', gender: 'M', login: { key: 'transport', role: 'Transport Manager' } },
  { code: 'S004', position: 'CATERING', gender: 'F', login: { key: 'kitchen', role: 'Catering' } },
  { code: 'S005', position: 'NURSE', gender: 'F', login: { key: 'nurse', role: 'Nurse' } },
  { code: 'S006', position: 'COOK', gender: 'F' },
  { code: 'S007', position: 'COOK', gender: 'M' },
  { code: 'S008', position: 'COOK', gender: 'F' },
  { code: 'S009', position: 'COOK', gender: 'F', leaves: '2026-07-31' },
  { code: 'S010', position: 'COOK', gender: 'M' },
  { code: 'S011', position: 'MATRON', gender: 'F' },
  { code: 'S012', position: 'MATRON', gender: 'F' },
  { code: 'S013', position: 'DRIVER', gender: 'M' },
  { code: 'S014', position: 'DRIVER', gender: 'M' },
  { code: 'S015', position: 'DRIVER', gender: 'M' },
  { code: 'S016', position: 'DRIVER', gender: 'M' },
  { code: 'S017', position: 'DRIVER', gender: 'M' },
  { code: 'S018', position: 'DRIVER', gender: 'M' },
  { code: 'S019', position: 'BUS-ATT', gender: 'F' },
  { code: 'S020', position: 'BUS-ATT', gender: 'F' },
  { code: 'S021', position: 'BUS-ATT', gender: 'F' },
  { code: 'S022', position: 'BUS-ATT', gender: 'F' },
  { code: 'S023', position: 'BUS-ATT', gender: 'M' },
  { code: 'S024', position: 'GUARD', gender: 'M', employmentType: 'CONTRACT' },
  { code: 'S025', position: 'GUARD', gender: 'M', employmentType: 'CONTRACT' },
  { code: 'S026', position: 'GUARD', gender: 'M', employmentType: 'CONTRACT' },
  { code: 'S027', position: 'GUARD', gender: 'M', employmentType: 'CONTRACT' },
  { code: 'S028', position: 'CLEANER', gender: 'F' },
  { code: 'S029', position: 'CLEANER', gender: 'F' },
  { code: 'S030', position: 'CLEANER', gender: 'M' },
  { code: 'S031', position: 'CLEANER', gender: 'F' },
  { code: 'S032', position: 'GROUNDS', gender: 'M' },
  { code: 'S033', position: 'GROUNDS', gender: 'M' },
  { code: 'S034', position: 'STORE', gender: 'M' },
  { code: 'S035', position: 'LIBRARIAN', gender: 'F' },
  // Joined for the second half of the year.
  { code: 'S036', position: 'NUR-TCH', gender: 'F', hired: '2026-05-18', employmentType: 'PROBATION' },
  { code: 'S037', position: 'COOK', gender: 'F', hired: '2026-08-03', employmentType: 'PROBATION' },
];

const BANKS = ['Stanbic Bank', 'Centenary Bank', 'dfcu Bank', 'Absa Bank', 'Equity Bank', 'Housing Finance Bank', 'PostBank Uganda'];

/** Logins the operations demo adds (the academic stages made the rest). */
export const OPS_LOGINS = SUPPORT.filter((s) => s.login).map((s) => ({ key: s.login!.key, role: s.login!.role, code: s.code }));

function personName(code: string, gender: 'M' | 'F'): { first: string; last: string } {
  const r = rng(`support-name:${code}`);
  return { first: pick(gender === 'F' ? FEMALE_NAMES : MALE_NAMES, r), last: pick(SURNAMES, r) };
}

/**
 * Hire the support staff, with logins for the five who sign in (accounts, HR,
 * transport, kitchen, nurse). Runs before the stage context is built, so those
 * personas exist when the services need a user to act as.
 */
export async function ensureSupportStaff(prisma: PrismaClient, school: School): Promise<number> {
  const O = school.O;
  // Roles are stored data: a grant added to a preset after the school was
  // provisioned never reaches it. Bring the demo's roles up to their presets.
  for (const preset of SCHOOL_ROLE_PRESETS as ReadonlyArray<{ name: string; permissions: readonly string[] }>) {
    const role = await prisma.role.findFirst({ where: { organizationId: O, name: preset.name } });
    if (!role) continue;
    const merged = [...new Set([...(role.permissions as string[]), ...preset.permissions])];
    if (merged.length !== (role.permissions as string[]).length) await prisma.role.update({ where: { id: role.id }, data: { permissions: merged } });
  }
  const staffHash = await bcrypt.hash(process.env.DEMO_STAFF_PASSWORD ?? SCHOOL.passwords.staff, 10);
  for (const s of SUPPORT) {
    const { first, last } = personName(s.code, s.gender);
    const employeeNo = `${PFX}-${s.code}`;
    const email = s.login ? `${s.login.key}@${DOMAIN}` : null;
    const partner = await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: O, code: `${PFX}-STAFF-${employeeNo}` } },
      update: { name: `${first} ${last}`, isEmployee: true },
      create: {
        organizationId: O,
        code: `${PFX}-STAFF-${employeeNo}`,
        name: `${first} ${last}`,
        email,
        phone: phoneFor(`staff:${s.code}`),
        isEmployee: true,
        gender: s.gender,
      },
    });
    await prisma.staffProfile.upsert({
      where: { organizationId_employeeNo: { organizationId: O, employeeNo } },
      update: { partnerId: partner.id },
      create: {
        organizationId: O,
        partnerId: partner.id,
        employeeNo,
        joinDate: new Date(`${s.hired ?? hireDateFor(s.code, s.position)}T00:00:00Z`),
        status: 'active',
        staffCategory: s.position === 'NUR-TCH' ? 'teaching' : 'non_teaching',
      },
    });
    let userId: string | null = null;
    if (s.login && email) {
      const role = await prisma.role.findFirst({ where: { organizationId: O, name: s.login.role } });
      const user = await prisma.user.upsert({
        where: { organizationId_email: { organizationId: O, email } },
        update: { firstName: first, lastName: last, isActive: true },
        create: { organizationId: O, email, passwordHash: staffHash, firstName: first, lastName: last, isActive: true },
      });
      if (role) await prisma.user.update({ where: { id: user.id }, data: { roles: { set: [{ id: role.id }] } } });
      userId = user.id;
    }
    const existing = await prisma.hrEmployee.findFirst({ where: { organizationId: O, employeeCode: employeeNo } });
    if (existing) {
      if (userId && existing.userId !== userId) await prisma.hrEmployee.update({ where: { id: existing.id }, data: { userId } });
    } else {
      await prisma.hrEmployee.create({
        data: {
          organizationId: O,
          employeeCode: employeeNo,
          userId,
          partnerId: partner.id,
          firstName: first,
          lastName: last,
          email,
          phone: phoneFor(`staff:${s.code}`),
          gender: s.gender,
          employmentType: s.employmentType ?? 'FULL_TIME',
          hireDate: new Date(`${s.hired ?? hireDateFor(s.code, s.position)}T00:00:00Z`),
        },
      });
    }
  }
  return SUPPORT.length;
}

function hireDateFor(code: string, position: string): string {
  const r = rng(`hire:${code}`);
  const senior = ['HEAD-TCH', 'DEP-HEAD', 'DOS', 'BURSAR'].includes(position);
  const year = senior ? int(r, 2011, 2018) : int(r, 2015, 2025);
  const month = pick(['01', '01', '02', '05', '09'], r);
  return `${year}-${month}-${String(int(r, 2, 20)).padStart(2, '0')}`;
}

/* ───────────────────────────────── The stage ──────────────────────────────── */

export async function seedHr(ctx: Ctx, tl: Timeline, books: Books): Promise<void> {
  const { prisma, O } = ctx;
  const payroll = ctx.svc('modules/hr/hr-payroll.service', 'HrPayrollService');
  const leave = ctx.svc('modules/hr/hr-leave.service', 'HrLeaveService');
  const postingSvc = ctx.svc('modules/accounting/posting/posting.service', 'PostingService');

  /**
   * Salaries and advances paid by mobile money leave the payroll's MoMo
   * clearing account; the bursar funds that bulk-disbursement float from
   * Centenary the same day, so the clearing account nets back to zero.
   */
  const fundMomoFloat = async (at: Date, label: string) => {
    const clearing = await prisma.account.findFirst({ where: { organizationId: O, code: 'MOMO-CLR' } });
    if (!clearing) return;
    const postingKey = `demo:momo-float:${at.toISOString()}`;
    if (await prisma.journalEntry.findFirst({ where: { organizationId: O, postingKey } })) return;
    const agg = await prisma.journalLine.aggregate({
      where: { organizationId: O, accountId: clearing.id, entry: { status: { in: ['posted', 'reversed'] } } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const owed = Number(agg._sum.baseCredit ?? 0) - Number(agg._sum.baseDebit ?? 0);
    if (owed <= 0) return;
    await ctx.as('bursar', () =>
      postingSvc.post({
        journalCode: 'BANK',
        date: at,
        description: `MTN/Airtel bulk disbursement float funded – ${label}`,
        sourceType: 'bank_transfer',
        postingKey,
        lines: [
          { accountId: clearing.id, debit: String(owed), description: 'Bulk MoMo float' },
          { accountId: books.account('1200'), credit: String(owed), description: 'Centenary – MoMo bulk payments' },
        ],
      }),
    );
  };

  // ── 1. Departments, grades, positions ────────────────────────────────────
  const deptId = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const row = await prisma.hrDepartment.upsert({
      where: { organizationId_code: { organizationId: O, code: d.code } },
      update: { name: d.name, isActive: true, deletedAt: null },
      create: { organizationId: O, code: d.code, name: d.name },
    });
    deptId.set(d.code, row.id);
  }
  // The old generic departments stay, unused, so nothing that pointed at them breaks.
  const gradeId = new Map<string, string>();
  for (const g of GRADES) {
    const row = await prisma.hrJobGrade.upsert({
      where: { organizationId_code: { organizationId: O, code: g.code } },
      update: { name: g.name, minSalary: g.min, midSalary: g.mid, maxSalary: g.max },
      create: { organizationId: O, code: g.code, name: g.name, minSalary: g.min, midSalary: g.mid, maxSalary: g.max },
    });
    gradeId.set(g.code, row.id);
  }
  const positionId = new Map<string, string>();
  for (const p of POSITIONS) {
    const data = { name: p.name, departmentId: deptId.get(p.dept)!, gradeId: gradeId.get(p.grade)!, defaultSalary: p.salary, isActive: true };
    const row = await prisma.hrPosition.upsert({
      where: { organizationId_code: { organizationId: O, code: p.code } },
      update: data,
      create: { organizationId: O, code: p.code, ...data },
    });
    positionId.set(p.code, row.id);
  }
  // Retire the setup positions nobody holds, so the pickers show this school.
  await prisma.hrPosition.updateMany({
    where: { organizationId: O, code: { notIn: POSITIONS.map((p) => p.code) }, employees: { none: {} } },
    data: { isActive: false },
  });

  // ── 2. Everyone's employment record ──────────────────────────────────────
  const employees = await prisma.hrEmployee.findMany({ where: { organizationId: O, deletedAt: null } });
  const placement = (code: string): { position: string; dept?: string } | null => {
    const n = Number(code.slice(-3));
    if (code.endsWith('A001')) return { position: 'HEAD-TCH' };
    if (code.endsWith('A002')) return { position: 'DEP-HEAD' };
    if (code.endsWith('A003')) return { position: 'DOS' };
    if (code.endsWith('A004')) return { position: 'BURSAR' };
    if (code.endsWith('A005')) return { position: 'REGISTRAR' };
    if (/-T\d{3}$/.test(code)) return { position: 'SUBJ-TCH' };
    if (/-C\d{3}$/.test(code)) {
      if (n <= 6) return { position: 'NUR-TCH' };
      if (n <= 15) return { position: 'CLASS-TCH', dept: 'TEACH-LP' };
      return { position: 'CLASS-TCH', dept: 'TEACH-UP' };
    }
    const s = SUPPORT.find((x) => code.endsWith(`-${x.code}`));
    return s ? { position: s.position } : null;
  };

  let updated = 0;
  for (const e of employees) {
    const place = placement(e.employeeCode);
    if (!place) continue;
    const pos = POSITIONS.find((p) => p.code === place.position)!;
    const r = rng(`emp:${e.employeeCode}`);
    const band = GRADES.find((g) => g.code === pos.grade)!;
    const spread = pos.salary >= 2_000_000 ? 0 : Math.round((r() - 0.5) * 0.24 * pos.salary / 10_000) * 10_000;
    const salary = Math.min(band.max, Math.max(band.min, pos.salary + spread));
    const g1 = pos.grade === 'G1';
    const momo = g1 && r() < 0.7;
    const bank = pick(BANKS, r);
    const gender = e.gender ?? (FEMALE_NAMES.includes(e.firstName) ? 'F' : 'M');
    const age = pos.grade === 'G5' ? int(r, 44, 56) : int(r, 24, 50);
    await prisma.hrEmployee.update({
      where: { id: e.id },
      data: {
        departmentId: deptId.get(place.dept ?? pos.dept)!,
        positionId: positionId.get(pos.code)!,
        baseSalary: salary,
        payFrequency: 'MONTHLY',
        gender,
        dateOfBirth: new Date(Date.UTC(2026 - age, int(r, 0, 11), int(r, 1, 28))),
        hireDate: e.hireDate && e.hireDate.getUTCFullYear() !== 2023 ? e.hireDate : new Date(`${hireDateFor(e.employeeCode, pos.code)}T00:00:00Z`),
        phone: e.phone ?? phoneFor(`staff:${e.employeeCode}`),
        address: `${pick(['Ntinda', 'Kireka', 'Najjera', 'Kyanja', 'Bweyogerere', 'Namugongo', 'Kisaasi', 'Mutungo', 'Seeta', 'Nansana'], r)}, ${pick(['Kampala', 'Wakiso', 'Mukono'], r)}`,
        bankName: momo ? null : bank,
        bankAccountName: momo ? null : `${e.firstName} ${e.lastName ?? ''}`.trim().toUpperCase(),
        bankAccountNumber: momo ? null : bankAccountNumber(bank, r),
        mobileMoneyProvider: momo ? pick(['MTN', 'MTN', 'Airtel'], r) : null,
        mobileMoneyNumber: momo ? (e.phone ?? phoneFor(`staff:${e.employeeCode}`)) : null,
        taxNumber: `10${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
        socialSecurityNumber: String(Math.floor(r() * 1e13)).padStart(13, '0'),
        isActive: true,
      },
    });
    updated += 1;
  }
  // Supervisors: the head over leadership, the deputy over teachers, the bursar
  // over finance, the HR officer over support staff.
  const byCode = new Map((await prisma.hrEmployee.findMany({ where: { organizationId: O } })).map((e) => [e.employeeCode, e]));
  const head = byCode.get(`${PFX}-A001`);
  const deputy = byCode.get(`${PFX}-A002`);
  const bursar = byCode.get(`${PFX}-A004`);
  const hrOfficer = byCode.get(`${PFX}-S002`);
  const kitchenLead = byCode.get(`${PFX}-S004`);
  const transportLead = byCode.get(`${PFX}-S003`);
  for (const e of byCode.values()) {
    const place = placement(e.employeeCode);
    if (!place) continue;
    const pos = place.position;
    const supervisor =
      ['DEP-HEAD', 'DOS', 'BURSAR', 'HR-OFF', 'REGISTRAR'].includes(pos) ? head
      : ['NUR-TCH', 'CLASS-TCH', 'SUBJ-TCH'].includes(pos) ? deputy
      : pos === 'ACCT' || pos === 'STORE' ? bursar
      : pos === 'COOK' ? kitchenLead
      : pos === 'DRIVER' || pos === 'BUS-ATT' ? transportLead
      : pos === 'HEAD-TCH' ? null
      : hrOfficer;
    if (supervisor && supervisor.id !== e.id) await prisma.hrEmployee.update({ where: { id: e.id }, data: { supervisorId: supervisor.id } });
  }
  for (const [code, manager] of [['ADMIN', head], ['FIN', bursar], ['TEACH-NUR', deputy], ['TEACH-LP', deputy], ['TEACH-UP', byCode.get(`${PFX}-A003`)], ['KITCHEN', kitchenLead], ['TRANSPORT', transportLead], ['BOARD', byCode.get(`${PFX}-S005`)], ['SEC', hrOfficer], ['SUP', hrOfficer]] as const) {
    if (manager) await prisma.hrDepartment.update({ where: { id: deptId.get(code)! }, data: { managerId: manager.id } });
  }
  ok(`employees: ${updated} placed on positions and grades with salaries, bank / MoMo, TIN and NSSF numbers`);

  // Contracts and qualifications — what an inspector or auditor asks to see.
  for (const e of byCode.values()) {
    const place = placement(e.employeeCode);
    if (!place || !e.hireDate) continue;
    const r = rng(`contract:${e.employeeCode}`);
    const contractNumber = `CTR-${e.employeeCode}`;
    const exists = await prisma.hrContract.findFirst({ where: { organizationId: O, contractNumber } });
    if (!exists) {
      const fixed = e.employmentType === 'CONTRACT' || e.employmentType === 'PROBATION';
      await prisma.hrContract.create({
        data: {
          organizationId: O,
          employeeId: e.id,
          contractNumber,
          type: e.employmentType === 'PROBATION' ? 'probation' : fixed ? 'fixed_term' : 'permanent',
          startDate: e.hireDate,
          endDate: fixed ? new Date(Date.UTC(e.hireDate.getUTCFullYear() + (e.employmentType === 'PROBATION' ? 0 : 1), e.hireDate.getUTCMonth() + (e.employmentType === 'PROBATION' ? 6 : 0), e.hireDate.getUTCDate())) : null,
          payFrequency: 'MONTHLY',
          salary: { amount: Number(e.baseSalary ?? 0), currency: 'UGX' },
          status: 'active',
          signedAt: e.hireDate,
        },
      });
    }
    if (['NUR-TCH', 'CLASS-TCH', 'SUBJ-TCH', 'DOS', 'DEP-HEAD', 'HEAD-TCH'].includes(place.position)) {
      const has = await prisma.hrQualification.count({ where: { organizationId: O, employeeId: e.id } });
      if (has === 0) {
        const quals = place.position === 'NUR-TCH'
          ? [{ type: 'teaching_qual', title: 'Certificate in Early Childhood Development (ECD)', institution: pick(['Kyambogo University', 'Shimoni Core PTC', 'Nkozi PTC'], r) }]
          : place.position === 'CLASS-TCH'
            ? [{ type: 'teaching_qual', title: "Grade III Teachers' Certificate", institution: pick(['Shimoni Core PTC', 'Kibuli Core PTC', 'Ndegeya Core PTC', 'Kabulasoke Core PTC'], r) },
               ...(r() < 0.5 ? [{ type: 'diploma', title: 'Diploma in Primary Education', institution: pick(['Kyambogo University', 'Nkozi University'], r) }] : [])]
            : [{ type: 'diploma', title: 'Diploma in Primary Education', institution: pick(['Kyambogo University', 'Kibuli Core PTC'], r) },
               { type: 'degree', title: pick(['Bachelor of Education (Primary)', 'Bachelor of Arts with Education', 'Bachelor of Science with Education'], r), institution: pick(['Kyambogo University', 'Makerere University', 'Ndejje University', 'Kampala University', 'Uganda Christian University'], r) }];
        let year = (e.hireDate?.getUTCFullYear() ?? 2018) - quals.length * 2;
        for (const q of quals) {
          await prisma.hrQualification.create({
            data: { organizationId: O, employeeId: e.id, type: q.type, title: q.title, institution: q.institution, graduatedAt: new Date(Date.UTC(year, 11, 15)) },
          });
          year += 2;
        }
      }
    }
  }
  log('contracts and teaching qualifications on file');

  // The cook who left in July: a dated exit earns a final payslip.
  const leaver = SUPPORT.find((s) => s.leaves);
  const leaverEmp = leaver ? byCode.get(`${PFX}-${leaver.code}`) : undefined;
  if (leaver && leaverEmp) {
    const exists = await prisma.hrOffboarding.findFirst({ where: { organizationId: O, employeeId: leaverEmp.id } });
    if (!exists) {
      await prisma.hrOffboarding.create({
        data: {
          organizationId: O,
          employeeId: leaverEmp.id,
          reason: 'resignation',
          noticeDate: new Date(`2026-07-01T00:00:00Z`),
          lastWorkingDay: new Date(`${leaver.leaves}T00:00:00Z`),
          status: 'settled',
          notes: 'Resigned to start a catering business in Mukono. One month notice served.',
          settledAt: new Date(`${leaver.leaves}T00:00:00Z`),
        },
      });
    }
  }

  // ── 3. Pay structure and statutory deductions ────────────────────────────
  const componentId = new Map<string, string>();
  for (const c of COMPONENTS) {
    const row = await prisma.hrPayrollComponent.upsert({
      where: { organizationId_code: { organizationId: O, code: c.code } },
      update: { name: c.name, isActive: true, deletedAt: null },
      create: {
        organizationId: O,
        code: c.code,
        name: c.name,
        componentType: c.type,
        calcMethod: 'FIXED',
        amount: 0,
        isTaxable: 'taxable' in c ? c.taxable : true,
        isRecurring: true,
        deductionCategory: c.type === 'DEDUCTION' ? c.category : null,
      },
    });
    componentId.set(c.code, row.id);
  }
  for (const [grade, lines] of Object.entries(STRUCTURES)) {
    for (const [code, amount] of Object.entries(lines)) {
      await prisma.hrSalaryStructure.upsert({
        where: { organizationId_gradeId_componentId: { organizationId: O, gradeId: gradeId.get(grade)!, componentId: componentId.get(code)! } },
        update: { amount, isActive: true, deletedAt: null },
        create: { organizationId: O, gradeId: gradeId.get(grade)!, componentId: componentId.get(code)!, amount },
      });
    }
  }
  await seedStatutory(prisma, O);
  log('pay structure: 4 allowances, SACCO + welfare deductions by grade; PAYE, NSSF 5%/10%, LST');

  // ── 4. Leave types and the public holidays ───────────────────────────────
  const leaveTypes = [
    { code: 'ANNUAL', name: 'Annual Leave', daysPerYear: 21, carryForwardDays: 5 },
    { code: 'SICK', name: 'Sick Leave', daysPerYear: 30 },
    { code: 'MATERNITY', name: 'Maternity Leave', daysPerYear: 60, maxConsecutiveDays: 60 },
    { code: 'PATERNITY', name: 'Paternity Leave', daysPerYear: 4 },
    { code: 'COMPASSIONATE', name: 'Compassionate Leave', daysPerYear: 5 },
    { code: 'STUDY', name: 'Study Leave (unpaid)', daysPerYear: 10, isPaid: false },
  ];
  const leaveTypeId = new Map<string, string>();
  for (const t of leaveTypes) {
    const row = await prisma.hrLeaveType.upsert({
      where: { organizationId_code: { organizationId: O, code: t.code } },
      update: { name: t.name, daysPerYear: t.daysPerYear, isActive: true, deletedAt: null },
      create: { organizationId: O, ...t, isPaid: t.isPaid ?? true },
    });
    leaveTypeId.set(t.code, row.id);
  }
  for (const h of PUBLIC_HOLIDAYS_2026) {
    const date = new Date(`${h.date}T00:00:00Z`);
    const exists = await prisma.hrHoliday.findFirst({ where: { organizationId: O, date } });
    if (!exists) await prisma.hrHoliday.create({ data: { organizationId: O, name: h.name, date, isRecurring: !['Eid al-Fitr', 'Eid al-Adha', 'Good Friday', 'Easter Monday'].includes(h.name) } });
  }
  log(`leave: ${leaveTypes.length} types, ${PUBLIC_HOLIDAYS_2026.length} public holidays`);

  // ── 5. Leave requests through the year ───────────────────────────────────
  const emp = (code: string) => byCode.get(`${PFX}-${code}`)!;
  const LEAVE = [
    { who: 'C003', type: 'MATERNITY', from: '2026-06-15', to: '2026-08-13', reason: 'Maternity leave — expected delivery late June.', outcome: 'approve', by: 'head' as const },
    { who: 'T004', type: 'COMPASSIONATE', from: '2026-03-09', to: '2026-03-12', reason: "Burial of my father in Mbale.", outcome: 'approve', by: 'deputy' as const },
    { who: 'C011', type: 'SICK', from: '2026-02-23', to: '2026-02-25', reason: 'Malaria — doctor\'s note from Mengo Hospital attached.', outcome: 'approve', by: 'deputy' as const },
    { who: 'S013', type: 'ANNUAL', from: '2026-05-04', to: '2026-05-13', reason: 'Annual leave during the first-term holiday.', outcome: 'approve', by: 'hr' as const },
    { who: 'S006', type: 'ANNUAL', from: '2026-08-24', to: '2026-08-28', reason: 'Visiting family in Masaka.', outcome: 'approve', by: 'hr' as const },
    { who: 'T009', type: 'PATERNITY', from: '2026-04-13', to: '2026-04-16', reason: 'Birth of our second child.', outcome: 'approve', by: 'deputy' as const },
    { who: 'C018', type: 'SICK', from: '2026-07-06', to: '2026-07-07', reason: 'Typhoid treatment.', outcome: 'approve', by: 'deputy' as const },
    { who: 'S024', type: 'COMPASSIONATE', from: '2026-06-22', to: '2026-06-24', reason: 'Burial of a brother in Gulu.', outcome: 'approve', by: 'hr' as const },
    { who: 'T012', type: 'STUDY', from: '2026-08-17', to: '2026-08-21', reason: 'Kyambogo University end-of-semester examinations (B.Ed in-service).', outcome: 'approve', by: 'head' as const },
    { who: 'S028', type: 'SICK', from: '2026-09-14', to: '2026-09-15', reason: 'Back pain — clinic visit.', outcome: 'approve', by: 'hr' as const },
    { who: 'C020', type: 'ANNUAL', from: '2026-09-21', to: '2026-09-25', reason: 'Wedding introduction ceremony (kwanjula) in Mityana.', outcome: 'reject', by: 'deputy' as const, note: 'Declined — mid-term examinations week. Please re-apply for the holiday.' },
    { who: 'S015', type: 'ANNUAL', from: '2026-12-07', to: '2026-12-18', reason: 'Annual leave after third term.', outcome: 'pending', by: 'hr' as const, requestOn: '2026-09-28' },
    { who: 'T006', type: 'SICK', from: '2026-10-01', to: '2026-10-02', reason: 'Flu — resting at home.', outcome: 'pending', by: 'deputy' as const, requestOn: '2026-10-01' },
    { who: 'S011', type: 'ANNUAL', from: '2026-12-14', to: '2026-12-24', reason: 'Christmas with family in Kabale.', outcome: 'pending', by: 'hr' as const, requestOn: '2026-09-30' },
  ];
  LEAVE.forEach((l, i) => {
    const e = byCode.get(`${PFX}-${l.who}`);
    if (!e) return;
    const requestOn = l.requestOn ?? addDaysIso(l.from, -7);
    tl.add({
      at: eat(requestOn, '08:30'),
      priority: 30,
      label: `leave ${l.who} ${l.type}`,
      run: async () => {
        const reqKey = `${l.from}:${l.type}`;
        let req = await prisma.hrLeaveRequest.findFirst({
          where: { organizationId: O, employeeId: e.id, leaveTypeId: leaveTypeId.get(l.type)!, notes: { startsWith: `demo:${reqKey}:` } },
        });
        if (!req) {
          req = await ctx.as('hr', () =>
            leave.createRequest({ employeeId: e.id, leaveTypeId: leaveTypeId.get(l.type)!, startDate: l.from, endDate: l.to, reason: l.reason, notes: `demo:${reqKey}:${i}`, checkBalance: l.type !== 'MATERNITY' }),
          );
        }
        if (req!.status !== 'PENDING') return;
        if (l.outcome === 'approve') await ctx.as(l.by, () => leave.approveRequest(req!.id, {}));
        if (l.outcome === 'reject') await ctx.as(l.by, () => leave.rejectRequest(req!.id, { notes: l.note }));
      },
    });
  });

  // ── 6. Salary advances and staff loans ───────────────────────────────────
  const ADVANCES = [
    { who: 'S007', on: '2026-03-10', amount: 200_000, months: 2, note: "Child's hospital bill at Nsambya Hospital." },
    { who: 'S014', on: '2026-05-20', amount: 300_000, months: 3, note: 'School fees for own children (secondary).' },
    { who: 'C013', on: '2026-06-08', amount: 500_000, months: 2, note: 'Rent arrears.' },
    { who: 'S026', on: '2026-08-12', amount: 150_000, months: 1, note: 'Transport to a burial in Lira.' },
    { who: 'T002', on: '2026-09-07', amount: 400_000, months: 2, note: 'Medical — mother admitted at Mulago.' },
  ];
  ADVANCES.forEach((a, i) => {
    const e = byCode.get(`${PFX}-${a.who}`);
    if (!e) return;
    tl.add({
      at: eat(a.on, '09:00'),
      priority: 31,
      label: `advance ${a.who}`,
      run: async () => {
        let adv = await prisma.hrSalaryAdvance.findFirst({ where: { organizationId: O, employeeId: e.id, notes: a.note } });
        if (!adv) adv = await ctx.as('hr', () => payroll.createAdvance({ employeeId: e.id, amount: a.amount, installmentMonths: a.months, notes: a.note }));
        if (adv!.status === 'PENDING') adv = await ctx.as('head', () => payroll.approveAdvance(adv!.id));
        if (adv!.status === 'APPROVED') {
          await ctx.as('bursar', () =>
            payroll.markAdvancePaid(adv!.id, { paymentMethod: e.mobileMoneyNumber ? 'MOBILE_MONEY' : 'BANK', paidAt: eat(addDaysIso(a.on, 1), '11:00').toISOString() }),
          );
          await fundMomoFloat(eat(addDaysIso(a.on, 1), '11:15'), 'salary advance');
        }
        void i;
      },
    });
  });
  const LOANS = [
    { who: 'T002', on: '2026-02-16', principal: 3_000_000, rate: 0.1, installments: 10, note: 'Staff loan — plot of land in Gayaza (10 months).' },
    { who: 'S016', on: '2026-04-20', principal: 1_500_000, rate: 0.05, installments: 6, note: 'Staff loan — motorcycle for weekend boda business.' },
    { who: 'C021', on: '2026-07-06', principal: 2_000_000, rate: 0.1, installments: 8, note: 'Staff loan — B.Ed tuition at Kyambogo University.' },
  ];
  for (const l of LOANS) {
    const e = byCode.get(`${PFX}-${l.who}`);
    if (!e) continue;
    tl.add({
      at: eat(l.on, '10:00'),
      priority: 31,
      label: `loan ${l.who}`,
      run: async () => {
        const exists = await prisma.hrEmployeeLoan.findFirst({ where: { organizationId: O, employeeId: e.id, notes: l.note } });
        if (exists) return;
        await ctx.as('bursar', () =>
          payroll.createLoan({
            employeeId: e.id,
            principal: l.principal,
            interestRate: l.rate,
            installmentsTotal: l.installments,
            notes: l.note,
            disbursedAt: eat(l.on, '10:00').toISOString(),
            disbursementMethod: 'BANK',
          }),
        );
      },
    });
  }

  // ── 7. Month-end payroll ─────────────────────────────────────────────────
  const teachers = [...byCode.values()].filter((e) => /-(T|C)\d{3}$/.test(e.employeeCode));
  const drivers = [...byCode.values()].filter((e) => SUPPORT.some((s) => s.position === 'DRIVER' && e.employeeCode.endsWith(`-${s.code}`)));
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const periodCode = `PRD-2026-${mm}`;
    const start = `2026-${mm}-01`;
    const end = new Date(Date.UTC(2026, m, 0)).toISOString().slice(0, 10);
    const days = schoolDaysIso(start, end);
    const inputsDay = days[Math.max(0, days.length - 7)];
    const runDay = days[Math.max(0, days.length - 5)];
    const payDay = [...days].reverse().find((d) => d <= `2026-${mm}-28`) ?? days[days.length - 1];

    const periodFor = async (): Promise<any> => {
      const existing = await prisma.hrPayrollPeriod.findFirst({ where: { organizationId: O, periodCode } });
      if (existing) return existing;
      return ctx.as('hr', () => payroll.createPeriod({ startDate: start, endDate: end, periodType: 'MONTHLY', periodCode }));
    };

    tl.add({ at: eat(start === '2026-01-01' ? '2026-01-02' : days[0], '08:00'), priority: 5, label: `payroll period ${mm}`, run: periodFor });

    // Variable pay for the month, keyed so a replay finds it.
    tl.add({
      at: eat(inputsDay, '10:00'),
      priority: 40,
      label: `payroll inputs ${mm}`,
      run: async () => {
        const period = await periodFor();
        const r = rng(`inputs:${mm}`);
        const inputs: any[] = [];
        // Boarding-section weekend duty: four teachers a month during term.
        if (![1, 12].includes(m)) {
          const pool = [...teachers];
          for (let k = 0; k < 4 && pool.length; k += 1) {
            const e = pool.splice(Math.floor(r() * pool.length), 1)[0];
            inputs.push({ employeeId: e.id, periodId: period.id, inputType: 'ALLOWANCE', name: 'Boarding weekend duty', amount: 80_000, reference: `duty:${mm}:${e.employeeCode}` });
          }
        }
        // Drivers' overtime in months with trips, sports days and festivals.
        if ([3, 6, 7, 9].includes(m)) {
          for (const e of drivers.slice(0, m === 6 ? 4 : 2)) {
            inputs.push({ employeeId: e.id, periodId: period.id, inputType: 'ALLOWANCE', name: m === 6 ? 'Overtime – educational trip to Jinja' : m === 3 ? 'Overtime – inter-school sports day' : m === 7 ? 'Overtime – MDD festival (Wakiso)' : 'Overtime – P.7 seminar transport', amount: m === 6 ? 120_000 : 60_000, reference: `ot:${mm}:${e.employeeCode}` });
          }
        }
        // PLE 2025 results bonus, paid with February salaries.
        if (m === 2) {
          for (const code of ['C024', 'C025', 'T001', 'T002', 'T003', 'T004', 'A003']) {
            const e = byCode.get(`${PFX}-${code}`);
            if (e) inputs.push({ employeeId: e.id, periodId: period.id, inputType: 'BONUS', name: 'PLE 2025 performance bonus (34 first grades)', amount: code === 'A003' ? 500_000 : 300_000, reference: `ple-bonus:${code}` });
          }
        }
        // End-of-year ... and a medical refund in May.
        if (m === 5) {
          const e = byCode.get(`${PFX}-S011`);
          if (e) inputs.push({ employeeId: e.id, periodId: period.id, inputType: 'REIMBURSEMENT', name: 'Refund – first aid supplies bought for the dormitory', amount: 85_000, isTaxable: false, reference: `refund:${mm}:S011` });
        }
        const fresh: any[] = [];
        for (const inp of inputs) {
          const exists = await prisma.hrPayrollInput.findFirst({ where: { organizationId: O, periodId: period.id, reference: inp.reference } });
          if (!exists) fresh.push(inp);
        }
        if (fresh.length === 0) return;
        await ctx.as('hr', () => payroll.createPayrollInputs({ inputs: fresh }));
        const pending = await prisma.hrPayrollInput.findMany({ where: { organizationId: O, periodId: period.id, status: 'PENDING' }, select: { id: true } });
        if (pending.length) await ctx.as('head', () => payroll.approvePayrollInputs({ ids: pending.map((x) => x.id) }));
      },
    });

    tl.add({
      at: eat(runDay, '09:00'),
      priority: 41,
      label: `payroll run ${mm}`,
      run: async () => {
        const period = await periodFor();
        let run = await prisma.hrPayrollRun.findFirst({ where: { organizationId: O, periodId: period.id, deletedAt: null, status: { not: 'REVERSED' } } });
        if (!run) run = await ctx.as('hr', () => payroll.createRun({ periodId: period.id, paymentDate: eat(payDay, '12:00').toISOString(), notes: `${monthNames[m - 1]} 2026 salaries` }));
        if (run!.status === 'DRAFT' || run!.status === 'CALCULATED') {
          await ctx.as('hr', () => payroll.calculateRun(run!.id));
          await ctx.as('head', () => payroll.approveRun(run!.id));
        }
      },
    });

    tl.add({
      at: eat(payDay, '11:00'),
      priority: 42,
      label: `salaries paid ${mm}`,
      run: async () => {
        const period = await prisma.hrPayrollPeriod.findFirst({ where: { organizationId: O, periodCode } });
        if (!period) return;
        const run = await prisma.hrPayrollRun.findFirst({ where: { organizationId: O, periodId: period.id, status: 'APPROVED' } });
        if (!run) return;
        const slips = await prisma.hrPayslip.findMany({
          where: { organizationId: O, status: 'ISSUED', bankPaymentId: null, item: { runId: run.id } },
          include: { item: { include: { employee: true } } },
        });
        // Mobile-money staff are paid one by one from the operations account.
        for (const s of slips) {
          if (!s.item.employee?.mobileMoneyNumber) continue;
          await ctx.as('bursar', () => payroll.markPaid(s.id, { paymentMethod: 'MOBILE_MONEY', paidAt: eat(payDay, '11:30').toISOString() }));
        }
        await fundMomoFloat(eat(payDay, '11:45'), `${monthNames[m - 1]} salaries`);
        // Everyone with a bank account goes in one Centenary bulk-transfer batch.
        const remaining = await prisma.hrPayslip.count({ where: { organizationId: O, status: 'ISSUED', bankPaymentId: null, item: { runId: run.id } } });
        if (remaining > 0) {
          const batch: any = await ctx.as('bursar', () =>
            payroll.generateBankPayment({ runId: run.id, method: 'BANK', paymentDate: eat(payDay, '12:00').toISOString(), notes: `Centenary bulk salary transfer – ${monthNames[m - 1]} 2026` }),
          );
          await ctx.as('bursar', () => payroll.updateBankPaymentStatus(batch.id, { status: 'SENT' }));
          await ctx.as('head', () => payroll.updateBankPaymentStatus(batch.id, { status: 'PAID', paidAt: eat(payDay, '15:00').toISOString() }));
        }
      },
    });

    // Statutory remittances by the 15th of the next month.
    if (m < 12) {
      const nextMm = String(m + 1).padStart(2, '0');
      const remitDay = [...schoolDaysIso(`2026-${nextMm}-08`, `2026-${nextMm}-15`)].pop() ?? `2026-${nextMm}-15`;
      const posting = ctx.svc('modules/accounting/posting/posting.service', 'PostingService');
      const remit = (label: string, payable: string, payee: string, key: string) =>
        tl.add({
          at: eat(remitDay, '10:30'),
          priority: 45,
          label: `${label} ${mm}`,
          run: async () => {
            const postingKey = `demo:${key}:2026-${mm}`;
            const done = await prisma.journalEntry.findFirst({ where: { organizationId: O, postingKey } });
            if (done) return;
            // Only what this month's payroll accrued (the ledger already holds
            // earlier months' remittances).
            const owed = -(await books.balance(payable));
            if (owed <= 0) return;
            await ctx.as('bursar', () =>
              posting.post({
                journalCode: 'BANK',
                date: eat(remitDay, '10:30'),
                description: `${payee} – ${monthNames[m - 1]} 2026`,
                sourceType: 'statutory_remittance',
                postingKey,
                lines: [
                  { accountId: books.account(payable), debit: String(owed), description: payee },
                  { accountId: books.account('1200'), credit: String(owed), description: 'Centenary – remittance' },
                ],
              }),
            );
          },
        });
      remit('PAYE', '2210', 'PAYE remitted to URA', 'paye');
      remit('NSSF', '2230', 'NSSF contributions (15%) remitted', 'nssf');
      remit('SACCO', '2260', 'SACCO savings & welfare fund remitted to Sunrise Staff SACCO', 'sacco');
      if (m === 10) remit('LST', '2250', 'Local Service Tax remitted to KCCA', 'lst');
    }
  }
}

/* ─────────────────────────────── Helpers ───────────────────────────────────── */

function bankAccountNumber(bank: string, r: () => number): string {
  const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(r() * 10))).join('');
  switch (bank) {
    case 'Stanbic Bank': return `903${digits(10)}`;
    case 'Centenary Bank': return `310${digits(7)}`;
    case 'dfcu Bank': return `01${digits(11)}`;
    case 'Absa Bank': return `60${digits(8)}`;
    case 'Equity Bank': return `100${digits(10)}`;
    case 'Housing Finance Bank': return `14${digits(8)}`;
    default: return `20${digits(10)}`;
  }
}

async function seedStatutory(prisma: PrismaClient, O: string): Promise<void> {
  if (!(await prisma.hrTaxTable.findFirst({ where: { organizationId: O, code: 'UG-PAYE', effectiveFrom: STATUTORY_FROM } }))) {
    const table = await prisma.hrTaxTable.create({
      data: { organizationId: O, code: 'UG-PAYE', name: 'Uganda PAYE (resident individuals)', countryCode: 'UG', taxType: 'PAYE', effectiveFrom: STATUTORY_FROM, contributionsDeductible: false, isActive: true },
    });
    await prisma.hrTaxBracket.createMany({
      data: PAYE_BANDS.map((b) => ({ organizationId: O, taxTableId: table.id, fromAmount: b.from * 12, toAmount: b.to === null ? null : b.to * 12, rate: b.rate })),
    });
  }
  if (!(await prisma.hrStatutoryConfig.findFirst({ where: { organizationId: O, code: 'UG-NSSF', effectiveFrom: STATUTORY_FROM } }))) {
    await prisma.hrStatutoryConfig.create({
      data: { organizationId: O, code: 'UG-NSSF', name: 'NSSF (Uganda) — 5% employee / 10% employer', configType: 'SOCIAL_SECURITY', rate: 0.05, employerRate: 0.1, contributionBase: 'GROSS', effectiveFrom: STATUTORY_FROM, isActive: true },
    });
  }
  await prisma.hrPayrollComponent.updateMany({ where: { organizationId: O, code: 'NSSF-SSF', isActive: true }, data: { isActive: false } });
  if (!(await prisma.hrTaxTable.findFirst({ where: { organizationId: O, code: 'UG-LST' } }))) {
    const table = await prisma.hrTaxTable.create({
      data: { organizationId: O, code: 'UG-LST', name: 'Local Service Tax (Uganda)', countryCode: 'UG', taxType: 'LOCAL', effectiveFrom: STATUTORY_FROM, collectionMonths: '7,8,9,10', contributionsDeductible: false, isActive: true },
    });
    await prisma.hrTaxBracket.createMany({
      data: LST_BANDS.map((b) => ({ organizationId: O, taxTableId: table.id, fromAmount: b.from, toAmount: b.to, rate: 0, fixedAmount: b.annual })),
    });
  }
}
