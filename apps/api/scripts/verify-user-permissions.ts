import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@sunrise.test' },
    include: { 
      roles: { 
        include: { role: true } 
      }
    }
  });
  
  if (!adminUser) {
    console.log('User not found');
    return;
  }
  
  console.log('User:', adminUser.email);
  console.log('\nRoles:');
  for (const ur of adminUser.roles) {
    console.log(`  - ${ur.role.name}:`);
    console.log(`      dataScope: ${ur.role.dataScope}`);
    console.log(`      permissions: ${ur.role.permissions.join(', ')}`);
    console.log(`      has readReports: ${ur.role.permissions.includes('school:reports:read')}`);
    console.log(`      has exportReports: ${ur.role.permissions.includes('school:reports:export')}`);
    console.log(`      has *: ${ur.role.permissions.includes('*')}`);
  }
  
  // Combine all permissions
  const allPerms = new Set<string>();
  for (const ur of adminUser.roles) {
    for (const p of ur.role.permissions) {
      allPerms.add(p);
    }
  }
  
  console.log('\nCombined permissions (relevant):');
  const reportPerms = [...allPerms].filter(p => p.includes('report'));
  console.log('  Report perms:', reportPerms.join(', '));
  console.log('  Has wildcard:', allPerms.has('*'));
}

main().catch(console.error).finally(() => prisma.$disconnect());