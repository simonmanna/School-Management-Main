import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';

const prisma = new PrismaClient();

async function main() {
  // Get the organization
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.log('No organization found');
    return;
  }
  console.log('Organization:', org.id, org.name);

  // Find the admin user
  const adminUser = await prisma.user.findFirst({
    where: { 
      email: 'admin@sunrise.test',
      organizationId: org.id,
    },
    include: { roles: true }
  });
  
  if (!adminUser) {
    console.log('Admin user not found');
    return;
  }
  console.log('Admin user:', adminUser.id, adminUser.email);
  console.log('Current roles:', adminUser.roles.map(r => r.name));

  // Grant all report permissions to Administrator role
  const adminRole = await prisma.role.findFirst({
    where: { name: 'Administrator', organizationId: org.id },
  });
  
  if (adminRole) {
    const reportPerms = [
      PERMISSIONS.school.readReports,
      PERMISSIONS.school.exportReports,
      PERMISSIONS.school.readFinanceReports,
      PERMISSIONS.school.readAuditReports,
      PERMISSIONS.school.manageSavedReports,
      PERMISSIONS.school.scheduleReports,
    ];
    const missing = reportPerms.filter(p => !adminRole.permissions.includes(p));
    if (missing.length > 0) {
      await prisma.role.update({
        where: { id: adminRole.id },
        data: { permissions: { set: [...adminRole.permissions, ...missing] } },
      });
      console.log(`Added ${missing.length} report permissions to Administrator`);
    }
  }

  // Also grant to Subject Teacher and Class Teacher
  for (const roleName of ['Subject Teacher', 'Class Teacher']) {
    const role = await prisma.role.findFirst({
      where: { name: roleName, organizationId: org.id },
    });
    if (role) {
      const perms = [
        PERMISSIONS.school.readReports,
        PERMISSIONS.school.exportReports,
      ];
      const missing = perms.filter(p => !role.permissions.includes(p));
      if (missing.length > 0) {
        await prisma.role.update({
          where: { id: role.id },
          data: { permissions: { set: [...role.permissions, ...missing] } },
        });
        console.log(`Added ${missing.length} report permissions to ${roleName}`);
      }
    }
  }

  // Assign all school roles to the admin user
  const allSchoolRoles = await prisma.role.findMany({
    where: { 
      organizationId: org.id,
      name: { in: ['Administrator', 'Subject Teacher', 'Class Teacher', 'Head Teacher', 'Deputy Head', 'Bursar', 'Registrar', 'Exams Officer'] }
    }
  });
  
  const currentRoleIds = adminUser.roles.map(r => r.id);
  const newRoles = allSchoolRoles.filter(r => !currentRoleIds.includes(r.id));
  
  if (newRoles.length > 0) {
    await prisma.user.update({
      where: { id: adminUser.id },
      data: {
        roles: {
          connect: newRoles.map(r => ({ id: r.id }))
        }
      }
    });
    console.log(`Assigned ${newRoles.length} new roles to admin user:`, newRoles.map(r => r.name).join(', '));
  }

  console.log('\nDone! Please log out and log back in to refresh permissions.');
}

main().catch(console.error).finally(() => prisma.$disconnect());