import { Prisma } from '@prisma/client';
import {
  bandFor,
  computeSubject,
  InvalidGradingScaleError,
  validateBands,
  type ResultInput,
  type SubjectInput,
} from '../../src/modules/school/assessment/result-computation';
import { defaultBands, inferScaleSystem, resolveScale } from '../../src/modules/school/assessment/grade-bands';
import { GradingService } from '../../src/modules/school/examinations/grading.service';

/**
 * Wave 13 regressions for the student-flow audit (2026-09-26): F01 (decimal
 * band gaps), F02 (missing components re-weighted away), F03 (formative work
 * counted), F14 (nursery graded on the primary scale), ADR-031 D1 rounding.
 */
const D = (v: number | string) => new Prisma.Decimal(v);
const PLE = defaultBands('PLE');
const base = (over: Partial<ResultInput> = {}): ResultInput => ({
  gradingSystem: 'PLE',
  bands: PLE,
  roundingMode: 'half_up',
  decimalPlaces: 2,
  rankOn: 'aggregate',
  students: [],
  ...over,
});

describe('F01 — continuous grade bands', () => {
  const boundaries = [0, 35, 40, 50, 60, 65, 70, 80, 90, 100];
  const grades: Record<number, string> = { 0: 'F9', 35: 'P8', 40: 'P7', 50: 'C6', 60: 'C5', 65: 'C4', 70: 'C3', 80: 'D2', 90: 'D1', 100: 'D1' };
  const below: Record<number, string> = { 35: 'F9', 40: 'P8', 50: 'P7', 60: 'C6', 65: 'C5', 70: 'C4', 80: 'C3', 90: 'D2', 100: 'D1' };

  it.each(boundaries)('boundary %s and ±0.01 land in the right band', (b) => {
    expect(bandFor(D(b), PLE).grade).toBe(grades[b]);
    if (b < 100) expect(bandFor(D(b + 0.01), PLE).grade).toBe(grades[b]);
    if (b > 0) expect(bandFor(D(b - 0.01), PLE).grade).toBe(below[b]);
  });

  it('89.5% is D2, never F9', () => {
    expect(bandFor(D('89.5'), PLE).grade).toBe('D2');
    expect(bandFor(D('79.99'), PLE).grade).toBe('C3');
  });

  it('ECD descriptors have no gaps either', () => {
    const ecd = defaultBands('ECD');
    expect(bandFor(D('79.5'), ecd).grade).toBe('Developing');
    expect(bandFor(D('39.9'), ecd).grade).toBe('Support');
  });

  it('D1 half_up_integer rounds before banding; none bands the exact percent', () => {
    expect(bandFor(D('89.5'), PLE, 'half_up_integer').grade).toBe('D1');
    expect(bandFor(D('89.49'), PLE, 'half_up_integer').grade).toBe('D2');
    expect(bandFor(D('89.5'), PLE, 'none').grade).toBe('D2');
  });

  it('a scale that cannot grade low scores is an error, not a silent last band', () => {
    const broken = [{ min: 50, max: 100, grade: 'P', gpa: 1 }];
    expect(validateBands(broken)).toEqual([expect.stringContaining('lowest band starts at 50')]);
    expect(() => bandFor(D(20), broken)).toThrow(InvalidGradingScaleError);
    expect(validateBands([{ min: 0, grade: 'A', gpa: 1 }, { min: 0, grade: 'B', gpa: 1 }])).toEqual([expect.stringContaining('two bands start at 0')]);
    expect(validateBands(PLE)).toEqual([]);
  });

  it('computeSubject grades a weighted 89.5 as D2', () => {
    const subject: SubjectInput = {
      subjectId: 's',
      passMark: 50,
      components: [
        { id: 'cat', kind: 'cat', weight: 40, aggregation: 'mean' },
        { id: 'exam', kind: 'exam', weight: 60, aggregation: 'mean' },
      ],
      assessments: [
        { componentId: 'cat', kind: 'cat', effectiveScore: 92, maxScore: 100, participation: 'present' },
        { componentId: 'exam', kind: 'exam', effectiveScore: '87.8333333', maxScore: 100, participation: 'present' },
      ],
    };
    const r = computeSubject(subject, base());
    expect(Number(r.finalPercent)).toBeCloseTo(89.5, 2);
    expect(r.grade).toBe('D2');
  });
});

describe('F02 — required components are never re-weighted away', () => {
  const policy = [
    { id: 'cat', kind: 'cat', weight: 40, aggregation: 'mean' as const },
    { id: 'exam', kind: 'exam', weight: 60, aggregation: 'mean' as const },
  ];

  it('CAT=80 with no exam row yields no result and names the missing component', () => {
    const r = computeSubject(
      { subjectId: 's', passMark: 50, components: policy, assessments: [{ componentId: 'cat', kind: 'cat', effectiveScore: 80, maxScore: 100, participation: 'present' }] },
      base(),
    );
    expect(r.finalPercent).toBeNull();
    expect(r.missingComponentIds).toEqual(['exam']);
    expect(r.componentBreakdown.find((c) => c.componentId === 'exam')?.status).toBe('missing');
  });

  it('an exam row with neither a mark nor an outcome is missing, not zero', () => {
    const r = computeSubject(
      {
        subjectId: 's', passMark: 50, components: policy,
        assessments: [
          { componentId: 'cat', kind: 'cat', effectiveScore: 80, maxScore: 100, participation: 'present' },
          { componentId: 'exam', kind: 'exam', effectiveScore: null, maxScore: 100, participation: 'present' },
        ],
      },
      base(),
    );
    expect(r.finalPercent).toBeNull();
  });

  it('a recorded exemption drops out and the remaining weight is re-spread (D2)', () => {
    const r = computeSubject(
      {
        subjectId: 's', passMark: 50, components: policy,
        assessments: [
          { componentId: 'cat', kind: 'cat', effectiveScore: 80, maxScore: 100, participation: 'present' },
          { componentId: 'exam', kind: 'exam', effectiveScore: null, maxScore: 100, participation: 'exempt' },
        ],
      },
      base(),
    );
    expect(Number(r.finalPercent)).toBe(80);
    expect(r.componentBreakdown.find((c) => c.componentId === 'exam')?.status).toBe('exempt');
  });

  it('an unexcused absence scores zero (D2 ABSENT_AS_ZERO)', () => {
    const r = computeSubject(
      {
        subjectId: 's', passMark: 50, components: policy,
        assessments: [
          { componentId: 'cat', kind: 'cat', effectiveScore: 80, maxScore: 100, participation: 'present' },
          { componentId: 'exam', kind: 'exam', effectiveScore: null, maxScore: 100, participation: 'absent' },
        ],
      },
      base(),
    );
    expect(Number(r.finalPercent)).toBe(32);
  });
});

describe('F03 — formative work never changes a term total', () => {
  const components = [
    { id: 'cat', kind: 'cat', weight: 40, aggregation: 'mean' as const },
    { id: 'exam', kind: 'exam', weight: 60, aggregation: 'mean' as const },
  ];
  const summative = [
    { componentId: 'cat', kind: 'cat', effectiveScore: 20, maxScore: 100, participation: 'present' },
    { componentId: 'exam', kind: 'exam', effectiveScore: 50, maxScore: 100, participation: 'present' },
  ];

  it('adding a formative CAT=100 leaves the total unchanged', () => {
    const without = computeSubject({ subjectId: 's', passMark: 50, components, assessments: summative }, base());
    const withF = computeSubject(
      { subjectId: 's', passMark: 50, components, assessments: [...summative, { componentId: null, kind: 'cat', effectiveScore: 100, maxScore: 100, participation: 'present', formative: true }] },
      base(),
    );
    expect(Number(without.finalPercent)).toBe(38);
    expect(Number(withF.finalPercent)).toBe(38);
  });

  it('an unbound summative mark never feeds two components of the same kind', () => {
    const two = [
      { id: 'cat1', kind: 'cat', weight: 20, aggregation: 'mean' as const },
      { id: 'cat2', kind: 'cat', weight: 20, aggregation: 'mean' as const },
      { id: 'exam', kind: 'exam', weight: 60, aggregation: 'mean' as const },
    ];
    const r = computeSubject(
      {
        subjectId: 's', passMark: 50, components: two,
        assessments: [
          { componentId: null, kind: 'cat', effectiveScore: 100, maxScore: 100, participation: 'present' },
          { componentId: 'exam', kind: 'exam', effectiveScore: 50, maxScore: 100, participation: 'present' },
        ],
      },
      base(),
    );
    // Ambiguous: bound to neither CAT component, so both are missing.
    expect(r.finalPercent).toBeNull();
    expect(r.missingComponentIds).toEqual(['cat1', 'cat2']);
  });
});

describe('F14 — a scale serves one system', () => {
  const pleDefault = { id: 'ple', name: 'PLE (UNEB)', system: 'PLE', isDefault: true, bands: PLE, bandRounding: 'none' };
  const house = { id: 'house', name: 'Our scale', system: null, isDefault: true, bands: PLE, bandRounding: 'half_up_integer' };
  const db = (scales: any[]) => ({ gradingScale: { findMany: jest.fn().mockResolvedValue(scales) } });

  it('nursery never borrows the default primary scale', async () => {
    const r = await resolveScale(db([pleDefault]), 'ECD');
    expect(r.scaleId).toBeNull();
    expect(r.bands[0].grade).toBe('Confident');
  });

  it('nursery never borrows an unlabelled house default either', async () => {
    const r = await resolveScale(db([house]), 'ECD');
    expect(r.bands.map((b) => b.grade)).toContain('Support');
  });

  it('a graded system may use the school house scale and its rounding', async () => {
    const r = await resolveScale(db([house]), 'PLE');
    expect(r.scaleId).toBe('house');
    expect(r.rounding).toBe('half_up_integer');
  });

  it('a registered broken scale is refused', async () => {
    await expect(resolveScale(db([{ ...pleDefault, bands: [{ min: 40, grade: 'P', gpa: 1 }] }]), 'PLE')).rejects.toThrow(InvalidGradingScaleError);
  });

  it('infers a legacy scale system by whole token (UCE is not inside UACE)', () => {
    expect(inferScaleSystem('UACE 2024')).toBe('UACE');
    expect(inferScaleSystem('UCE')).toBe('UCE');
    expect(inferScaleSystem('ECD nursery descriptors')).toBe('ECD');
    expect(inferScaleSystem('House scale')).toBeNull();
  });

  it('GradingService.bandFor uses the same continuous lookup (89.5 → D2)', async () => {
    const svc = new GradingService({ client: { gradingScale: { findMany: jest.fn().mockResolvedValue([]) } } } as any);
    expect((await svc.bandFor(89.5, 100, 'PLE'))?.grade).toBe('D2');
  });
});

describe('F13 — the accepted application is the source of the pupil record', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AdmissionsService } = require('../../src/modules/school/admissions/admissions.service');
  const svc: any = Object.create(AdmissionsService.prototype);
  svc.encryption = { decrypt: () => 'CM1234567890XYZ' };
  const app = {
    applicantFirstName: 'Grace', applicantLastName: 'Aine', applicantDob: new Date('2019-03-04'), applicantGender: 'female',
    nationality: 'Ugandan', residenceType: 'boarder', studentCategoryId: 'cat-sibling', address: 'Ntinda',
    ninCiphertext: 'c', ninIv: 'i', ninTag: 't',
  };

  it('carries residence, category, nationality and NIN without re-entry', () => {
    const m = svc.mapApplicationToPupil(app, { student: { name: 'Grace Aine', gender: 'female' } });
    expect(m.fields).toMatchObject({ name: 'Grace Aine', residenceType: 'boarder', studentCategoryId: 'cat-sibling', nationality: 'Ugandan', dateOfBirth: '2019-03-04' });
    expect(m.customFields.ninEncrypted).toEqual({ ciphertext: 'c', iv: 'i', tag: 't' });
    expect(m.customFields.ninLast4).toBe('0XYZ');
    expect(m.summary.carried).toEqual(expect.arrayContaining(['residenceType', 'studentCategoryId', 'nin']));
  });

  it('refuses a contradicting override unless it is confirmed', () => {
    expect(() => svc.mapApplicationToPupil(app, { student: { residenceType: 'day' } })).toThrow(/Confirm the change/);
    const m = svc.mapApplicationToPupil(app, { student: { residenceType: 'day' }, confirmOverrides: true });
    expect(m.fields.residenceType).toBe('day');
    expect(m.summary.overridden).toEqual(['residenceType']);
  });

  it('defaults to day only when neither side says otherwise', () => {
    const m = svc.mapApplicationToPupil({ ...app, residenceType: null, ninCiphertext: null }, {});
    expect(m.fields.residenceType).toBe('day');
  });
});

describe('Report cards — a class release never stops half-way', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ReportCardService } = require('../../src/modules/school/examinations/examinations.service');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BadRequestException } = require('@nestjs/common');

  it('releases every releasable card and counts the previews it held back', async () => {
    const svc: any = Object.create(ReportCardService.prototype);
    svc.classRoll = async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
    svc.prisma = {
      client: {
        reportCard: {
          findMany: async () => [
            { id: 'c1', publishedAt: null },
            { id: 'c2', publishedAt: null }, // a late admission: preview only
            { id: 'c3', publishedAt: new Date() },
          ],
        },
      },
    };
    const released: string[] = [];
    svc.setPublished = async (id: string) => {
      if (id === 'c2') throw new BadRequestException('built from live marks');
      released.push(id);
    };
    const res = await svc.publishForClass({ classId: 'k', termId: 't' });
    expect(released).toEqual(['c1']);
    expect(res).toEqual({ published: 1, alreadyPublished: 1, notGenerated: 1, awaitingResults: 1 });
  });
});
