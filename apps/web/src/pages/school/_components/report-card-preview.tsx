import { forwardRef } from 'react';
import type { CSSProperties } from 'react';
import type { ReportCardColumnItem } from '@/features/school/api';

/**
 * A paper-accurate preview of the printable report card.
 *
 * This is a faithful browser mirror of report-card-pdf.service.ts: the same
 * settings keys drive the same header layouts, block order, table columns and
 * footer, so what an administrator tunes here is what comes out of the PDF.
 * It renders at true page dimensions (mm) and typographic sizes (pt) — the
 * caller scales it down with a CSS transform for on-screen fit.
 */

export interface ReportCardPreviewData {
  school: { name: string; motto?: string; address?: string; phone?: string; email?: string; website?: string; logoUrl?: string };
  student: { name: string; admissionNo: string; gender: string; className: string; stream: string; dateOfBirth?: string; house?: string };
  term: { name: string; startDate?: string; endDate?: string; academicYear?: string };
  sections: Array<{ title: string; subjects: PreviewSubject[] }>;
  summary: Array<{ label: string; value: string }>;
  stats: { gpa?: number; rank?: number; classSize?: number; meanPercent?: number; division?: string; aggregate?: string };
  comments: { classTeacher?: string; headTeacher?: string };
  attendance: { present: number; absent: number; late: number; total: number };
  gradeBands: Array<{ min: number; max: number; grade: string; remark?: string }>;
  eligible?: { qualifies: boolean; reason: string };
}

interface PreviewSubject {
  subject: string;
  subjectCode?: string;
  examScores: Array<{ examType: string; marks: number; maxMarks: number }>;
  totalPercent: number;
  finalGrade?: string;
  finalPoints?: number;
  remark?: string;
  position?: number;
  teacherInitials?: string;
}

/** Sample data used until real marks are available for the chosen student. */
export const SAMPLE_PREVIEW_DATA: ReportCardPreviewData = {
  school: {
    name: 'St. Andrews Secondary School',
    motto: 'Knowledge is Light',
    address: 'P.O. Box 12345, Nyapeya, Uganda',
    phone: '0123 456 789 / 0987 654 321',
    email: 'info@standrews.ac.ug',
    website: 'www.standrews.ac.ug',
  },
  student: {
    name: 'Ngarombo Ronald Andrew',
    admissionNo: 'REG-1003',
    gender: 'Male',
    className: 'S.1',
    stream: 'North',
    dateOfBirth: '2011-04-18',
    house: 'Kabalega',
  },
  term: { name: 'Term 1', startDate: '2026-02-01', endDate: '2026-04-30', academicYear: '2026' },
  sections: [
    {
      title: 'Subjects',
      subjects: [
        { subject: 'English Language', subjectCode: 'ENG', examScores: [{ examType: 'CAT', marks: 26, maxMarks: 30 }, { examType: 'Midterm', marks: 24, maxMarks: 30 }, { examType: 'End of Term', marks: 33, maxMarks: 40 }], totalPercent: 83, finalGrade: 'D1', finalPoints: 1, remark: 'Excellent', position: 2, teacherInitials: 'T.M.' },
        { subject: 'Mathematics', subjectCode: 'MTC', examScores: [{ examType: 'CAT', marks: 21, maxMarks: 30 }, { examType: 'Midterm', marks: 23, maxMarks: 30 }, { examType: 'End of Term', marks: 28, maxMarks: 40 }], totalPercent: 72, finalGrade: 'C3', finalPoints: 3, remark: 'Very good', position: 5, teacherInitials: 'J.M.' },
        { subject: 'Physics', subjectCode: 'PHY', examScores: [{ examType: 'CAT', marks: 18, maxMarks: 30 }, { examType: 'Midterm', marks: 17, maxMarks: 30 }, { examType: 'End of Term', marks: 22, maxMarks: 40 }], totalPercent: 57, finalGrade: 'C5', finalPoints: 5, remark: 'Fair effort', position: 11, teacherInitials: 'A.O.' },
        { subject: 'Chemistry', subjectCode: 'CHE', examScores: [{ examType: 'CAT', marks: 14, maxMarks: 30 }, { examType: 'Midterm', marks: 12, maxMarks: 30 }, { examType: 'End of Term', marks: 15, maxMarks: 40 }], totalPercent: 41, finalGrade: 'P7', finalPoints: 7, remark: 'Must improve', position: 24, teacherInitials: 'S.N.' },
        { subject: 'Biology', subjectCode: 'BIO', examScores: [{ examType: 'CAT', marks: 24, maxMarks: 30 }, { examType: 'Midterm', marks: 25, maxMarks: 30 }, { examType: 'End of Term', marks: 30, maxMarks: 40 }], totalPercent: 79, finalGrade: 'D2', finalPoints: 2, remark: 'Very good', position: 3, teacherInitials: 'P.K.' },
        { subject: 'Geography', subjectCode: 'GEO', examScores: [{ examType: 'CAT', marks: 20, maxMarks: 30 }, { examType: 'Midterm', marks: 19, maxMarks: 30 }, { examType: 'End of Term', marks: 26, maxMarks: 40 }], totalPercent: 65, finalGrade: 'C4', finalPoints: 4, remark: 'Good', position: 8, teacherInitials: 'R.B.' },
      ],
    },
  ],
  summary: [
    { label: 'Best 8 Aggregate', value: '22 / 72' },
    { label: 'Compulsory Pass', value: 'Yes' },
    { label: 'Subjects Assessed', value: '6' },
  ],
  stats: { gpa: 3.4, rank: 4, classSize: 42, meanPercent: 66.2, division: 'Division 1', aggregate: '22' },
  comments: {
    classTeacher: 'Ronald has shown consistent effort this term, particularly in the languages. Chemistry needs deliberate revision before next term.',
    headTeacher: 'A promising result. Keep up the discipline and aim higher next term.',
  },
  attendance: { present: 58, absent: 3, late: 4, total: 65 },
  gradeBands: [
    { min: 80, max: 100, grade: 'D1', remark: 'Distinction' },
    { min: 75, max: 79, grade: 'D2', remark: 'Distinction' },
    { min: 70, max: 74, grade: 'C3', remark: 'Credit' },
    { min: 65, max: 69, grade: 'C4', remark: 'Credit' },
    { min: 60, max: 64, grade: 'C5', remark: 'Credit' },
    { min: 55, max: 59, grade: 'C6', remark: 'Credit' },
    { min: 50, max: 54, grade: 'P7', remark: 'Pass' },
    { min: 45, max: 49, grade: 'P8', remark: 'Pass' },
    { min: 0, max: 44, grade: 'F9', remark: 'Fail' },
  ],
  eligible: { qualifies: true, reason: 'Eligible for the Uganda Certificate of Education.' },
};

/** Page dimensions in millimetres, portrait. */
const PAGE_MM: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  LETTER: { w: 215.9, h: 279.4 },
  LEGAL: { w: 215.9, h: 355.6 },
};

const FONT_STACKS: Record<string, string> = {
  helvetica: 'Helvetica, Arial, "Helvetica Neue", sans-serif',
  times: '"Times New Roman", Times, Georgia, serif',
  courier: '"Courier New", Courier, monospace',
};

const DENSITY: Record<string, number> = { compact: 0.65, normal: 1, relaxed: 1.45 };

export function pageDimensions(settings: Record<string, any>): { w: number; h: number } {
  const base = PAGE_MM[String(settings.pageSize)] ?? PAGE_MM.A4;
  return settings.orientation === 'landscape' ? { w: base.h, h: base.w } : base;
}

interface Props {
  settings: Record<string, any>;
  data?: ReportCardPreviewData;
}

export const ReportCardPreview = forwardRef<HTMLDivElement, Props>(function ReportCardPreview(
  { settings: s, data = SAMPLE_PREVIEW_DATA },
  ref,
) {
  const page = pageDimensions(s);
  const gap = DENSITY[String(s.density)] ?? 1;
  const font = FONT_STACKS[String(s.fontFamily)] ?? FONT_STACKS.helvetica;
  const blocks = enabled(s.blockOrder, ['studentInfo', 'marksTable', 'summary', 'comments', 'signatures']);

  const pageStyle: CSSProperties = {
    width: `${page.w}mm`,
    minHeight: `${page.h}mm`,
    paddingTop: `${nz(s.marginTopMm, 12)}mm`,
    paddingRight: `${nz(s.marginRightMm, 12)}mm`,
    paddingBottom: `${nz(s.marginBottomMm, 12)}mm`,
    paddingLeft: `${nz(s.marginLeftMm, 12)}mm`,
    background: hex(s.pageBackground, '#ffffff'),
    color: hex(s.valueColor, '#0f172a'),
    fontFamily: font,
    fontSize: `${nz(s.baseFontSize, 9.5)}pt`,
    lineHeight: nz(s.lineHeight, 1.25),
    position: 'relative',
    boxSizing: 'border-box',
    overflow: 'hidden',
  };

  return (
    <div ref={ref} style={pageStyle} data-report-card-page>
      <PageFrame s={s} />
      {s.showWatermark && <Watermark s={s} />}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <Header s={s} data={data} gap={gap} />

        <div style={{ flex: 1 }}>
          {blocks.map((key) => {
            switch (key) {
              case 'studentInfo': return <StudentInfo key={key} s={s} data={data} gap={gap} />;
              case 'marksTable': return <MarksTable key={key} s={s} data={data} gap={gap} />;
              case 'summary': return <Summary key={key} s={s} data={data} gap={gap} />;
              case 'gradeKey': return <GradeKey key={key} s={s} data={data} gap={gap} />;
              case 'attendance': return <Attendance key={key} s={s} data={data} gap={gap} />;
              case 'conduct': return <Conduct key={key} s={s} gap={gap} />;
              case 'coCurricular': return <CoCurricular key={key} s={s} gap={gap} />;
              case 'fees': return <Fees key={key} s={s} gap={gap} />;
              case 'comments': return <Comments key={key} s={s} data={data} gap={gap} />;
              case 'nextTerm': return <NextTerm key={key} s={s} gap={gap} />;
              case 'signatures': return <Signatures key={key} s={s} gap={gap} />;
              default: return null;
            }
          })}
        </div>

        <Footer s={s} />
      </div>
    </div>
  );
});

// ── Page decorations ──────────────────────────────────────────────────────

function PageFrame({ s }: { s: Record<string, any> }) {
  const border = String(s.pageBorder || 'thin');
  if (border === 'none') return null;
  const color = hex(s.pageBorderColor, '#1f2937');
  const w = border === 'thick' ? 2.2 : border === 'double' ? 1.4 : 0.8;
  return (
    <>
      <div style={{ position: 'absolute', inset: '2mm', border: `${w}px solid ${color}`, pointerEvents: 'none', zIndex: 0 }} />
      {border === 'double' && (
        <div style={{ position: 'absolute', inset: '3.2mm', border: `0.5px solid ${color}`, pointerEvents: 'none', zIndex: 0 }} />
      )}
    </>
  );
}

function Watermark({ s }: { s: Record<string, any> }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <span
        style={{
          transform: `rotate(${nz(s.watermarkRotation, -30)}deg)`,
          fontSize: `${nz(s.watermarkSize, 72)}pt`,
          fontWeight: 700,
          color: hex(s.watermarkColor, '#1f2937'),
          opacity: nz(s.watermarkOpacity, 0.08),
          whiteSpace: 'nowrap',
        }}
      >
        {String(s.watermarkText || 'OFFICIAL')}
      </span>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header({ s, data, gap }: BlockProps) {
  const layout = String(s.headerLayout || 'centered');
  const onBanner = layout === 'banner';
  const logoSize = nz(s.logoSize, 64);
  const subSize = `${nz(s.baseFontSize, 9.5) - 0.5}pt`;
  const align = layout === 'logo-left' ? 'left' : 'center';

  const identity = (
    <div style={{ flex: 1, textAlign: align as any, minWidth: 0 }}>
      <div
        style={{
          fontSize: `${nz(s.schoolNameFontSize, 18)}pt`,
          fontWeight: 700,
          color: onBanner ? '#ffffff' : hex(s.schoolNameColor, '#0f172a'),
          letterSpacing: `${nz(s.letterSpacing, 0.4)}pt`,
          lineHeight: 1.15,
        }}
      >
        {cased(data.school.name, s.headingCase)}
      </div>
      {layout !== 'minimal' && (
        <>
          {s.showSchoolMotto && data.school.motto && (
            <div style={{ fontStyle: 'italic', fontSize: subSize, color: onBanner ? '#e2e8f0' : hex(s.schoolAddressColor, '#475569') }}>
              “{data.school.motto}”
            </div>
          )}
          {s.showSchoolAddress && data.school.address && (
            <div style={{ fontSize: subSize, color: onBanner ? '#e2e8f0' : hex(s.schoolAddressColor, '#475569') }}>{data.school.address}</div>
          )}
          <div style={{ fontSize: subSize, display: 'flex', gap: '0.6em', justifyContent: align === 'center' ? 'center' : 'flex-start', flexWrap: 'wrap' }}>
            {s.showSchoolPhone && data.school.phone && (
              <span style={{ color: onBanner ? '#e2e8f0' : hex(s.contactColor, '#475569') }}>Tel: {data.school.phone}</span>
            )}
            {s.showSchoolEmail && data.school.email && (
              <span style={{ color: onBanner ? '#e2e8f0' : hex(s.emailColor, '#1d4ed8') }}>· {data.school.email}</span>
            )}
            {s.showSchoolWebsite && data.school.website && (
              <span style={{ color: onBanner ? '#e2e8f0' : hex(s.websiteColor, '#1d4ed8') }}>· {data.school.website}</span>
            )}
          </div>
        </>
      )}
    </div>
  );

  const logo = s.showSchoolLogo && layout !== 'minimal' ? <Logo s={s} data={data} size={logoSize} /> : null;
  const photo = s.showStudentPhoto && String(s.studentPhotoPosition).startsWith('header')
    ? <PhotoBox s={s} size={nz(s.studentPhotoSize, 72)} />
    : null;

  return (
    <div style={{ marginBottom: `${4 * gap}pt` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          ...(onBanner
            ? { background: hex(s.accentColor, '#1f2937'), padding: '8px 10px', borderRadius: 2 }
            : {}),
        }}
      >
        {photo && s.studentPhotoPosition === 'header-left' && photo}
        {(layout === 'logo-left' || layout === 'logo-both') && logo}
        {layout === 'centered' ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{logo}</div>}
            {identity}
          </div>
        ) : (
          identity
        )}
        {layout === 'logo-both' && logo}
        {photo && s.studentPhotoPosition === 'header-right' && photo}
      </div>

      <div
        style={{
          marginTop: `${4 * gap}pt`,
          textAlign: (s.titleAlignment as any) || 'center',
          fontSize: `${nz(s.titleFontSize, 13)}pt`,
          fontWeight: 700,
          color: hex(s.reportTitleColor, '#0f172a'),
          textDecoration: s.showTitleUnderline ? 'underline' : 'none',
          letterSpacing: `${nz(s.letterSpacing, 0.4)}pt`,
        }}
      >
        {cased(interpolate(String(s.reportTitle || 'STUDENT PROGRESS REPORT'), data), s.headingCase)}
      </div>
      {s.reportSubtitle ? (
        <div style={{ textAlign: (s.titleAlignment as any) || 'center', fontSize: subSize, color: hex(s.labelColor, '#64748b') }}>
          {interpolate(String(s.reportSubtitle), data)}
        </div>
      ) : null}
      <div style={{ borderTop: `0.8px solid ${hex(s.accentColor, '#1f2937')}`, marginTop: `${3 * gap}pt` }} />
    </div>
  );
}

function Logo({ s, data, size }: { s: Record<string, any>; data: ReportCardPreviewData; size: number }) {
  const radius = s.logoShape === 'circle' ? '50%' : s.logoShape === 'rounded' ? `${size * 0.15}px` : '0';
  const initials = data.school.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        border: data.school.logoUrl ? 'none' : `1px solid ${hex(s.accentColor, '#1f2937')}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        color: hex(s.accentColor, '#1f2937'),
        fontWeight: 700,
        fontSize: size * 0.34,
      }}
    >
      {data.school.logoUrl
        ? <img src={data.school.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initials}
    </div>
  );
}

function PhotoBox({ s, size }: { s: Record<string, any>; size: number }) {
  const radius = s.studentPhotoShape === 'circle' ? '50%' : s.studentPhotoShape === 'rounded' ? '5px' : '0';
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        border: `0.8px solid ${hex(s.tableBorderColor, '#cbd5e1')}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '6.5pt',
        color: hex(s.labelColor, '#64748b'),
      }}
    >
      PHOTO
    </div>
  );
}

// ── Body blocks ───────────────────────────────────────────────────────────

function StudentInfo({ s, data, gap }: BlockProps) {
  const rows = studentValues(s, data);
  if (rows.length === 0) return null;
  const cols = clamp(Math.round(nz(s.studentInfoColumns, 3)), 1, 4);
  const style = String(s.studentInfoStyle || 'grid');
  const bordered = style !== 'grid';
  const besidePhoto = s.showStudentPhoto && s.studentPhotoPosition === 'beside-name';

  return (
    <section style={{ marginBottom: `${5 * gap}pt` }}>
      {s.showStudentInfoTitle && <SectionTitle s={s}>{String(s.studentInfoTitle || 'STUDENT DETAILS')}</SectionTitle>}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: bordered ? 0 : '1px 10px' }}>
          {rows.map((r) => (
            <div
              key={r.label}
              style={{
                display: 'flex',
                gap: '0.35em',
                minWidth: 0,
                padding: bordered ? '3px 4px' : 0,
                border: bordered ? `0.5px solid ${hex(s.tableBorderColor, '#cbd5e1')}` : 'none',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '0.92em', color: hex(s.labelColor, '#64748b'), whiteSpace: 'nowrap' }}>
                {cased(r.label, s.headingCase)}:
              </span>
              <span style={{ color: hex(s.valueColor, '#0f172a'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.value}</span>
            </div>
          ))}
        </div>
        {besidePhoto && <PhotoBox s={s} size={nz(s.studentPhotoSize, 72)} />}
      </div>
    </section>
  );
}

function MarksTable({ s, data, gap }: BlockProps) {
  const examTypes = distinctExamTypes(data.sections);
  const cols = resolveColumns(s, examTypes);
  if (cols.length === 0) return null;

  const style = String(s.tableStyle || 'grid');
  const border = `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;
  const fs = `${nz(s.tableFontSize, 8)}pt`;
  const rowH = `${nz(s.tableRowHeight, 14)}pt`;
  const blank = String(s.emptyCellPlaceholder || '—');
  const all = data.sections.flatMap((sec) => sec.subjects);
  const mean = all.length ? all.reduce((a, x) => a + x.totalPercent, 0) / all.length : 0;
  const totalPoints = all.reduce((a, x) => a + (x.finalPoints ?? 0), 0);

  const cellBase: CSSProperties = {
    padding: '0 3px',
    height: rowH,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    borderRight: style === 'grid' ? border : 'none',
    borderBottom: style === 'minimal' ? 'none' : border,
  };

  return (
    <section style={{ marginBottom: `${5 * gap}pt`, fontSize: fs }}>
      {data.sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: si < data.sections.length - 1 ? `${3 * gap}pt` : 0 }}>
          {s.showSectionTitles && data.sections.length > 1 && <SectionTitle s={s}>{sec.title}</SectionTitle>}
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', border: style === 'grid' ? border : 'none' }}>
            <colgroup>
              {cols.map((c) => <col key={c.key} style={{ width: `${c.pct}%` }} />)}
            </colgroup>
            <thead>
              <tr
                style={{
                  background: style === 'minimal' ? 'transparent' : hex(s.tableHeaderBg, '#1f2937'),
                  color: style === 'minimal' ? hex(s.sectionTitleColor, '#0f172a') : hex(s.tableHeaderText, '#ffffff'),
                  borderBottom: style === 'minimal' ? `1px solid ${hex(s.accentColor, '#1f2937')}` : 'none',
                }}
              >
                {cols.map((c) => (
                  <th key={c.key} style={{ ...cellBase, textAlign: c.align, fontWeight: 700, borderBottom: 'none' }}>
                    {cased(c.label, s.headingCase)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sec.subjects.length === 0 && (
                <tr><td colSpan={cols.length} style={{ ...cellBase, fontStyle: 'italic', color: hex(s.labelColor, '#64748b') }}>No subjects recorded for this term.</td></tr>
              )}
              {sec.subjects.map((subj, ri) => (
                <tr key={ri} style={{ background: s.zebraStripes && ri % 2 === 1 ? hex(s.tableStripeColor, '#f8fafc') : 'transparent' }}>
                  {cols.map((c) => {
                    const isGrade = c.key === 'grade';
                    return (
                      <td
                        key={c.key}
                        style={{
                          ...cellBase,
                          textAlign: c.align,
                          fontWeight: (c.key === 'subject' && s.boldSubjectNames) || isGrade ? 700 : 400,
                          color: isGrade && s.colorGrades ? gradeColor(s, subj.totalPercent) : hex(s.valueColor, '#0f172a'),
                        }}
                      >
                        {cellValue(c.key, subj, ri, blank)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {s.showTotalsRow && sec.subjects.length > 0 && si === data.sections.length - 1 && (
                <tr style={{ background: tint(hex(s.tableHeaderBg, '#1f2937'), 0.9), fontWeight: 700 }}>
                  {cols.map((c) => (
                    <td key={c.key} style={{ ...cellBase, textAlign: c.align }}>
                      {c.key === 'subject' ? cased(`Total · ${all.length} subjects`, s.headingCase)
                        : c.key === 'percent' ? `${mean.toFixed(1)}%`
                          : c.key === 'points' ? String(totalPoints)
                            : ''}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function Summary({ s, data, gap }: BlockProps) {
  const stats: Array<{ label: string; value: string }> = [...data.summary];
  if (data.stats.meanPercent != null) stats.unshift({ label: 'Mean Score', value: `${data.stats.meanPercent.toFixed(1)}%` });
  if (data.stats.gpa != null) stats.unshift({ label: 'GPA', value: data.stats.gpa.toFixed(2) });
  if (data.stats.rank != null) stats.unshift({ label: 'Position', value: String(data.stats.rank) });
  if (stats.length === 0 && !data.eligible) return null;

  const style = String(s.summaryStyle || 'cards');
  const border = `0.5px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;

  return (
    <section style={{ marginBottom: `${5 * gap}pt` }}>
      <SectionTitle s={s}>PERFORMANCE SUMMARY</SectionTitle>
      {style === 'inline' && (
        <div>{stats.map((x) => `${x.label}: ${x.value}`).join('     •     ')}</div>
      )}
      {style === 'table' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', border }}>
          <tbody>
            {stats.map((x) => (
              <tr key={x.label}>
                <td style={{ border, padding: '2px 4px', width: '40%', fontWeight: 700, fontSize: '0.94em', color: hex(s.labelColor, '#64748b') }}>{x.label}</td>
                <td style={{ border, padding: '2px 4px' }}>{x.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {style === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px' }}>
          {stats.map((x) => (
            <div key={x.label} style={{ border, borderRadius: 3, padding: '3px 5px', minWidth: 0 }}>
              <div style={{ fontSize: '0.8em', color: hex(s.labelColor, '#64748b'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {cased(x.label, s.headingCase)}
              </div>
              <div style={{ fontWeight: 700, color: hex(s.accentColor, '#1f2937'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.value}</div>
            </div>
          ))}
        </div>
      )}
      {data.eligible && (
        <div style={{ marginTop: '3pt' }}>
          <span style={{ fontWeight: 700, color: data.eligible.qualifies ? hex(s.gradePassColor, '#15803d') : hex(s.gradeFailColor, '#b91c1c') }}>
            {data.eligible.qualifies ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
          </span>
          <div style={{ fontSize: '0.94em' }}>{data.eligible.reason}</div>
        </div>
      )}
    </section>
  );
}

function GradeKey({ s, data, gap }: BlockProps) {
  if (!data.gradeBands.length) return null;
  const cols = clamp(Math.round(nz(s.gradeKeyColumns, 5)), 2, 10);
  const border = `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;
  return (
    <section style={{ marginBottom: `${5 * gap}pt`, fontSize: `${nz(s.tableFontSize, 8)}pt` }}>
      <SectionTitle s={s}>{String(s.gradeKeyTitle || 'GRADING KEY')}</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {data.gradeBands.map((b) => (
          <div key={b.grade} style={{ border, padding: '2px 4px', minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: hex(s.accentColor, '#1f2937') }}>{b.grade}</div>
            <div style={{ fontSize: '0.9em', color: hex(s.labelColor, '#64748b'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {b.min}–{b.max}{b.remark ? ` · ${b.remark}` : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Attendance({ s, data, gap }: BlockProps) {
  const a = data.attendance;
  if (!a.total) return null;
  const rate = ((a.present + a.late) / a.total) * 100;
  const cells = [
    { label: 'Days Recorded', value: String(a.total) },
    { label: 'Present', value: String(a.present) },
    { label: 'Absent', value: String(a.absent) },
    { label: 'Late', value: String(a.late) },
    { label: 'Attendance Rate', value: `${rate.toFixed(1)}%` },
  ];
  const border = `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;
  return (
    <section style={{ marginBottom: `${5 * gap}pt` }}>
      <SectionTitle s={s}>{String(s.attendanceTitle || 'ATTENDANCE')}</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((x) => (
          <div key={x.label} style={{ border, padding: '2px 4px', minWidth: 0 }}>
            <div style={{ fontSize: '0.8em', color: hex(s.labelColor, '#64748b'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {cased(x.label, s.headingCase)}
            </div>
            <div style={{ fontWeight: 700 }}>{x.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Conduct({ s, gap }: { s: Record<string, any>; gap: number }) {
  const traits = list(s.conductTraits);
  const scale = list(s.conductScale);
  if (!traits.length || !scale.length) return null;
  const border = `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;
  const fs = `${nz(s.tableFontSize, 8)}pt`;
  return (
    <section style={{ marginBottom: `${5 * gap}pt`, fontSize: fs }}>
      <SectionTitle s={s}>{String(s.conductTitle || 'CONDUCT & BEHAVIOUR')}</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', border, tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: hex(s.tableHeaderBg, '#1f2937'), color: hex(s.tableHeaderText, '#ffffff') }}>
            <th style={{ border, padding: '2px 4px', width: '34%' }} />
            {scale.map((x) => <th key={x} style={{ border, padding: '2px 4px', fontWeight: 700 }}>{x}</th>)}
          </tr>
        </thead>
        <tbody>
          {traits.map((t) => (
            <tr key={t}>
              <td style={{ border, padding: '2px 4px' }}>{t}</td>
              {scale.map((x) => <td key={x} style={{ border, padding: '2px 4px', height: `${nz(s.tableRowHeight, 14)}pt` }} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CoCurricular({ s, gap }: { s: Record<string, any>; gap: number }) {
  const items = list(s.coCurricularActivities);
  if (!items.length) return null;
  const border = `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;
  return (
    <section style={{ marginBottom: `${5 * gap}pt`, fontSize: `${nz(s.tableFontSize, 8)}pt` }}>
      <SectionTitle s={s}>{String(s.coCurricularTitle || 'CO-CURRICULAR ACTIVITIES')}</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', border, tableLayout: 'fixed' }}>
        <tbody>
          {items.map((x) => (
            <tr key={x}>
              <td style={{ border, padding: '2px 4px', width: '34%' }}>{x}</td>
              <td style={{ border, padding: '2px 4px', height: `${nz(s.tableRowHeight, 14) + 2}pt` }} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Fees({ s, gap }: { s: Record<string, any>; gap: number }) {
  if (!s.showFeesBalance) return null;
  const border = `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`;
  return (
    <section style={{ marginBottom: `${5 * gap}pt` }}>
      <SectionTitle s={s}>{String(s.feesTitle || 'FEES STATEMENT')}</SectionTitle>
      <div style={{ border, padding: '3px 5px', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: '0.92em', color: hex(s.labelColor, '#64748b') }}>
          {cased('Outstanding Balance', s.headingCase)}
        </span>
        <span>__________________</span>
      </div>
    </section>
  );
}

function Comments({ s, data, gap }: BlockProps) {
  const boxes: Array<{ label: string; text?: string }> = [];
  if (s.showClassTeacherComment) boxes.push({ label: String(s.classTeacherLabel || "CLASS TEACHER'S COMMENT"), text: data.comments.classTeacher });
  if (s.showHeadTeacherComment) boxes.push({ label: String(s.headTeacherLabel || "HEAD TEACHER'S COMMENT"), text: data.comments.headTeacher });
  if (s.showParentComment) boxes.push({ label: String(s.parentCommentLabel || "PARENT'S / GUARDIAN'S COMMENT") });
  if (boxes.length === 0) return null;

  const style = String(s.commentBoxStyle || 'boxed');
  const lines = clamp(Math.round(nz(s.commentLines, 2)), 0, 6);

  return (
    <section style={{ marginBottom: `${4 * gap}pt`, display: 'grid', gap: '4px' }}>
      {boxes.map((b) => (
        <div
          key={b.label}
          style={{
            border: style === 'boxed' ? `0.5px solid ${hex(s.tableBorderColor, '#cbd5e1')}` : 'none',
            borderBottom: style === 'lined' ? `0.6px solid ${hex(s.accentColor, '#1f2937')}` : undefined,
            borderRadius: style === 'boxed' ? 3 : 0,
            padding: style === 'plain' ? '0' : '3px 5px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.85em', color: hex(s.labelColor, '#64748b'), letterSpacing: `${nz(s.letterSpacing, 0.4)}pt` }}>
            {cased(b.label, s.headingCase)}
          </div>
          {b.text ? (
            <div>{b.text}</div>
          ) : (
            <div style={{ paddingTop: '2px' }}>
              {Array.from({ length: lines }).map((_, i) => (
                <div key={i} style={{ borderBottom: `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`, height: `${nz(s.baseFontSize, 9.5) * nz(s.lineHeight, 1.25) + 3}pt` }} />
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function NextTerm({ s, gap }: { s: Record<string, any>; gap: number }) {
  const note = String(s.nextTermNote || '').trim();
  return (
    <section style={{ marginBottom: `${5 * gap}pt` }}>
      <SectionTitle s={s}>{String(s.nextTermTitle || 'NEXT TERM')}</SectionTitle>
      <div>Next term begins: ______________________</div>
      {note && <div style={{ fontStyle: 'italic', fontSize: '0.92em', color: hex(s.labelColor, '#64748b') }}>{note}</div>}
    </section>
  );
}

function Signatures({ s, gap }: { s: Record<string, any>; gap: number }) {
  const labels = s.showSignatureLines ? list(s.signatureLabels) : [];
  if (!labels.length && !s.showSchoolStamp) return null;
  return (
    <section style={{ marginTop: `${4 * gap}pt`, marginBottom: `${4 * gap}pt`, display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
      <div style={{ flex: 1, display: 'flex', gap: '12px' }}>
        {labels.map((label) => (
          <div key={label} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ borderTop: `0.6px solid ${hex(s.accentColor, '#1f2937')}`, marginTop: '18pt' }} />
            <div style={{ fontSize: '0.85em', color: hex(s.labelColor, '#64748b'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
          </div>
        ))}
      </div>
      {s.showSchoolStamp && (
        <div
          style={{
            width: '28mm',
            height: '18mm',
            border: `0.6px dashed ${hex(s.tableBorderColor, '#cbd5e1')}`,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.8em',
            color: hex(s.labelColor, '#64748b'),
            flexShrink: 0,
          }}
        >
          {String(s.stampLabel || 'School Stamp')}
        </div>
      )}
    </section>
  );
}

function Footer({ s }: { s: Record<string, any> }) {
  const lines = [...list(s.footerLines)];
  if (s.showDisclaimer && s.disclaimerText) lines.push(String(s.disclaimerText));
  const meta: string[] = [];
  if (s.showGeneratedDate) meta.push(`Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  if (s.showVerificationCode) meta.push('Verification: 8F2A31C0D4');
  if (s.showPageNumbers) meta.push('Page 1 of 1');
  if (meta.length) lines.push(meta.join('     •     '));
  if (lines.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: '3pt',
        borderTop: `0.4px solid ${hex(s.tableBorderColor, '#cbd5e1')}`,
        textAlign: 'center',
        fontSize: `${nz(s.footerFontSize, 7)}pt`,
        color: hex(s.footerColor, '#64748b'),
      }}
    >
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

function SectionTitle({ s, children }: { s: Record<string, any>; children: string }) {
  return (
    <div
      style={{
        fontSize: `${nz(s.sectionFontSize, 10)}pt`,
        fontWeight: 700,
        color: hex(s.sectionTitleColor, '#0f172a'),
        letterSpacing: `${nz(s.letterSpacing, 0.4)}pt`,
        marginBottom: '2pt',
      }}
    >
      {cased(children, s.headingCase)}
    </div>
  );
}

// ── Shared helpers (mirrors of the PDF renderer's) ────────────────────────

interface BlockProps {
  s: Record<string, any>;
  data: ReportCardPreviewData;
  gap: number;
}

function nz(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

function tint(color: string, amount: number): string {
  const full = color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
  const mix = (ch: number) => Math.round(ch + (255 - ch) * amount).toString(16).padStart(2, '0');
  return `#${mix(parseInt(full.slice(1, 3), 16))}${mix(parseInt(full.slice(3, 5), 16))}${mix(parseInt(full.slice(5, 7), 16))}`;
}

function cased(text: string, mode: unknown): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'capitalize') return titleCase(text);
  return text;
}

function titleCase(text: string): string {
  return String(text ?? '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function fmtDate(d?: string): string {
  if (!d) return '';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function interpolate(text: string, data: ReportCardPreviewData): string {
  return text
    .replace(/\{term\}/gi, data.term.name)
    .replace(/\{year\}/gi, data.term.academicYear ?? String(new Date().getFullYear()))
    .replace(/\{school\}/gi, data.school.name)
    .replace(/\{student\}/gi, data.student.name)
    .replace(/\{class\}/gi, data.student.className);
}

function items(v: unknown): ReportCardColumnItem[] {
  return Array.isArray(v) ? (v as ReportCardColumnItem[]) : [];
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

function enabled(v: unknown, fallback: string[]): string[] {
  const keys = items(v).filter((i) => i.enabled).map((i) => i.key);
  return keys.length ? keys : fallback;
}

function distinctExamTypes(sections: ReportCardPreviewData['sections']): string[] {
  const seen = new Set<string>();
  for (const sec of sections) for (const s of sec.subjects) for (const x of s.examScores ?? []) seen.add(x.examType);
  return [...seen];
}

function studentValues(s: Record<string, any>, data: ReportCardPreviewData): Array<{ label: string; value: string }> {
  const values: Record<string, string | undefined | null> = {
    name: data.student.name,
    admissionNo: data.student.admissionNo,
    gender: titleCase(data.student.gender),
    class: data.student.className,
    stream: data.student.stream,
    term: data.term.name,
    academicYear: data.term.academicYear,
    termStart: fmtDate(data.term.startDate),
    termEnd: fmtDate(data.term.endDate),
    dateOfBirth: fmtDate(data.student.dateOfBirth),
    age: data.student.dateOfBirth
      ? String(Math.floor((Date.now() - new Date(data.student.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000)))
      : null,
    house: data.student.house,
    dormitory: null,
    lin: null,
    classRank: data.stats.rank != null ? String(data.stats.rank) : null,
    classSize: data.stats.classSize != null ? String(data.stats.classSize) : null,
    meanScore: data.stats.meanPercent != null ? `${data.stats.meanPercent.toFixed(1)}%` : null,
    aggregate: data.stats.aggregate,
    division: data.stats.division,
    feesBalance: 'UGX 150,000',
  };
  const blank = String(s.emptyCellPlaceholder || '—');
  return items(s.studentFields)
    .filter((i) => i.enabled)
    .map((i) => ({ label: i.label, value: values[i.key] ? String(values[i.key]) : blank }));
}

interface PreviewCol {
  key: string;
  label: string;
  align: 'left' | 'center' | 'right';
  pct: number;
}

/** Same width algorithm as the PDF: explicit percentages first, rest share. */
function resolveColumns(s: Record<string, any>, examTypes: string[]): PreviewCol[] {
  const specs: Array<{ key: string; label: string; align: 'left' | 'center'; weight: number }> = [];
  for (const item of items(s.tableColumns).filter((i) => i.enabled)) {
    if (item.key === 'scores') {
      if (examTypes.length === 0) specs.push({ key: 'score:none', label: item.label, align: 'center', weight: 1 });
      else for (const t of examTypes) specs.push({ key: `score:${t}`, label: t, align: 'center', weight: 1 });
    } else if (item.key === 'subject') {
      specs.push({ key: 'subject', label: item.label, align: 'left', weight: -nz(s.subjectColumnWidth, 28) / 100 });
    } else if (item.key === 'remark') {
      specs.push({ key: 'remark', label: item.label, align: 'left', weight: -nz(s.remarkColumnWidth, 20) / 100 });
    } else if (item.key === 'serial') {
      specs.push({ key: 'serial', label: item.label, align: 'center', weight: 0.4 });
    } else {
      specs.push({ key: item.key, label: item.label, align: 'center', weight: 1 });
    }
  }
  if (specs.length === 0) return [];
  const fixedTotal = specs.filter((x) => x.weight < 0).reduce((a, x) => a + -x.weight, 0);
  const flexShare = Math.max(0, 1 - fixedTotal);
  const flexWeight = specs.filter((x) => x.weight >= 0).reduce((a, x) => a + x.weight, 0) || 1;
  return specs.map((x) => ({
    key: x.key,
    label: x.label,
    align: x.align,
    pct: (x.weight < 0 ? -x.weight : (x.weight / flexWeight) * flexShare) * 100,
  }));
}

function cellValue(key: string, subj: PreviewSubject, index: number, blank: string): string {
  if (key.startsWith('score:')) {
    const hit = subj.examScores.find((x) => x.examType === key.slice(6));
    return hit ? String(hit.marks) : blank;
  }
  switch (key) {
    case 'serial': return String(index + 1);
    case 'subject': return subj.subject;
    case 'code': return subj.subjectCode ?? blank;
    case 'outOf': return String(subj.examScores.reduce((a, x) => a + x.maxMarks, 0) || blank);
    case 'total': return String(subj.examScores.reduce((a, x) => a + x.marks, 0) || blank);
    case 'percent': return `${subj.totalPercent}%`;
    case 'grade': return subj.finalGrade ?? blank;
    case 'points': return subj.finalPoints != null ? String(subj.finalPoints) : blank;
    case 'position': return subj.position != null ? String(subj.position) : blank;
    case 'remark': return subj.remark ?? blank;
    case 'initials': return subj.teacherInitials ?? blank;
    default: return blank;
  }
}

function gradeColor(s: Record<string, any>, pct: number): string {
  if (pct >= nz(s.gradePassMin, 70)) return hex(s.gradePassColor, '#15803d');
  if (pct < nz(s.gradeFailBelow, 40)) return hex(s.gradeFailColor, '#b91c1c');
  return hex(s.gradeWarnColor, '#b45309');
}
