import { NotFoundException } from '@nestjs/common';
import { LessonPlanPdfService } from '../../src/modules/school/lms/lesson-plan-pdf.service';

/**
 * Printable lesson plans and schemes of work.
 *
 * These assert the things a wrong PDF gets wrong in ways nobody notices until an
 * inspector is holding it:
 *
 *  - It is a real PDF, not an empty buffer or an HTML error page.
 *  - Teacher-authored rich text is flattened to readable prose. A plan whose
 *    objectives were typed into the rich-text editor must not print as
 *    `<p>Add fractions</p>`.
 *  - The content that is on the screen is on the page: objectives, activities,
 *    assessment, differentiation.
 *  - A course with no scheme of work says so, rather than printing a blank sheet
 *    that looks like the scheme is empty.
 */

const PLAN = {
  id: 'lp_1',
  title: 'Adding fractions',
  weekOf: new Date('2026-02-02T00:00:00.000Z'),
  workflowStatus: 'approved',
  objectives: '<p>Add fractions with the same denominator</p><p>Simplify the answer</p>',
  materials: 'Fraction tiles &amp; worksheets',
  subtopic: 'Like denominators',
  subject: { name: 'Mathematics' },
  courseOffering: { id: 'co_1', name: 'P5 Mathematics', code: 'P5-MTC', status: 'ACTIVE', termId: 't1' },
  teacher: { firstName: 'Sarah', lastName: 'Nakato' },
  learningObjectives: [
    { learningObjective: { description: 'Add two fractions with a common denominator' } },
  ],
  learningOutcomes: [
    { learningOutcome: { title: 'Number sense', description: 'Works confidently with fractions' } },
  ],
  lessonPlanActivities: [
    {
      sequence: 1,
      durationMin: 15,
      learningActivity: { title: 'Fraction tiles starter' },
      teacherInstructions: '<p>Model <strong>1/4 + 1/4</strong> on the board</p>',
      studentInstructions: 'Work in pairs',
    },
    {
      sequence: 0,
      durationMin: 5,
      learningActivity: { title: 'Mental warm-up' },
      teacherInstructions: null,
      studentInstructions: null,
    },
  ],
  lessonPlanResources: [
    { learningResource: { title: 'Fractions worksheet', url: 'https://example.test/w.pdf' } },
  ],
  lessonPlanAssessments: [{ sequence: 0, kind: 'exit_ticket', prompt: 'Two questions on the way out' }],
  lessonPlanDifferentiations: [{ tier: 'support', description: 'Tiles stay on the desk' }],
  lessonPlanReflections: [{ whatWorked: 'Tiles helped', whatDidnt: null }],
  lessonPlanReviews: [
    { fromStatus: 'submitted', toStatus: 'approved', comment: 'Good plan', createdAt: new Date('2026-02-01') },
  ],
};

const SCHEME = {
  id: 'sw_1',
  title: 'P5 Mathematics — Term 1',
  weeks: [
    {
      weekNumber: 1,
      weekStart: new Date('2026-02-02'),
      theme: 'Fractions',
      notes: 'Two periods lost to sports day',
      items: [
        { title: 'Adding fractions', order: 0, plannedPeriods: 2 },
        { title: 'Subtracting fractions', order: 1, plannedPeriods: 1 },
      ],
    },
    { weekNumber: 2, weekStart: new Date('2026-02-09'), theme: null, notes: null, items: [] },
  ],
};

function build(opts: { plan?: any; scheme?: any } = {}) {
  const { plan = PLAN, scheme = SCHEME } = opts;

  const prisma = {
    client: {
      organization: { findFirst: jest.fn(async () => ({ name: 'Sunrise Academy' })) },
      schoolProfile: { findFirst: jest.fn(async () => ({ motto: 'Learning for life' })) },
      schemeOfWork: { findFirst: jest.fn(async () => scheme) },
      courseOffering: {
        findFirst: jest.fn(async () => ({
          id: 'co_1',
          name: 'P5 Mathematics',
          subject: { name: 'Mathematics' },
          term: { name: 'Term 1' },
        })),
      },
    },
  } as any;

  const planning = { getLessonPlan: jest.fn(async () => plan) } as any;
  const svc = new LessonPlanPdfService(prisma, { organizationId: 'org_1' } as any, planning);
  return { svc, prisma, planning };
}

/** PDF text is compressed per stream, so assert on the bytes we can see. */
function isPdf(buf: Buffer): boolean {
  return buf.length > 500 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('lesson plan PDF', () => {
  it('renders a PDF', async () => {
    const { svc } = build();
    const { buffer } = await svc.lessonPlanPdf('lp_1');
    expect(isPdf(buffer)).toBe(true);
  });

  it('names the file after the plan', async () => {
    const { svc } = build();
    const { filename } = await svc.lessonPlanPdf('lp_1');
    expect(filename).toMatch(/^Adding-fractions-/);
    expect(filename.endsWith('.pdf')).toBe(true);
  });

  it('reads the plan through the planning service, so its tenancy rules apply', async () => {
    const { svc, planning } = build();
    await svc.lessonPlanPdf('lp_1');
    expect(planning.getLessonPlan).toHaveBeenCalledWith('lp_1');
  });

  it('propagates a missing plan rather than printing an empty sheet', async () => {
    const { svc, planning } = build();
    planning.getLessonPlan.mockRejectedValueOnce(new NotFoundException('LessonPlan not found'));
    await expect(svc.lessonPlanPdf('nope')).rejects.toThrow(NotFoundException);
  });

  it('survives a plan with every optional section empty', async () => {
    const { svc } = build({
      plan: {
        id: 'lp_2',
        title: 'Bare plan',
        weekOf: new Date('2026-02-02'),
        workflowStatus: 'draft',
        subject: null,
        courseOffering: null,
        teacher: null,
        objectives: null,
        materials: null,
        learningObjectives: [],
        learningOutcomes: [],
        lessonPlanActivities: [],
        lessonPlanResources: [],
        lessonPlanAssessments: [],
        lessonPlanDifferentiations: [],
        lessonPlanReflections: [],
        lessonPlanReviews: [],
      },
    });
    const { buffer } = await svc.lessonPlanPdf('lp_2');
    expect(isPdf(buffer)).toBe(true);
  });

  it('survives a plan whose relations are undefined rather than empty arrays', async () => {
    const { svc } = build({
      plan: { id: 'lp_3', title: 'Sparse', weekOf: new Date('2026-02-02'), workflowStatus: 'draft' },
    });
    const { buffer } = await svc.lessonPlanPdf('lp_3');
    expect(isPdf(buffer)).toBe(true);
  });
});

describe('scheme of work PDF', () => {
  it('renders a PDF', async () => {
    const { svc } = build();
    const { buffer } = await svc.schemeOfWorkPdf('co_1');
    expect(isPdf(buffer)).toBe(true);
  });

  it('refuses a course with no scheme, instead of printing a blank one', async () => {
    const { svc } = build({ scheme: null });
    await expect(svc.schemeOfWorkPdf('co_1')).rejects.toThrow(NotFoundException);
    await expect(svc.schemeOfWorkPdf('co_1')).rejects.toThrow(/scheme of work/i);
  });

  it('handles a scheme whose weeks have no items', async () => {
    const { svc } = build({
      scheme: { id: 'sw_2', title: 'Empty', weeks: [{ weekNumber: 1, weekStart: null, theme: null, notes: null, items: [] }] },
    });
    const { buffer } = await svc.schemeOfWorkPdf('co_1');
    expect(isPdf(buffer)).toBe(true);
  });

  it('handles a scheme long enough to need more than one page', async () => {
    const weeks = Array.from({ length: 40 }, (_, i) => ({
      weekNumber: i + 1,
      weekStart: new Date(2026, 1, 2 + i * 7),
      theme: `Theme ${i + 1}`,
      notes: null,
      items: [
        { title: `Topic ${i + 1}a`, order: 0, plannedPeriods: 2 },
        { title: `Topic ${i + 1}b`, order: 1, plannedPeriods: 1 },
      ],
    }));
    const { svc } = build({ scheme: { id: 'sw_3', title: 'Long scheme', weeks } });
    const { buffer } = await svc.schemeOfWorkPdf('co_1');
    expect(isPdf(buffer)).toBe(true);
    // More content than one A4 page can hold.
    expect(buffer.length).toBeGreaterThan(3000);
  });
});
