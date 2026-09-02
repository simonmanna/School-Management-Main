import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';

const prisma = new PrismaClient();

async function main() {
  // Get the first organization
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.log('No organization found');
    return;
  }
  console.log('Organization:', org.id, org.name);

  // Teacher permissions - what they need for reports
const teacherPermissions = [
    PERMISSIONS.school.read,
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
    PERMISSIONS.school.ownAttendance,
    PERMISSIONS.school.ownGrades,
    PERMISSIONS.school.ownLessonPlans,
    PERMISSIONS.school.ownTimetable,
    PERMISSIONS.school.lmsRead,
    PERMISSIONS.school.teacherPortal,
    PERMISSIONS.school.portalSelf,
    PERMISSIONS.hr.self,
  ].filter(Boolean);

  // Check if Subject Teacher already exists
  let subjectTeacher = await prisma.role.findFirst({
    where: { name: 'Subject Teacher', organizationId: org.id },
  });

  if (subjectTeacher) {
    console.log('Subject Teacher role exists, updating permissions...');
    const missing = teacherPermissions.filter(p => !subjectTeacher.permissions.includes(p));
    if (missing.length > 0) {
      await prisma.role.update({
        where: { id: subjectTeacher.id },
        data: { permissions: { set: [...subjectTeacher.permissions, ...missing] } },
      });
      console.log(`Added ${missing.length} permissions to Subject Teacher`);
    } else {
      console.log('Subject Teacher already has all permissions');
    }
  } else {
    subjectTeacher = await prisma.role.create({
      data: {
        name: 'Subject Teacher',
        description: 'Today\'s Teacher preset, rescoped from implicit to explicit `own`.',
        organizationId: org.id,
        permissions: teacherPermissions,
        isSystem: false,
        dataScope: 'own',
      },
    });
    console.log('Created Subject Teacher role:', subjectTeacher.id);
  }

  // Also create Class Teacher role
  const classTeacherPermissions = [
    PERMISSIONS.school.read,
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
    PERMISSIONS.school.ownAttendance,
    PERMISSIONS.school.attendanceStatusWrite,
    PERMISSIONS.school.ownGrades,
    PERMISSIONS.school.assignmentsWrite,
    PERMISSIONS.school.assignmentsGrade,
    PERMISSIONS.school.ownLessonPlans,
    PERMISSIONS.school.ownTimetable,
    PERMISSIONS.school.coursesTeach,
    PERMISSIONS.school.lmsRead,
    PERMISSIONS.school.documentsRead,
    PERMISSIONS.school.communicate,
    PERMISSIONS.school.teacherPortal,
    PERMISSIONS.school.portalSelf,
    PERMISSIONS.hr.self,
  ].filter(Boolean);

  let classTeacher = await prisma.role.findFirst({
    where: { name: 'Class Teacher', organizationId: org.id },
  });

  if (classTeacher) {
    console.log('Class Teacher role exists, updating permissions...');
    const missing = classTeacherPermissions.filter(p => !classTeacher.permissions.includes(p));
    if (missing.length > 0) {
      await prisma.role.update({
        where: { id: classTeacher.id },
        data: { permissions: { set: [...classTeacher.permissions, ...missing] } },
      });
      console.log(`Added ${missing.length} permissions to Class Teacher`);
    } else {
      console.log('Class Teacher already has all permissions');
    }
  } else {
    classTeacher = await prisma.role.create({
      data: {
        name: 'Class Teacher',
        description: 'Enters marks and takes registers for their own classes; never approves them.',
        organizationId: org.id,
        permissions: classTeacherPermissions,
        isSystem: false,
        dataScope: 'class',
      },
    });
    console.log('Created Class Teacher role:', classTeacher.id);
  }

  // Also grant to Administrator if not already
  const admin = await prisma.role.findFirst({
    where: { name: 'Administrator', organizationId: org.id },
  });
  if (admin && !admin.permissions.includes('*')) {
    const adminPerms = [
      PERMISSIONS.school.read,
      PERMISSIONS.school.readReports,
      PERMISSIONS.school.exportReports,
      PERMISSIONS.school.readFinanceReports,
      PERMISSIONS.school.readAuditReports,
      PERMISSIONS.school.manageSavedReports,
      PERMISSIONS.school.scheduleReports,
    ].filter(Boolean);
    const missing = adminPerms.filter(p => !admin.permissions.includes(p));
    if (missing.length > 0) {
      await prisma.role.update({
        where: { id: admin.id },
        data: { permissions: { set: [...admin.permissions, ...missing] } },
      });
      console.log(`Added ${missing.length} permissions to Administrator`);
    }
  }

  console.log('\nDone! Now assign the "Subject Teacher" or "Class Teacher" role to your user in the UI.');
}

main().catch(console.error).finally(() => prisma.$disconnect());