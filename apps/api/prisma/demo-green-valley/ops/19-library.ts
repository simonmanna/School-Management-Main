/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 19 — the library.
 *
 * A Ugandan primary-school library: NCDC-approved course books from MK, Fountain
 * and Longhorn, class readers, a reference shelf (atlases, dictionaries, the
 * encyclopaedia the PTA donated), story books for the nursery corner, and the
 * newspapers the P.7 class reads for current affairs. Copies are numbered per
 * title and shelved by section; the librarian lends to P.3–P.7 (and the
 * nursery reading corner borrows picture books for the class, never the child).
 *
 * Lending runs week by week through the three terms: most copies come back on
 * time, a few come back late and earn a fine (posted as an AR invoice the
 * bursar can collect like any fee), some are still out today, and three are
 * written off as lost.
 */
import { ok, log, rng, int, pick } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso, schoolDaysIso } from './kit';
import type { Roster, Pupil } from './roster';
import { NURSERY } from './roster';

/** UGX per day a book is overdue (SchoolProfile.customFields.libraryFinePerDay). */
const FINE_PER_DAY = 500;
/** How long a pupil may keep a book. */
const LOAN_DAYS = 14;

type Title = {
  code: string;
  title: string;
  author: string;
  publisher: string;
  isbn: string;
  category: 'textbook' | 'reference' | 'novel' | 'journal' | 'magazine';
  shelf: string;
  copies: number;
  /** Price per copy — the replacement value a lost book is charged at. */
  price: number;
  /** Classes that read it; drives who borrows. */
  grades: string[];
};

const CATALOGUE: Title[] = [
  // ── Course books (textbook) ─────────────────────────────────────────────
  { code: 'LIB-ENG-P1', title: "MK Primary English Pupil's Book 1", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-101-4', category: 'textbook', shelf: 'A1', copies: 14, price: 18_000, grades: ['P1'] },
  { code: 'LIB-ENG-P2', title: "MK Primary English Pupil's Book 2", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-102-1', category: 'textbook', shelf: 'A1', copies: 14, price: 18_000, grades: ['P2'] },
  { code: 'LIB-ENG-P3', title: "MK Primary English Pupil's Book 3", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-103-8', category: 'textbook', shelf: 'A1', copies: 16, price: 19_500, grades: ['P3'] },
  { code: 'LIB-ENG-P4', title: "MK Primary English Pupil's Book 4", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-104-5', category: 'textbook', shelf: 'A1', copies: 16, price: 19_500, grades: ['P4'] },
  { code: 'LIB-ENG-P5', title: "MK Primary English Pupil's Book 5", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-105-2', category: 'textbook', shelf: 'A2', copies: 18, price: 21_000, grades: ['P5'] },
  { code: 'LIB-ENG-P6', title: "MK Primary English Pupil's Book 6", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-106-9', category: 'textbook', shelf: 'A2', copies: 18, price: 21_000, grades: ['P6'] },
  { code: 'LIB-ENG-P7', title: "MK Primary English Pupil's Book 7", author: 'MK Editorial Team', publisher: 'MK Publishers', isbn: '978-9970-25-107-6', category: 'textbook', shelf: 'A2', copies: 22, price: 22_500, grades: ['P7'] },
  { code: 'LIB-MTC-P4', title: 'Fountain Primary Mathematics Book 4', author: 'J. B. Ssekamwa', publisher: 'Fountain Publishers', isbn: '978-9970-02-214-3', category: 'textbook', shelf: 'B1', copies: 16, price: 20_000, grades: ['P4'] },
  { code: 'LIB-MTC-P5', title: 'Fountain Primary Mathematics Book 5', author: 'J. B. Ssekamwa', publisher: 'Fountain Publishers', isbn: '978-9970-02-215-0', category: 'textbook', shelf: 'B1', copies: 18, price: 20_000, grades: ['P5'] },
  { code: 'LIB-MTC-P6', title: 'Fountain Primary Mathematics Book 6', author: 'J. B. Ssekamwa', publisher: 'Fountain Publishers', isbn: '978-9970-02-216-7', category: 'textbook', shelf: 'B1', copies: 18, price: 21_500, grades: ['P6'] },
  { code: 'LIB-MTC-P7', title: 'Fountain Primary Mathematics Book 7', author: 'J. B. Ssekamwa', publisher: 'Fountain Publishers', isbn: '978-9970-02-217-4', category: 'textbook', shelf: 'B1', copies: 24, price: 23_000, grades: ['P7'] },
  { code: 'LIB-SST-P5', title: 'Longhorn Social Studies for Uganda Book 5', author: 'Grace Nalubega', publisher: 'Longhorn Publishers', isbn: '978-9970-55-331-2', category: 'textbook', shelf: 'B2', copies: 16, price: 20_500, grades: ['P5'] },
  { code: 'LIB-SST-P6', title: 'Longhorn Social Studies for Uganda Book 6', author: 'Grace Nalubega', publisher: 'Longhorn Publishers', isbn: '978-9970-55-332-9', category: 'textbook', shelf: 'B2', copies: 16, price: 20_500, grades: ['P6'] },
  { code: 'LIB-SST-P7', title: 'Longhorn Social Studies for Uganda Book 7', author: 'Grace Nalubega', publisher: 'Longhorn Publishers', isbn: '978-9970-55-333-6', category: 'textbook', shelf: 'B2', copies: 22, price: 22_000, grades: ['P7'] },
  { code: 'LIB-SCI-P5', title: 'Integrated Science for Primary Schools Book 5', author: 'Dr. Patrick Okello', publisher: 'Mukono Bookshop Printing & Publishing', isbn: '978-9970-41-205-8', category: 'textbook', shelf: 'C1', copies: 16, price: 19_000, grades: ['P5'] },
  { code: 'LIB-SCI-P6', title: 'Integrated Science for Primary Schools Book 6', author: 'Dr. Patrick Okello', publisher: 'Mukono Bookshop Printing & Publishing', isbn: '978-9970-41-206-5', category: 'textbook', shelf: 'C1', copies: 16, price: 19_000, grades: ['P6'] },
  { code: 'LIB-SCI-P7', title: 'Integrated Science for Primary Schools Book 7', author: 'Dr. Patrick Okello', publisher: 'Mukono Bookshop Printing & Publishing', isbn: '978-9970-41-207-2', category: 'textbook', shelf: 'C1', copies: 22, price: 21_000, grades: ['P7'] },
  { code: 'LIB-LUG-P4', title: 'Olugezi lw’Oluganda Ekitabo 4', author: 'Nakato Ssalongo', publisher: 'Fountain Publishers', isbn: '978-9970-02-451-2', category: 'textbook', shelf: 'C2', copies: 12, price: 16_000, grades: ['P4', 'P5'] },
  { code: 'LIB-LUG-P6', title: 'Olugezi lw’Oluganda Ekitabo 6', author: 'Nakato Ssalongo', publisher: 'Fountain Publishers', isbn: '978-9970-02-453-6', category: 'textbook', shelf: 'C2', copies: 12, price: 16_000, grades: ['P6', 'P7'] },
  { code: 'LIB-RE-P5', title: 'Christian Religious Education for Primary 5', author: 'Rev. Samuel Kigozi', publisher: 'Uganda Bookshop', isbn: '978-9970-77-118-9', category: 'textbook', shelf: 'C3', copies: 14, price: 15_500, grades: ['P5', 'P6'] },
  { code: 'LIB-NCDC-LP', title: 'NCDC Lower Primary Thematic Curriculum Reader', author: 'National Curriculum Development Centre', publisher: 'NCDC', isbn: '978-9970-14-022-6', category: 'textbook', shelf: 'A3', copies: 20, price: 12_000, grades: ['P1', 'P2', 'P3'] },
  { code: 'LIB-NCDC-ECD', title: 'NCDC Early Childhood Learning Framework Activity Book', author: 'National Curriculum Development Centre', publisher: 'NCDC', isbn: '978-9970-14-031-8', category: 'textbook', shelf: 'A3', copies: 16, price: 11_000, grades: ['BABY', 'MIDDLE', 'TOP'] },
  { code: 'LIB-PLE-REV', title: 'PLE Revision Kit – Past Papers 2016–2025 (All Subjects)', author: 'Wakiso Examinations Bureau', publisher: 'Nasser Road Publishers', isbn: '978-9970-88-402-5', category: 'textbook', shelf: 'B3', copies: 26, price: 25_000, grades: ['P7'] },
  { code: 'LIB-HAND-P7', title: 'Handwriting & Composition Workbook P.7', author: 'Esther Nabukenya', publisher: 'MK Publishers', isbn: '978-9970-25-311-7', category: 'textbook', shelf: 'A2', copies: 14, price: 9_500, grades: ['P6', 'P7'] },

  // ── Reference shelf ─────────────────────────────────────────────────────
  { code: 'LIB-DICT-OX', title: 'Oxford Advanced Learner’s Dictionary (10th Edition)', author: 'A. S. Hornby', publisher: 'Oxford University Press', isbn: '978-0-19-479849-2', category: 'reference', shelf: 'R1', copies: 6, price: 85_000, grades: ['P5', 'P6', 'P7'] },
  { code: 'LIB-DICT-LUG', title: 'Oluganda–English Dictionary', author: 'John Ssentongo', publisher: 'Fountain Publishers', isbn: '978-9970-02-889-3', category: 'reference', shelf: 'R1', copies: 4, price: 55_000, grades: ['P5', 'P6', 'P7'] },
  { code: 'LIB-ATLAS-UG', title: 'Macmillan Uganda School Atlas', author: 'Macmillan Education', publisher: 'Macmillan Uganda', isbn: '978-9966-31-402-7', category: 'reference', shelf: 'R1', copies: 8, price: 42_000, grades: ['P5', 'P6', 'P7'] },
  { code: 'LIB-ENCY-AFR', title: 'Children’s Encyclopaedia of Africa', author: 'Mary Achieng', publisher: 'East African Educational Publishers', isbn: '978-9966-25-771-5', category: 'reference', shelf: 'R2', copies: 3, price: 120_000, grades: ['P4', 'P5', 'P6', 'P7'] },
  { code: 'LIB-MAP-WORLD', title: 'World Political & Physical Wall Map Book', author: 'Cartographic Services Uganda', publisher: 'Cartographic Services', isbn: '978-9970-66-004-1', category: 'reference', shelf: 'R2', copies: 2, price: 68_000, grades: ['P6', 'P7'] },
  { code: 'LIB-UG-CONST', title: 'The Constitution of the Republic of Uganda (Simplified for Schools)', author: 'Uganda Law Reform Commission', publisher: 'UPPC', isbn: '978-9970-30-112-4', category: 'reference', shelf: 'R2', copies: 4, price: 30_000, grades: ['P6', 'P7'] },
  { code: 'LIB-SCI-ENC', title: 'My First Science Encyclopaedia', author: 'Dorling Kindersley', publisher: 'DK Children', isbn: '978-0-241-28934-0', category: 'reference', shelf: 'R2', copies: 3, price: 95_000, grades: ['P3', 'P4', 'P5'] },

  // ── Readers and story books ─────────────────────────────────────────────
  { code: 'LIB-NOV-ELEPHANT', title: 'The Elephant and the Hare: Folk Tales from Uganda', author: 'Barbara Kimenye', publisher: 'East African Educational Publishers', isbn: '978-9966-25-110-2', category: 'novel', shelf: 'S1', copies: 10, price: 14_000, grades: ['P3', 'P4', 'P5'] },
  { code: 'LIB-NOV-MOSES', title: 'Moses in Trouble', author: 'Barbara Kimenye', publisher: 'East African Educational Publishers', isbn: '978-9966-25-118-8', category: 'novel', shelf: 'S1', copies: 12, price: 14_500, grades: ['P5', 'P6', 'P7'] },
  { code: 'LIB-NOV-SONGAI', title: 'The Girl Who Could Not Keep Quiet', author: 'Hilda Twongyeirwe', publisher: 'FEMRITE', isbn: '978-9970-48-022-4', category: 'novel', shelf: 'S1', copies: 8, price: 13_000, grades: ['P5', 'P6'] },
  { code: 'LIB-NOV-KINTU', title: 'Kintu and Nambi: The First People of Buganda', author: 'Joseph Kizza', publisher: 'Fountain Publishers', isbn: '978-9970-02-660-8', category: 'novel', shelf: 'S1', copies: 10, price: 12_500, grades: ['P3', 'P4', 'P5'] },
  { code: 'LIB-NOV-LAKE', title: 'Across the Lake: A Story of Lake Victoria', author: 'Agnes Atim', publisher: 'Oxford University Press East Africa', isbn: '978-0-19-574110-3', category: 'novel', shelf: 'S2', copies: 9, price: 13_500, grades: ['P4', 'P5', 'P6'] },
  { code: 'LIB-NOV-MATCH', title: 'The Match of the Season', author: 'Peter Wasswa', publisher: 'MK Publishers', isbn: '978-9970-25-660-6', category: 'novel', shelf: 'S2', copies: 11, price: 11_500, grades: ['P4', 'P5', 'P6'] },
  { code: 'LIB-NOV-SUNRISE', title: 'Sunrise over Mount Elgon', author: 'Rebecca Chemutai', publisher: 'Fountain Publishers', isbn: '978-9970-02-771-1', category: 'novel', shelf: 'S2', copies: 8, price: 13_000, grades: ['P6', 'P7'] },
  { code: 'LIB-NOV-BODA', title: 'Juma the Boda Boda Boy', author: 'Richard Mugisha', publisher: 'Longhorn Publishers', isbn: '978-9970-55-880-5', category: 'novel', shelf: 'S2', copies: 10, price: 11_000, grades: ['P3', 'P4'] },
  { code: 'LIB-NOV-MARKET', title: 'Market Day in Kampala', author: 'Sarah Nambi', publisher: 'Longhorn Publishers', isbn: '978-9970-55-881-2', category: 'novel', shelf: 'S3', copies: 12, price: 10_500, grades: ['P2', 'P3'] },
  { code: 'LIB-NOV-GOAT', title: 'My Goat Kadogo', author: 'Mariam Nalwoga', publisher: 'Fountain Publishers', isbn: '978-9970-02-990-6', category: 'novel', shelf: 'S3', copies: 14, price: 9_000, grades: ['P1', 'P2', 'P3'] },
  { code: 'LIB-NOV-RAIN', title: 'When the Rain Came to Nakawa', author: 'Doreen Baingana', publisher: 'FEMRITE', isbn: '978-9970-48-055-2', category: 'novel', shelf: 'S3', copies: 8, price: 12_000, grades: ['P5', 'P6', 'P7'] },
  { code: 'LIB-PIC-ANIMALS', title: 'Animals of the Savannah (Big Picture Book)', author: 'Jane Kyomuhendo', publisher: 'Fountain Publishers', isbn: '978-9970-02-120-7', category: 'novel', shelf: 'N1', copies: 10, price: 15_000, grades: ['BABY', 'MIDDLE', 'TOP'] },
  { code: 'LIB-PIC-COUNT', title: 'Let Us Count Together 1–20', author: 'Betty Akello', publisher: 'MK Publishers', isbn: '978-9970-25-880-8', category: 'novel', shelf: 'N1', copies: 12, price: 13_000, grades: ['BABY', 'MIDDLE', 'TOP'] },
  { code: 'LIB-PIC-ABC', title: 'My First ABC in English and Luganda', author: 'Betty Akello', publisher: 'MK Publishers', isbn: '978-9970-25-881-5', category: 'novel', shelf: 'N1', copies: 12, price: 13_000, grades: ['BABY', 'MIDDLE', 'TOP'] },
  { code: 'LIB-PIC-FARM', title: 'On Grandmother’s Farm', author: 'Specioza Nankya', publisher: 'Longhorn Publishers', isbn: '978-9970-55-990-1', category: 'novel', shelf: 'N1', copies: 10, price: 12_000, grades: ['MIDDLE', 'TOP', 'P1'] },

  // ── Journals and magazines ──────────────────────────────────────────────
  { code: 'LIB-JRN-TEACH', title: 'The Uganda Teacher – Professional Journal (Bound Volume 2025)', author: 'Uganda National Teachers’ Union', publisher: 'UNATU', isbn: '978-9970-91-010-6', category: 'journal', shelf: 'J1', copies: 3, price: 35_000, grades: ['P7'] },
  { code: 'LIB-JRN-NCDC', title: 'NCDC Curriculum Review Journal 2025', author: 'National Curriculum Development Centre', publisher: 'NCDC', isbn: '978-9970-14-200-8', category: 'journal', shelf: 'J1', copies: 2, price: 28_000, grades: ['P7'] },
  { code: 'LIB-MAG-NEWVIS', title: 'New Vision Education Supplement – Term Bound Copies', author: 'Vision Group', publisher: 'Vision Group', isbn: '978-9970-99-001-7', category: 'magazine', shelf: 'J2', copies: 4, price: 8_000, grades: ['P6', 'P7'] },
  { code: 'LIB-MAG-YOUNG', title: 'Young Talk – Health Magazine for Pupils', author: 'Straight Talk Foundation', publisher: 'Straight Talk Foundation', isbn: '978-9970-93-220-7', category: 'magazine', shelf: 'J2', copies: 6, price: 5_000, grades: ['P5', 'P6', 'P7'] },
  { code: 'LIB-MAG-SCIKIDS', title: 'Science for Kids Monthly (Bound 2025)', author: 'Kampala Science Club', publisher: 'Kampala Science Club', isbn: '978-9970-95-114-9', category: 'magazine', shelf: 'J2', copies: 4, price: 7_500, grades: ['P4', 'P5', 'P6'] },
];

export interface Library {
  titles: number;
  copies: number;
}

export async function seedLibrary(ctx: Ctx, tl: Timeline, roster: Roster): Promise<Library> {
  const { prisma, O } = ctx;
  const borrowings = ctx.svc('modules/school/library/library-transport-hostel-cafeteria.service', 'BorrowingService');

  // ── 1. The fine the school charges ───────────────────────────────────────
  const profile = await prisma.schoolProfile.findFirst({ where: { organizationId: O } });
  if (profile) {
    const custom = (profile.customFields as Record<string, unknown>) ?? {};
    await prisma.schoolProfile.update({
      where: { id: profile.id },
      data: { customFields: { ...custom, libraryFinePerDay: FINE_PER_DAY } },
    });
  }

  // ── 2. Catalogue: one product per title, then the numbered copies ────────
  const category = await prisma.productCategory.upsert({
    where: { organizationId_name: { organizationId: O, name: 'Library Books' } },
    update: {},
    create: { organizationId: O, name: 'Library Books' },
  });

  type Copy = { id: string; code: string; copyNumber: string };
  const copiesByTitle = new Map<string, Copy[]>();
  let copyCount = 0;
  for (const t of CATALOGUE) {
    const product = await prisma.product.upsert({
      where: { organizationId_code: { organizationId: O, code: t.code } },
      update: { name: t.title, categoryId: category.id, costPrice: t.price, salesPrice: t.price, isActive: true },
      create: {
        organizationId: O,
        code: t.code,
        name: t.title,
        categoryId: category.id,
        productType: 'consumable',
        trackInventory: false,
        costPrice: t.price,
        salesPrice: t.price,
        station: 'none',
      },
    });
    const meta = await prisma.bookMetadata.upsert({
      where: { productId: product.id },
      update: { author: t.author, isbn: t.isbn, publisher: t.publisher, category: t.category, shelfLocation: t.shelf, totalCopies: t.copies },
      create: {
        organizationId: O,
        productId: product.id,
        author: t.author,
        isbn: t.isbn,
        publisher: t.publisher,
        edition: t.category === 'textbook' ? '2023 NCDC-approved edition' : undefined,
        category: t.category,
        shelfLocation: t.shelf,
        totalCopies: t.copies,
      },
    });
    const copies: Copy[] = [];
    for (let i = 1; i <= t.copies; i += 1) {
      const copyNumber = `${t.code.replace('LIB-', '')}/${String(i).padStart(3, '0')}`;
      const r = rng(`copycond:${t.code}:${i}`);
      const condition = i === 1 ? 'good' : pick(['good', 'good', 'good', 'new', 'fair', 'fair', 'poor'], r);
      const row = await prisma.bookCopy.upsert({
        where: { organizationId_bookMetadataId_copyNumber: { organizationId: O, bookMetadataId: meta.id, copyNumber } },
        update: { condition },
        create: {
          organizationId: O,
          bookMetadataId: meta.id,
          copyNumber,
          condition,
          status: 'available',
          acquiredAt: eat(pick(['2022-02-14', '2023-01-30', '2024-02-05', '2025-01-27', '2026-01-19'], rng(`acq:${t.code}:${i}`)), '10:00'),
        },
      });
      copies.push({ id: row.id, code: t.code, copyNumber });
      copyCount += 1;
    }
    copiesByTitle.set(t.code, copies);
  }
  ok(`library: ${CATALOGUE.length} titles catalogued, ${copyCount} copies shelved, fine UGX ${FINE_PER_DAY}/day`);

  // ── 3. Lending, week by week ─────────────────────────────────────────────
  // Borrowers: P.3 upwards take books home; the nursery and P.1–P.2 reading
  // corner books are signed out to the class teacher's pupils in rotation.
  const readers = roster.pupils.filter((p) => !NURSERY.includes(p.grade));
  const titleFor = (p: Pupil, r: () => number): Title | null => {
    const fits = CATALOGUE.filter((t) => t.grades.includes(p.grade));
    if (fits.length === 0) return null;
    return pick(fits, r);
  };

  /** Mondays and Wednesdays of each term — the days the library lends. */
  const lendingDays: string[] = [];
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    const end = ctx.asOf < term.end ? ctx.asOf : term.end;
    for (const d of schoolDaysIso(term.start, end)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow === 1 || dow === 3) lendingDays.push(d);
    }
  }

  let planned = 0;
  let lost = 0;
  for (const [w, day] of lendingDays.entries()) {
    const r = rng(`lendday:${day}`);
    // 8–16 books go out on a lending day; P.7 borrows most (revision).
    const outToday = int(r, 8, 16);
    const chosen: Pupil[] = [];
    for (let i = 0; i < outToday; i += 1) {
      const pool = r() < 0.4 ? readers.filter((p) => p.grade === 'P7') : readers;
      if (pool.length === 0) continue;
      const p = pick(pool, r);
      if (chosen.some((c) => c.id === p.id)) continue;
      chosen.push(p);
    }
    for (const [k, pupil] of chosen.entries()) {
      const rr = rng(`lend:${day}:${pupil.id}:${k}`);
      const title = titleFor(pupil, rr);
      if (!title) continue;
      const copies = copiesByTitle.get(title.code)!;
      const copy = copies[int(rr, 0, copies.length - 1)];
      const dueAt = addDaysIso(day, LOAN_DAYS);
      // 72% on time, 16% late, 8% still out, 4% lost (older loans only).
      const dice = rr();
      const stale = w < lendingDays.length - 3;
      const outcome = !stale ? 'out' : dice < 0.72 ? 'ontime' : dice < 0.88 ? 'late' : dice < 0.96 ? 'out' : 'lost';
      const back =
        outcome === 'ontime'
          ? addDaysIso(day, int(rr, 4, LOAN_DAYS - 1))
          : outcome === 'late'
            ? addDaysIso(dueAt, int(rr, 2, 21))
            : null;
      if (back && back > ctx.asOf) continue;

      planned += 1;
      if (outcome === 'lost') lost += 1;
      const key = `demo:lend:${day}:${copy.copyNumber}:${pupil.admissionNo}`;
      tl.add({
        at: eat(day, '11:00'),
        priority: 70,
        label: `library lend ${title.title} → ${pupil.admissionNo}`,
        run: async () => {
          const already = await prisma.borrowing.findFirst({ where: { organizationId: O, notes: key } });
          if (already) return;
          const live = await prisma.bookCopy.findFirst({ where: { id: copy.id }, select: { status: true } });
          if (live?.status !== 'available') return;
          const row: any = await ctx.as('registrar', () =>
            borrowings.borrow(copy.id, pupil.id, eat(dueAt, '16:00'), key),
          );
          // `borrowedAt` is stamped by the database; give it the business date.
          await prisma.borrowing.update({ where: { id: row.id }, data: { borrowedAt: eat(day, '11:00') } });
        },
      });

      if (outcome === 'lost') {
        // Reported lost when the term closes: the copy is withdrawn and the
        // replacement cost is charged on the next invoice (noted on the loan).
        const reported = addDaysIso(dueAt, int(rr, 10, 25));
        if (reported > ctx.asOf) continue;
        tl.add({
          at: eat(reported, '15:00'),
          priority: 71,
          label: `library lost ${copy.copyNumber}`,
          run: async () => {
            const row = await prisma.borrowing.findFirst({ where: { organizationId: O, notes: key } });
            if (!row || row.status !== 'borrowed') return;
            await prisma.borrowing.update({
              where: { id: row.id },
              data: {
                status: 'lost',
                notes: `${key} · Reported lost by the pupil; replacement charged at UGX ${title.price.toLocaleString()}.`,
                fineAmount: title.price,
              },
            });
            await prisma.bookCopy.update({ where: { id: copy.id }, data: { status: 'lost' } });
          },
        });
        continue;
      }
      if (!back) continue;
      tl.add({
        at: eat(back, '12:30'),
        priority: 71,
        label: `library return ${copy.copyNumber}`,
        run: async () => {
          const row = await prisma.borrowing.findFirst({ where: { organizationId: O, notes: key } });
          if (!row || row.returnedAt) return;
          await ctx.as('registrar', () => borrowings.return(row.id));
          const damaged = rng(`damage:${key}`)() < 0.05;
          if (damaged) {
            await prisma.bookCopy.update({ where: { id: copy.id }, data: { status: 'damaged', condition: 'poor' } });
          }
        },
      });
    }
  }
  log(`library lending: ${planned} loans over ${lendingDays.length} lending days (${lost} reported lost; late returns fined UGX ${FINE_PER_DAY}/day)`);

  return { titles: CATALOGUE.length, copies: copyCount };
}
