/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The demographic pools the admissions demo draws applicants from, shaped like a
 * Ugandan nursery-and-primary day school in the Kampala–Wakiso belt.
 *
 * Nothing here names a real child, parent, school or telephone subscriber. The
 * surnames are common across Uganda, the given names are the ones a 2020s
 * register is actually full of, the neighbourhoods are real places (so a head
 * teacher recognises the catchment at a glance) and every previous school is
 * invented.
 *
 * All of it is consumed through `rng()` from ../shared, so the same applicant
 * gets the same guardian, village, occupation and marks on every run.
 */

/* ───────────────────────────── Applicant names ───────────────────────────── */

export const GIRL_NAMES = [
  'Abigail', 'Agnes', 'Amina', 'Annet', 'Brenda', 'Catherine', 'Daphine', 'Dorcus',
  'Esther', 'Faith', 'Gloria', 'Grace', 'Hadijah', 'Harriet', 'Immaculate', 'Joan',
  'Joy', 'Juliet', 'Kevina', 'Leticia', 'Linda', 'Mercy', 'Miriam', 'Nancy',
  'Patience', 'Phiona', 'Prossy', 'Rebecca', 'Ritah', 'Sandra', 'Sharon', 'Shamim',
  'Sheila', 'Stella', 'Sylvia', 'Tracy', 'Vanessa', 'Winnie', 'Zahara', 'Zuena',
] as const;

export const BOY_NAMES = [
  'Abdul', 'Allan', 'Andrew', 'Arnold', 'Benjamin', 'Brian', 'Collins', 'Daniel',
  'Derrick', 'Edgar', 'Elijah', 'Emmanuel', 'Enock', 'Fahad', 'Fred', 'Gerald',
  'Gideon', 'Herbert', 'Isaac', 'Ivan', 'Jonathan', 'Joshua', 'Kelvin', 'Lawrence',
  'Marvin', 'Moses', 'Nelson', 'Nicholas', 'Patrick', 'Raymond', 'Ronald', 'Samuel',
  'Shafik', 'Simon', 'Timothy', 'Trevor', 'Victor', 'Wilson',
] as const;

/**
 * Surnames spread across the regions a Kampala school actually enrols from —
 * Buganda, Ankole/Kigezi, Acholi/Lango, Busoga, Bugisu, Toro — plus the East
 * African and South Sudanese families who show up in every city register.
 */
export const SURNAMES = [
  'Ahimbisibwe', 'Akello', 'Alunyu', 'Asiimwe', 'Atim', 'Bagonza', 'Birungi', 'Byaruhanga',
  'Isabirye', 'Kabanda', 'Kagoya', 'Kamya', 'Kanyesigye', 'Kasule', 'Katende', 'Kiggundu',
  'Kirabo', 'Kyomuhendo', 'Lubega', 'Lukwago', 'Mugisha', 'Mukisa', 'Mulindwa', 'Mutebi',
  'Nabukenya', 'Nakalema', 'Namirembe', 'Nankya', 'Nsubuga', 'Nuwagaba', 'Obbo', 'Ochieng',
  'Odongo', 'Okello', 'Okwir', 'Oloya', 'Opio', 'Ssekandi', 'Ssemakula', 'Ssenyonga',
  'Tumusiime', 'Tusiime', 'Twesigye', 'Wafula', 'Waiswa', 'Wanyama', 'Zalwango',
] as const;

/** Guardian given names, kept separate so a parent never reads as a classmate. */
export const MOTHER_NAMES = [
  'Betty', 'Christine', 'Doreen', 'Edith', 'Florence', 'Gorreti', 'Hellen', 'Irene',
  'Jackline', 'Josephine', 'Lillian', 'Margaret', 'Mariam', 'Norah', 'Olivia', 'Peruth',
  'Rose', 'Ruth', 'Sarah', 'Specioza', 'Teddy', 'Violet',
] as const;

export const FATHER_NAMES = [
  'Alex', 'Bosco', 'Charles', 'David', 'Edward', 'Francis', 'Geoffrey', 'Henry',
  'Innocent', 'James', 'John', 'Julius', 'Kenneth', 'Martin', 'Michael', 'Noah',
  'Paul', 'Richard', 'Robert', 'Stephen', 'Tom', 'William',
] as const;

/* ───────────────────────── Households and catchment ──────────────────────── */

/** Neighbourhoods inside the school run, as a Kampala parent would write them. */
export const NEIGHBOURHOODS = [
  'Bweyogerere', 'Kireka', 'Namugongo', 'Kyaliwajjala', 'Najjera', 'Kiwatule', 'Ntinda',
  'Kyanja', 'Kisaasi', 'Bukoto', 'Kanyanya', 'Kawempe', 'Kasangati', 'Gayaza',
  'Kitintale', 'Luzira', 'Mutungo', 'Nsambya', 'Makindye', 'Ndeeba', 'Nateete',
  'Kyengera', 'Nansana', 'Matugga', 'Seeta', 'Mukono', 'Bulenga', 'Namasuba',
] as const;

export const OCCUPATIONS = [
  'Boda boda rider', 'Market vendor', 'Primary school teacher', 'Nurse', 'Police officer',
  'Shopkeeper', 'Tailor', 'Carpenter', 'Accountant', 'Taxi driver', 'Farmer', 'Mechanic',
  'Hair dresser', 'Civil servant', 'NGO programme officer', 'Businesswoman', 'Businessman',
  'Pastor', 'Soldier (UPDF)', 'Bank teller', 'Hotel supervisor', 'Produce dealer',
  'Lab technician', 'Boutique owner', 'Welder', 'Secretary', 'Clearing agent',
] as const;

export const RELIGIONS = [
  'Catholic', 'Anglican', 'Pentecostal', 'Muslim', 'Seventh-day Adventist', 'Orthodox',
] as const;

/** Nationalities the front desk actually picks from, Uganda first. */
export const NATIONALITIES = [
  'Ugandan', 'Kenyan', 'Tanzanian', 'Rwandan', 'Burundian', 'South Sudanese',
  'Congolese', 'Somali', 'Eritrean', 'Indian', 'British', 'Nigerian',
] as const;

/** Previous schools — all invented, in the shape of real Uganda signboards. */
export const PREVIOUS_SCHOOLS = [
  { name: 'Sunbeam Nursery School', location: 'Kireka, Wakiso' },
  { name: 'Little Doves Day Care & Nursery', location: 'Kisaasi, Kampala' },
  { name: 'Mustard Seed Nursery School', location: 'Kiwatule, Kampala' },
  { name: 'St. Jerome Primary School', location: 'Seeta, Mukono' },
  { name: 'Hillview Junior School', location: 'Nansana, Wakiso' },
  { name: 'Royal Palm Primary School', location: 'Mukono' },
  { name: 'Pearl Junior Academy', location: 'Gayaza, Wakiso' },
  { name: 'Trinity Parents Primary School', location: 'Kyaliwajjala, Wakiso' },
  { name: 'Kabaale Church of Uganda Primary School', location: 'Luweero' },
  { name: 'Bishop Nankyama Memorial Primary School', location: 'Mityana' },
  { name: 'Lakeside Junior School', location: 'Entebbe, Wakiso' },
  { name: 'Victory Nursery & Primary School', location: 'Nateete, Kampala' },
] as const;

/* ───────────────────────────── Telephone numbers ─────────────────────────── */

/** MTN and Airtel prefixes, so a bursar recognises the network on sight. */
const MTN = ['077', '078', '076'];
const AIRTEL = ['070', '075', '074'];

/** A fictional Ugandan mobile number. `+256 7XX XXXXXX`, never a live range. */
export function phone(r: () => number, network: 'mtn' | 'airtel' = 'mtn'): string {
  const prefixes = network === 'mtn' ? MTN : AIRTEL;
  const prefix = prefixes[Math.floor(r() * prefixes.length) % prefixes.length];
  let rest = '';
  for (let i = 0; i < 6; i += 1) rest += String(Math.floor(r() * 10));
  return `+256${prefix.slice(1)}${rest}`;
}

/* ────────────────────────────── The funnel ───────────────────────────────── */

/** How enquiries reach the school. `source` matches the API's enumeration. */
export const ENQUIRY_CHANNELS = [
  { source: 'website', note: 'Filled the enquiry form on the school website.' },
  { source: 'walk_in', note: 'Walked in at the gate and was shown around by the registrar.' },
  { source: 'referral', note: 'Referred by a parent in P.3 Blue.' },
  { source: 'sibling', note: 'Elder sibling already on the roll.' },
  { source: 'agent', note: 'Brought by an education agent working with relocating families.' },
  { source: 'other', note: 'Heard the Radio Simba advert during the Saturday programme.' },
  { source: 'other', note: 'Church announcement after the 9:00 a.m. service.' },
  { source: 'other', note: 'Saw the Open Day banner at the Kireka junction.' },
  { source: 'other', note: 'Facebook post about the P.7 PLE results.' },
] as const;

/** Why a decision went the way it did — what a registrar actually types. */
export const REJECTION_REASONS = [
  'Entrance assessment below the P.4 pass mark; advised to re-sit next intake.',
  'Age far outside the class range; the family was advised on the right class.',
  'Class is full and the family could not take a place in another stream.',
  'Required documents were never completed despite two reminders.',
  'Interview showed the learner needs support the school cannot provide this year.',
] as const;

export const WAITLIST_REASONS = [
  'Strong application but the stream is full; first on the waiting list.',
  'Held on the waiting list pending confirmation of two Term 3 transfers.',
  'Good interview; place to be confirmed once the P.1 Green stream opens.',
  'On the list for Top Class Red; parent asked to be kept informed.',
  'Awaiting the transfer letter from the previous school.',
] as const;

export const ACCEPT_REASONS = [
  'Met the entry standard; interview and report card both strong.',
  'Admitted on the entrance assessment; sibling already on the roll.',
  'Readiness conversation satisfactory for the class applied for.',
  'Admitted on the Board bursary for the orphan support programme.',
  'Transfer from a recognised school with a clean leaving certificate.',
] as const;

export const WITHDRAW_REASONS = [
  'Family relocating to Mbarara; application withdrawn by the parent.',
  'Parent took the place at a school nearer home.',
  'Withdrawn by the family on cost grounds.',
] as const;

export const DECLINE_NOTES = [
  'Parent declined: took a boarding place elsewhere.',
  'Parent declined: fees above what the family had budgeted.',
] as const;

/* ───────────────────────── Documents and paperwork ────────────────────────── */

/**
 * The paperwork a Ugandan school asks for. `code` is the requirement code and
 * the `ApplicationDocument.type`, so the submission gate and the uploaded file
 * line up.
 */
export const DOCUMENT_TYPES = [
  { code: 'birth_cert', label: 'Birth certificate (NIRA)', filename: 'nira-birth-certificate.pdf' },
  { code: 'immunisation_card', label: 'Immunisation card', filename: 'immunisation-card.jpg' },
  { code: 'photo', label: 'Passport photograph', filename: 'passport-photo.jpg' },
  { code: 'report_card', label: 'Last report card from the previous school', filename: 'last-report-card.pdf' },
  { code: 'transfer_letter', label: 'Transfer / school leaving letter', filename: 'transfer-letter.pdf' },
  { code: 'lc_letter', label: 'LC1 letter of residence', filename: 'lc1-letter.pdf' },
  { code: 'medical_form', label: 'Completed medical form', filename: 'medical-form.pdf' },
] as const;

export type DocumentCode = (typeof DOCUMENT_TYPES)[number]['code'];

export const DOCUMENT_BY_CODE = new Map(DOCUMENT_TYPES.map((d) => [d.code, d] as const));

/** What a panel writes after twenty minutes with a four-year-old. */
export const NURSERY_PANEL_NOTES = [
  'Settled quickly, separated from the parent without fuss. Counts to twenty, knows colours.',
  'Shy at first, warmed up over the play activity. Holds a pencil well.',
  'Confident and talkative. Follows two-step instructions in English and Luganda.',
  'Needs encouragement to speak up but handled the sorting task well.',
  'Toilet trained, feeds herself, happy in the group activity.',
  'Very active. Will do well with a firm class routine.',
] as const;

/** What an upper-primary interview panel writes. */
export const PRIMARY_PANEL_NOTES = [
  'Read the passage fluently and explained it in his own words. Strong candidate.',
  'Mathematics reasoning good; spoken English needs work but will improve in class.',
  'Articulate and well prepared. Clear about why the family is moving school.',
  'Average reading, strong arithmetic. Recommended with a term of reading support.',
  'Struggled with the comprehension and with mental work; borderline.',
  'Quiet but accurate. The report card from the previous school matches what we saw.',
] as const;

/* ────────────────────────────── Offer letters ─────────────────────────────── */

export const OFFER_TEMPLATES = [
  {
    name: 'Admission offer — Nursery',
    validityDays: 14,
    isDefault: true,
    body: [
      'Dear Parent / Guardian,',
      '',
      'We are pleased to offer your child a place in {{class}} at {{school}} for the {{year}} academic year.',
      '',
      'To confirm the place, kindly report to the Registrar with this letter, the child\'s birth certificate and',
      'immunisation card, and pay the admission fee of UGX 30,000 on or before {{expiry}}. Places not',
      'confirmed by that date are released to the waiting list.',
      '',
      'Term 1 opens on 2 February. School runs 7:40 a.m. to 4:30 p.m., with lunch and a mid-morning snack',
      'provided. The Nursery uniform is bought at the school store.',
      '',
      'Yours faithfully,',
      'The Registrar',
    ].join('\n'),
  },
  {
    name: 'Admission offer — Primary',
    validityDays: 21,
    isDefault: false,
    body: [
      'Dear Parent / Guardian,',
      '',
      'Following the entrance assessment and interview, we are pleased to offer your child a place in',
      '{{class}} at {{school}} for the {{year}} academic year.',
      '',
      'Please confirm the place by {{expiry}} by reporting to the Registrar with the original report card and',
      'transfer letter from the previous school, and by paying the admission fee of UGX 50,000.',
      '',
      'A requirements list and the fees structure are attached. Term 1 opens on 2 February.',
      '',
      'Yours faithfully,',
      'The Head Teacher',
    ].join('\n'),
  },
  {
    name: 'Waiting list letter',
    validityDays: 30,
    isDefault: false,
    body: [
      'Dear Parent / Guardian,',
      '',
      'Thank you for applying to {{school}}. Your child met our entry standard, but {{class}} is now full',
      'for the {{year}} academic year.',
      '',
      'We have placed the application on the waiting list and will contact you the moment a place is',
      'released, which most often happens in the two weeks before Term 1 opens.',
      '',
      'Yours faithfully,',
      'The Registrar',
    ].join('\n'),
  },
] as const;
