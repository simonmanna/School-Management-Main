/**
 * Report-card comments (review A2). The class teacher writes the class
 * teacher's comment for their own class; the head teacher writes theirs; a
 * released card is not rewritten behind the family's back.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportCardService } from '../../src/modules/school/examinations/examinations.service';

function makeService(opts: {
  permissions: string[];
  scope?: string;
  staffProfileId?: string | null;
  homeroomOf?: string | null;
  streamTeacherOf?: string | null;
  existing?: Record<string, unknown> | null;
}) {
  const tx: any = {
    reportCard: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve(create)),
    },
  };
  const client: any = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    schoolClass: { count: jest.fn(({ where }: any) => Promise.resolve(where.id === opts.homeroomOf ? 1 : 0)) },
    section: { count: jest.fn(({ where }: any) => Promise.resolve(where.id === opts.streamTeacherOf ? 1 : 0)) },
  };
  const placements: any = {
    resolve: jest.fn().mockResolvedValue(new Map([['stu_1', { classId: 'p5', sectionId: 'p5-red' }]])),
  };
  const service = new ReportCardService(
    { client } as any,
    { organizationId: 'org_1', userId: 'u1', store: { permissions: opts.permissions } } as any,
    {} as any,
    { publishInTx: jest.fn() } as any,
    {} as any,
    { recordInTx: jest.fn() } as any,
    {} as any,
    placements,
    { effective: jest.fn().mockResolvedValue(opts.scope ?? 'class') } as any,
    { staffProfileIdForCaller: jest.fn().mockResolvedValue(opts.staffProfileId ?? null) } as any,
  );
  return { service, tx };
}

const CT = 'school:reports:comment';
const HEAD = 'school:reports:comment:head';
const dto = (over: Record<string, unknown>) => ({ studentProfileId: 'stu_1', termId: 'term_1', ...over });

describe('report-card comments', () => {
  it('the class teacher of the pupil’s stream writes the class teacher’s comment', async () => {
    const { service, tx } = makeService({ permissions: [CT], staffProfileId: 'staff_1', streamTeacherOf: 'p5-red' });
    await service.updateComment(dto({ classTeacherComment: '  Good work.  ' }) as any);
    expect(tx.reportCard.upsert.mock.calls[0][0].create.classTeacherComment).toBe('Good work.');
  });

  it('a class-scoped teacher of another class is refused', async () => {
    const { service } = makeService({ permissions: [CT], staffProfileId: 'staff_2', homeroomOf: 'p4' });
    await expect(service.updateComment(dto({ classTeacherComment: 'x' }) as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a class teacher cannot write the head teacher’s comment', async () => {
    const { service } = makeService({ permissions: [CT], staffProfileId: 'staff_1', homeroomOf: 'p5' });
    await expect(service.updateComment(dto({ principalComment: 'x' }) as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the head teacher (school scope) writes both', async () => {
    const { service, tx } = makeService({ permissions: [CT, HEAD], scope: 'school' });
    await service.updateComment(dto({ classTeacherComment: 'A', principalComment: 'B' }) as any);
    expect(tx.reportCard.upsert.mock.calls[0][0].create).toMatchObject({ classTeacherComment: 'A', principalComment: 'B' });
  });

  it('a released card is not rewritten', async () => {
    const { service } = makeService({ permissions: [CT, HEAD], scope: 'school', existing: { id: 'rc', publishedAt: new Date(), payload: {} } });
    await expect(service.updateComment(dto({ classTeacherComment: 'x' }) as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the grid saves what it may and reports the rest', async () => {
    const { service } = makeService({ permissions: [CT], staffProfileId: 'staff_1', homeroomOf: 'p5' });
    const res = await service.updateComments({
      termId: 'term_1',
      items: [{ studentProfileId: 'stu_1', classTeacherComment: 'Fine' }, { studentProfileId: 'stu_1', principalComment: 'No' }],
    });
    expect(res.saved).toBe(1);
    expect(res.refused).toHaveLength(1);
  });
});
