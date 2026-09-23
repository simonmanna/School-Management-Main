import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing foreign keys to allow migration...');
  
  // Clear dependent tables that don't have restrictions
  await prisma.borrowing.deleteMany({});
  console.log('Deleted borrowings');
  
  await prisma.bookCopy.deleteMany({});
  console.log('Deleted book copies');
  
  await prisma.bookMetadata.deleteMany({});
  console.log('Deleted book metadata');
  
  await prisma.product.deleteMany({ where: { code: { startsWith: 'BK-' } } });
  console.log('Deleted library products');
  
  await prisma.studentCategory.deleteMany({});
  console.log('Deleted student categories');
  
  await prisma.complaint.deleteMany({});
  console.log('Deleted complaints');
  
  await prisma.phoneCall.deleteMany({});
  console.log('Deleted phone calls');
  
  await prisma.enrollmentPlacement.deleteMany({});
  await prisma.studentEnrollmentEvent.deleteMany({});
  await prisma.studentEnrollment.deleteMany({});
  console.log('Deleted enrollments');
  
  await prisma.studentProfile.updateMany({
    data: { studentCategoryId: null }
  });
  console.log('Cleared studentCategoryId from all students');
  
  await prisma.section.updateMany({
    data: { classTeacherId: null }
  });
  console.log('Cleared classTeacherId from sections');
  
  console.log('All foreign keys cleared!');
  await prisma.$disconnect();
}

main()
  .catch((e) => { console.error('Failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });