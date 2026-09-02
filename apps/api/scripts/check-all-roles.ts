import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({ 
    select: { id: true, name: true, organizationId: true, permissions: true }
  });
  console.log('All roles:', JSON.stringify(roles, null, 2));
}

main().finally(() => prisma.$disconnect());