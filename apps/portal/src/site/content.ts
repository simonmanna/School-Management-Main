/**
 * The public website's content.
 *
 * One file, deliberately. There is no CMS behind the portal, and adding one to
 * publish six pages of prose would mean a database, an editor, a permission set
 * and a review workflow for text that changes twice a year. Everything a school
 * secretary would want to change — term dates, fees guidance, the head's name, a
 * news item — is a plain object below.
 *
 * Anything genuinely dynamic (certificate verification, application status) is
 * read from the API at request time and lives in the pages, not here.
 *
 * ── Replace the entries marked TODO with the school's real details, then set
 *    VITE_SITE_CONTENT_READY=true. Until then the public routes show a neutral
 *    "website being prepared" page instead of this sample content. ──
 */

export interface NewsItem {
  slug: string;
  title: string;
  /** ISO date. Rendered with the school's locale. */
  date: string;
  category: 'News' | 'Event' | 'Notice' | 'Achievement';
  excerpt: string;
  /** Paragraphs. An array so the page never has to parse markdown. */
  body: string[];
  /** Cover photo, a key of `PHOTOS`. */
  photo: PhotoKey;
}

export interface Programme {
  key: string;
  name: string;
  ages: string;
  summary: string;
  highlights: string[];
  photo: PhotoKey;
}

/* ── Photography ──
   Every photo is self-hosted under /site/photos in two widths (`-lg` 1440px,
   `-sm` 720px WebP, ~30–180 KB), so a page never makes a third-party request
   and a phone never downloads the desktop size. The sample set is free-licence
   Unsplash photography (see public/site/photos/CREDITS.md). TODO: replace with
   the school's own photographs — same file names, and nothing else changes. */

export const PHOTOS = {
  'hero-classroom': { alt: 'A teacher at the blackboard while pupils raise their hands to answer', w: 1440, h: 960 },
  'classroom-desks': { alt: 'Pupils at wooden desks listening during a lesson', w: 1440, h: 810 },
  'classroom-full': { alt: 'A full primary classroom of pupils in green uniform', w: 1440, h: 958 },
  'pupils-writing': { alt: 'Pupils writing in their exercise books', w: 1440, h: 958 },
  'pupils-smiling': { alt: 'A smiling pupil surrounded by classmates', w: 1440, h: 958 },
  'boys-uniform': { alt: 'Two pupils in school uniform laughing together', w: 1440, h: 810 },
  'girls-uniform': { alt: 'Young pupils in green and yellow uniform smiling at the camera', w: 1440, h: 954 },
  'nursery-graduate': { alt: 'A nursery pupil in a green graduation gown and cap', w: 1440, h: 960 },
  'primary-reading': { alt: 'A teacher reading aloud to a primary class', w: 1440, h: 961 },
  'olevel-lesson': { alt: 'A teacher explaining a worked problem to secondary students', w: 1440, h: 960 },
  'alevel-maths': { alt: 'A student drawing a graph with a ruler', w: 1440, h: 960 },
  library: { alt: 'The library reading room with tall windows and study tables', w: 1440, h: 1080 },
  'girl-reading': { alt: 'A pupil sitting cross-legged, absorbed in a book', w: 1440, h: 960 },
  graduation: { alt: 'Graduates in gowns throwing their caps in the air', w: 1440, h: 960 },
  campus: { alt: 'Classroom blocks around a tree-lined courtyard', w: 1440, h: 960 },
  'campus-courtyard': { alt: 'A school building with a court in front of it', w: 1440, h: 1920 },
  'games-field': { alt: 'Children playing ball games on the grass', w: 1440, h: 997 },
  football: { alt: 'Pupils playing football on the school pitch', w: 1440, h: 2160 },
  boarding: { alt: 'A tidy boarding dormitory with bunk beds', w: 1440, h: 961 },
  music: { alt: 'Pupils seated on the floor in a music lesson', w: 1440, h: 2160 },
  friends: { alt: 'A group of pupils crowding in for a photograph', w: 1440, h: 960 },
} as const;

export type PhotoKey = keyof typeof PHOTOS;

const env = import.meta.env;

export const SITE = {
  /** Shares `VITE_SCHOOL_NAME` with the portal header so the two never disagree. */
  name: (env.VITE_SCHOOL_NAME as string | undefined) ?? 'Sunrise Academy',
  shortName: (env.VITE_SCHOOL_SHORT_NAME as string | undefined) ?? 'Sunrise',
  tagline: 'Learning that lasts a lifetime',
  /** One sentence. Used in the hero, the footer and the document description. */
  intro:
    'A day and boarding school in Kampala educating pupils from nursery through A-Level, with small classes, steady pastoral care and results that open doors.',
  motto: 'Knowledge · Character · Service',
  foundedYear: 1998,

  contact: {
    // TODO: the school's real address, numbers and inbox.
    addressLines: ['Plot 42, Kira Road', 'Nakawa Division', 'Kampala, Uganda'],
    phone: '+250 790 600 100',
    /** Same line as `phone`; linked via wa.me, which wants digits only. */
    whatsapp: '+250 790 600 100',
    email: 'info@sunriseacademy.ac.ug',
    admissionsEmail: 'admissions@sunriseacademy.ac.ug',
    officeHours: [
      { days: 'Monday – Friday', hours: '7:30 am – 5:00 pm' },
      { days: 'Saturday', hours: '8:00 am – 1:00 pm' },
      { days: 'Sunday & public holidays', hours: 'Closed' },
    ],
    /** A link, not an embed: an embedded map loads a third-party script on every page view. */
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kira+Road+Kampala',
  },

  social: [
    { label: 'Facebook', href: '#' },
    { label: 'X', href: '#' },
    { label: 'YouTube', href: '#' },
  ],
} as const;

/** The four numbers a parent scans for in the first five seconds. */
export const STATS: Array<{ value: string; label: string; sub: string }> = [
  { value: '1,240', label: 'Pupils enrolled', sub: 'Nursery to A-Level' },
  { value: '1:18', label: 'Teacher to pupil', sub: 'Across all classes' },
  { value: '98%', label: 'UNEB pass rate', sub: '2025 candidates' },
  {
    value: `${new Date().getFullYear() - SITE.foundedYear}`,
    label: 'Years teaching',
    sub: `Founded ${SITE.foundedYear}`,
  },
];

export const PROGRAMMES: Programme[] = [
  {
    key: 'nursery',
    name: 'Nursery',
    ages: 'Ages 3 – 5',
    summary:
      'Baby, Middle and Top class. Play-led literacy and numeracy, in a room a small child is happy to be left in.',
    highlights: ['Baby, Middle, Top', 'Daily reading circle', 'Structured play', 'Termly progress meeting'],
    photo: 'nursery-graduate',
  },
  {
    key: 'primary',
    name: 'Primary',
    ages: 'P1 – P7',
    summary:
      'The national primary curriculum, taught in classes small enough that no child sits at the back unnoticed.',
    highlights: ['Thematic curriculum P1–P3', 'Full subjects P4–P7', 'PLE preparation', 'Weekly reading assessment'],
    photo: 'primary-reading',
  },
  {
    key: 'olevel',
    name: 'Ordinary Level',
    ages: 'S1 – S4',
    summary:
      'The lower secondary competency-based curriculum, with sciences taught in equipped laboratories from S1.',
    highlights: ['Competency-based curriculum', 'Three science laboratories', 'ICT from S1', 'UCE candidature'],
    photo: 'olevel-lesson',
  },
  {
    key: 'alevel',
    name: 'Advanced Level',
    ages: 'S5 – S6',
    summary: 'Science, arts and mixed combinations, with careers guidance that starts before subjects are chosen.',
    highlights: ['PCM · PCB · BCM · HEG · MEG', 'Sub-ICT and General Paper', 'University guidance', 'UACE candidature'],
    photo: 'alevel-maths',
  },
];

export const WHY_US: Array<{ title: string; body: string }> = [
  {
    title: 'Small classes, named teachers',
    body: 'Every class has a class teacher who knows the child by name and a guardian contact they actually answer. Nothing about a pupil goes a full term unnoticed.',
  },
  {
    title: 'Results you can check',
    body: 'Marks reach the parent portal as they are approved — not in a printed slip at the end of term, when it is too late to act on them.',
  },
  {
    title: 'Fees without surprises',
    body: 'The full fee structure is published before the term begins, and every payment, balance and receipt is visible to guardians online at any hour.',
  },
  {
    title: 'Safe day and boarding',
    body: 'Supervised boarding houses, a resident nurse, gated grounds and a signed-in visitor policy. Attendance is taken every period, not just at the gate.',
  },
  {
    title: 'Beyond the timetable',
    body: 'Music, debate, football, netball, swimming, coding club and scouting. Every pupil takes at least one, because a report card is not the whole child.',
  },
  {
    title: 'A school that answers',
    body: 'One office line, one inbox, one portal thread per family — and a rule that nothing from a guardian waits more than two working days.',
  },
];

/** Shown on Admissions. The steps a family actually walks through. */
export const ADMISSION_STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Enquire',
    body: 'Call the admissions office or send the enquiry form. We will tell you honestly whether there is a place in the class you want.',
  },
  {
    title: 'Visit',
    body: 'Come and see a normal school day — not an open day. Tours run on weekday mornings during term, by appointment.',
  },
  {
    title: 'Apply',
    body: 'Collect or request an application form. Return it with a birth certificate copy, the last two report cards and two passport photographs.',
  },
  {
    title: 'Assessment',
    body: 'Pupils joining P4 and above sit a short placement assessment in English and Mathematics. It sets the class; it is not a gate.',
  },
  {
    title: 'Offer',
    body: 'Successful applicants receive an offer letter with the fee structure and a deadline. Offers can be accepted online.',
  },
  {
    title: 'Enrol',
    body: 'Pay the acceptance deposit and collect the joining pack: uniform list, booklist, term dates and the portal invite.',
  },
];

export const ADMISSION_REQUIREMENTS: string[] = [
  'Completed application form',
  'Copy of the birth certificate',
  'Last two school report cards (P4 and above)',
  'Two recent passport photographs',
  'Transfer or leaving letter from the previous school',
  'Immunisation record (nursery and lower primary)',
];

export const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'When can my child join?',
    a: 'Any term, if there is a place. Most families join at the start of Term 1 in February, but mid-year transfers are common and we hold a small number of places for them.',
  },
  {
    q: 'Do you offer boarding?',
    a: 'Yes, from P5 upwards. Boarding houses are single-sex, supervised overnight by resident matrons, with a nurse resident on the campus.',
  },
  {
    q: 'How are fees paid?',
    a: 'By bank deposit or mobile money to the school account. Every payment appears on the parent portal with a receipt, usually within the hour.',
  },
  {
    q: 'Is there transport?',
    a: 'School buses run fixed routes across Kampala and Wakiso. Transport is an optional fee, added only for pupils who use it.',
  },
  {
    q: 'What if my child needs extra help?',
    a: 'Tell us at application. We run supervised prep, subject clinics and, where needed, an individual learning plan agreed with the guardian each term.',
  },
  {
    q: 'How do I get portal access?',
    a: 'The school office creates the account against your child’s record and emails you an invite. Accounts are never self-created — that is what stops anyone claiming to be somebody’s parent.',
  },
];

/** Newest first. */
export const NEWS: NewsItem[] = [
  {
    slug: 'term-three-opens',
    title: 'Term 3 opens on 14 September',
    date: '2026-08-24',
    category: 'Notice',
    excerpt: 'Reporting times by section, the boarders’ packing list, and the fee deadline for the term.',
    body: [
      'Term 3 begins on Monday 14 September. Day pupils report by 7:20 am. Boarders report on Sunday 13 September between 2:00 pm and 6:00 pm; the packing list is available from the office and on the parent portal.',
      'Fees for the term fall due on Friday 25 September. Guardians can see the exact amount, any balance carried forward and every receipt on the portal, rather than waiting for a printed statement.',
      'Class teachers will hold a short introductory meeting for each class in the first week. Times go out by SMS and are posted on the portal.',
    ],
    photo: 'classroom-full',
  },
  {
    slug: 'uneb-2025-results',
    title: '2025 candidates post the school’s best UNEB results',
    date: '2026-08-11',
    category: 'Achievement',
    excerpt:
      '98% of candidates passed, with 41 first grades at UCE and every A-Level candidate qualifying for university entry.',
    body: [
      'The 2025 cohort has recorded the strongest results in the school’s history. At UCE, 41 candidates earned first grades and 98% passed overall. Every A-Level candidate met the minimum university entry requirement.',
      'The sciences carried the year: Physics, Chemistry and Biology each improved on 2024, which the department credits to laboratory time being timetabled rather than borrowed.',
      'Result slips are available from the office and on each pupil’s portal account.',
    ],
    photo: 'graduation',
  },
  {
    slug: 'science-laboratory-opens',
    title: 'Third science laboratory opens',
    date: '2026-07-02',
    category: 'News',
    excerpt: 'A dedicated Physics laboratory frees the shared room for Biology practicals from S1.',
    body: [
      'The new Physics laboratory opened at the start of Term 2, taking pressure off the shared science room and letting practicals be timetabled for every stream from S1 rather than only for candidate classes.',
      'The room seats 40 at 20 benches, with a preparation room and a lockable chemical store to the standard required of UNEB practical centres.',
    ],
    photo: 'pupils-writing',
  },
  {
    slug: 'inter-house-sports',
    title: 'Inter-house sports gala — 3 October',
    date: '2026-06-19',
    category: 'Event',
    excerpt: 'Athletics, football, netball and swimming across a single day. Guardians welcome from 8:00 am.',
    body: [
      'The annual inter-house gala runs on Saturday 3 October, from 8:00 am to 4:00 pm on the school field and in the pool.',
      'Guardians are welcome for the whole day. Parking is on the lower field and the canteen will be open. Pupils compete in house colours; kit lists have gone out through class teachers.',
    ],
    photo: 'games-field',
  },
  {
    slug: 'parent-portal-launch',
    title: 'Parent portal: results, attendance and fees online',
    date: '2026-05-08',
    category: 'News',
    excerpt: 'Every guardian now has an account showing their child’s marks, daily attendance and fee balance.',
    body: [
      'The parent portal is live for every family. Signing in shows each child’s published results, their attendance record day by day, the current fee balance and every receipt against it.',
      'Accounts are created by the school office against your child’s record and sent to the email address we hold for you. If the invite has not arrived, check the address on file with the office — we cannot create an account from a request alone.',
      'The portal works in any phone browser and can be added to the home screen like an app.',
    ],
    photo: 'boys-uniform',
  },
];

/** Term dates: the single most-requested item on any school website. */
export const TERM_DATES: Array<{ term: string; opens: string; closes: string; note?: string }> = [
  {
    term: 'Term 3, 2026',
    opens: '14 September 2026',
    closes: '4 December 2026',
    note: 'Candidate classes sit UNEB from October',
  },
  { term: 'Term 1, 2027', opens: '1 February 2027', closes: '30 April 2027' },
  { term: 'Term 2, 2027', opens: '24 May 2027', closes: '20 August 2027' },
];

/** TODO: replace with the school's actual leadership. */
export const LEADERSHIP: Array<{ name: string; role: string; blurb: string }> = [
  { name: 'Head Teacher', role: 'Head of School', blurb: 'Leads the academic programme and chairs the admissions panel.' },
  {
    name: 'Deputy Head, Academics',
    role: 'Deputy Head',
    blurb: 'Responsible for the timetable, examinations and departmental standards.',
  },
  { name: 'Director of Studies', role: 'Academics', blurb: 'Oversees assessment, marks approval and reporting to guardians.' },
  { name: 'School Bursar', role: 'Finance', blurb: 'Fee structures, invoicing, receipts and the fees helpdesk.' },
];

/** The three doors into the portal, described in the words each audience uses. */
export const PORTAL_AUDIENCES = [
  {
    key: 'parent' as const,
    title: 'Parents & guardians',
    body: 'Your child’s fee balance and receipts, their attendance day by day, and results the moment they are published.',
    points: [
      'Fee balance and payment history',
      'Daily attendance record',
      'Published results and report cards',
      'Switch between your children',
    ],
  },
  {
    key: 'student' as const,
    title: 'Students',
    body: 'Your timetable, your courses, your marks and your attendance — on the phone in your pocket.',
    points: ['Today’s lessons', 'Course materials and assignments', 'Your published results', 'Your attendance record'],
  },
  {
    key: 'teacher' as const,
    title: 'Teachers',
    body: 'Take the register, enter marks and see your classes without opening the back-office system.',
    points: ['Daily class register', 'Marks entry for your classes', 'Class lists and profiles', 'Your teaching timetable'],
  },
];

/** The head's welcome, on the home page and About. TODO: the real head's words and name. */
export const HEAD_MESSAGE = {
  name: 'The Head Teacher',
  role: `Head of School, ${SITE.name}`,
  photo: 'friends' as PhotoKey,
  paragraphs: [
    'Thank you for taking the time to look at our school. Whether you are a family thinking about joining us or a guardian checking on next week, you are welcome here.',
    'We are a school of ordinary days done well: lessons that start on time, homework that is marked, and adults who notice when a child is not themselves. Results follow from that, and so does confidence.',
    'The best way to know us is to visit on a normal morning. Walk the corridors, sit at the back of a lesson, and ask the pupils what they think. We will be glad to show you round.',
  ],
};

/** Words from families and former pupils. TODO: real, consented quotes. */
export const TESTIMONIALS: Array<{ quote: string; name: string; role: string }> = [
  {
    quote:
      'Our daughter joined in P4 barely reading. By P6 she was borrowing two library books a week. Her class teacher called us before we ever had to call her.',
    name: 'A Primary parent',
    role: 'Guardian of a P6 pupil',
  },
  {
    quote:
      'I can see the fee balance and the marks on my phone the same week they are entered. I no longer find out about a problem at the end of term.',
    name: 'A Secondary guardian',
    role: 'Guardian of two S3 students',
  },
  {
    quote:
      'The science teachers gave up their Saturdays before UACE. I am now studying medicine, and I still message my Biology teacher my results.',
    name: 'A former student',
    role: 'Class of 2024, PCB',
  },
];

/** The campus, with a photo each. Shown on Academics and the home page. */
export const FACILITIES: Array<{ title: string; body: string; photo: PhotoKey }> = [
  {
    title: 'Library & reading room',
    body: 'Over 8,000 titles, daily reading periods for primary classes and a quiet study room open until evening prep for boarders.',
    photo: 'library',
  },
  {
    title: 'Science & ICT',
    body: 'Physics, Chemistry and Biology laboratories to UNEB practical-centre standard, and a 40-seat computer lab used from P5.',
    photo: 'pupils-writing',
  },
  {
    title: 'Field, courts & pool',
    body: 'A full football pitch, netball and volleyball courts, an athletics track and a supervised swimming pool.',
    photo: 'games-field',
  },
  {
    title: 'Boarding houses',
    body: 'Single-sex houses from P5, each with a resident matron, supervised prep, and a nurse on campus day and night.',
    photo: 'boarding',
  },
  {
    title: 'Music & performing arts',
    body: 'A music room with instruments to borrow, a school choir, traditional dance troupe and an annual drama production.',
    photo: 'music',
  },
  {
    title: 'A green, gated campus',
    body: 'Classroom blocks around shaded courtyards, a single staffed gate and a signed-in visitor policy.',
    photo: 'campus',
  },
];

/** Clubs and activities — every pupil takes at least one. */
export const ACTIVITIES: string[] = [
  'Football', 'Netball', 'Athletics', 'Swimming', 'Volleyball', 'Chess',
  'Debate & public speaking', 'Choir', 'Traditional dance', 'Drama', 'Coding club',
  'Science club', 'Scouts & Guides', 'Writers’ club', 'Environment club', 'Red Cross',
];

export type GalleryCategory = 'Classroom' | 'Campus' | 'Sport & arts' | 'Celebrations';

/** The gallery page, in display order. */
export const GALLERY: Array<{ photo: PhotoKey; category: GalleryCategory; caption: string }> = [
  { photo: 'hero-classroom', category: 'Classroom', caption: 'Hands up in a P5 English lesson' },
  { photo: 'girls-uniform', category: 'Campus', caption: 'Lower primary at morning break' },
  { photo: 'football', category: 'Sport & arts', caption: 'Junior football training' },
  { photo: 'library', category: 'Campus', caption: 'The library reading room' },
  { photo: 'graduation', category: 'Celebrations', caption: 'Senior Six graduation day' },
  { photo: 'pupils-writing', category: 'Classroom', caption: 'Silent writing, P6' },
  { photo: 'music', category: 'Sport & arts', caption: 'Music lesson in the arts block' },
  { photo: 'nursery-graduate', category: 'Celebrations', caption: 'Top class graduation' },
  { photo: 'campus', category: 'Campus', caption: 'The main classroom courtyard' },
  { photo: 'olevel-lesson', category: 'Classroom', caption: 'S2 Mathematics' },
  { photo: 'games-field', category: 'Sport & arts', caption: 'Games afternoon' },
  { photo: 'friends', category: 'Celebrations', caption: 'Inter-house gala, 2025' },
  { photo: 'classroom-desks', category: 'Classroom', caption: 'P7 revision before PLE' },
  { photo: 'girl-reading', category: 'Classroom', caption: 'Reading period' },
  { photo: 'boarding', category: 'Campus', caption: 'A girls’ boarding house' },
  { photo: 'campus-courtyard', category: 'Campus', caption: 'Courts behind the secondary block' },
  { photo: 'boys-uniform', category: 'Celebrations', caption: 'First day of term' },
  { photo: 'alevel-maths', category: 'Classroom', caption: 'Graph work, S5' },
];
