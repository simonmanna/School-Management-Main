/**
 * Append a class/section grid to TimetableVersion, stamped with the term that
 * is current — the timetable's history (audit F-14). Called inside the writer's
 * transaction after every change to the live grid, by the timetable service and
 * by anything else that edits slots (a leaver's lessons being unassigned).
 */
export async function recordTimetableVersion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  ctx: { organizationId: string; userId?: string | null },
  classId: string,
  sectionId: string | null,
  reason: string,
): Promise<void> {
  const slots = await tx.timetableSlot.findMany({
    where: { classId, sectionId },
    select: {
      dayOfWeek: true, periodId: true, subjectId: true, teacherPartnerId: true, substituteTeacherId: true,
      room: true, teachingRoomId: true, type: true, spanPeriods: true, cycle: true, courseOfferingId: true,
    },
    orderBy: [{ dayOfWeek: 'asc' }, { periodId: 'asc' }],
  });
  const term = await tx.term.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const last = await tx.timetableVersion.findFirst({
    where: { classId, sectionId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  await tx.timetableVersion.create({
    data: {
      organizationId: ctx.organizationId,
      classId,
      sectionId,
      termId: term?.id ?? null,
      version: (last?.version ?? 0) + 1,
      reason,
      slots,
      createdById: ctx.userId ?? null,
    },
  });
}
