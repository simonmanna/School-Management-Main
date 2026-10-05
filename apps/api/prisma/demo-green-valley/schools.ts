/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOLS, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The demo schools this pipeline can build, as data.
 *
 * The structure seed (`seed-green-valley.ts`) and the eight fill stages are the
 * same code for every school; what differs is here — the organization, the
 * login domain, the shape of the school, how full each stream is, and which
 * stream the demo personas belong to.
 *
 * Pick one with `--school=<key>` (default `greenvalley`), or `DEMO_SCHOOL`.
 */

export interface GradeSeed {
  code: string;
  name: string;
  /** Streams within this grade's class. Empty means the class is not subdivided. */
  streams: string[];
  /** Seats per stream, or for the whole class when it has no streams. */
  capacity?: number;
}

export interface LevelSeed {
  code: 'PRE_PRIMARY' | 'PRIMARY';
  name: string;
  description: string;
  stage: 'PRE_PRIMARY' | 'PRIMARY';
  grades: GradeSeed[];
}

export interface NamedPerson {
  key: string;
  first: string;
  last: string;
}

export interface DemoSchoolProfile {
  key: string;
  orgCode: string;
  orgName: string;
  /** Login domain: `head@<emailDomain>`. */
  emailDomain: string;
  /** Prefix on partner, staff and offering codes, e.g. `GV-PUP-…`. */
  codePrefix: string;
  /** Admission numbers read `<prefix>/0001`. */
  admissionPrefix: string;
  profile: {
    name: string;
    motto: string;
    address: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  structure: LevelSeed[];
  /** Stream display order; anything not named sorts last. */
  streamOrder: string[];
  /** Pupils per stream, by grade code. */
  classSize: Record<string, number>;
  houses: string[];
  /**
   * The demo personas' stream code: its class teacher is `teacher@`, its roll 1
   * is `pupil@`, and its upper-primary courses are built out in the LMS.
   */
  showcaseStream: string;
  /**
   * Which streams get fully built LMS courses and schemes of work:
   * `persona` = P5/P6/P7 in the showcase stream; `upper-primary` = every P4-P7 stream.
   */
  lmsShowcase: 'persona' | 'upper-primary';
  /** UNEB PLE centre number, for P7 candidate registration. */
  unebCentre: string;
  /** `StudentProfile.residenceType` for boarders, matching the school's fee structures. */
  boarderValue: string;
  passwords: { staff: string; portal: string };
  /** Named leadership, overriding the defaults by key (head, deputy, dos, bursar, registrar). */
  leadership?: Partial<Record<'head' | 'deputy' | 'dos' | 'bursar' | 'registrar', Omit<NamedPerson, 'key'>>>;
}

/** Three terms per year, as Ugandan schools run them. */
export const TERMS = [
  { name: 'Term 1', start: '02-01', end: '04-30' },
  { name: 'Term 2', start: '05-15', end: '08-15' },
  { name: 'Term 3', start: '09-01', end: '12-05' },
];

/** Academic years. Exactly one ACTIVE. */
export const YEARS = [
  { name: '2025', status: 'CLOSED' as const, isCurrent: false },
  { name: '2026', status: 'ACTIVE' as const, isCurrent: true },
  { name: '2027', status: 'PLANNING' as const, isCurrent: false },
];

const GREEN_VALLEY: DemoSchoolProfile = {
  key: 'greenvalley',
  orgCode: 'GREENVALLEY',
  orgName: 'Green Valley Primary School (DEMO)',
  emailDomain: 'greenvalley.demo',
  codePrefix: 'GV',
  admissionPrefix: 'GV',
  profile: { name: 'Green Valley Primary School', motto: 'Learning, together', address: 'Kampala, Uganda' },
  structure: [
    {
      code: 'PRE_PRIMARY',
      name: 'Pre-Primary',
      description: 'Nursery classes. Assessment here is developmental, not mark-based.',
      stage: 'PRE_PRIMARY',
      grades: [
        { code: 'BABY', name: 'Baby Class', streams: ['North', 'South'], capacity: 25 },
        { code: 'MIDDLE', name: 'Middle Class', streams: ['North', 'South'], capacity: 25 },
        { code: 'TOP', name: 'Top Class', streams: ['North', 'South', 'East'], capacity: 25 },
      ],
    },
    {
      code: 'PRIMARY',
      name: 'Primary',
      description: 'Primary One through Primary Seven.',
      stage: 'PRIMARY',
      grades: [
        { code: 'P1', name: 'Primary 1', streams: ['North', 'South', 'East'], capacity: 35 },
        { code: 'P2', name: 'Primary 2', streams: ['North', 'South', 'East'], capacity: 35 },
        { code: 'P3', name: 'Primary 3', streams: ['North', 'South', 'East', 'West'], capacity: 35 },
        { code: 'P4', name: 'Primary 4', streams: ['North', 'South', 'East', 'West'], capacity: 35 },
        { code: 'P5', name: 'Primary 5', streams: ['North', 'South', 'East'], capacity: 35 },
        { code: 'P6', name: 'Primary 6', streams: ['North', 'South', 'East'], capacity: 35 },
        { code: 'P7', name: 'Primary 7', streams: ['North', 'South', 'East'], capacity: 35 },
      ],
    },
  ],
  streamOrder: ['North', 'South', 'East', 'West'],
  classSize: { BABY: 23, MIDDLE: 23, TOP: 23, P1: 32, P2: 32, P3: 32, P4: 32, P5: 32, P6: 32, P7: 32 },
  houses: ['Nile', 'Rwenzori', 'Elgon', 'Victoria'],
  showcaseStream: 'NORTH',
  lmsShowcase: 'persona',
  unebCentre: '510233',
  boarderValue: 'boarder',
  passwords: { staff: 'Staff@2026', portal: 'Portal@2026' },
};

/**
 * Sunrise Academy — a mid-sized Kampala nursery and primary day-and-boarding
 * school, about 700 pupils. Streams are colours, as many Ugandan primaries run
 * them. Logins stay on `@sunrise.test`, which the e2e specs and the shared-VPS
 * demo already use.
 */
const SUNRISE: DemoSchoolProfile = {
  key: 'sunrise',
  orgCode: 'SUNRISE',
  orgName: 'Sunrise Academy',
  emailDomain: 'sunrise.test',
  codePrefix: 'SA',
  admissionPrefix: 'SA',
  profile: {
    name: 'Sunrise Academy',
    motto: 'Knowledge, Integrity, Service',
    address: 'Plot 12, Kampala Road, Kampala',
    phone: '+256700000000',
    email: 'admin@sunrise.ac.ug',
    website: 'https://sunrise.ac.ug',
  },
  structure: [
    {
      code: 'PRE_PRIMARY',
      name: 'Nursery',
      description: 'Baby, Middle and Top Class. Developmental assessment against the ECD learning areas.',
      stage: 'PRE_PRIMARY',
      grades: [
        { code: 'BABY', name: 'Baby Class', streams: ['Red', 'Blue'], capacity: 24 },
        { code: 'MIDDLE', name: 'Middle Class', streams: ['Red', 'Blue'], capacity: 24 },
        { code: 'TOP', name: 'Top Class', streams: ['Red', 'Blue'], capacity: 25 },
      ],
    },
    {
      code: 'PRIMARY',
      name: 'Primary',
      description: 'P.1 to P.7: thematic curriculum in P.1–P.3, subject-based P.4–P.7 leading to the PLE.',
      stage: 'PRIMARY',
      grades: [
        { code: 'P1', name: 'P.1', streams: ['Red', 'Blue', 'Green'], capacity: 35 },
        { code: 'P2', name: 'P.2', streams: ['Red', 'Blue', 'Green'], capacity: 35 },
        { code: 'P3', name: 'P.3', streams: ['Red', 'Blue', 'Green'], capacity: 35 },
        { code: 'P4', name: 'P.4', streams: ['Red', 'Blue', 'Green'], capacity: 35 },
        { code: 'P5', name: 'P.5', streams: ['Red', 'Blue', 'Green'], capacity: 35 },
        { code: 'P6', name: 'P.6', streams: ['Red', 'Blue'], capacity: 38 },
        { code: 'P7', name: 'P.7', streams: ['Red', 'Blue'], capacity: 38 },
      ],
    },
  ],
  streamOrder: ['Red', 'Blue', 'Green', 'Yellow'],
  classSize: { BABY: 20, MIDDLE: 21, TOP: 22, P1: 30, P2: 31, P3: 30, P4: 29, P5: 30, P6: 33, P7: 34 },
  houses: ['Kagera', 'Mpanga', 'Kafu', 'Achwa'],
  showcaseStream: 'RED',
  lmsShowcase: 'upper-primary',
  unebCentre: '530417',
  boarderValue: 'boarding',
  passwords: { staff: 'Staff@123', portal: 'Portal@123' },
  leadership: {
    head: { first: 'Joseph', last: 'Okot' },
    deputy: { first: 'Harriet', last: 'Namatovu' },
    dos: { first: 'Godfrey', last: 'Twinomugisha' },
    bursar: { first: 'Peter', last: 'Ssempijja' },
    registrar: { first: 'Rose', last: 'Nansubuga' },
  },
};

export const DEMO_SCHOOLS: Record<string, DemoSchoolProfile> = {
  greenvalley: GREEN_VALLEY,
  sunrise: SUNRISE,
};

/** The school selected by `--school=<key>` or `DEMO_SCHOOL`, default Green Valley. */
export function activeSchool(): DemoSchoolProfile {
  const arg = process.argv.find((a) => a.startsWith('--school='))?.split('=')[1];
  const key = (arg ?? process.env.DEMO_SCHOOL ?? 'greenvalley').toLowerCase();
  const school = DEMO_SCHOOLS[key];
  if (!school) {
    throw new Error(`Unknown demo school "${key}". Known: ${Object.keys(DEMO_SCHOOLS).join(', ')}.`);
  }
  return school;
}

/** The showcase stream's display name, e.g. `North` for code `NORTH`. */
export function showcaseStreamName(school: DemoSchoolProfile): string {
  return school.streamOrder.find((s) => s.toUpperCase() === school.showcaseStream) ?? school.showcaseStream;
}
