/**
 * `MarkingService.assertMayEnterExamPaper` — who may type exam marks.
 *
 * `POST /school/marks/entry` used to require `school:grades:write`, which no
 * teacher preset holds, so the "Exam papers to enter" tile on My Teaching sent
 * every teacher to a screen that refused every save. The route now admits
 * `school:read` and this check decides: the org-wide grant passes, an
 * owner-scoped teacher passes only for a (class, subject) they teach.
 */
import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';

function makeService(opts: {
  permissions: string[];
  staffId?: string | null;
  assignment?: unknown;
  seat?: unknown;
}) {
  const client: any = {
    teacherAssignment: { findFirst: jest.fn().mockResolvedValue(opts.assignment ?? null) },
    courseOfferingTeacher: { findFirst: jest.fn().mockResolvedValue(opts.seat ?? null) },
  };
  const service = new MarkingService(
    { client } as any,
    { organizationId: 'org_1', store: { permissions: opts.permissions } } as any,
    {} as any,
    {} as any,
    { staffProfileIdForCaller: jest.fn().mockResolvedValue(opts.staffId ?? null) } as any,
    {} as any,
  );
  return { service, client };
}

describe('MarkingService.assertMayEnterExamPaper', () => {
  it('lets the org-wide entry grant through without an ownership lookup', async () => {
    const { service, client } = makeService({ permissions: [PERMISSIONS.school.enterGrades] });
    await expect(service.assertMayEnterExamPaper('class_1', 'sub_1')).resolves.toBeUndefined();
    expect(client.teacherAssignment.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a caller with neither entry grant', async () => {
    const { service } = makeService({ permissions: [PERMISSIONS.school.read], staffId: 'staff_1' });
    await expect(service.assertMayEnterExamPaper('class_1', 'sub_1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an own-grades teacher enter a paper they are assigned to', async () => {
    const { service, client } = makeService({
      permissions: [PERMISSIONS.school.ownGrades],
      staffId: 'staff_1',
      assignment: { id: 'ta_1' },
    });
    await expect(service.assertMayEnterExamPaper('class_1', 'sub_1')).resolves.toBeUndefined();
    expect(client.teacherAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org_1', teacherPartnerId: 'staff_1', classId: 'class_1', subjectId: 'sub_1' },
    }));
  });

  it('accepts a live course-offering seat when there is no teaching allocation', async () => {
    const { service } = makeService({
      permissions: [PERMISSIONS.school.ownGrades],
      staffId: 'staff_1',
      seat: { id: 'cot_1' },
    });
    await expect(service.assertMayEnterExamPaper('class_1', 'sub_1')).resolves.toBeUndefined();
  });

  it("refuses an own-grades teacher on someone else's class", async () => {
    const { service } = makeService({ permissions: [PERMISSIONS.school.ownGrades], staffId: 'staff_1' });
    await expect(service.assertMayEnterExamPaper('class_2', 'sub_1')).rejects.toThrow('classes and subjects you teach');
  });

  it('refuses an own-grades login with no staff record', async () => {
    const { service } = makeService({ permissions: [PERMISSIONS.school.ownGrades], staffId: null });
    await expect(service.assertMayEnterExamPaper('class_1', 'sub_1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
