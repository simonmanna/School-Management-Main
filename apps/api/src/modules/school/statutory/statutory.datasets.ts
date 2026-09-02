/**
 * The column vocabulary a statutory export template may draw on.
 *
 * A template chooses and renames fields; it never carries a query. That is the
 * whole point of the registry: a school can rebuild the layout when UNEB moves
 * a column without anyone shipping a release, and it still cannot invent a
 * field, reach into another tenant's data, or emit a mark that has not been
 * approved — because the dataset builder decided what a row contains before
 * the template ever saw it.
 */

/** One selectable field, and what it means on the row. */
export interface DatasetField {
  /** Stable key a template's `source` refers to. Never renamed once shipped. */
  key: string;
  /** What a school administrator sees when picking columns. */
  label: string;
  /** 'string' | 'number' | 'date' | 'boolean' — drives formatting, not validation. */
  type: 'string' | 'number' | 'date' | 'boolean';
  /** Notes shown beside the field in the template designer. */
  hint?: string;
}

export interface DatasetDefinition {
  scope: string;
  name: string;
  description: string;
  /** Which filters the dataset builder honours. */
  filters: Array<'termId' | 'academicYearId' | 'examId' | 'programmeId' | 'classIds' | 'level' | 'registrationYear'>;
  fields: DatasetField[];
}

/**
 * `uneb_ca` — one row per candidate per subject, which is the shape UNEB's
 * continuous-assessment submission takes: Subject Achievement, Activities of
 * Integration and project work are separate scores against the same candidate.
 */
const UNEB_CA: DatasetDefinition = {
  scope: 'uneb_ca',
  name: 'UNEB continuous assessment',
  description:
    'One row per candidate per subject: candidate reference, subject achievement, activities of integration and project scores for the selected term.',
  filters: ['termId', 'programmeId', 'classIds', 'level', 'registrationYear'],
  fields: [
    { key: 'centreNumber', label: 'Centre number', type: 'string' },
    { key: 'candidateNumber', label: 'Candidate number', type: 'string' },
    { key: 'indexNumber', label: 'Index number', type: 'string', hint: 'Blank until the board issues it.' },
    { key: 'studentName', label: 'Candidate name', type: 'string' },
    { key: 'surname', label: 'Surname', type: 'string', hint: 'First token of the recorded name.' },
    { key: 'otherNames', label: 'Other names', type: 'string' },
    { key: 'sex', label: 'Sex', type: 'string', hint: 'M / F as recorded on the learner profile.' },
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { key: 'className', label: 'Class', type: 'string' },
    { key: 'streamName', label: 'Stream', type: 'string' },
    { key: 'subjectCode', label: 'Subject code', type: 'string' },
    { key: 'subjectName', label: 'Subject', type: 'string' },
    { key: 'subjectAchievement', label: 'Subject achievement score', type: 'number' },
    { key: 'activityOfIntegration', label: 'Activity of integration score', type: 'number' },
    { key: 'projectScore', label: 'Project work score', type: 'number' },
    { key: 'caTotal', label: 'CA total', type: 'number' },
    { key: 'caPercent', label: 'CA percent', type: 'number' },
    { key: 'assessmentCount', label: 'Assessments counted', type: 'number' },
    { key: 'termName', label: 'Term', type: 'string' },
    { key: 'academicYear', label: 'Academic year', type: 'string' },
  ],
};

/** `candidate_register` — the registration nominal roll, one row per candidate. */
const CANDIDATE_REGISTER: DatasetDefinition = {
  scope: 'candidate_register',
  name: 'Candidate register',
  description: 'One row per registered candidate: the nominal roll a centre submits before a sitting.',
  filters: ['programmeId', 'classIds', 'level', 'registrationYear'],
  fields: [
    { key: 'centreNumber', label: 'Centre number', type: 'string' },
    { key: 'candidateNumber', label: 'Candidate number', type: 'string' },
    { key: 'indexNumber', label: 'Index number', type: 'string' },
    { key: 'studentName', label: 'Candidate name', type: 'string' },
    { key: 'surname', label: 'Surname', type: 'string' },
    { key: 'otherNames', label: 'Other names', type: 'string' },
    { key: 'sex', label: 'Sex', type: 'string' },
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { key: 'admissionNo', label: 'Admission number', type: 'string' },
    { key: 'className', label: 'Class', type: 'string' },
    { key: 'streamName', label: 'Stream', type: 'string' },
    { key: 'programmeCode', label: 'Programme', type: 'string' },
    { key: 'referenceStatus', label: 'Reference status', type: 'string' },
    { key: 'registrationYear', label: 'Registration year', type: 'number' },
  ],
};

/** `results_summary` — one row per learner per published term result. */
const RESULTS_SUMMARY: DatasetDefinition = {
  scope: 'results_summary',
  name: 'Published results summary',
  description:
    'One row per learner from a published result set: aggregate, division, mean and rank. Draft and unpublished results are never included.',
  filters: ['termId', 'classIds', 'programmeId'],
  fields: [
    { key: 'studentName', label: 'Learner name', type: 'string' },
    { key: 'admissionNo', label: 'Admission number', type: 'string' },
    { key: 'candidateNumber', label: 'Candidate number', type: 'string' },
    { key: 'className', label: 'Class', type: 'string' },
    { key: 'streamName', label: 'Stream', type: 'string' },
    { key: 'termName', label: 'Term', type: 'string' },
    { key: 'meanPercent', label: 'Mean percent', type: 'number' },
    { key: 'aggregate', label: 'Aggregate', type: 'number' },
    { key: 'division', label: 'Division', type: 'string' },
    { key: 'gpa', label: 'GPA', type: 'number' },
    { key: 'classRank', label: 'Class position', type: 'number' },
    { key: 'promotionRecommendation', label: 'Promotion recommendation', type: 'string' },
    { key: 'resultSetRevision', label: 'Result revision', type: 'number' },
    { key: 'publishedAt', label: 'Published at', type: 'date' },
  ],
};

export const STATUTORY_DATASETS: Record<string, DatasetDefinition> = {
  [UNEB_CA.scope]: UNEB_CA,
  [CANDIDATE_REGISTER.scope]: CANDIDATE_REGISTER,
  [RESULTS_SUMMARY.scope]: RESULTS_SUMMARY,
};

export const STATUTORY_SCOPES = Object.keys(STATUTORY_DATASETS);

/** Value transforms a column may apply. Deliberately few and total. */
export const COLUMN_TRANSFORMS = ['none', 'upper', 'lower', 'trim', 'date_ddmmyyyy', 'date_iso', 'integer', 'one_decimal'] as const;
export type ColumnTransform = (typeof COLUMN_TRANSFORMS)[number];

export interface TemplateColumn {
  header: string;
  source: string;
  required?: boolean;
  fallback?: string;
  transform?: ColumnTransform;
}

/**
 * Uganda default templates, seeded per organisation on first use.
 *
 * These are a starting layout, not a specification: a school edits them when
 * the board's circular changes, and the version bump keeps every past
 * submission readable under the layout it was produced with.
 */
export const DEFAULT_TEMPLATES: Array<{
  code: string;
  name: string;
  description: string;
  board: string;
  level: string | null;
  scope: string;
  columns: TemplateColumn[];
}> = [
  {
    code: 'UNEB_UCE_CA',
    name: 'UNEB UCE continuous assessment',
    description: 'Subject achievement, activities of integration and project scores for S3/S4 candidates.',
    board: 'UNEB',
    level: 'UCE',
    scope: 'uneb_ca',
    columns: [
      { header: 'CENTRE_NO', source: 'centreNumber', required: true, transform: 'upper' },
      { header: 'CANDIDATE_NO', source: 'candidateNumber', required: true, transform: 'upper' },
      { header: 'INDEX_NO', source: 'indexNumber', transform: 'upper' },
      { header: 'SURNAME', source: 'surname', required: true, transform: 'upper' },
      { header: 'OTHER_NAMES', source: 'otherNames', transform: 'upper' },
      { header: 'SEX', source: 'sex', fallback: 'U', transform: 'upper' },
      { header: 'SUBJECT_CODE', source: 'subjectCode', required: true, transform: 'upper' },
      { header: 'SUBJECT_ACHIEVEMENT', source: 'subjectAchievement', transform: 'one_decimal' },
      { header: 'ACTIVITY_OF_INTEGRATION', source: 'activityOfIntegration', transform: 'one_decimal' },
      { header: 'PROJECT', source: 'projectScore', transform: 'one_decimal' },
      { header: 'CA_TOTAL', source: 'caTotal', transform: 'one_decimal' },
    ],
  },
  {
    code: 'UNEB_PLE_REGISTER',
    name: 'UNEB PLE candidate register',
    description: 'Nominal roll for a P7 sitting.',
    board: 'UNEB',
    level: 'PLE',
    scope: 'candidate_register',
    columns: [
      { header: 'CENTRE_NO', source: 'centreNumber', required: true, transform: 'upper' },
      { header: 'CANDIDATE_NO', source: 'candidateNumber', required: true, transform: 'upper' },
      { header: 'SURNAME', source: 'surname', required: true, transform: 'upper' },
      { header: 'OTHER_NAMES', source: 'otherNames', transform: 'upper' },
      { header: 'SEX', source: 'sex', fallback: 'U', transform: 'upper' },
      { header: 'DATE_OF_BIRTH', source: 'dateOfBirth', transform: 'date_ddmmyyyy' },
      { header: 'CLASS', source: 'className' },
    ],
  },
  {
    code: 'INTERNAL_RESULTS_SUMMARY',
    name: 'Internal results summary',
    description: 'Published term results for the school’s own records and the district return.',
    board: 'INTERNAL',
    level: null,
    scope: 'results_summary',
    columns: [
      { header: 'ADMISSION_NO', source: 'admissionNo', required: true },
      { header: 'NAME', source: 'studentName', required: true },
      { header: 'CLASS', source: 'className' },
      { header: 'STREAM', source: 'streamName' },
      { header: 'MEAN_PERCENT', source: 'meanPercent', transform: 'one_decimal' },
      { header: 'AGGREGATE', source: 'aggregate', transform: 'integer' },
      { header: 'DIVISION', source: 'division' },
      { header: 'POSITION', source: 'classRank', transform: 'integer' },
    ],
  },
];
