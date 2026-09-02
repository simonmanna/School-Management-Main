import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({ 
    where: { name: { contains: 'Teacher', mode: 'insensitive' } },
    select: { id: true, name: true, organizationId: true, permissions: true }
  });
  console.log('Teacher roles:', JSON.stringify(roles, null, 2));
  
  // Also check for Class Teacher
  const classTeacherRoles = await prisma.role.findMany({ 
    where: { name: { contains: 'Class Teacher', mode: 'insensitive' } },
    select: { id: true, name: true, organizationId: true, permissions: true }
  });
  console.log('Class Teacher roles:', JSON.stringify(classTeacherRoles, null, 2));
}

main().finally(() => prisma.$disconnect());