import { BadRequestException } from '@nestjs/common';
import { recordTimetableVersion } from '../academics/timetable-version';

export type StaffStatusValue = 'active' | 'on_leave' | 'suspended' | 'inactive' | 'terminated' | 'resigned' | 'retired';

export const STAFF_STATUSES: readonly StaffStatusValue[] = [
  'active',
  'on_leave',
  'suspended',
  'inactive',
  'terminated',
  'resigned',
  'retired',
] as const;

/** Statuses that END employment. Entering one revokes access and teaching. */
export const LEAVING_STATUSES: readonly StaffStatusValue[] = ['terminated', 'resigned', 'retired'];

/**
 * Staff lifecycle. The leaving statuses are terminal except for an explicit
 * re-hire back to `active` — the person returns; their earlier history stays.
 */
export const STAFF_TRANSITIONS: Readonly<Record<StaffStatusValue, readonly StaffStatusValue[]>> = {
  active: ['on_leave', 'suspended', 'inactive', 'terminated', 'resigned', 'retired'],
  on_leave: ['active', 'inactive', 'terminated', 'resigned', 'retired'],
  suspended: ['active', 'terminated', 'resigned'],
  inactive: ['active', 'terminated', 'resigned', 'retired'],
  terminated: ['active'],
  resigned: ['active'],
  retired: ['active'],
};

export function assertStaffTransition(from: string, to: string): void {
  const allowed = STAFF_TRANSITIONS[from as StaffStatusValue] ?? [];
  if (!allowed.includes(to as StaffStatusValue)) {
    throw new BadRequestException(
      `A staff member cannot go from '${from}' to '${to}'. ` +
        (allowed.length ? `From '${from}' they may become: ${allowed.join(', ')}.` : `'${from}' is terminal.`),
    );
  }
}

/**
 * End a staff member's CURRENT access to teaching, inside the caller's
 * transaction. Nothing historical is deleted or rewritten:
 *
 *  - course-offering allocations are end-dated (the offering keeps its record
 *    of who taught it, and when);
 *  - live timetable lessons lose the teacher (and cover assignments are
 *    dropped) — the grid as it stood is preserved in TimetableVersion;
 *  - class-teacher / homeroom pointers are cleared;
 *  - the linked login (User ← HrEmployee ← Partner) is deactivated and every
 *    session revoked.
 *
 * Returns what changed, for the audit record.
 */
export async function endTeachingAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  staff: { id: string; partnerId: string; organizationId: string },
  at: Date,
  actorId: string | null,
) {
  const allocations = await tx.courseOfferingTeacher.updateMany({
    where: { teacherPartnerId: staff.id, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
    data: { effectiveTo: at },
  });
  const lessons = await tx.timetableSlot.findMany({
    where: { OR: [{ teacherPartnerId: staff.id }, { substituteTeacherId: staff.id }] },
    select: { id: true, classId: true, sectionId: true, teacherPartnerId: true },
  });
  await tx.timetableSlot.updateMany({ where: { teacherPartnerId: staff.id }, data: { teacherPartnerId: null } });
  await tx.timetableSlot.updateMany({ where: { substituteTeacherId: staff.id }, data: { substituteTeacherId: null } });
  const grids = new Map<string, { classId: string; sectionId: string | null }>();
  for (const l of lessons) grids.set(`${l.classId}:${l.sectionId ?? ''}`, { classId: l.classId, sectionId: l.sectionId ?? null });
  for (const g of grids.values()) {
    await recordTimetableVersion(
      tx,
      { organizationId: staff.organizationId, userId: actorId },
      g.classId,
      g.sectionId,
      'Teacher left: lessons unassigned for cover',
    );
  }
  const sections = await tx.section.updateMany({ where: { classTeacherId: staff.id }, data: { classTeacherId: null } });
  const homerooms = await tx.schoolClass.updateMany({ where: { homeroomTeacherId: staff.id }, data: { homeroomTeacherId: null } });

  let userId: string | null = null;
  const employee = await tx.hrEmployee.findFirst({ where: { partnerId: staff.partnerId }, select: { userId: true } });
  if (employee?.userId) {
    userId = employee.userId;
    await tx.user.updateMany({ where: { id: userId }, data: { isActive: false } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  return {
    allocationsEnded: allocations.count,
    lessonsUnassigned: lessons.length,
    affectedGrids: [...grids.keys()],
    classTeacherCleared: sections.count,
    homeroomCleared: homerooms.count,
    loginDisabled: userId,
  };
}
