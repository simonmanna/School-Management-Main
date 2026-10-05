/**
 * Green Valley demo — the LMS.
 *
 * Built directly rather than through the API, so the demo seeds without a
 * running server. That means this file is responsible for the invariants the
 * services would normally keep, and it keeps them deliberately:
 *
 *  - **The context tree.** Capabilities are resolved by walking
 *    `LmsContext.path` upward, so every course and every activity needs a
 *    context row with a correct materialised path (`/<orgCtx>/<courseCtx>/`).
 *    Miss one and the course denies everybody, including an administrator.
 *  - **Roles are per-organization.** The eight Moodle archetypes are seeded for
 *    Green Valley; a teacher gets `editingteacher` on the courses they teach and
 *    pupils get `student`, which is what the capability resolver reads.
 *  - **A gradable activity owns one `Assessment`** and nothing else writes a
 *    mark (ADR-026). The assignments here point at the assessment spine built
 *    in `05-assessment`, so a mark shown in the LMS is the same number the
 *    report card uses.
 *
 * Depth over breadth: every course in the live term gets its section skeleton,
 * and the **showcase streams** (P5/P6/P7 North) get fully built courses — real
 * lesson pages, worksheets, a marked assignment, a quiz with real questions, and
 * a forum with a conversation in it. A demo needs one course that stands up to
 * clicking, not two hundred that are empty.
 */
import { PrismaClient } from '@prisma/client';
import { D, SCHOOL, createManyChunked, int, log, ok, rng, type School } from './shared';
import { ROLE_ARCHETYPES } from '../../src/modules/school/lms/moodle/context/roles.seed';
import type { Reference } from './01-reference';
import type { People } from './02-people';
import type { Enrollment } from './03-enrollment';
import type { Offering, Teaching } from './04-teaching';
import type { Assessment } from './05-assessment';

/** The streams whose courses are built out in full. */
const SHOWCASE: Array<{ gradeCode: string; streamCode: string | '*' }> =
  SCHOOL.lmsShowcase === 'upper-primary'
    ? ['P4', 'P5', 'P6', 'P7'].map((gradeCode) => ({ gradeCode, streamCode: '*' }))
    : [
        { gradeCode: 'P5', streamCode: SCHOOL.showcaseStream },
        { gradeCode: 'P6', streamCode: SCHOOL.showcaseStream },
        { gradeCode: 'P7', streamCode: SCHOOL.showcaseStream },
      ];
const inShowcase = (gradeCode: string, streamCode: string) =>
  SHOWCASE.some((x) => x.gradeCode === gradeCode && (x.streamCode === '*' || x.streamCode === streamCode));

/**
 * Course content per subject: six weeks of real Ugandan primary curriculum
 * topics, so a teacher looking at the demo recognises their own scheme.
 */
export const SYLLABUS: Record<string, { topic: string; objectives: string[] }[]> = {
  MTC: [
    { topic: 'Fractions', objectives: ['Add fractions with the same denominator', 'Compare fractions using diagrams', 'Simplify a fraction to its lowest terms'] },
    { topic: 'Decimals', objectives: ['Read and write decimals to two places', 'Add and subtract decimals', 'Convert simple fractions to decimals'] },
    { topic: 'Percentages', objectives: ['Express a fraction as a percentage', 'Find a percentage of a quantity', 'Solve simple profit and loss problems'] },
    { topic: 'Measurement: length and mass', objectives: ['Convert between metres and centimetres', 'Weigh objects in grams and kilograms', 'Solve problems involving mass'] },
    { topic: 'Geometry: lines and angles', objectives: ['Identify types of angles', 'Measure angles with a protractor', 'Construct a perpendicular line'] },
    { topic: 'Data handling', objectives: ['Read a bar graph', 'Draw a bar graph from a table', 'Find the mode of a set of data'] },
  ],
  ENG: [
    { topic: 'Reading comprehension', objectives: ['Answer questions on a passage', 'Find the main idea of a paragraph', 'Use context to work out new words'] },
    { topic: 'Nouns and pronouns', objectives: ['Identify common and proper nouns', 'Replace nouns with the right pronoun', 'Use possessive pronouns correctly'] },
    { topic: 'Verb tenses', objectives: ['Use the simple past correctly', 'Form the present continuous', 'Choose the right tense in a sentence'] },
    { topic: 'Composition: narrative writing', objectives: ['Plan a story with a beginning, middle and end', 'Use paragraphs correctly', 'Use descriptive words'] },
    { topic: 'Punctuation', objectives: ['Use full stops and capital letters', 'Use commas in a list', 'Punctuate direct speech'] },
    { topic: 'Letter writing', objectives: ['Write an informal letter', 'Lay out an address correctly', 'Use an appropriate closing'] },
  ],
  SCI: [
    { topic: 'The human digestive system', objectives: ['Name the parts of the digestive system', 'Describe what happens to food in the stomach', 'Explain why we need a balanced diet'] },
    { topic: 'Plants: parts and functions', objectives: ['Name the parts of a flowering plant', 'Describe the function of roots and leaves', 'Explain pollination'] },
    { topic: 'Water and sanitation', objectives: ['Explain how to make water safe for drinking', 'Describe causes of water-borne disease', 'List ways to keep a latrine clean'] },
    { topic: 'Immunisation and disease', objectives: ['Name diseases prevented by immunisation', 'Explain how malaria is spread', 'Describe how to prevent malaria'] },
    { topic: 'Energy and simple machines', objectives: ['Give examples of sources of energy', 'Identify a lever in everyday life', 'Explain how a pulley helps us'] },
    { topic: 'Soil and farming', objectives: ['Name the three types of soil', 'Explain soil erosion and its control', 'Describe crop rotation'] },
  ],
  SST: [
    { topic: 'The physical features of Uganda', objectives: ['Locate the major lakes of Uganda', 'Name the main mountain ranges', 'Describe the climate of your district'] },
    { topic: 'Our district and its leaders', objectives: ['Name the leaders of your district', 'Describe the work of the LC1 chairperson', 'Explain how local leaders are chosen'] },
    { topic: 'Farming in Uganda', objectives: ['Name the main cash crops', 'Distinguish subsistence from commercial farming', 'Explain problems facing farmers'] },
    { topic: 'The history of Uganda: early societies', objectives: ['Describe the Bachwezi', 'Explain the growth of Buganda kingdom', 'Name the early inhabitants of Uganda'] },
    { topic: 'Transport and communication', objectives: ['Name forms of transport used in Uganda', 'Explain the importance of roads', 'Describe modern means of communication'] },
    { topic: 'Rights and responsibilities of a child', objectives: ['List the rights of a child', 'Explain a child’s responsibilities at home', 'Describe where to report abuse'] },
  ],
};

/** Quiz questions, per subject. Real primary-level items, with real answers. */
export const QUIZ_BANK: Record<string, Array<{ prompt: string; options: string[]; correct: number; marks?: number }>> = {
  MTC: [
    { prompt: 'What is 1/2 + 1/4?', options: ['1/4', '2/4', '3/4', '4/4'], correct: 2 },
    { prompt: 'Simplify 6/8 to its lowest terms.', options: ['3/4', '2/3', '6/8', '1/2'], correct: 0 },
    { prompt: 'Write 0.25 as a fraction in its lowest terms.', options: ['1/5', '1/4', '2/5', '1/2'], correct: 1 },
    { prompt: 'What is 20% of 150?', options: ['15', '25', '30', '35'], correct: 2 },
    { prompt: 'How many centimetres are in 2.5 metres?', options: ['25 cm', '250 cm', '2 500 cm', '0.025 cm'], correct: 1 },
    { prompt: 'An angle of 90 degrees is called a:', options: ['acute angle', 'obtuse angle', 'right angle', 'reflex angle'], correct: 2 },
    { prompt: 'What is the mode of 2, 3, 3, 5, 7?', options: ['2', '3', '5', '7'], correct: 1 },
    { prompt: 'A shirt costs 12 000 shillings. What is the cost of 4 shirts?', options: ['36 000', '44 000', '48 000', '52 000'], correct: 2 },
  ],
  ENG: [
    { prompt: 'Choose the correct pronoun: "____ is my sister."', options: ['Her', 'She', 'Hers', 'Him'], correct: 1 },
    { prompt: 'Which word is a proper noun?', options: ['city', 'Kampala', 'river', 'teacher'], correct: 1 },
    { prompt: 'What is the past tense of "go"?', options: ['goed', 'gone', 'went', 'going'], correct: 2 },
    { prompt: 'Choose the correctly punctuated sentence.', options: ['where are you going', 'Where are you going?', 'where are you going?', 'Where are you going'], correct: 1 },
    { prompt: 'The plural of "child" is:', options: ['childs', 'childes', 'children', 'childrens'], correct: 2 },
    { prompt: 'Which word means the opposite of "ancient"?', options: ['old', 'modern', 'historic', 'past'], correct: 1 },
    { prompt: 'Complete: "She ____ to school every day."', options: ['go', 'goes', 'going', 'gone'], correct: 1 },
    { prompt: 'In a friendly letter, where does your own address go?', options: ['bottom left', 'top right', 'top left', 'centre'], correct: 1 },
  ],
  SCI: [
    { prompt: 'Which organ breaks down food using acid?', options: ['liver', 'stomach', 'lungs', 'kidney'], correct: 1 },
    { prompt: 'Which part of a plant makes food?', options: ['root', 'stem', 'leaf', 'flower'], correct: 2 },
    { prompt: 'Malaria is spread by:', options: ['houseflies', 'female anopheles mosquito', 'cockroaches', 'dirty water'], correct: 1 },
    { prompt: 'The best way to make water safe for drinking at home is to:', options: ['filter it with cloth', 'boil it', 'add sugar', 'leave it in the sun'], correct: 1 },
    { prompt: 'Which of these is a source of energy?', options: ['stone', 'the sun', 'sand', 'glass'], correct: 1 },
    { prompt: 'Soil erosion can be controlled by:', options: ['burning grass', 'planting trees', 'digging up slopes', 'overgrazing'], correct: 1 },
    { prompt: 'A balanced diet must contain:', options: ['only carbohydrates', 'only proteins', 'all food nutrients', 'only vitamins'], correct: 2 },
    { prompt: 'Immunisation protects a child against:', options: ['hunger', 'measles', 'injury', 'cold weather'], correct: 1 },
  ],
  SST: [
    { prompt: 'Which is the largest lake in Uganda?', options: ['Lake Albert', 'Lake Kyoga', 'Lake Victoria', 'Lake Edward'], correct: 2 },
    { prompt: 'The capital city of Uganda is:', options: ['Jinja', 'Entebbe', 'Kampala', 'Gulu'], correct: 2 },
    { prompt: 'Which mountain range lies on Uganda’s western border?', options: ['Mount Elgon', 'Rwenzori', 'Mount Moroto', 'Mount Kadam'], correct: 1 },
    { prompt: 'The main cash crop of Uganda is:', options: ['maize', 'coffee', 'beans', 'cassava'], correct: 1 },
    { prompt: 'The leader of a village council is the:', options: ['District Chairperson', 'LC1 Chairperson', 'Member of Parliament', 'Mayor'], correct: 1 },
    { prompt: 'Farming for family use only is called:', options: ['commercial farming', 'subsistence farming', 'mixed farming', 'plantation farming'], correct: 1 },
    { prompt: 'Which river flows out of Lake Victoria?', options: ['River Nile', 'River Katonga', 'River Kagera', 'River Mpologoma'], correct: 0 },
    { prompt: 'One right of a child is the right to:', options: ['work for pay', 'education', 'vote', 'drive'], correct: 1 },
  ],
};

export async function seedLms(
  prisma: PrismaClient,
  s: School,
  ref: Reference,
  people: People,
  enrol: Enrollment,
  teaching: Teaching,
  assessment: Assessment,
) {
  const { O } = s;
  const liveTerm = teaching.liveTerm;

  // ── LMS roles and their capabilities ──────────────────────────────────────
  //
  // Both halves, from the application's own `ROLE_ARCHETYPES` rather than a
  // hand-written copy. A role row on its own grants NOTHING: capabilities live
  // in `LmsRoleCapability`, and the resolver folds those along the context
  // path. Seeding the roles and omitting their capabilities produced exactly
  // the failure it should have — a pupil could list their courses and was then
  // refused entry to one with "Missing LMS capability: lms/course:view".
  const lmsRoles = new Map<string, string>();
  let capabilityRows = 0;
  for (const def of ROLE_ARCHETYPES) {
    const role = await prisma.lmsRole.upsert({
      where: { organizationId_shortname: { organizationId: O, shortname: def.shortname } },
      create: {
        organizationId: O,
        shortname: def.shortname,
        name: def.name,
        archetype: def.archetype,
        sortOrder: def.sortOrder,
        assignableAt: def.assignableAt,
      },
      update: {
        name: def.name,
        archetype: def.archetype,
        sortOrder: def.sortOrder,
        assignableAt: def.assignableAt,
      },
    });
    lmsRoles.set(def.shortname, role.id);
    for (const capability of def.allow) {
      await prisma.lmsRoleCapability.upsert({
        where: { roleId_capability: { roleId: role.id, capability } },
        create: { roleId: role.id, capability, permission: 'allow' },
        update: { permission: 'allow' },
      });
      capabilityRows += 1;
    }
  }
  ok(`LMS roles: ${lmsRoles.size} archetypes, ${capabilityRows} capability grants`);

  // ── Context tree ──────────────────────────────────────────────────────────
  // `path` is a materialised path the capability resolver splits on '/' to find
  // ancestors, so it must be built the same way the service builds it:
  // the org root is `/<id>/`, a course is `<parent.path><id>/`.
  async function ensureContext(
    level: 'organization' | 'course' | 'activity',
    instanceId: string | null,
    parent: { id: string; path: string; depth: number } | null,
  ) {
    const existing = await prisma.lmsContext.findFirst({
      where: { organizationId: O, level, instanceId },
    });
    if (existing) return existing;
    const created = await prisma.lmsContext.create({
      data: {
        organizationId: O,
        level,
        instanceId,
        parentId: parent?.id ?? null,
        depth: parent ? parent.depth + 1 : 0,
        path: '',
      },
    });
    return prisma.lmsContext.update({
      where: { id: created.id },
      data: { path: `${parent?.path ?? '/'}${created.id}/` },
    });
  }

  const orgContext = await ensureContext('organization', null, null);

  // ── Which courses get content ─────────────────────────────────────────────
  const liveOfferings = teaching.offerings.filter((o) => o.termId === liveTerm.id);
  const isShowcase = (o: Offering) =>
    inShowcase(o.gradeCode, o.streamCode) && Boolean(SYLLABUS[o.subjectCode]);

  const showcaseOfferings = liveOfferings.filter(isShowcase);

  // Marks already in the spine, so the LMS assignment can own the right one.
  const assessmentByKey = new Map(
    assessment.seeded.map((a) => [`${a.offering.id}:${a.kind}`, a]),
  );

  let sectionsMade = 0;
  let modulesMade = 0;
  let enrolments = 0;
  let completions = 0;
  let submissions = 0;

  // ── Every live course gets its week skeleton ──────────────────────────────
  // An "Advanced Courses" list of two hundred empty courses is still a useful
  // demo of scale, provided opening one shows a structured term rather than a
  // blank page.
  for (const offering of liveOfferings) {
    const courseContext = await ensureContext('course', offering.id, orgContext);

    // The teacher of the course can edit it.
    const existingRole = await prisma.lmsRoleAssignment.findFirst({
      where: { organizationId: O, contextId: courseContext.id, roleId: lmsRoles.get('editingteacher')! },
    });
    if (!existingRole) {
      // Role assignments key on userId; only staff with logins have one, so the
      // coarse-permission fallback covers the rest (capability.service.ts).
      const teacherUser = await prisma.user.findFirst({
        where: { organizationId: O, email: `${emailKeyFor(offering, people)}@${SCHOOL.emailDomain}` },
        select: { id: true },
      });
      if (teacherUser) {
        await prisma.lmsRoleAssignment.create({
          data: {
            organizationId: O,
            contextId: courseContext.id,
            roleId: lmsRoles.get('editingteacher')!,
            userId: teacherUser.id,
          },
        });
      }
    }

    const weeks = SYLLABUS[offering.subjectCode] ?? [];
    const sectionCount = weeks.length > 0 ? weeks.length : 6;
    for (let n = 0; n <= sectionCount; n += 1) {
      const week = n > 0 ? weeks[n - 1] : null;
      const existingSection = await prisma.courseSection.findFirst({
        where: { organizationId: O, courseOfferingId: offering.id, sectionNo: n },
      });
      if (existingSection) continue;
      await prisma.courseSection.create({
        data: {
          organizationId: O,
          courseOfferingId: offering.id,
          sectionNo: n,
          name: n === 0 ? 'Course information' : week ? `Week ${n}: ${week.topic}` : `Week ${n}`,
          summary:
            n === 0
              ? `<p>Welcome to ${offering.subjectCode} for ${offering.gradeCode} ${offering.streamCode}. Work is set here every week.</p>`
              : week
                ? `<p>${week.objectives[0]}.</p>`
                : null,
          visible: true,
          weekOf: new Date(liveTerm.startDate.getTime() + (n - 1) * 7 * 86_400_000),
        },
      });
      sectionsMade += 1;
    }

    // ── Enrol the stream, by roster sync ────────────────────────────────────
    // The LMS membership is a PROJECTION of official enrolment (ADR-026): the
    // method is `roster_sync`, not `manual`, because nobody enrolled these
    // pupils by hand.
    let method = await prisma.courseEnrolmentMethod.findFirst({
      where: { organizationId: O, courseOfferingId: offering.id, method: 'roster_sync' },
    });
    if (!method) {
      method = await prisma.courseEnrolmentMethod.create({
        data: { organizationId: O, courseOfferingId: offering.id, method: 'roster_sync', enabled: true },
      });
    }

    const members = assessment.pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? [];

    // The `student` role at the course context, for every pupil on it.
    //
    // The capability guard builds a learner principal as `{ studentProfileId }`
    // with no userId, deliberately — a pupil's access comes from enrolment, not
    // from a school-wide permission — so this assignment is the ONLY thing that
    // lets them open the course. Assigning it on the showcase courses alone
    // left pupils locked out of the rest of their own timetable.
    const existingStudentRoles = await prisma.lmsRoleAssignment.count({
      where: { organizationId: O, contextId: courseContext.id, roleId: lmsRoles.get('student')! },
    });
    if (existingStudentRoles !== members.length && members.length > 0) {
      await createManyChunked(
        prisma.lmsRoleAssignment as never,
        members.map((p) => ({
          organizationId: O,
          contextId: courseContext.id,
          roleId: lmsRoles.get('student')!,
          studentProfileId: p.id,
        })) as never[],
      );
    }

    const existingEnrolments = await prisma.courseEnrolment.count({
      where: { organizationId: O, courseOfferingId: offering.id },
    });
    if (existingEnrolments === 0 && members.length > 0) {
      await createManyChunked(
        prisma.courseEnrolment as never,
        members.map((p) => ({
          organizationId: O,
          courseOfferingId: offering.id,
          methodId: method!.id,
          studentProfileId: p.id,
          status: 'active',
          startedAt: liveTerm.startDate,
        })) as never[],
      );
      enrolments += members.length;
    }
  }
  ok(`course pages: ${sectionsMade} week sections across ${liveOfferings.length} live courses`);
  log(`LMS enrolments: ${enrolments} (roster_sync — a projection of official enrolment)`);

  // ── Showcase courses: real content ────────────────────────────────────────
  for (const offering of showcaseOfferings) {
    const weeks = SYLLABUS[offering.subjectCode]!;
    const sections = await prisma.courseSection.findMany({
      where: { organizationId: O, courseOfferingId: offering.id },
      orderBy: { sectionNo: 'asc' },
    });
    const courseContext = await ensureContext('course', offering.id, orgContext);
    const members = assessment.pupilsByStream.get(`${offering.gradeCode}:${offering.streamCode}`) ?? [];

    // Student roles were assigned for every live course above, so there is
    // nothing to do here.
    const alreadyBuilt = await prisma.courseModule.count({
      where: { organizationId: O, courseOfferingId: offering.id, deletedAt: null },
    });
    if (alreadyBuilt > 0) continue;

    /** Place one activity: its instance row, its spine row, and its context. */
    async function addModule(opts: {
      sectionNo: number;
      activityType: string;
      instanceId: string;
      sequence: number;
      completionMode?: 'none' | 'manual' | 'automatic';
      dueAt?: Date | null;
      assessmentId?: string | null;
    }) {
      const section = sections.find((x) => x.sectionNo === opts.sectionNo);
      if (!section) return null;
      const cm = await prisma.courseModule.create({
        data: {
          organizationId: O,
          courseOfferingId: offering.id,
          sectionId: section.id,
          activityType: opts.activityType,
          instanceId: opts.instanceId,
          sequence: opts.sequence,
          visible: true,
          visibleOnPage: true,
          completionMode: opts.completionMode ?? 'manual',
          dueAt: opts.dueAt ?? null,
          assessmentId: opts.assessmentId ?? null,
        },
      });
      await ensureContext('activity', cm.id, courseContext);
      modulesMade += 1;
      return cm;
    }

    // Week 0: a welcome note the pupils see first.
    const label = await prisma.modLabel.create({
      data: {
        organizationId: O,
        content: `<p><strong>Welcome to ${offering.subjectCode}.</strong> Check this page every week for your notes and homework.</p>`,
      },
    });
    await addModule({ sectionNo: 0, activityType: 'label', instanceId: label.id, sequence: 0, completionMode: 'none' });


    for (const [i, week] of weeks.entries()) {
      const sectionNo = i + 1;
      const weekStart = new Date(liveTerm.startDate.getTime() + i * 7 * 86_400_000);
      let seq = 0;

      // ── Lesson notes ──
      const page = await prisma.modPage.create({
        data: {
          organizationId: O,
          name: `${week.topic} — lesson notes`,
          intro: `<p>Notes for ${week.topic}.</p>`,
          content:
            `<h2>${week.topic}</h2>` +
            `<p>By the end of this week you should be able to:</p>` +
            `<ul>${week.objectives.map((obj) => `<li>${obj}</li>`).join('')}</ul>` +
            `<h3>Key points</h3>` +
            `<p>${week.objectives[0]}. Work through the examples in your exercise book, then try the questions your teacher sets.</p>` +
            `<h3>Words to know</h3>` +
            `<p>${week.topic.split(/[:,]/)[0]} &mdash; write the meaning in your own words.</p>`,
        },
      });
      await addModule({ sectionNo, activityType: 'page', instanceId: page.id, sequence: seq++ });

      // ── A worksheet reference ──
      // No bytes are uploaded by a seed; the activity exists with its title so
      // the course page and the learner's file list are populated, and the
      // teacher attaches the real PDF in front of the client.
      const resource = await prisma.modResource.create({
        data: {
          organizationId: O,
          name: `${week.topic} — worksheet`,
          intro: '<p>Print or copy the questions into your book.</p>',
          displayMode: 'auto',
        },
      });
      await addModule({ sectionNo, activityType: 'resource', instanceId: resource.id, sequence: seq++ });

      // ── A video link, every other week ──
      if (i % 2 === 0) {
        const url = await prisma.modUrl.create({
          data: {
            organizationId: O,
            name: `${week.topic} — watch this first`,
            intro: '<p>A short explanation to watch before the lesson.</p>',
            externalUrl: 'https://www.youtube-nocookie.com/embed/5NgNicANyqM',
            display: 'embed',
          },
        });
        await addModule({ sectionNo, activityType: 'url', instanceId: url.id, sequence: seq++ });
      }

      // ── Homework, weeks 1–4, tied to the assessment spine ──
      if (i < 4) {
        const dueAt = new Date(weekStart.getTime() + 4 * 86_400_000 + 16 * 3_600_000);
        // The continuous-assessment paper this homework contributes to.
        const spine = assessmentByKey.get(`${offering.id}:cat`);
        const assign = await prisma.modAssign.create({
          data: {
            organizationId: O,
            name: `${week.topic} — homework`,
            intro: `<p>Answer all the questions on ${week.topic.toLowerCase()}. Show your working.</p>`,
            dueDate: dueAt,
            maxScore: D(10),
            submissionTypes: ['online_text', 'file'],
            maxAttempts: 2,
          },
        });
        const cm = await addModule({
          sectionNo,
          activityType: 'assign',
          instanceId: assign.id,
          sequence: seq++,
          completionMode: 'automatic',
          dueAt,
          // Only the first week's homework owns the spine assessment: one
          // assessment, one module (the column is unique).
          assessmentId: i === 0 ? (spine?.id ?? null) : null,
        });

        // Submissions for past weeks, so the marking workbench has work in it.
        if (cm && dueAt < new Date()) {
          for (const pupil of members) {
            const pr = rng(`submit:${pupil.admissionNo}:${cm.id}`);
            if (pr() < 0.12) continue; // a few have not handed in
            const late = pr() < 0.15;
            // Lateness is not a column here: it is `submittedAt` against the
            // module's `dueAt`, which is what `lms-assign-rules` enforces.
            await prisma.modAssignSubmission.create({
              data: {
                organizationId: O,
                assignId: assign.id,
                courseModuleId: cm.id,
                studentProfileId: pupil.id,
                attemptNo: 1,
                status: 'submitted',
                submittedAt: new Date(dueAt.getTime() + (late ? 36 : -20) * 3_600_000),
                content: `My answers for ${week.topic.toLowerCase()}.`,
              },
            });
            submissions += 1;
          }
        }
      }

      // ── A quiz in weeks 2 and 5, with real questions ──
      if ((i === 1 || i === 4) && QUIZ_BANK[offering.subjectCode]) {
        const items = QUIZ_BANK[offering.subjectCode]!;

        // Keyed on (organization, name) — NOT on a fixed id.
        //
        // A fixed `id` like `gv-bank-MTC` is global, so after the tenant is
        // deleted and re-seeded the old row survives, the upsert finds it, and
        // the bank keeps pointing at an organization that no longer exists.
        // The questions then belong to a dead tenant, the tenancy extension
        // cannot see them, and every quiz fails to start with "Paper has no
        // questions to sit". Natural keys inside the org cannot do that.
        const bankName = `${offering.subjectCode} question bank`;
        const bank =
          (await prisma.questionBank.findFirst({ where: { organizationId: O, name: bankName } })) ??
          (await prisma.questionBank.create({
            data: {
              organizationId: O,
              name: bankName,
              subjectId: offering.subjectId,
              description: 'Demo question bank — primary level items.',
            },
          }));

        // Questions are written once per subject and reused by every quiz that
        // draws on the bank, which is the point of having a bank.
        const questionIds: string[] = [];
        for (const [qi, item] of items.entries()) {
          const existingQ = await prisma.question.findFirst({
            where: { organizationId: O, bankId: bank.id, prompt: item.prompt },
          });
          const question =
            existingQ ??
            (await prisma.question.create({
              data: {
                organizationId: O,
                bankId: bank.id,
                type: 'mcq_single',
                prompt: item.prompt,
                marks: D(item.marks ?? 1),
                difficulty: qi < 3 ? 'easy' : qi < 6 ? 'medium' : 'hard',
                tags: [offering.subjectCode, week.topic],
              },
            }));
          if (!existingQ) {
            await prisma.questionOption.createMany({
              data: item.options.map((label, oi) => ({
                organizationId: O,
                questionId: question.id,
                label,
                isCorrect: oi === item.correct,
                order: oi,
              })),
            });
          }
          questionIds.push(question.id);
        }

        const paper = await prisma.paper.create({
          data: {
            organizationId: O,
            name: `${offering.gradeCode} ${offering.subjectCode} — ${week.topic} quiz`,
            subjectId: offering.subjectId,
            courseOfferingId: offering.id,
            totalMarks: D(questionIds.length),
            durationMinutes: 20,
          },
        });
        await prisma.paperQuestion.createMany({
          data: questionIds.map((questionId, qi) => ({
            organizationId: O,
            paperId: paper.id,
            questionId,
            order: qi,
            marks: D(1),
          })),
        });

        const quiz = await prisma.modQuiz.create({
          data: {
            organizationId: O,
            name: `${week.topic} — quiz`,
            intro: `<p>${questionIds.length} questions. You have 20 minutes and two attempts.</p>`,
            questionPaperId: paper.id,
            timeLimitSec: 20 * 60,
            attemptsAllowed: 2,
            gradingMethod: 'highest',
            navMethod: 'free',
            shuffleAnswers: true,
            maxScore: D(questionIds.length),
            openAt: weekStart,
            closeAt: new Date(weekStart.getTime() + 10 * 86_400_000),
          },
        });
        await addModule({
          sectionNo,
          activityType: 'quiz',
          instanceId: quiz.id,
          sequence: seq++,
          completionMode: 'automatic',
          dueAt: new Date(weekStart.getTime() + 6 * 86_400_000),
        });
      }

      // ── A forum, once per course ──
      if (i === 0) {
        const forum = await prisma.modForum.create({
          data: {
            organizationId: O,
            name: `${offering.subjectCode} class discussion`,
            intro: '<p>Ask your questions here. Be kind and use full sentences.</p>',
            forumType: 'general',
            subscription: 'optional',
          },
        });
        const cm = await addModule({
          sectionNo: 0,
          activityType: 'forum',
          instanceId: forum.id,
          sequence: 1,
          completionMode: 'none',
        });

        if (cm) {
          const discussion = await prisma.discussion.create({
            data: {
              organizationId: O,
              courseOfferingId: offering.id,
              courseModuleId: cm.id,
              title: `Where do we use ${week.topic.toLowerCase()} at home?`,
              body: `<p>Think about your home and your village. Where do you see ${week.topic.toLowerCase()} being used? Write one example.</p>`,
              pinned: true,
            },
          });
          const posters = members.slice(0, 4);
          const replies = [
            'We use it when we share food at home so everyone gets the same.',
            'My mother uses it at the market when she measures beans.',
            'We used it yesterday when we shared the sugarcane into four parts.',
            'I see it on the radio when they talk about prices going up.',
          ];
          for (let pi = 0; pi < posters.length; pi += 1) {
            await prisma.discussionPost.create({
              data: {
                organizationId: O,
                discussionId: discussion.id,
                body: `<p>${replies[pi % replies.length]}</p>`,
              },
            });
          }
        }
      }
    }

    // ── Completion, so progress bars are not all zero ──────────────────────
    const courseModules = await prisma.courseModule.findMany({
      where: { organizationId: O, courseOfferingId: offering.id, completionMode: { not: 'none' } },
      select: { id: true },
    });
    const completionRows: Array<Record<string, unknown>> = [];
    for (const pupil of members) {
      const pr = rng(`progress:${pupil.admissionNo}:${offering.code}`);
      // A pupil's diligence, so the class shows a spread rather than one figure.
      const diligence = 0.25 + pr() * 0.7;
      for (const cm of courseModules) {
        if (pr() > diligence) continue;
        completionRows.push({
          organizationId: O,
          courseModuleId: cm.id,
          studentProfileId: pupil.id,
          state: 'complete',
          completedAt: new Date(liveTerm.startDate.getTime() + int(pr, 1, 50) * 86_400_000),
        });
      }
    }
    completions += completionRows.length;
    await createManyChunked(prisma.courseModuleCompletion as never, completionRows as never[], 1000);
  }
  ok(`showcase courses: ${showcaseOfferings.length} built out, ${modulesMade} activities`);
  log(`submissions: ${submissions} handed in; completions: ${completions} ticked`);

  // ── Badges ────────────────────────────────────────────────────────────────
  const badgeSeeds = [
    { code: 'reader', name: 'Reader', description: 'Finished every reading activity in a term.' },
    { code: 'homework-hero', name: 'Homework Hero', description: 'Handed in every piece of homework on time.' },
    { code: 'quiz-master', name: 'Quiz Master', description: 'Scored above 80% in three quizzes.' },
  ];
  const badges: string[] = [];
  for (const b of badgeSeeds) {
    const existing = await prisma.lmsBadge.findFirst({ where: { organizationId: O, name: b.name } });
    const row =
      existing ??
      (await prisma.lmsBadge.create({
        data: {
          organizationId: O,
          name: b.name,
          description: b.description,
          criteriaType: 'manual',
          active: true,
        },
      }));
    badges.push(row.id);
  }

  // Award them to the diligent pupils in the showcase streams.
  const showcasePupils = people.pupils.filter((p) =>
    inShowcase(p.gradeCode, p.streamCode),
  );
  const awardRows: Array<Record<string, unknown>> = [];
  for (const pupil of showcasePupils) {
    const pr = rng(`badge:${pupil.admissionNo}`);
    for (const badgeId of badges) {
      if (pr() < 0.25) {
        awardRows.push({
          organizationId: O,
          badgeId,
          studentProfileId: pupil.id,
          awardedAt: new Date(liveTerm.startDate.getTime() + int(pr, 5, 45) * 86_400_000),
        });
      }
    }
  }
  // The demo pupil always gets them. Awards are drawn deterministically, so
  // whether the persona the demo signs in as has any at all is luck — and an
  // empty badges screen for the one pupil anybody looks at is a poor advert
  // for a feature that works.
  if (people.demoPupil) {
    for (const badgeId of badges) {
      if (!awardRows.some((a) => a.badgeId === badgeId && a.studentProfileId === people.demoPupil!.id)) {
        awardRows.push({
          organizationId: O,
          badgeId,
          studentProfileId: people.demoPupil.id,
          awardedAt: new Date(liveTerm.startDate.getTime() + 12 * 86_400_000),
        });
      }
    }
  }

  // Deduplicated against what is already there, by hand.
  //
  // `LmsBadgeAward` is unique on (badgeId, studentProfileId, userId) and
  // `userId` is null for a pupil award. Postgres treats NULLs as distinct in a
  // unique index, so `skipDuplicates` matches nothing and every re-seed adds
  // another full set — six runs had turned 74 awards into 438, and the demo
  // pupil's badge list showed the same badge four times.
  const alreadyAwarded = new Set(
    (
      await prisma.lmsBadgeAward.findMany({
        where: { organizationId: O },
        select: { badgeId: true, studentProfileId: true },
      })
    ).map((a) => `${a.badgeId}:${a.studentProfileId ?? '-'}`),
  );
  const newAwards = awardRows.filter(
    (a) => !alreadyAwarded.has(`${a.badgeId as string}:${(a.studentProfileId as string) ?? '-'}`),
  );
  await createManyChunked(prisma.lmsBadgeAward as never, newAwards as never[], 500);
  ok(
    `badges: ${badges.length} defined, ${newAwards.length} newly awarded ` +
      `(${alreadyAwarded.size} already held)`,
  );

  return { showcaseOfferings, lmsRoles, orgContext };
}

/**
 * The login key of a course's teacher, if they have one.
 *
 * Only a few staff have accounts in the demo; the rest are records. A course
 * whose teacher has no login simply gets no role assignment, and the coarse
 * school permissions still let staff open it.
 */
function emailKeyFor(offering: Offering, people: People): string {
  const named = [...people.subjectTeachers, ...people.leadership].find((t) => t.id === offering.teacher.id);
  if (named) return named.email.split('@')[0];
  // Class teachers: only the P5 showcase-stream one has a login, under `teacher@`.
  if (offering.gradeCode === 'P5' && offering.streamCode === SCHOOL.showcaseStream) return 'teacher';
  return '__none__';
}

export type Lms = Awaited<ReturnType<typeof seedLms>>;
