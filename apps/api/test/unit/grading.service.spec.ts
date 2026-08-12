import { GradingService, type GradeBand } from '../../src/modules/school/examinations/grading.service';

/**
 * Unit tests for GradingService — pure functions that don't need a database.
 *
 * Covers the three Uganda grading systems (UCE / UACE / CBC) plus the
 * legacy 9-point scale (kept for backwards-compat with schools that
 * haven't customised yet).
 */
describe('GradingService — UCE bands (post-2020 UNEB scale)', () => {
  let service: GradingService;
  let prisma: any;

  beforeEach(() => {
    prisma = { client: { gradingScale: { findFirst: jest.fn() } } };
    service = new GradingService(prisma);
  });

  it('returns D1 / 4.0 for 90–100%', async () => {
    const band = await service.bandFor(95, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'D1', gpa: 4.0, points: 1 });
  });
  it('returns D2 / 3.6 for 80–89%', async () => {
    const band = await service.bandFor(85, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'D2', gpa: 3.6, points: 2 });
  });
  it('returns C3 / 3.2 for 70–79%', async () => {
    const band = await service.bandFor(75, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'C3', gpa: 3.2, points: 3 });
  });
  it('returns C6 / 2.0 for 50–59%', async () => {
    const band = await service.bandFor(55, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'C6', gpa: 2.0, points: 6 });
  });
  it('returns P7 / 1.5 for 40–49%', async () => {
    const band = await service.bandFor(45, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'P7', gpa: 1.5, points: 7 });
  });
  it('returns P8 / 1.0 for 35–39%', async () => {
    const band = await service.bandFor(37, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'P8', gpa: 1.0, points: 8 });
  });
  it('returns F9 / 0.0 for 0–34%', async () => {
    const band = await service.bandFor(20, 100, 'UCE');
    expect(band).toMatchObject({ grade: 'F9', gpa: 0.0, points: 9 });
  });
});

describe('GradingService — UACE bands (A–O)', () => {
  let service: GradingService;

  beforeEach(() => {
    service = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
  });

  it('returns A / 5 pts for 80–100%', async () => {
    const band = await service.bandFor(85, 100, 'UACE');
    expect(band).toMatchObject({ grade: 'A', points: 5 });
  });
  it('returns B / 6 pts for 70–79%', async () => {
    const band = await service.bandFor(75, 100, 'UACE');
    expect(band).toMatchObject({ grade: 'B', points: 6 });
  });
  it('returns F (fail) for <30%', async () => {
    const band = await service.bandFor(20, 100, 'UACE');
    expect(band?.grade).toBe('F');
    expect(band?.points).toBe(11);
  });
});

describe('GradingService — CBC competency levels', () => {
  let service: GradingService;

  beforeEach(() => {
    service = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
  });

  it('returns A (Exceeding) for 80%+', async () => {
    const band = await service.bandFor(85, 100, 'CBC');
    expect(band?.grade).toBe('A');
  });
  it('returns D (Below) for <50%', async () => {
    const band = await service.bandFor(40, 100, 'CBC');
    expect(band?.grade).toBe('D');
  });
});

describe('GradingService — UCE aggregate (best 8)', () => {
  let service: GradingService;

  beforeEach(() => {
    service = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
  });

  it('sums the best 8 subject points', () => {
    const result = service.computeUCEAggregate([
      { subject: 'English', points: 1 },     // compulsory
      { subject: 'Mathematics', points: 2 }, // compulsory
      { subject: 'Physics', points: 3 },
      { subject: 'Chemistry', points: 4 },
      { subject: 'Biology', points: 5 },
      { subject: 'History', points: 6 },
      { subject: 'Geography', points: 7 },
      { subject: 'Luganda', points: 8 },
      { subject: 'CRE', points: 9 },          // not in best 8 (worst)
      { subject: 'Agriculture', points: 9 },  // not in best 8 (worst)
    ]);
    expect(result.best8Aggregate).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7 + 8); // 36
    expect(result.f9Count).toBe(2);
    expect(result.compulsoryPass).toBe(true);
    expect(result.eligible).toBe(true);
  });

  it('disqualifies when English is F9 even with a low aggregate', () => {
    const result = service.computeUCEAggregate([
      { subject: 'English', points: 9 },
      { subject: 'Mathematics', points: 1 },
      { subject: 'Physics', points: 1 },
      { subject: 'Chemistry', points: 1 },
      { subject: 'Biology', points: 1 },
      { subject: 'History', points: 1 },
      { subject: 'Geography', points: 1 },
      { subject: 'Luganda', points: 1 },
    ]);
    expect(result.eligible).toBe(false);
    expect(result.compulsoryPass).toBe(false);
  });

  it('disqualifies with 4+ F9 grades (3 max)', () => {
    const result = service.computeUCEAggregate([
      { subject: 'English', points: 1 },
      { subject: 'Mathematics', points: 1 },
      { subject: 'Physics', points: 9 },
      { subject: 'Chemistry', points: 9 },
      { subject: 'Biology', points: 9 },
      { subject: 'History', points: 1 },
      { subject: 'Geography', points: 1 },
      { subject: 'Luganda', points: 1 },
      { subject: 'CRE', points: 9 },
    ]);
    expect(result.f9Count).toBe(4);
    expect(result.eligible).toBe(false);
  });
});

describe('GradingService — UACE aggregate (best 3 principals)', () => {
  let service: GradingService;

  beforeEach(() => {
    service = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
  });

  it('sums only the best 3 principal subject points', () => {
    const result = service.computeUACEAggregate([
      { subject: 'Mathematics', points: 5, isPrincipal: true },
      { subject: 'Physics',     points: 6, isPrincipal: true },
      { subject: 'Chemistry',   points: 7, isPrincipal: true },
      { subject: 'Economics',   points: 9, isPrincipal: true }, // not in best 3
      { subject: 'GP',          points: 8, isPrincipal: false }, // subsidiary
    ]);
    expect(result.best3Aggregate).toBe(5 + 6 + 7); // 18
    expect(result.principalCount).toBe(4);
    expect(result.subsidiaries).toHaveLength(1);
  });

  it('handles all-principal scenario', () => {
    const result = service.computeUACEAggregate([
      { subject: 'Math', points: 5, isPrincipal: true },
      { subject: 'Physics', points: 6, isPrincipal: true },
      { subject: 'Chem', points: 7, isPrincipal: true },
    ]);
    expect(result.best3Aggregate).toBe(18);
  });
});

describe('GradingService — scale fixtures', () => {
  it('UCE has 9 bands sorted from highest to lowest', () => {
    const svc = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
    const bands = svc.defaultUCE();
    expect(bands).toHaveLength(9);
    expect(bands[0].grade).toBe('D1');
    expect(bands[bands.length - 1].grade).toBe('F9');
    // No gaps in coverage.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i - 1].min).toBe(bands[i].max + 1);
    }
  });

  it('UACE has 7 bands from A to F', () => {
    const svc = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
    const bands = svc.defaultUACE();
    expect(bands).toHaveLength(7);
    expect(bands[0].grade).toBe('A');
    expect(bands[bands.length - 1].grade).toBe('F');
  });

  it('CBC has 4 competency levels', () => {
    const svc = new GradingService({ client: { gradingScale: { findFirst: jest.fn() } } } as any);
    const bands = svc.defaultCBC();
    expect(bands.map((b) => b.grade)).toEqual(['A', 'B', 'C', 'D']);
  });
});