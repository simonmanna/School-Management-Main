/**
 * Library Demo Seed — Comprehensive library dataset for client demonstrations.
 * 
 * Creates a realistic school library with:
 * - 25+ books across 6 categories with multiple copies
 * - 50+ borrowings with varied statuses (available, borrowed, overdue, returned, lost)
 * - Fines with realistic amounts
 * - Reservations and holds
 * - Library statistics ready for dashboard
 * 
 * Run from apps/api:
 *   npx ts-node prisma/seed-library-demo.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_CODE = 'SUNRISE';
const D = (v: number | string) => new Prisma.Decimal(v);

const log = (m: string) => console.log(`  • ${m}`);
const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);

async function main() {
  console.log('\n=== Library Demo Seed ===\n');
  const org = await prisma.organization.findUnique({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`Org ${ORG_CODE} not found — run 'pnpm db:seed' first.`);
  const O = org.id;

  // Check if library data already exists
  const existingBooks = await prisma.bookMetadata.count({ where: { organizationId: O } });
  if (existingBooks > 0) {
    console.log('\x1b[33mLibrary data already exists — seed skipped. Delete BookMetadata to reseed.\x1b[0m');
    return;
  }

  // Get students and term for borrowings
  const students = await prisma.studentProfile.findMany({
    where: { organizationId: O, status: 'active' },
    take: 100,
    include: { partner: true },
  });
  const term = await prisma.term.findFirst({ where: { organizationId: O, isCurrent: true } });
  if (!term) throw new Error('No current term found');

  console.log('\n=== Creating Library Books ===\n');

  // ── Book Data (25 books) ──
  const bookData = [
    // Textbooks
    { isbn: '9780195737872', title: 'New Progressive Mathematics S3', author: 'K. M. Mutumba', category: 'textbook', publisher: 'Oxford University Press', edition: '3rd', shelf: 'TXT-MAT-01', copies: 5 },
    { isbn: '9780195737889', title: 'Understanding English Grammar', author: 'J. A. Odongo', category: 'textbook', publisher: 'Oxford University Press', edition: '2nd', shelf: 'TXT-ENG-01', copies: 5 },
    { isbn: '9780195737896', title: 'Integrated Science for Uganda', author: 'P. K. Ssali', category: 'textbook', publisher: 'Oxford University Press', edition: '1st', shelf: 'TXT-SCI-01', copies: 4 },
    { isbn: '9780195737902', title: 'Physics for Secondary Schools', author: 'R. K. Kato', category: 'textbook', publisher: 'Longman Uganda', edition: '4th', shelf: 'TXT-PHY-01', copies: 4 },
    { isbn: '9780195737919', title: 'Chemistry Principles S3', author: 'M. N. Wandera', category: 'textbook', publisher: 'Fountain Publishers', edition: '2nd', shelf: 'TXT-CHE-01', copies: 4 },
    { isbn: '9780195737926', title: 'Biology for Secondary Schools', author: 'S. B. Mugisha', category: 'textbook', publisher: 'Longman Uganda', edition: '3rd', shelf: 'TXT-BIO-01', copies: 4 },
    { isbn: '9780195737933', title: 'History of East Africa', author: 'D. N. Mukasa', category: 'textbook', publisher: 'Fountain Publishers', edition: '1st', shelf: 'TXT-HIS-01', copies: 3 },
    { isbn: '9780195737940', title: 'Geography of Uganda', author: 'J. K. Nabbanja', category: 'textbook', publisher: 'Oxford University Press', edition: '2nd', shelf: 'TXT-GEO-01', copies: 3 },
    { isbn: '9780195737957', title: 'Luganda Language & Literature', author: 'F. M. Nakato', category: 'textbook', publisher: 'Fountain Publishers', edition: '1st', shelf: 'TXT-LUG-01', copies: 3 },

    // Reference
    { isbn: '9780195738008', title: 'Oxford Advanced Learner\'s Dictionary', author: 'A. S. Hornby', category: 'reference', publisher: 'Oxford University Press', edition: '10th', shelf: 'REF-DIC-01', copies: 2 },
    { isbn: '9780195738015', title: 'Uganda National Encyclopedia', author: 'Uganda Book Trust', category: 'reference', publisher: 'Uganda Book Trust', edition: '2nd', shelf: 'REF-ENC-01', copies: 2 },
    { isbn: '9780195738022', title: 'World Atlas for Students', author: 'Oxford Cartography', category: 'reference', publisher: 'Oxford University Press', edition: '5th', shelf: 'REF-ATL-01', copies: 2 },
    { isbn: '9780195738039', title: 'Science Encyclopedia for Students', author: 'DK Publishing', category: 'reference', publisher: 'DK', edition: '3rd', shelf: 'REF-SCI-01', copies: 1 },
    { isbn: '9780195738046', title: 'Historical Atlas of Africa', author: 'Cambridge University Press', category: 'reference', publisher: 'Cambridge University Press', edition: '1st', shelf: 'REF-HIS-01', copies: 1 },

    // Novels/Fiction
    { isbn: '9780195738053', title: 'The River Between', author: 'Ngũgĩ wa Thiong\'o', category: 'novel', publisher: 'Heinemann', edition: '1st', shelf: 'FIC-AFR-01', copies: 4 },
    { isbn: '9780195738060', title: 'Things Fall Apart', author: 'Chinua Achebe', category: 'novel', publisher: 'Heinemann', edition: '1st', shelf: 'FIC-AFR-02', copies: 4 },
    { isbn: '9780195738077', title: 'A Man of the People', author: 'Chinua Achebe', category: 'novel', publisher: 'Heinemann', edition: '1st', shelf: 'FIC-AFR-03', copies: 3 },
    { isbn: '9780195738084', title: 'Weep Not, Child', author: 'Ngũgĩ wa Thiong\'o', category: 'novel', publisher: 'Heinemann', edition: '1st', shelf: 'FIC-AFR-04', copies: 3 },
    { isbn: '9780195738091', title: 'The African Child', author: 'Camara Laye', category: 'novel', publisher: 'Heinemann', edition: '1st', shelf: 'FIC-AFR-05', copies: 3 },
    { isbn: '9780195738107', title: 'Animal Farm', author: 'George Orwell', category: 'novel', publisher: 'Penguin Books', edition: '1st', shelf: 'FIC-CLS-01', copies: 4 },
    { isbn: '9780195738114', title: '1984', author: 'George Orwell', category: 'novel', publisher: 'Penguin Books', edition: '1st', shelf: 'FIC-CLS-02', copies: 4 },

    // Journals/Periodicals
    { isbn: '9780195738121', title: 'Uganda Journal of Education', author: 'Makerere University', category: 'journal', publisher: 'Makerere University Press', edition: 'Vol. 2023', shelf: 'JRN-EDU-01', copies: 1 },
    { isbn: '9780195738138', title: 'African Journal of Science', author: 'African Academy of Sciences', category: 'journal', publisher: 'AAS', edition: 'Vol. 2023', shelf: 'JRN-SCI-01', copies: 1 },

    // Magazines
    { isbn: '9780195738145', title: 'Young African', author: 'Young African Magazine', category: 'magazine', publisher: 'Young African Media', edition: 'Jan 2024', shelf: 'MAG-YTH-01', copies: 2 },
    { isbn: '9780195738152', title: 'Science Today', author: 'Science Today Publishers', category: 'magazine', publisher: 'Science Today', edition: 'Mar 2024', shelf: 'MAG-SCI-01', copies: 2 },
  ];

  const bookMetas: any[] = [];

  for (const b of bookData) {
    // Create product (stockable item for inventory)
    const product = await prisma.product.create({
      data: {
        organizationId: O,
        code: `BK-${b.isbn.slice(-6)}`,
        name: b.title,
        sku: `BK-${b.isbn.slice(-6)}`,
        productType: 'stockable',
        salesPrice: D(15000 + Math.floor(Math.random() * 30000)),
      },
    });

    const meta = await prisma.bookMetadata.create({
      data: {
        organizationId: O,
        productId: product.id,
        author: b.author,
        isbn: b.isbn,
        publisher: b.publisher,
        edition: b.edition,
        category: b.category,
        shelfLocation: b.shelf,
        totalCopies: b.copies,
      },
    });

    // Create copies
    const copies: any[] = [];
    for (let i = 1; i <= b.copies; i++) {
      const copyNum = `C${String(i).padStart(3, '0')}`;
      const copy = await prisma.bookCopy.create({
        data: {
          organizationId: O,
          bookMetadataId: meta.id,
          copyNumber: copyNum,
          status: 'available',
          condition: ['new', 'good', 'good', 'fair'][Math.floor(Math.random() * 4)],
          acquiredAt: new Date(Date.now() - Math.floor(Math.random() * 365) * 86400000),
        },
      });
      copies.push(copy);
    }

    bookMetas.push({ meta, copies, title: b.title, category: b.category, author: b.author });
  }

  ok(`books: ${bookMetas.length} titles with ${bookMetas.reduce((s, b) => s + b.copies.length, 0)} total copies`);

  // Build lookup maps for faster access
  const copyToMeta = new Map<string, any>();
  const allCopies = bookMetas.flatMap((b) => {
    b.copies.forEach((c: any) => copyToMeta.set(c.id, b.meta));
    return b.copies;
  });

  // Get students for borrowings
  const allStudents = await prisma.studentProfile.findMany({
    where: { organizationId: O, status: 'active' },
    take: 100,
    include: { partner: true },
  });
  const borrowers = allStudents.slice(0, 70);

  const statusWeights = [
    { status: 'returned', weight: 40 },
    { status: 'borrowed', weight: 25 },
    { status: 'overdue', weight: 15 },
    { status: 'lost', weight: 5 },
    { status: 'damaged', weight: 5 },
    { status: 'reserved', weight: 10 },
  ];

  const getRandomStatus = () => {
    const r = Math.random() * 100;
    let acc = 0;
    for (const w of statusWeights) {
      acc += w.weight;
      if (r <= acc) return w.status;
    }
    return 'returned';
  };

  let borrowingCount = 0;
  let overdueCount = 0;
  let fineTotal = D(0);

  for (let i = 0; i < borrowers.length; i++) {
    const student = borrowers[i];
    const copy = allCopies[i % allCopies.length];
    const meta = copyToMeta.get(copy.id)!;
    const status = getRandomStatus();
    
    const daysAgo = Math.floor(Math.random() * 60) + 1;
    const borrowedAt = new Date(Date.now() - daysAgo * 86400000);
    const dueAt = new Date(borrowedAt.getTime() + 14 * 86400000);
    const isOverdue = dueAt < new Date() && status === 'borrowed';
    const statusFinal = isOverdue ? 'overdue' : status;

    let returnedAt: Date | null = null;
    let fineAmount = D(0);

    if (statusFinal === 'returned' || statusFinal === 'overdue') {
      const daysLate = statusFinal === 'overdue' 
        ? Math.ceil((Date.now() - dueAt.getTime()) / 86400000)
        : Math.max(0, Math.ceil((Date.now() - (borrowedAt.getTime() + 12 * 86400000)) / 86400000));
      
      if (daysLate > 0) {
        fineAmount = D(daysLate * 200);
        fineTotal = fineTotal.add(fineAmount);
      }
      returnedAt = new Date(borrowedAt.getTime() + (14 - Math.floor(Math.random() * 10)) * 86400000);
    }

    if (statusFinal === 'overdue') overdueCount++;
    if (statusFinal === 'lost') fineAmount = D(50000); // Lost book fine
    if (statusFinal === 'damaged') fineAmount = D(25000);

    // Update copy status
    const copyStatus = ['returned', 'lost'].includes(statusFinal) ? 'available' : 'borrowed';
    await prisma.bookCopy.updateMany({ where: { id: copy.id }, data: { status: copyStatus } });

    await prisma.borrowing.create({
      data: {
        organizationId: O,
        bookMetadataId: meta.id,
        bookCopyId: copy.id,
        studentProfileId: borrowers[i].id,
        borrowedAt,
        dueAt,
        returnedAt,
        status: statusFinal,
        fineAmount,
        notes: `${meta.title} - ${meta.author}`,
      },
    });

    borrowingCount++;
  }

  ok(`borrowings: ${borrowingCount} (${overdueCount} overdue, fine total: ${money(fineTotal)})`);

  // ── Reservations/Holds (10) ──
  const availableCopies = allCopies.filter((c: any) => c.status === 'available');
  const reservedStudents = allStudents.slice(60, 70);
  
  for (let i = 0; i < reservedStudents.length && i < availableCopies.length; i++) {
    const copy = availableCopies[i];
    const student = reservedStudents[i];
    const meta = copyToMeta.get(copy.id)!;
    
    await prisma.bookCopy.updateMany({ where: { id: copy.id }, data: { status: 'reserved' } });
    await prisma.borrowing.create({
      data: {
        organizationId: O,
        bookMetadataId: meta.id,
        bookCopyId: copy.id,
        studentProfileId: reservedStudents[i].id,
        borrowedAt: new Date(),
        dueAt: new Date(Date.now() + 3 * 86400000), // 3-day hold
        status: 'reserved',
        notes: `Reserved for ${reservedStudents[i].partner?.name}`,
      },
    });
  }
  ok(`reservations: 10`);

  // ── Library Statistics ──
  const totalBooks = bookMetas.length;
  const totalCopies = allCopies.length;
  const availableCount = allCopies.filter((c: any) => c.status === 'available').length;
  const borrowedCount = allCopies.filter((c: any) => c.status === 'borrowed').length;
  const overdueCountFinal = allCopies.filter((c: any) => c.status === 'overdue').length;
  const reservedCount = allCopies.filter((c: any) => c.status === 'reserved').length;
  const lostCount = allCopies.filter((c: any) => c.status === 'lost').length;
  const damagedCount = allCopies.filter((c: any) => c.status === 'damaged').length;

  console.log('\n=== Library Statistics ===');
  console.log(`  Total Books: ${totalBooks}`);
  console.log(`  Total Copies: ${totalCopies}`);
  console.log(`  Available: ${availableCount}`);
  console.log(`  Borrowed: ${borrowedCount}`);
  console.log(`  Overdue: ${overdueCountFinal}`);
  console.log(`  Reserved: ${reservedCount}`);
  console.log(`  Lost: ${lostCount}`);
  console.log(`  Damaged: ${damagedCount}`);
  console.log(`  Total Borrowings: ${borrowingCount}`);
  console.log(`  Overdue Borrowings: ${overdueCount}`);
  console.log(`  Total Fines: ${money(fineTotal)}`);

  ok(`Library demo seed complete!`);
  console.log('\n\x1b[32m✅ Library demo seed complete — ready for client demos.\x1b[0m');
}

function money(n: Prisma.Decimal | number | string): string {
  return `UGX ${Number(n).toLocaleString()}`;
}

main()
  .catch((e) => { console.error('\x1b[31mSeed failed:\x1b[0m', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });