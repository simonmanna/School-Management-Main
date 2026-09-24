/**
 * Wave 7 (E2E audit P3) · timetable auto-generation is deterministic and
 * weekday-only. It used to draw random cells from all seven days, so lessons
 * landed at weekends and two runs over the same input disagreed.
 */
import { TimetableAdvancedService } from '../../src/modules/school/academics/timetable-advanced.service';

function makeService() {
  const periods = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, order: n }));
  const bulkUpsert = jest.fn(async (dto: any) => ({ count: dto.slots.length }));
  const svc = Object.create(TimetableAdvancedService.prototype) as any;
  svc.prisma = { client: { period: { findMany: jest.fn(async () => periods) } } };
  svc.timetable = { bulkUpsert };
  svc.hasClash = jest.fn(async () => false);
  return { svc, bulkUpsert };
}

const input = {
  classId: 'c1',
  subjectLoads: [
    { subjectId: 'math', perWeek: 7 },
    { subjectId: 'eng', perWeek: 6 },
    { subjectId: 'sci', perWeek: 4 },
  ],
  maxPerDay: 2,
};

describe('timetable generate', () => {
  it('places every lesson Monday–Friday, at most maxPerDay of a subject a day', async () => {
    const { svc, bulkUpsert } = makeService();
    const res = await svc.generate(input);
    const slots = bulkUpsert.mock.calls[0][0].slots;
    expect(res.created).toBe(17);
    expect(slots.every((s: any) => s.dayOfWeek >= 1 && s.dayOfWeek <= 5)).toBe(true);
    const perSubjectDay = new Map<string, number>();
    for (const s of slots) {
      const k = `${s.subjectId}:${s.dayOfWeek}`;
      perSubjectDay.set(k, (perSubjectDay.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perSubjectDay.values())).toBeLessThanOrEqual(2);
    // No cell used twice.
    const cells = new Set(slots.map((s: any) => `${s.dayOfWeek}:${s.periodId}`));
    expect(cells.size).toBe(slots.length);
  });

  it('gives the same draft for the same input', async () => {
    const a = makeService();
    const b = makeService();
    await a.svc.generate(input);
    await b.svc.generate(input);
    expect(a.bulkUpsert.mock.calls[0][0].slots).toEqual(b.bulkUpsert.mock.calls[0][0].slots);
  });
});
