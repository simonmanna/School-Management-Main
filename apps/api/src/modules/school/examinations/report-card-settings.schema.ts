/**
 * ReportCardSettings field registry — the single source of truth for the
 * printable report card's configuration.
 *
 * Everything downstream is derived from this file:
 *   - defaults        → `DEFAULTS` (resolved settings shape)
 *   - validation      → `coerceField` / `sanitizePatch`
 *   - persistence     → `column: true` fields live in real table columns
 *                       (legacy compatibility); the rest live in the
 *                       `config` JSONB blob, so new options need no migration
 *   - the settings UI → `GET /school/report-card-settings/schema` ships this
 *                       registry to the browser, which renders the controls
 *                       generically
 *   - the PDF renderer → reads the resolved settings object
 *
 * Adding a new customisation option = add one entry here. Nothing else.
 */

export type FieldType =
  | 'boolean'
  | 'color'
  | 'number'
  | 'text'
  | 'textarea'
  | 'select'
  | 'list' // string[] — free-form repeated text lines
  | 'columns'; // ordered [{ key, label, enabled }] — reorderable checklist

export type GroupKey =
  | 'paper'
  | 'brand'
  | 'type'
  | 'color'
  | 'student'
  | 'table'
  | 'blocks'
  | 'comments'
  | 'footer';

export interface ColumnItem {
  key: string;
  label: string;
  enabled: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  group: GroupKey;
  default: unknown;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Persisted in a dedicated table column instead of the `config` blob. */
  column?: boolean;
  /** Only render in the UI when this predicate holds. */
  showIf?: { key: string; equals?: unknown };
  /** For `columns` fields: which item keys may not be disabled. */
  locked?: string[];
}

export const GROUPS: Array<{ key: GroupKey; label: string; description: string; icon: string }> = [
  { key: 'paper', label: 'Paper & Layout', description: 'Page size, margins, density and the page frame.', icon: 'FileText' },
  { key: 'brand', label: 'Branding & Header', description: 'Logo, school identity, report title, watermark and student photo.', icon: 'Image' },
  { key: 'type', label: 'Typography', description: 'Font family and the size of every text role on the page.', icon: 'Type' },
  { key: 'color', label: 'Colour Palette', description: 'Every colour used by the header, table and grade highlighting.', icon: 'Palette' },
  { key: 'student', label: 'Student Details', description: 'Which biodata fields print, in what order and in what shape.', icon: 'User' },
  { key: 'table', label: 'Marks Table', description: 'Table columns, styling, totals and pagination.', icon: 'Table' },
  { key: 'blocks', label: 'Content Blocks', description: 'Optional sections: summary, grading key, attendance, conduct, fees.', icon: 'LayoutGrid' },
  { key: 'comments', label: 'Comments & Signatures', description: 'Comment boxes, signature lines and the school stamp.', icon: 'PenLine' },
  { key: 'footer', label: 'Footer & Security', description: 'Footer lines, disclaimer, page numbers and verification code.', icon: 'ShieldCheck' },
];

const PAGE_SIZES = [
  { value: 'A4', label: 'A4 (210 × 297 mm)' },
  { value: 'A5', label: 'A5 (148 × 210 mm)' },
  { value: 'LETTER', label: 'Letter (8.5 × 11 in)' },
  { value: 'LEGAL', label: 'Legal (8.5 × 14 in)' },
];

const ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

/** Student biodata fields available for the info block, in default print order. */
export const STUDENT_FIELD_CATALOG: ColumnItem[] = [
  { key: 'name', label: 'Student Name', enabled: true },
  { key: 'admissionNo', label: 'Admission / Reg No.', enabled: true },
  { key: 'gender', label: 'Gender', enabled: true },
  { key: 'class', label: 'Class', enabled: true },
  { key: 'stream', label: 'Stream', enabled: true },
  { key: 'term', label: 'Term', enabled: true },
  { key: 'academicYear', label: 'Academic Year', enabled: true },
  { key: 'termStart', label: 'Term Start Date', enabled: false },
  { key: 'termEnd', label: 'Term End Date', enabled: true },
  { key: 'dateOfBirth', label: 'Date of Birth', enabled: false },
  { key: 'age', label: 'Age', enabled: false },
  { key: 'house', label: 'House', enabled: false },
  { key: 'dormitory', label: 'Dormitory', enabled: false },
  { key: 'lin', label: 'LIN / Learner ID', enabled: false },
  { key: 'classRank', label: 'Position in Class', enabled: true },
  { key: 'classSize', label: 'Class Size', enabled: true },
  { key: 'meanScore', label: 'Mean Score', enabled: true },
  { key: 'aggregate', label: 'Aggregate', enabled: true },
  { key: 'division', label: 'Division / Grade', enabled: true },
  { key: 'feesBalance', label: 'Fees Balance', enabled: false },
];

/** Marks-table columns available, in default print order. */
export const TABLE_COLUMN_CATALOG: ColumnItem[] = [
  { key: 'serial', label: 'No.', enabled: false },
  { key: 'subject', label: 'Subject', enabled: true },
  { key: 'code', label: 'Code', enabled: true },
  { key: 'scores', label: 'Assessment Scores', enabled: true },
  { key: 'outOf', label: 'Out Of', enabled: false },
  { key: 'total', label: 'Total', enabled: false },
  { key: 'percent', label: 'Percent', enabled: true },
  { key: 'grade', label: 'Grade', enabled: true },
  { key: 'points', label: 'Points', enabled: true },
  { key: 'position', label: 'Subject Position', enabled: false },
  { key: 'remark', label: 'Remark', enabled: true },
  { key: 'initials', label: 'Teacher Initials', enabled: false },
];

/** Body blocks in default print order. */
export const BLOCK_CATALOG: ColumnItem[] = [
  { key: 'studentInfo', label: 'Student Details', enabled: true },
  { key: 'marksTable', label: 'Marks Table', enabled: true },
  { key: 'summary', label: 'Performance Summary', enabled: true },
  { key: 'gradeKey', label: 'Grading Key', enabled: true },
  { key: 'attendance', label: 'Attendance', enabled: true },
  { key: 'conduct', label: 'Conduct & Behaviour', enabled: false },
  { key: 'coCurricular', label: 'Co-curricular Activities', enabled: false },
  { key: 'fees', label: 'Fees Statement', enabled: false },
  { key: 'comments', label: 'Comments', enabled: true },
  { key: 'nextTerm', label: 'Next Term Information', enabled: true },
  { key: 'signatures', label: 'Signatures & Stamp', enabled: true },
];

export const FIELDS: FieldDef[] = [
  // ── Paper & layout ───────────────────────────────────────────────────
  { key: 'pageSize', label: 'Page Size', type: 'select', group: 'paper', default: 'A4', options: PAGE_SIZES },
  {
    key: 'orientation', label: 'Orientation', type: 'select', group: 'paper', default: 'portrait',
    options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
  },
  { key: 'marginTopMm', label: 'Top Margin', type: 'number', group: 'paper', default: 12, min: 4, max: 40, step: 1, unit: 'mm' },
  { key: 'marginRightMm', label: 'Right Margin', type: 'number', group: 'paper', default: 12, min: 4, max: 40, step: 1, unit: 'mm' },
  { key: 'marginBottomMm', label: 'Bottom Margin', type: 'number', group: 'paper', default: 12, min: 4, max: 40, step: 1, unit: 'mm' },
  { key: 'marginLeftMm', label: 'Left Margin', type: 'number', group: 'paper', default: 12, min: 4, max: 40, step: 1, unit: 'mm' },
  {
    key: 'density', label: 'Vertical Density', type: 'select', group: 'paper', default: 'normal',
    help: 'Scales the gap between every block. Use “Compact” to fit more subjects on one page.',
    options: [{ value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'relaxed', label: 'Relaxed' }],
  },
  {
    key: 'pageBorder', label: 'Page Frame', type: 'select', group: 'paper', default: 'thin',
    options: [
      { value: 'none', label: 'None' },
      { value: 'thin', label: 'Thin rule' },
      { value: 'thick', label: 'Thick rule' },
      { value: 'double', label: 'Double rule' },
    ],
  },
  { key: 'pageBorderColor', label: 'Frame Colour', type: 'color', group: 'paper', default: '#1f2937', showIf: { key: 'pageBorder' } },
  { key: 'pageBackground', label: 'Paper Colour', type: 'color', group: 'paper', default: '#ffffff' },

  // ── Branding & header ────────────────────────────────────────────────
  {
    key: 'headerLayout', label: 'Header Layout', type: 'select', group: 'brand', default: 'centered',
    options: [
      { value: 'centered', label: 'Centred — logo above name' },
      { value: 'logo-left', label: 'Logo left, details right' },
      { value: 'logo-both', label: 'Logo on both sides' },
      { value: 'banner', label: 'Colour banner' },
      { value: 'minimal', label: 'Minimal — name only' },
    ],
  },
  { key: 'showSchoolLogo', label: 'School Logo', type: 'boolean', group: 'brand', default: true, column: true },
  { key: 'logoSize', label: 'Logo Size', type: 'number', group: 'brand', default: 64, min: 24, max: 140, step: 2, unit: 'px', showIf: { key: 'showSchoolLogo', equals: true } },
  {
    key: 'logoShape', label: 'Logo Shape', type: 'select', group: 'brand', default: 'circle',
    options: [{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }],
    showIf: { key: 'showSchoolLogo', equals: true },
  },
  { key: 'showSchoolMotto', label: 'School Motto', type: 'boolean', group: 'brand', default: true, column: true },
  { key: 'showSchoolAddress', label: 'Postal Address', type: 'boolean', group: 'brand', default: true },
  { key: 'showSchoolPhone', label: 'Telephone', type: 'boolean', group: 'brand', default: true },
  { key: 'showSchoolEmail', label: 'Email', type: 'boolean', group: 'brand', default: true },
  { key: 'showSchoolWebsite', label: 'Website', type: 'boolean', group: 'brand', default: true },
  { key: 'reportTitle', label: 'Report Title', type: 'text', group: 'brand', default: 'STUDENT PROGRESS REPORT', help: 'Printed under the school identity. Use {term} and {year} as placeholders.' },
  { key: 'reportSubtitle', label: 'Report Subtitle', type: 'text', group: 'brand', default: '' },
  { key: 'titleAlignment', label: 'Title Alignment', type: 'select', group: 'brand', default: 'center', options: ALIGNMENTS },
  { key: 'showTitleUnderline', label: 'Underline Title', type: 'boolean', group: 'brand', default: true },
  { key: 'showStudentPhoto', label: 'Student Photo', type: 'boolean', group: 'brand', default: true, column: true },
  {
    key: 'studentPhotoPosition', label: 'Photo Position', type: 'select', group: 'brand', default: 'header-right',
    options: [
      { value: 'header-right', label: 'Top right' },
      { value: 'header-left', label: 'Top left' },
      { value: 'beside-name', label: 'Beside student details' },
    ],
    showIf: { key: 'showStudentPhoto', equals: true },
  },
  { key: 'studentPhotoSize', label: 'Photo Size', type: 'number', group: 'brand', default: 72, min: 40, max: 160, step: 4, unit: 'px', showIf: { key: 'showStudentPhoto', equals: true } },
  {
    key: 'studentPhotoShape', label: 'Photo Shape', type: 'select', group: 'brand', default: 'rounded',
    options: [{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }],
    showIf: { key: 'showStudentPhoto', equals: true },
  },
  { key: 'showWatermark', label: 'Watermark', type: 'boolean', group: 'brand', default: false, column: true },
  { key: 'watermarkText', label: 'Watermark Text', type: 'text', group: 'brand', default: 'OFFICIAL', showIf: { key: 'showWatermark', equals: true } },
  { key: 'watermarkOpacity', label: 'Watermark Opacity', type: 'number', group: 'brand', default: 0.08, min: 0.02, max: 0.4, step: 0.01, showIf: { key: 'showWatermark', equals: true } },
  { key: 'watermarkSize', label: 'Watermark Size', type: 'number', group: 'brand', default: 72, min: 20, max: 180, step: 2, unit: 'pt', showIf: { key: 'showWatermark', equals: true } },
  { key: 'watermarkRotation', label: 'Watermark Angle', type: 'number', group: 'brand', default: -30, min: -90, max: 90, step: 5, unit: '°', showIf: { key: 'showWatermark', equals: true } },
  { key: 'watermarkColor', label: 'Watermark Colour', type: 'color', group: 'brand', default: '#1f2937', showIf: { key: 'showWatermark', equals: true } },

  // ── Typography ───────────────────────────────────────────────────────
  {
    key: 'fontFamily', label: 'Font Family', type: 'select', group: 'type', default: 'helvetica',
    help: 'Restricted to the three cores every PDF reader can render without embedding.',
    options: [
      { value: 'helvetica', label: 'Helvetica — clean sans' },
      { value: 'times', label: 'Times — traditional serif' },
      { value: 'courier', label: 'Courier — monospace' },
    ],
  },
  { key: 'baseFontSize', label: 'Body Text', type: 'number', group: 'type', default: 9.5, min: 6, max: 14, step: 0.5, unit: 'pt' },
  { key: 'schoolNameFontSize', label: 'School Name', type: 'number', group: 'type', default: 18, min: 10, max: 32, step: 1, unit: 'pt' },
  { key: 'titleFontSize', label: 'Report Title', type: 'number', group: 'type', default: 13, min: 8, max: 24, step: 1, unit: 'pt' },
  { key: 'sectionFontSize', label: 'Section Headings', type: 'number', group: 'type', default: 10, min: 6, max: 18, step: 0.5, unit: 'pt' },
  { key: 'tableFontSize', label: 'Table Text', type: 'number', group: 'type', default: 8, min: 5, max: 13, step: 0.5, unit: 'pt' },
  { key: 'lineHeight', label: 'Line Height', type: 'number', group: 'type', default: 1.25, min: 1, max: 2, step: 0.05 },
  {
    key: 'headingCase', label: 'Heading Case', type: 'select', group: 'type', default: 'uppercase',
    options: [{ value: 'uppercase', label: 'UPPERCASE' }, { value: 'capitalize', label: 'Title Case' }, { value: 'none', label: 'As typed' }],
  },
  { key: 'letterSpacing', label: 'Heading Letter Spacing', type: 'number', group: 'type', default: 0.4, min: 0, max: 3, step: 0.1, unit: 'pt' },
  { key: 'boldSubjectNames', label: 'Bold Subject Names', type: 'boolean', group: 'type', default: true },

  // ── Colour palette ───────────────────────────────────────────────────
  { key: 'schoolNameColor', label: 'School Name', type: 'color', group: 'color', default: '#0f172a', column: true },
  { key: 'schoolAddressColor', label: 'Address & Motto', type: 'color', group: 'color', default: '#475569', column: true },
  { key: 'contactColor', label: 'Telephone', type: 'color', group: 'color', default: '#475569', column: true },
  { key: 'websiteColor', label: 'Website', type: 'color', group: 'color', default: '#1d4ed8', column: true },
  { key: 'emailColor', label: 'Email', type: 'color', group: 'color', default: '#1d4ed8', column: true },
  { key: 'reportTitleColor', label: 'Report Title', type: 'color', group: 'color', default: '#0f172a', column: true },
  { key: 'accentColor', label: 'Accent / Rules', type: 'color', group: 'color', default: '#1f2937' },
  { key: 'sectionTitleColor', label: 'Section Headings', type: 'color', group: 'color', default: '#0f172a' },
  { key: 'labelColor', label: 'Field Labels', type: 'color', group: 'color', default: '#64748b' },
  { key: 'valueColor', label: 'Field Values', type: 'color', group: 'color', default: '#0f172a' },
  { key: 'tableHeaderBg', label: 'Table Header Fill', type: 'color', group: 'color', default: '#1f2937' },
  { key: 'tableHeaderText', label: 'Table Header Text', type: 'color', group: 'color', default: '#ffffff' },
  { key: 'tableBorderColor', label: 'Table Borders', type: 'color', group: 'color', default: '#cbd5e1' },
  { key: 'zebraStripes', label: 'Zebra Striping', type: 'boolean', group: 'color', default: true },
  { key: 'tableStripeColor', label: 'Stripe Colour', type: 'color', group: 'color', default: '#f8fafc', showIf: { key: 'zebraStripes', equals: true } },
  { key: 'colorGrades', label: 'Colour-code Grades', type: 'boolean', group: 'color', default: true, help: 'Tint the grade cell by performance band.' },
  { key: 'gradePassColor', label: 'Strong Pass', type: 'color', group: 'color', default: '#15803d', showIf: { key: 'colorGrades', equals: true } },
  { key: 'gradeWarnColor', label: 'Borderline', type: 'color', group: 'color', default: '#b45309', showIf: { key: 'colorGrades', equals: true } },
  { key: 'gradeFailColor', label: 'Fail', type: 'color', group: 'color', default: '#b91c1c', showIf: { key: 'colorGrades', equals: true } },
  { key: 'gradePassMin', label: 'Strong Pass From', type: 'number', group: 'color', default: 70, min: 0, max: 100, step: 1, unit: '%', showIf: { key: 'colorGrades', equals: true } },
  { key: 'gradeFailBelow', label: 'Fail Below', type: 'number', group: 'color', default: 40, min: 0, max: 100, step: 1, unit: '%', showIf: { key: 'colorGrades', equals: true } },

  // ── Student details ──────────────────────────────────────────────────
  {
    key: 'studentFields', label: 'Fields & Order', type: 'columns', group: 'student',
    default: STUDENT_FIELD_CATALOG, locked: ['name'],
    help: 'Drag to reorder. Untick to hide. “Student Name” always prints.',
  },
  { key: 'studentInfoColumns', label: 'Columns', type: 'number', group: 'student', default: 3, min: 1, max: 4, step: 1 },
  {
    key: 'studentInfoStyle', label: 'Presentation', type: 'select', group: 'student', default: 'grid',
    options: [
      { value: 'grid', label: 'Label : value grid' },
      { value: 'boxed', label: 'Bordered boxes' },
      { value: 'table', label: 'Bordered table' },
    ],
  },
  { key: 'studentInfoTitle', label: 'Block Heading', type: 'text', group: 'student', default: 'STUDENT DETAILS' },
  { key: 'showStudentInfoTitle', label: 'Show Block Heading', type: 'boolean', group: 'student', default: false },

  // ── Marks table ──────────────────────────────────────────────────────
  {
    key: 'tableColumns', label: 'Columns & Order', type: 'columns', group: 'table',
    default: TABLE_COLUMN_CATALOG, locked: ['subject'],
    help: 'Drag to reorder. “Assessment Scores” expands to one column per exam type recorded.',
  },
  {
    key: 'tableStyle', label: 'Table Style', type: 'select', group: 'table', default: 'grid',
    options: [
      { value: 'grid', label: 'Full grid' },
      { value: 'horizontal', label: 'Horizontal rules only' },
      { value: 'minimal', label: 'Minimal — header rule only' },
    ],
  },
  { key: 'showSectionTitles', label: 'Section Titles', type: 'boolean', group: 'table', default: true, help: 'e.g. “Principal Subjects” / “Subsidiary Subjects” for UACE.' },
  { key: 'showTotalsRow', label: 'Totals Row', type: 'boolean', group: 'table', default: true },
  { key: 'tableRowHeight', label: 'Row Height', type: 'number', group: 'table', default: 14, min: 9, max: 28, step: 1, unit: 'pt' },
  { key: 'emptyCellPlaceholder', label: 'Empty Cell Text', type: 'text', group: 'table', default: '—' },
  { key: 'maxSubjectsPerPage', label: 'Subjects Per Page', type: 'number', group: 'table', default: 22, min: 5, max: 60, step: 1 },
  { key: 'subjectColumnWidth', label: 'Subject Column Width', type: 'number', group: 'table', default: 28, min: 12, max: 50, step: 1, unit: '%' },
  { key: 'remarkColumnWidth', label: 'Remark Column Width', type: 'number', group: 'table', default: 20, min: 8, max: 45, step: 1, unit: '%' },

  // ── Content blocks ───────────────────────────────────────────────────
  {
    key: 'blockOrder', label: 'Blocks & Order', type: 'columns', group: 'blocks',
    default: BLOCK_CATALOG, locked: ['marksTable'],
    help: 'Drag to reorder the whole page. Untick to drop a block entirely.',
  },
  {
    key: 'summaryStyle', label: 'Summary Style', type: 'select', group: 'blocks', default: 'cards',
    options: [{ value: 'cards', label: 'Stat cards' }, { value: 'inline', label: 'Inline list' }, { value: 'table', label: 'Bordered table' }],
  },
  { key: 'gradeKeyTitle', label: 'Grading Key Heading', type: 'text', group: 'blocks', default: 'GRADING KEY' },
  { key: 'gradeKeyColumns', label: 'Grading Key Columns', type: 'number', group: 'blocks', default: 5, min: 2, max: 10, step: 1 },
  { key: 'attendanceTitle', label: 'Attendance Heading', type: 'text', group: 'blocks', default: 'ATTENDANCE' },
  { key: 'conductTitle', label: 'Conduct Heading', type: 'text', group: 'blocks', default: 'CONDUCT & BEHAVIOUR' },
  { key: 'conductTraits', label: 'Conduct Traits', type: 'list', group: 'blocks', default: ['Punctuality', 'Neatness', 'Discipline', 'Class Participation', 'Leadership'] },
  { key: 'conductScale', label: 'Conduct Rating Scale', type: 'list', group: 'blocks', default: ['Excellent', 'Very Good', 'Good', 'Fair', 'Needs Improvement'] },
  { key: 'coCurricularTitle', label: 'Co-curricular Heading', type: 'text', group: 'blocks', default: 'CO-CURRICULAR ACTIVITIES' },
  { key: 'coCurricularActivities', label: 'Activities', type: 'list', group: 'blocks', default: ['Sports & Games', 'Music, Dance & Drama', 'Debating', 'Clubs & Societies'] },
  { key: 'showFeesBalance', label: 'Fees Balance', type: 'boolean', group: 'blocks', default: false, column: true },
  { key: 'feesTitle', label: 'Fees Heading', type: 'text', group: 'blocks', default: 'FEES STATEMENT', showIf: { key: 'showFeesBalance', equals: true } },
  { key: 'nextTermTitle', label: 'Next Term Heading', type: 'text', group: 'blocks', default: 'NEXT TERM' },
  { key: 'nextTermNote', label: 'Next Term Note', type: 'textarea', group: 'blocks', default: 'All fees must be cleared before the first day of term.' },
  { key: 'showTermStartDate', label: 'Term Start Date', type: 'boolean', group: 'blocks', default: false, column: true },
  { key: 'showTermEndDate', label: 'Term End Date', type: 'boolean', group: 'blocks', default: true, column: true },

  // ── Comments & signatures ────────────────────────────────────────────
  { key: 'showClassTeacherComment', label: "Class Teacher's Comment", type: 'boolean', group: 'comments', default: true, column: true },
  { key: 'classTeacherLabel', label: 'Class Teacher Label', type: 'text', group: 'comments', default: "CLASS TEACHER'S COMMENT", showIf: { key: 'showClassTeacherComment', equals: true } },
  { key: 'showHeadTeacherComment', label: "Head Teacher's Comment", type: 'boolean', group: 'comments', default: true, column: true },
  { key: 'headTeacherLabel', label: 'Head Teacher Label', type: 'text', group: 'comments', default: "HEAD TEACHER'S COMMENT", showIf: { key: 'showHeadTeacherComment', equals: true } },
  { key: 'showParentComment', label: "Parent's Comment", type: 'boolean', group: 'comments', default: false },
  { key: 'parentCommentLabel', label: 'Parent Label', type: 'text', group: 'comments', default: "PARENT'S / GUARDIAN'S COMMENT", showIf: { key: 'showParentComment', equals: true } },
  {
    key: 'commentBoxStyle', label: 'Comment Box Style', type: 'select', group: 'comments', default: 'boxed',
    options: [{ value: 'boxed', label: 'Bordered box' }, { value: 'lined', label: 'Ruled lines' }, { value: 'plain', label: 'Plain text' }],
  },
  { key: 'commentLines', label: 'Blank Lines When Empty', type: 'number', group: 'comments', default: 2, min: 0, max: 6, step: 1 },
  { key: 'showSignatureLines', label: 'Signature Lines', type: 'boolean', group: 'comments', default: true },
  { key: 'signatureLabels', label: 'Signatories', type: 'list', group: 'comments', default: ['Class Teacher', 'Head Teacher', 'Parent / Guardian'], showIf: { key: 'showSignatureLines', equals: true } },
  { key: 'showSchoolStamp', label: 'School Stamp Box', type: 'boolean', group: 'comments', default: true },
  { key: 'stampLabel', label: 'Stamp Label', type: 'text', group: 'comments', default: 'School Stamp', showIf: { key: 'showSchoolStamp', equals: true } },

  // ── Footer & security ────────────────────────────────────────────────
  { key: 'footerLines', label: 'Footer Lines', type: 'list', group: 'footer', default: ['This report is issued by the school administration.'] },
  { key: 'showDisclaimer', label: 'Disclaimer', type: 'boolean', group: 'footer', default: true },
  { key: 'disclaimerText', label: 'Disclaimer Text', type: 'textarea', group: 'footer', default: 'This report is not valid without the official school stamp.', showIf: { key: 'showDisclaimer', equals: true } },
  { key: 'showGeneratedDate', label: 'Generated Date', type: 'boolean', group: 'footer', default: true },
  { key: 'showPageNumbers', label: 'Page Numbers', type: 'boolean', group: 'footer', default: true },
  { key: 'showVerificationCode', label: 'Verification Code', type: 'boolean', group: 'footer', default: false, help: 'Prints a short code derived from the report card id so a parent can verify authenticity.' },
  { key: 'footerColor', label: 'Footer Colour', type: 'color', group: 'footer', default: '#64748b' },
  { key: 'footerFontSize', label: 'Footer Size', type: 'number', group: 'footer', default: 7, min: 4, max: 11, step: 0.5, unit: 'pt' },
];

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/** Fields stored in real table columns (legacy compatibility). */
export const COLUMN_FIELDS: FieldDef[] = FIELDS.filter((f) => f.column);
export const COLUMN_KEYS: string[] = COLUMN_FIELDS.map((f) => f.key);

/** Fully-resolved default settings object. */
export const DEFAULTS: Record<string, unknown> = Object.fromEntries(
  FIELDS.map((f) => [f.key, clone(f.default)]),
);

/**
 * Named starting points. Each is a sparse override of `DEFAULTS`; applying a
 * preset resets every other field back to its default, so presets are
 * predictable rather than cumulative.
 */
export interface PresetDef {
  key: string;
  label: string;
  description: string;
  overrides: Record<string, unknown>;
}

export const PRESETS: PresetDef[] = [
  {
    key: 'classic',
    label: 'Classic',
    description: 'Serif type, full grid, heavy rules — the traditional Ugandan school report.',
    overrides: {
      fontFamily: 'times',
      headerLayout: 'centered',
      pageBorder: 'double',
      tableStyle: 'grid',
      tableHeaderBg: '#111827',
      tableHeaderText: '#ffffff',
      zebraStripes: false,
      accentColor: '#111827',
      websiteColor: '#111827',
      emailColor: '#111827',
      schoolNameColor: '#111827',
      reportTitleColor: '#111827',
      showTitleUnderline: true,
    },
  },
  {
    key: 'modern',
    label: 'Modern',
    description: 'Sans-serif, colour banner header, zebra striping and stat cards.',
    overrides: {
      fontFamily: 'helvetica',
      headerLayout: 'banner',
      pageBorder: 'none',
      tableStyle: 'horizontal',
      tableHeaderBg: '#1d4ed8',
      tableHeaderText: '#ffffff',
      tableBorderColor: '#e2e8f0',
      zebraStripes: true,
      tableStripeColor: '#f1f5f9',
      accentColor: '#1d4ed8',
      schoolNameColor: '#1e3a8a',
      reportTitleColor: '#1e3a8a',
      summaryStyle: 'cards',
      showTitleUnderline: false,
    },
  },
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'No frame, hairline rules, generous whitespace. Ink-light for bulk printing.',
    overrides: {
      headerLayout: 'minimal',
      pageBorder: 'none',
      showSchoolLogo: false,
      showWatermark: false,
      tableStyle: 'minimal',
      tableHeaderBg: '#ffffff',
      tableHeaderText: '#0f172a',
      tableBorderColor: '#e2e8f0',
      zebraStripes: false,
      colorGrades: false,
      density: 'relaxed',
      showTitleUnderline: false,
      summaryStyle: 'inline',
      accentColor: '#94a3b8',
    },
  },
  {
    key: 'bold',
    label: 'Bold',
    description: 'Large type, strong dark header, colour-coded grades. Reads well at a glance.',
    overrides: {
      headerLayout: 'logo-left',
      schoolNameFontSize: 22,
      titleFontSize: 15,
      baseFontSize: 10,
      tableFontSize: 9,
      tableHeaderBg: '#0f172a',
      tableHeaderText: '#ffffff',
      zebraStripes: true,
      colorGrades: true,
      pageBorder: 'thick',
      density: 'compact',
      accentColor: '#0f172a',
    },
  },
  {
    key: 'formal',
    label: 'Formal Certificate',
    description: 'Crest on both sides, watermark, stamp box and signature lines. For end-of-year reports.',
    overrides: {
      fontFamily: 'times',
      headerLayout: 'logo-both',
      pageBorder: 'double',
      pageBorderColor: '#7c2d12',
      showWatermark: true,
      watermarkText: 'OFFICIAL',
      watermarkOpacity: 0.07,
      showSchoolStamp: true,
      showSignatureLines: true,
      showVerificationCode: true,
      accentColor: '#7c2d12',
      schoolNameColor: '#7c2d12',
      reportTitleColor: '#7c2d12',
      tableHeaderBg: '#7c2d12',
      density: 'compact',
    },
  },
];

export const PRESET_BY_KEY: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.key, p]));

// ── Coercion & validation ───────────────────────────────────────────────

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clone<T>(v: T): T {
  return v && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v;
}

/**
 * Coerce one incoming value to the field's declared type, clamping numbers,
 * rejecting unknown enum members and dropping junk. Returns `undefined` when
 * the value cannot be salvaged — callers skip those keys, keeping the stored
 * value intact rather than writing garbage.
 */
export function coerceField(def: FieldDef, raw: unknown): unknown {
  switch (def.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      return undefined;

    case 'color': {
      if (typeof raw !== 'string') return undefined;
      const v = raw.trim();
      return HEX.test(v) ? v.toLowerCase() : undefined;
    }

    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return undefined;
      const min = def.min ?? Number.NEGATIVE_INFINITY;
      const max = def.max ?? Number.POSITIVE_INFINITY;
      return Math.min(max, Math.max(min, n));
    }

    case 'text':
      if (typeof raw !== 'string') return undefined;
      return raw.slice(0, 200);

    case 'textarea':
      if (typeof raw !== 'string') return undefined;
      return raw.slice(0, 2000);

    case 'select': {
      if (typeof raw !== 'string') return undefined;
      return def.options?.some((o) => o.value === raw) ? raw : undefined;
    }

    case 'list': {
      if (!Array.isArray(raw)) return undefined;
      return raw
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.slice(0, 200))
        .slice(0, 20);
    }

    case 'columns': {
      if (!Array.isArray(raw)) return undefined;
      const catalog = (def.default as ColumnItem[]) ?? [];
      const byKey = new Map(catalog.map((c) => [c.key, c]));
      const seen = new Set<string>();
      const out: ColumnItem[] = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const key = String((item as ColumnItem).key ?? '');
        const known = byKey.get(key);
        if (!known || seen.has(key)) continue; // unknown or duplicate keys are dropped
        seen.add(key);
        out.push({
          key,
          label: typeof (item as ColumnItem).label === 'string' && (item as ColumnItem).label.trim()
            ? String((item as ColumnItem).label).slice(0, 60)
            : known.label,
          enabled: def.locked?.includes(key) ? true : Boolean((item as ColumnItem).enabled),
        });
      }
      // Anything the client omitted keeps its catalog position at the end,
      // disabled — so a stale client can never silently delete a column.
      for (const c of catalog) if (!seen.has(c.key)) out.push({ ...c, enabled: false });
      return out;
    }

    default:
      return undefined;
  }
}

/** Coerce a whole patch, dropping unknown keys and unusable values. */
export function sanitizePatch(dto: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dto ?? {})) {
    const def = FIELD_BY_KEY[k];
    if (!def) continue;
    const coerced = coerceField(def, v);
    if (coerced !== undefined) out[k] = coerced;
  }
  return out;
}

/** Merge stored values over defaults, coercing anything that drifted. */
export function resolveSettings(stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const raw = stored?.[f.key];
    const coerced = raw === undefined || raw === null ? undefined : coerceField(f, raw);
    out[f.key] = coerced === undefined ? clone(f.default) : coerced;
  }
  return out;
}

/** The full settings object a preset produces (defaults + its overrides). */
export function presetSettings(key: string): Record<string, unknown> | null {
  const preset = PRESET_BY_KEY[key];
  if (!preset) return null;
  return resolveSettings({ ...DEFAULTS, ...preset.overrides });
}

/** Every field belonging to a group — used by the per-group reset action. */
export function groupDefaults(group: GroupKey): Record<string, unknown> {
  return Object.fromEntries(
    FIELDS.filter((f) => f.group === group).map((f) => [f.key, clone(f.default)]),
  );
}
