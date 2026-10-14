/**
 * Teacher Allocation grid (review A7): one save writes the term's
 * TeacherAssignment rows and class teachers; copying a term never overwrites a
 * decision already made in the target term.
 */
import { BadRequestException } from '@nestjs/common';
import { TeachingAllocationService } from '../../src/modules/school/academics/teaching-allocation.service';

jest.mock('../../src/modules/school/foundation/academic-year-guard', () => ({ assertYearWritable: jest.fn() }));

function makeService(over: Partial<Record<string, any>> = {}) {
  const tx: any = {
    teacherAssignment: { deleteMany: jest.fn(), create: jest.fn() },
    section: { updateMany: jest.fn() },
    schoolClass: { updateMany: jest.fn() },
  };
  const client: any = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    term: { findFirst: jest.fn().mockResolvedValue({ id: 't3', name: 'Term 3', academicYearId: 'y' }) },
    staffProfile: { findMany: jest.fn().mockResolvedValue([{ id: 'okot', status: 'active' }, { id: 'gone', status: 'terminated' }]) },
    schoolClass: { findMany: jest.fn().mockResolvedValue([{ id: 'p5' }]) },
    section: { findMany: jest.fn().mockResolvedValue([{ id: 'p5-red', classId: 'p5' }]) },
    subject: { findMany: jest.fn().mockResolvedValue([{ id: 'eng' }]) },
    teacherAssignment: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
    ...over,
  };
  const service = new TeachingAllocationService({ client } as any, { organizationId: 'org' } as any, { recordInTx: jest.fn() } as any);
  jest.spyOn(service, 'matrix').mockResolvedValue({} as any);
  return { service, tx, client };
}

describe('TeachingAllocationService', () => {
  it('replaces a cell and sets a stream’s class teacher in one transaction', async () => {
    const { service, tx } = makeService();
    await service.save({
      termId: 't3',
      cells: [{ classId: 'p5', sectionId: 'p5-red', subjectId: 'eng', teacherPartnerId: 'okot' }],
      classTeachers: [{ classId: 'p5', sectionId: 'p5-red', staffProfileId: 'okot' }],
    });
    expect(tx.teacherAssignment.deleteMany).toHaveBeenCalledWith({ where: { termId: 't3', classId: 'p5', sectionId: 'p5-red', subjectId: 'eng' } });
    expect(tx.teacherAssignment.create.mock.calls[0][0].data).toMatchObject({ termId: 't3', classId: 'p5', sectionId: 'p5-red', subjectId: 'eng', teacherPartnerId: 'okot' });
    expect(tx.section.updateMany).toHaveBeenCalledWith({ where: { id: 'p5-red' }, data: { classTeacherId: 'okot' } });
  });

  it('clearing a cell deletes it and creates nothing', async () => {
    const { service, tx } = makeService();
    await service.save({ termId: 't3', cells: [{ classId: 'p5', sectionId: null, subjectId: 'eng', teacherPartnerId: null }] });
    expect(tx.teacherAssignment.deleteMany).toHaveBeenCalled();
    expect(tx.teacherAssignment.create).not.toHaveBeenCalled();
  });

  it('refuses a teacher who has left and a stream of another class', async () => {
    const { service } = makeService();
    await expect(service.save({ termId: 't3', cells: [{ classId: 'p5', subjectId: 'eng', teacherPartnerId: 'gone' }] }))
      .rejects.toBeInstanceOf(BadRequestException);
    const other = makeService({ section: { findMany: jest.fn().mockResolvedValue([{ id: 'p4-red', classId: 'p4' }]) } });
    await expect(other.service.save({ termId: 't3', cells: [{ classId: 'p5', sectionId: 'p4-red', subjectId: 'eng', teacherPartnerId: 'okot' }] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('copying a term keeps what the target term already has', async () => {
    const findMany = jest.fn()
      .mockResolvedValueOnce([
        { classId: 'p5', sectionId: null, subjectId: 'eng', teacherPartnerId: 'okot', periodsPerWeek: 0 },
        { classId: 'p5', sectionId: null, subjectId: 'mtc', teacherPartnerId: 'okot', periodsPerWeek: 0 },
      ])
      .mockResolvedValueOnce([{ classId: 'p5', sectionId: null, subjectId: 'eng' }]);
    const { service, client } = makeService({
      teacherAssignment: { findMany, createMany: jest.fn() },
      term: { findFirst: jest.fn().mockResolvedValue({ id: 'x', academicYearId: 'y' }) },
    });
    const res = await service.copy({ fromTermId: 't2', toTermId: 't3' });
    expect(res).toEqual({ copied: 1, kept: 1 });
    expect(client.teacherAssignment.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ subjectId: 'mtc', termId: 't3' }),
    ]);
  });
});
