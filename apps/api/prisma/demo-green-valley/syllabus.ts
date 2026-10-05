/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — curriculum content for a Ugandan nursery and primary school
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The topics a term is taught, per grade and subject, following the shape of
 * the NCDC curriculum: nursery learning areas, the P1–P3 thematic curriculum
 * (Literacy I/II and Numeracy move through the same themes), and subject-based
 * P4–P7 leading to the PLE.
 *
 * Upper-primary Term 3 uses the LMS stage's `SYLLABUS`, so the curriculum, the
 * course pages, the schemes of work and the lesson plans all name the same six
 * topics and cannot drift.
 */
import { SYLLABUS } from './07-lms';

/** Topics per term: [Term 1, Term 2, Term 3]. */
type ByTerm = [string[], string[], string[]];

const THEMES: Record<string, ByTerm> = {
  P1: [
    ['Our school', 'Our home', 'Our community'],
    ['Our human body and health', 'Our environment', 'Weather'],
    ['Accidents and safety', 'Living together', 'Food and nutrition'],
  ],
  P2: [
    ['Our school and neighbourhood', 'Our home', 'Our community'],
    ['Our environment', 'Our health', 'Weather in our sub-county'],
    ['Living together', 'Transport in our community', 'Peace and security'],
  ],
  P3: [
    ['Our sub-county', 'Livelihood in our sub-county', 'Our environment'],
    ['Managing resources', 'Health in our sub-county', 'Culture and gender'],
    ['Population and resources', 'Transport and communication', 'Leadership in our sub-county'],
  ],
};

const NUMERACY: Record<string, ByTerm> = {
  P1: [['Sets', 'Numbers 0–20', 'Addition up to 10'], ['Subtraction up to 10', 'Numbers 0–50', 'Shapes'], ['Measures: length', 'Money (coins)', 'Addition and subtraction up to 50']],
  P2: [['Sets and set notation', 'Numbers to 999', 'Place value'], ['Addition with carrying', 'Subtraction with borrowing', 'Multiplication tables 2–5'], ['Fractions: halves and quarters', 'Time: the clock', 'Money: shopping sums']],
  P3: [['Sets: union and intersection', 'Numbers to 9 999', 'Operations on numbers'], ['Multiplication and division', 'Fractions', 'Measures: mass and capacity'], ['Time and calendar', 'Money', 'Geometry: shapes and lines']],
};

const UPPER: Record<string, Record<string, [string[], string[]]>> = {
  MTC: {
    P4: [['Sets', 'Whole numbers to 100 000', 'Operations on whole numbers'], ['Fractions: halves to tenths', 'Measures: money and time', 'Lines, angles and shapes']],
    P5: [['Set concepts', 'Numeration systems and bases', 'Operations on whole numbers'], ['Number patterns and sequences', 'Integers', 'Measures: time and money']],
    P6: [['Sets and Venn diagrams', 'Place value to millions', 'LCM, HCF and number patterns'], ['Integers', 'Algebra: simplifying expressions', 'Ratio and proportion']],
    P7: [['Set concepts and probability', 'Numeration and bases', 'Operations and BODMAS'], ['Algebra and equations', 'Speed, distance and time', 'Simple interest and business maths']],
  },
  ENG: {
    P4: [['Living together', 'Our environment', 'Time'], ['Shopping', 'Health', 'Communication']],
    P5: [['Communication', 'Accidents', 'Hygiene and sanitation'], ['Culture', 'Leisure', 'Friendly letters']],
    P6: [['Debating', 'Electronic media', 'Banking'], ['Examinations', 'Rights and responsibilities', 'Formal letters']],
    P7: [['Examinations', 'Debating', 'Rights and responsibilities'], ['Culture and ceremonies', 'Electronic media', 'Letter writing and invitations']],
  },
  SCI: {
    P4: [['Classification of living things', 'Personal hygiene', 'Weather changes'], ['Sanitation', 'Crop growing', 'Animal and plant life']],
    P5: [['Measurement', 'Changes in our environment', 'Teeth and their care'], ['Keeping poultry and bees', 'Alcohol, smoking and drug abuse', 'Plant life']],
    P6: [['Vertebrates', 'The muscular and skeletal system', 'Sound energy'], ['Crop growing', 'Primary health care', 'Heat energy']],
    P7: [['Light energy', 'Electricity and magnetism', 'The excretory system'], ['Population and health', 'Simple machines and friction', 'The circulatory system']],
  },
  SST: {
    P4: [['Location of our district', 'Physical features of our district', 'Vegetation in our district'], ['People in our district', 'Leaders in our district', 'Social services in our district']],
    P5: [['Location of Uganda', 'Physical features of Uganda', 'Climate of Uganda'], ['Vegetation of Uganda', 'Natural resources of Uganda', 'The people of Uganda']],
    P6: [['Location of East Africa', 'Physical features of East Africa', 'Climate of East Africa'], ['Natural resources of East Africa', 'Foreign influence in East Africa', 'Nationalism and independence']],
    P7: [['Location of Africa', 'Physical features of Africa', 'Climate and vegetation of Africa'], ['Foreign influence in Africa', 'Nationalism in Africa', 'The Commonwealth and the African Union']],
  },
};

/** One topic per term for the subjects taught but not examined, and for nursery. */
const ONE_PER_TERM: Record<string, [string, string, string]> = {
  RE: ['God’s creation', 'The family and the community', 'Prayer, worship and festivals'],
  KIS: ['Salamu na maamkizi (greetings)', 'Familia yangu (my family)', 'Shuleni na nyumbani (school and home)'],
  ICT: ['Parts of a computer', 'Using the mouse and keyboard', 'Typing, saving and printing work'],
  PE: ['Athletics: running and jumping', 'Ball games: football and netball', 'Gymnastics and traditional games'],
  MDD: ['Singing and rhythm', 'Traditional dances of Uganda', 'Drama and mime'],
  ART: ['Drawing and colouring', 'Modelling with clay', 'Weaving and crafts'],
  'LANG-DEV': ['Listening and speaking', 'Pre-reading: sounds and pictures', 'Pre-writing: patterns and letters'],
  'NUM-CONC': ['Sorting and matching', 'Counting 1–10', 'Shapes and sizes'],
  'ENV-AWARE': ['Myself and my family', 'Our school and home', 'Animals and plants around us'],
  CREATIVE: ['Colouring and painting', 'Songs, rhymes and stories', 'Modelling and printing'],
  'PHYS-DEV': ['Running, jumping and balancing', 'Throwing and catching', 'Fine motor skills: threading and tearing'],
  'SOC-EMO': ['Sharing and taking turns', 'Self-care and hygiene', 'Expressing feelings'],
};

/** Topics for a subject in a grade, per term. Empty when the grade does not take it. */
export function topicsFor(gradeCode: string, subjectCode: string): ByTerm {
  if (subjectCode === 'NUM') return NUMERACY[gradeCode] ?? [[], [], []];
  if (subjectCode === 'LIT1' || subjectCode === 'LIT2') return THEMES[gradeCode] ?? [[], [], []];
  const upper = UPPER[subjectCode]?.[gradeCode];
  if (upper) return [upper[0], upper[1], (SYLLABUS[subjectCode] ?? []).map((w) => w.topic)];
  const one = ONE_PER_TERM[subjectCode];
  return one ? [[one[0]], [one[1]], [one[2]]] : [[], [], []];
}

/** The Term 3 syllabus objectives for a topic, where the LMS stage defined them. */
export function syllabusObjectives(subjectCode: string, topic: string): string[] {
  return SYLLABUS[subjectCode]?.find((w) => w.topic === topic)?.objectives ?? [];
}

/**
 * The strands a subject's competencies are grouped into. A topic belongs to
 * the strand at its index, so every competency has topics under it.
 */
export const STRANDS: Record<string, Array<{ code: string; description: string }>> = {
  MTC: [
    { code: 'NUM', description: 'Numeracy and number sense' },
    { code: 'OPS', description: 'Operations and problem solving' },
    { code: 'MEAS', description: 'Measurement, geometry and data' },
  ],
  ENG: [
    { code: 'LIS', description: 'Listening and speaking' },
    { code: 'READ', description: 'Reading and comprehension' },
    { code: 'WRITE', description: 'Writing and grammar' },
  ],
  SCI: [
    { code: 'INQ', description: 'Scientific inquiry and investigation' },
    { code: 'HEALTH', description: 'Health and the human body' },
    { code: 'ENV', description: 'The environment, energy and technology' },
  ],
  SST: [
    { code: 'GEO', description: 'Location and physical environment' },
    { code: 'HIST', description: 'History and heritage' },
    { code: 'CIV', description: 'Citizenship, leadership and rights' },
  ],
  LIT1: [
    { code: 'ORAL', description: 'Oral literacy in the local language' },
    { code: 'READ', description: 'Reading in the local language' },
  ],
  LIT2: [
    { code: 'ORAL', description: 'Listening and speaking English' },
    { code: 'RW', description: 'Reading and writing English' },
  ],
  NUM: [
    { code: 'NUM', description: 'Number and counting' },
    { code: 'OPS', description: 'Operations on numbers' },
    { code: 'MEAS', description: 'Measures, money and shapes' },
  ],
};

/** Two learning outcomes per topic, phrased the way an NCDC scheme phrases them. */
export function outcomesFor(subjectCode: string, topic: string): string[] {
  const t = topic.replace(/^[A-Z]/, (c) => c.toLowerCase());
  switch (subjectCode) {
    case 'MTC':
    case 'NUM':
      return [`Works out and explains problems involving ${t}`, `Applies ${t} to real-life situations at home and in the market`];
    case 'ENG':
      return [`Uses vocabulary and structures related to ${t} correctly`, `Reads and writes short texts about ${t}`];
    case 'SCI':
      return [`Explains the key ideas of ${t}`, `Carries out simple activities and observations on ${t}`];
    case 'SST':
      return [`Describes ${t}`, `Relates ${t} to everyday life in Uganda`];
    case 'LIT1':
      return [`Talks about ${t} in the local language`, `Reads and writes simple words and sentences about ${t}`];
    case 'LIT2':
      return [`Listens and responds in English about ${t}`, `Reads and writes simple English sentences about ${t}`];
    default:
      return [`Shows understanding of ${t}`, `Takes part confidently in activities on ${t}`];
  }
}
