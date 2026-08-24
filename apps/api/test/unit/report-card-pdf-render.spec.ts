/**
 * Runtime smoke tests for the report card PDF layout engine.
 *
 * The renderer drives pdfkit imperatively — fonts by name, `rotate`, `dash`,
 * `switchToPage`, buffered pages. None of that is checked by the compiler: a
 * bad font name or an unbalanced save/restore only blows up at generation
 * time, on a real school's report card. These tests run the layout engine over
 * every preset and over the awkward edge cases (no subjects, every block on,
 * every block off, landscape, many subjects forcing a page break) and assert a
 * well-formed PDF comes out.
 *
 * `render` is exercised directly with a hand-built model, so no database,
 * Prisma or Nest container is involved.
 */
import { ReportCardPdfService, interpolate } from '../../src/modules/school/examinations/report-card-pdf.service';
import {
  DEFAULTS,
  PRESETS,
  presetSettings,
  resolveSettings,
} from '../../src/modules/school/examinations/report-card-settings.schema';

/** The renderer only touches its injected deps in `loadModel`, never in `render`. */
function makeService(): ReportCardPdfService {
  return new ReportCardPdfService(null as any, null as any, null as any, null as any, null as any, null as any);
}

function subject(name: string, code: string, percent: number) {
  return {
    subject: name,
    subjectCode: code,
    examScores: [
      { examType: 'CAT', marks: Math.round(percent * 0.3), maxMarks: 30, grade: 'C3', points: 3 },
      { examType: 'Midterm', marks: Math.round(percent * 0.3), maxMarks: 30, grade: 'C3', points: 3 },
      { examType: 'End of Term', marks: Math.round(percent * 0.4), maxMarks: 40, grade: 'C3', points: 3 },
    ],
    totalPercent: percent,
    finalGrade: percent >= 80 ? 'D1' : percent >= 50 ? 'C3' : 'F9',
    finalPoints: percent >= 80 ? 1 : percent >= 50 ? 3 : 9,
    remark: percent >= 50 ? 'Good' : 'Must improve',
  };
}

function model(settings: Record<string, unknown>, subjectCount = 6) {
  return {
    settings,
    school: {
      name: 'St. Andrews Secondary School',
      motto: 'Knowledge is Light',
      address: 'P.O. Box 12345, Nyapeya, Uganda',
      phone: '0123 456 789',
      email: 'info@standrews.ac.ug',
      website: 'www.standrews.ac.ug',
    },
    student: {
      name: 'Ngarombo Ronald Andrew',
      admissionNo: 'REG-1003',
      gender: 'Male',
      className: 'S.1',
      stream: 'North',
      dateOfBirth: new Date('2011-04-18'),
      house: 'Kabalega',
    },
    term: { name: 'Term 1', startDate: new Date('2026-02-01'), endDate: new Date('2026-04-30'), academicYear: '2026' },
    layout: {
      system: 'UCE',
      columnHeaders: [],
      sections: [
        {
          title: 'Subjects',
          subjects: Array.from({ length: subjectCount }, (_, i) =>
            subject(`Subject ${i + 1}`, `S${i + 1}`, [83, 72, 57, 41, 79, 65][i % 6]),
          ),
        },
      ],
      summary: [
        { label: 'Best 8 Aggregate', value: '22 / 72' },
        { label: 'Compulsory Pass', value: 'Yes' },
      ],
      eligible: { qualifies: true, reason: 'Eligible for the Uganda Certificate of Education.' },
      footer: ['Issued under the UNEB grading system.'],
    },
    stats: { gpa: 3.4, rank: 4, classSize: 42, meanPercent: 66.2, division: 'Division 1', aggregate: '22' },
    comments: {
      classTeacher: 'Consistent effort this term.',
      headTeacher: 'Keep it up.',
      competency: 'COM-1: Exceeding   •   COM-2: Meeting',
    },
    attendance: { present: 58, absent: 3, late: 4, total: 65 },
    gradeBands: [
      { min: 80, max: 100, grade: 'D1', gpa: 4, points: 1, remark: 'Distinction' },
      { min: 50, max: 79, grade: 'C3', gpa: 3, points: 3, remark: 'Credit' },
      { min: 0, max: 49, grade: 'F9', gpa: 0, points: 9, remark: 'Fail' },
    ],
    verificationCode: '8F2A31C0D4',
    generatedAt: new Date('2026-08-21T00:00:00Z'),
  };
}

/** Render and assert we got a structurally valid PDF back. */
async function renderOk(settings: Record<string, unknown>, subjectCount = 6): Promise<Buffer> {
  const service = makeService();
  const buf: Buffer = await (service as any).render(model(settings, subjectCount));
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(buf.subarray(-8).toString('latin1')).toContain('%%EOF');
  expect(buf.length).toBeGreaterThan(1000);
  return buf;
}

function pageCount(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('ReportCardPdfService.render', () => {
  jest.setTimeout(30000);

  it('renders the registry defaults', async () => {
    await renderOk(resolveSettings({}));
  });

  it.each(PRESETS.map((p) => p.key))('renders the %s preset', async (key) => {
    await renderOk(presetSettings(key)!);
  });

  it.each(['A4', 'A5', 'LETTER', 'LEGAL'])('renders on %s paper', async (pageSize) => {
    await renderOk(resolveSettings({ ...DEFAULTS, pageSize }));
  });

  it('renders landscape', async () => {
    await renderOk(resolveSettings({ ...DEFAULTS, orientation: 'landscape' }));
  });

  it.each(['helvetica', 'times', 'courier'])('renders in the %s font family', async (fontFamily) => {
    await renderOk(resolveSettings({ ...DEFAULTS, fontFamily }));
  });

  it.each(['none', 'thin', 'thick', 'double'])('renders the %s page frame', async (pageBorder) => {
    await renderOk(resolveSettings({ ...DEFAULTS, pageBorder }));
  });

  it.each(['grid', 'horizontal', 'minimal'])('renders the %s table style', async (tableStyle) => {
    await renderOk(resolveSettings({ ...DEFAULTS, tableStyle }));
  });

  it.each(['centered', 'logo-left', 'logo-both', 'banner', 'minimal'])(
    'renders the %s header layout',
    async (headerLayout) => {
      await renderOk(resolveSettings({ ...DEFAULTS, headerLayout }));
    },
  );

  it.each(['cards', 'inline', 'table'])('renders the %s summary style', async (summaryStyle) => {
    await renderOk(resolveSettings({ ...DEFAULTS, summaryStyle }));
  });

  it.each(['boxed', 'lined', 'plain'])('renders the %s comment box style', async (commentBoxStyle) => {
    await renderOk(resolveSettings({ ...DEFAULTS, commentBoxStyle }));
  });

  it('renders a rotated, semi-transparent watermark without leaking the transform', async () => {
    const buf = await renderOk(resolveSettings({ ...DEFAULTS, showWatermark: true, watermarkRotation: 45 }));
    // A leaked graphics state would drag the rest of the page off-canvas and
    // collapse the output; a healthy page keeps its bulk.
    expect(buf.length).toBeGreaterThan(2000);
  });

  it('renders with every optional block switched on', async () => {
    const settings = resolveSettings({
      ...DEFAULTS,
      showWatermark: true,
      showFeesBalance: true,
      showParentComment: true,
      showVerificationCode: true,
      showStudentInfoTitle: true,
      blockOrder: (DEFAULTS.blockOrder as Array<Record<string, unknown>>).map((b) => ({ ...b, enabled: true })),
      tableColumns: (DEFAULTS.tableColumns as Array<Record<string, unknown>>).map((c) => ({ ...c, enabled: true })),
      studentFields: (DEFAULTS.studentFields as Array<Record<string, unknown>>).map((f) => ({ ...f, enabled: true })),
    });
    await renderOk(settings);
  });

  it('renders with every optional block switched off', async () => {
    const settings = resolveSettings({
      ...DEFAULTS,
      showSchoolLogo: false,
      showStudentPhoto: false,
      showClassTeacherComment: false,
      showHeadTeacherComment: false,
      showSignatureLines: false,
      showSchoolStamp: false,
      showDisclaimer: false,
      showGeneratedDate: false,
      showPageNumbers: false,
      footerLines: [],
      // `marksTable` is locked on, so the coercer keeps it enabled.
      blockOrder: (DEFAULTS.blockOrder as Array<Record<string, unknown>>).map((b) => ({ ...b, enabled: false })),
    });
    await renderOk(settings);
  });

  it('renders a card with no subjects at all', async () => {
    const service = makeService();
    const empty = model(resolveSettings({}));
    empty.layout.sections = [{ title: 'Subjects', subjects: [] }];
    const buf: Buffer = await (service as any).render(empty);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('breaks to a second page and reprints the table header when subjects overflow', async () => {
    const onePage = await renderOk(resolveSettings({ ...DEFAULTS, maxSubjectsPerPage: 60 }), 8);
    const manyPages = await renderOk(resolveSettings({ ...DEFAULTS, maxSubjectsPerPage: 5 }), 40);
    expect(pageCount(manyPages)).toBeGreaterThan(pageCount(onePage));
  });

  it('renders a multi-page card when page numbering is on', async () => {
    // The footer text itself lives in a deflated content stream and cannot be
    // asserted from the bytes; what matters here is that stamping page
    // furniture across buffered pages does not corrupt or truncate the file.
    const buf = await renderOk(resolveSettings({ ...DEFAULTS, showPageNumbers: true, maxSubjectsPerPage: 5 }), 40);
    expect(pageCount(buf)).toBeGreaterThan(1);
  });

  /**
   * Regression: wide labels in narrow columns drove the computed cell width
   * negative, and pdfkit's ellipsis wrapper never terminates on a negative
   * width — it allocated until the heap died. The page-count bound is the
   * tripwire: a runaway shows up as an implausible page count (or, before the
   * fix, as an OOM) rather than a silent slowdown.
   */
  it('survives absurd but in-range typography without runaway pagination', async () => {
    const buf = await renderOk(resolveSettings({
      ...DEFAULTS,
      baseFontSize: 14,
      schoolNameFontSize: 32,
      titleFontSize: 24,
      tableFontSize: 13,
      tableRowHeight: 28,
      letterSpacing: 3,
      lineHeight: 2,
      marginTopMm: 40,
      marginBottomMm: 40,
      marginLeftMm: 40,
      marginRightMm: 40,
      density: 'relaxed',
    }));
    expect(pageCount(buf)).toBeLessThan(20);
  });

  describe('title placeholders', () => {
    const m = {
      term: { name: 'Term 1', startDate: null, endDate: null, academicYear: '2026' },
      school: { name: 'St. Andrews Secondary School' },
      student: {
        name: 'Ronald A', admissionNo: 'REG-1', gender: 'Male',
        className: 'S.1', stream: 'North',
      },
    } as any;

    it('substitutes each supported placeholder', () => {
      expect(interpolate('{term} REPORT', m)).toBe('Term 1 REPORT');
      expect(interpolate('{school} — {year}', m)).toBe('St. Andrews Secondary School — 2026');
      expect(interpolate('{student} of {class}', m)).toBe('Ronald A of S.1');
    });

    it('is case-insensitive and replaces every occurrence', () => {
      expect(interpolate('{TERM}/{Term}/{term}', m)).toBe('Term 1/Term 1/Term 1');
    });

    it('leaves unknown placeholders and plain text alone', () => {
      expect(interpolate('END OF {semester} REPORT', m)).toBe('END OF {semester} REPORT');
      expect(interpolate('STUDENT PROGRESS REPORT', m)).toBe('STUDENT PROGRESS REPORT');
    });

    it('falls back to the current year when the term has no academic year', () => {
      const noYear = { ...m, term: { ...m.term, academicYear: undefined } };
      expect(interpolate('{year}', noYear)).toBe(String(new Date().getFullYear()));
    });
  });

  it('keeps every preset to a sane page count', async () => {
    for (const p of PRESETS) {
      expect(pageCount(await renderOk(presetSettings(p.key)!))).toBeLessThan(12);
    }
  });
});
