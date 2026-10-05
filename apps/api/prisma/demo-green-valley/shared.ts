/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 *
 *  Green Valley Primary School, Kampala does not exist. Every name, admission
 *  number, mark, guardian and phone number produced by these files is invented
 *  for demonstration. Nothing here describes a real school, learner or member
 *  of staff.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Shared helpers for the Green Valley demo fill.
 *
 * `seed-green-valley.ts` builds the STRUCTURE (levels, grades, classes,
 * streams, years, terms) and deliberately stops there. These files are the
 * people and the teaching: staff, pupils, guardians, enrolment, the academic
 * year's assessment and results, the LMS courses, and the planning records.
 *
 * Two properties every file here keeps:
 *
 *  1. **Idempotent.** Every write is keyed on a stable code — `organizationId`
 *     plus a code or a natural key — never on a display name and never on
 *     insertion order. Re-running produces the same database, so a demo can be
 *     refreshed in front of a client without fear.
 *
 *  2. **Deterministic.** Every "random" choice comes from `rng()`, a seeded
 *     generator. The same pupil gets the same marks on every run, so a
 *     screenshot taken last week still matches the system today. `Math.random`
 *     is never used.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { activeSchool } from './schools';

/** The demo school this run builds — `--school=<key>`, default Green Valley. */
export const SCHOOL = activeSchool();
export const ORG_CODE = SCHOOL.orgCode;

/** Decimal shorthand, as the other school seeds use. */
export const D = (v: number | string) => new Prisma.Decimal(v);

export const log = (m: string) => console.log(`  - ${m}`);
export const ok = (m: string) => console.log(`\x1b[32mOK\x1b[0m ${m}`);
export const warn = (m: string) => console.log(`\x1b[33m!!\x1b[0m ${m}`);

/**
 * A seeded pseudo-random generator (mulberry32).
 *
 * Demo data must be reproducible: if marks were drawn from `Math.random`, every
 * re-seed would renumber every report card, and a client walking through a
 * printed sample would find different figures on screen. Call `rng('a-stable-key')`
 * with something derived from the row's identity.
 */
export function rng(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one element, deterministically. */
export function pick<T>(items: readonly T[], r: () => number): T {
  return items[Math.floor(r() * items.length) % items.length];
}

/** An integer in [min, max], deterministically. */
export function int(r: () => number, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

/** Insert rows in chunks — a single createMany of 30k rows exhausts parameters. */
export async function createManyChunked<T>(
  delegate: { createMany: (args: { data: T[]; skipDuplicates?: boolean }) => Promise<unknown> },
  rows: T[],
  chunk = 500,
): Promise<number> {
  for (let i = 0; i < rows.length; i += chunk) {
    await delegate.createMany({ data: rows.slice(i, i + chunk), skipDuplicates: true });
  }
  return rows.length;
}

/** Refuse to run against a production database. */
export function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production.');
  }
}

/**
 * The demo organization, with the structure seed's rows loaded.
 *
 * Fails loudly rather than inventing structure: the shape of the school is
 * `seed-green-valley.ts`'s business, and a fill that silently created its own
 * classes would drift from it.
 */
export async function loadSchool(prisma: PrismaClient) {
  const org = await prisma.organization.findUnique({ where: { code: ORG_CODE } });
  if (!org) {
    throw new Error(
      `Organization ${ORG_CODE} not found. Build the structure first:\n` +
        `  pnpm --filter @erp/api exec tsx prisma/seed-green-valley.ts --school=${SCHOOL.key}`,
    );
  }
  const O = org.id;

  const [levels, grades, classes, sections, years, terms] = await Promise.all([
    prisma.academicLevel.findMany({ where: { organizationId: O } }),
    prisma.gradeLevel.findMany({ where: { organizationId: O }, orderBy: { order: 'asc' } }),
    prisma.schoolClass.findMany({ where: { organizationId: O } }),
    prisma.section.findMany({ where: { organizationId: O }, orderBy: { displayOrder: 'asc' } }),
    prisma.academicYear.findMany({ where: { organizationId: O } }),
    prisma.term.findMany({ where: { organizationId: O } }),
  ]);

  if (grades.length === 0 || classes.length === 0) {
    throw new Error(
      `${SCHOOL.orgName} has no grades or classes. Run the structure seed (seed-green-valley.ts --school=${SCHOOL.key}) first.`,
    );
  }

  // The explicit tuple matters: without it TypeScript infers `(string | T)[][]`
  // and the map comes back as `Map<string, { code: string }>`, losing every
  // other column on the row.
  const byCode = <T extends { code: string | null }>(rows: T[]): Map<string, T> =>
    new Map(rows.filter((r) => r.code !== null).map((r) => [r.code as string, r] as [string, T]));

  return {
    O,
    org,
    levels: byCode(levels),
    grades: byCode(grades),
    classes: byCode(classes),
    /** Streams keyed `"<classCode>:<streamCode>"`, e.g. `"P5:NORTH"`. */
    sections: new Map(
      sections.map((sec) => {
        const cls = classes.find((c) => c.id === sec.classId);
        return [`${cls?.code ?? '?'}:${sec.code ?? '?'}`, sec] as [string, (typeof sections)[number]];
      }),
    ),
    /**
     * A class's streams in display order.
     *
     * `Section.code` is nullable in the schema; every stream this school seeds
     * has one, so the type is narrowed here rather than at thirty call sites.
     */
    sectionsByClassCode: (classCode: string) => {
      const cls = classes.find((c) => c.code === classCode);
      return sections
        .filter((sec) => sec.classId === cls?.id && sec.code !== null)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((sec) => ({ ...sec, code: sec.code as string }));
    },
    years: new Map(years.map((y) => [y.name, y] as [string, (typeof years)[number]])),
    /** Terms keyed `"<year>:<term name>"`, e.g. `"2026:Term 3"`. */
    terms: new Map(
      terms.map((t) => {
        const y = years.find((yy) => yy.id === t.academicYearId);
        return [`${y?.name ?? '?'}:${t.name}`, t] as [string, (typeof terms)[number]];
      }),
    ),
  };
}

export type School = Awaited<ReturnType<typeof loadSchool>>;

/* ────────────────────────── The school's shape, as data ────────────────────── */

/** Grade codes in teaching order, matching `seed-green-valley.ts`. */
export const NURSERY_GRADES = ['BABY', 'MIDDLE', 'TOP'] as const;
export const LOWER_PRIMARY_GRADES = ['P1', 'P2', 'P3'] as const;
export const UPPER_PRIMARY_GRADES = ['P4', 'P5', 'P6', 'P7'] as const;
export const ALL_GRADES = [
  ...NURSERY_GRADES,
  ...LOWER_PRIMARY_GRADES,
  ...UPPER_PRIMARY_GRADES,
] as const;

export type GradeCode = (typeof ALL_GRADES)[number];

/** Which programme a grade enrols into. */
export function programmeCodeFor(gradeCode: string): 'ECD' | 'LOWER_PRIMARY' | 'UPPER_PRIMARY' {
  if ((NURSERY_GRADES as readonly string[]).includes(gradeCode)) return 'ECD';
  if ((LOWER_PRIMARY_GRADES as readonly string[]).includes(gradeCode)) return 'LOWER_PRIMARY';
  return 'UPPER_PRIMARY';
}

/** Nursery reports descriptors, primary reports marks. */
export function gradingSystemFor(gradeCode: string): 'ECD' | 'PLE' {
  return programmeCodeFor(gradeCode) === 'ECD' ? 'ECD' : 'PLE';
}

/** How full each stream is, per grade — from the school profile. */
export const CLASS_SIZE: Record<string, number> = SCHOOL.classSize;

/** Typical age on entry, used to invent a plausible date of birth. */
export const ENTRY_AGE: Record<string, number> = {
  BABY: 3,
  MIDDLE: 4,
  TOP: 5,
  P1: 6,
  P2: 7,
  P3: 8,
  P4: 9,
  P5: 10,
  P6: 11,
  P7: 12,
};

/* ────────────────────────────── Ugandan names ──────────────────────────────── */

/**
 * Name pools, spread across Uganda's main regions rather than Buganda alone —
 * a Kampala school register is not single-ethnicity, and a demo whose every
 * pupil is a Mukasa reads as invented.
 */
export const SURNAMES = [
  // Central (Baganda)
  'Mukasa', 'Ssempijja', 'Nakato', 'Babirye', 'Kato', 'Wasswa', 'Namuli', 'Nalubega',
  'Lubega', 'Ssemakula', 'Nabukenya', 'Kiggundu', 'Muwanga', 'Nansubuga', 'Kyeyune',
  'Ssali', 'Namatovu', 'Kizza', 'Nakimuli', 'Sserwadda', 'Nabirye', 'Kasozi',
  'Namusoke', 'Ssekandi', 'Nalwoga', 'Mugerwa', 'Nakabugo', 'Lukwago',
  // Western (Banyankole, Bakiga, Batooro)
  'Byaruhanga', 'Tumusiime', 'Mugisha', 'Kyomuhendo', 'Atuhaire', 'Asiimwe',
  'Katusiime', 'Ninsiima', 'Twinomugisha', 'Kamugisha', 'Nshemereirwe', 'Bwambale',
  'Masika', 'Baluku', 'Kabahenda', 'Mwesigwa',
  // Northern (Acholi, Langi)
  'Okello', 'Ocen', 'Atim', 'Akello', 'Lamunu', 'Odongo', 'Aber', 'Opio', 'Apio',
  'Oyella', 'Ojok', 'Adong', 'Okot', 'Auma',
  // Eastern (Iteso, Basoga)
  'Waiswa', 'Kirunda', 'Isabirye', 'Mugweri', 'Namukose', 'Akol', 'Emoit', 'Ikiring',
  'Osele', 'Tenywa', 'Balidawa', 'Nabwire',
];

export const MALE_NAMES = [
  'Joseph', 'David', 'Emmanuel', 'Isaac', 'Brian', 'Allan', 'Derrick', 'Trevor',
  'Mark', 'Peter', 'Samuel', 'Daniel', 'Ibrahim', 'Hamza', 'Musa', 'Ronald',
  'Simon', 'Timothy', 'Elijah', 'Arnold', 'Edgar', 'Shafik', 'Mubarak', 'Henry',
  'Robert', 'Fred', 'Moses', 'Patrick', 'Collins', 'Andrew', 'Martin', 'Benjamin',
  'Godfrey', 'Innocent', 'Julius', 'Kenneth', 'Lawrence', 'Nicholas', 'Oscar', 'Raymond',
];

export const FEMALE_NAMES = [
  'Sarah', 'Grace', 'Patricia', 'Esther', 'Joan', 'Brenda', 'Daphine', 'Sharon',
  'Mercy', 'Prossy', 'Aisha', 'Zainab', 'Fatuma', 'Rebecca', 'Winnie', 'Doreen',
  'Phiona', 'Shakira', 'Linda', 'Hope', 'Immaculate', 'Peace', 'Gloria', 'Ritah',
  'Nancy', 'Juliet', 'Sylvia', 'Catherine', 'Agnes', 'Lydia', 'Barbara', 'Claire',
  'Diana', 'Edith', 'Faith', 'Harriet', 'Irene', 'Jackie', 'Loyce', 'Monica',
];

/** Houses, as a Ugandan primary school runs them. */
export const HOUSES = SCHOOL.houses;

/** A Kampala-plausible mobile number, deterministic per key. */
export function phoneFor(key: string): string {
  const r = rng(`phone:${key}`);
  const prefix = pick(['070', '075', '077', '078', '070', '074', '076'], r);
  let rest = '';
  for (let i = 0; i < 7; i += 1) rest += String(int(r, 0, 9));
  return `+256${prefix.slice(1)}${rest}`;
}

/** Kampala neighbourhoods, for addresses that read like a real register. */
export const SUBURBS = [
  'Ntinda', 'Kireka', 'Najjera', 'Kyanja', 'Bweyogerere', 'Namugongo', 'Kisaasi',
  'Bukoto', 'Nakawa', 'Kiwatule', 'Naalya', 'Seeta', 'Kyaliwajjala', 'Mutungo',
  'Luzira', 'Muyenga', 'Kabalagala', 'Makindye', 'Rubaga', 'Nansana',
];

/* ────────────────────────────── Dates ──────────────────────────────────────── */

/** The day the demo is "as of". Fixed so re-seeding does not move the story. */
export function today(): Date {
  const override = process.env.DEMO_AS_OF;
  return override ? new Date(override) : new Date();
}

export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Monday of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return dateOnly(addDays(d, -back));
}

/** Weekdays between two dates, inclusive, Monday–Friday only. */
export function schoolDays(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = dateOnly(from); d <= to; d = addDays(d, 1)) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(new Date(d));
  }
  return out;
}
