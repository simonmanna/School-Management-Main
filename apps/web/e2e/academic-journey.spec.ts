import { expect, test, type Page } from '@playwright/test';

/**
 * The whole school year in one browser run (Wave 11).
 *
 * The audit's remaining unknown was that every cross-module handoff was proved
 * only by a service test that prepared its own data. This walks the journey the
 * way a school does, through the UI, in one tenant, with two roles:
 *
 *   registrar: application → decision/offer → enrol → placement
 *   teacher:   assessment → marks → submit for approval
 *   registrar: approve → compute results → release → publish the report document
 *
 * It is deliberately one test, not eleven: the point is the handoffs between the
 * steps, and a later step has no meaning if an earlier one did not really happen.
 *
 * Running it (an already-running stack, as in playwright.config.ts):
 *   E2E_ORG=... E2E_EMAIL=... E2E_PASSWORD=...          registrar/admin
 *   E2E_TEACHER_EMAIL=... E2E_TEACHER_PASSWORD=...      required: the marking teacher
 *   E2E_TERM=...                                        optional: a live term
 *   pnpm --filter @erp/web exec playwright test academic-journey
 *
 * The teacher credentials are REQUIRED and must be a different account (audit
 * R07 / D07): running the marking leg as the registrar would prove the journey
 * but not the separation of duties, and a green run must never be read as both.
 *
 * Wave 13 contract (student-flow audit 2026-09-26):
 *   - an application is a form page, not a dialog;
 *   - enrolment is one shared dialog that carries the pupil's details from the
 *     application and offers only the application year's terms (F13/F18);
 *   - an assessment counts toward term results only when bound to a weighting
 *     component (F03), and must be published before it is marked;
 *   - results are worked out from a locked WHOLE-CLASS list for the term (F06),
 *     and a subject needs evidence for every required component (F02). Point
 *     E2E_TERM at a term whose subject policy the journey's single assessment
 *     can satisfy (e.g. a 100% CAT policy), or the release is correctly refused.
 */
const ORG = process.env.E2E_ORG ?? '';
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL ?? '';
const TEACHER_PASSWORD = process.env.E2E_TEACHER_PASSWORD ?? '';
const TERM = process.env.E2E_TERM ?? '';
/** The class and course set up by scripts/seed-sunrise-academics.ts. */
const CLASS = process.env.E2E_CLASS ?? 'P.1 A';
const COURSE = process.env.E2E_COURSE ?? 'P.1 A Mathematics — Term 3';
// Run `pnpm --filter @erp/api exec tsx ../../scripts/seed-sunrise-academics.ts`
// before each run: it opens a fresh exam sitting once the previous one is closed.

test.skip(!ORG || !EMAIL || !PASSWORD, 'Set E2E_ORG, E2E_EMAIL and E2E_PASSWORD to run the academic journey');

// Configured to run, the journey must not quietly downgrade to one account.
test.beforeAll(() => {
  if (!ORG || !EMAIL) return;
  if (!TEACHER_EMAIL || !TEACHER_PASSWORD) {
    throw new Error('Set E2E_TEACHER_EMAIL and E2E_TEACHER_PASSWORD: the marking leg must be a different person (D07).');
  }
  if (TEACHER_EMAIL.toLowerCase() === EMAIL.toLowerCase()) {
    throw new Error('E2E_TEACHER_EMAIL must differ from E2E_EMAIL: approver and marker must be different people (D07).');
  }
});

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('e.g. GVPS').fill(ORG);
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Pick the first real option of a `select`, or the one whose label matches. */
async function choose(select: ReturnType<Page['locator']>, label?: string) {
  if (label) {
    // Labels may carry a suffix such as "(current)"; match on the text.
    const option = select.locator('option', { hasText: label }).first();
    await expect(option).toBeAttached();
    await select.selectOption((await option.getAttribute('value'))!);
    return label;
  }
  const options = select.locator('option');
  // Options arrive with their query; wait for them rather than racing it.
  await expect.poll(() => options.count(), { message: 'the selector had no options to choose from' }).toBeGreaterThan(1);
  const text = (await options.nth(1).textContent())!.trim();
  await select.selectOption({ index: 1 });
  return text;
}

test('application → enrolment → assessment → marks → results → published report', async ({ browser }) => {
  // One test for the whole year: it needs far more than the default budget.
  test.setTimeout(600_000);
  const stamp = Date.now();
  const applicant = `Journey Pupil${stamp}`; // other names + surname, as the application records them
  const assessmentTitle = `Journey Check ${stamp}`;

  const registrar = await browser.newPage();
  await signIn(registrar, EMAIL, PASSWORD);

  /* ── 1. The application arrives ───────────────────────────────────────── */
  await registrar.goto('/school/applications/new');
  const form = registrar.getByRole('main');
  // Academic year first: the terms (and classes) offered depend on it.
  await choose(form.locator('select').first());
  await form.getByPlaceholder('E.g. Atimango').fill(`Pupil${stamp}`);
  await form.getByPlaceholder('E.g. Isabelle Atweoki').fill('Journey');
  await form.getByPlaceholder('E.g. Okello').fill('Guardian');
  await form.getByPlaceholder('E.g. James Paul').fill(`Journey ${stamp}`);
  await form.getByPlaceholder('E.g. 0700123456').fill('0700123456');
  // Admission date, then date of birth (the two date inputs, in form order).
  const dates = form.locator('input[type="date"]');
  await dates.nth(0).fill(new Date().toISOString().slice(0, 10));
  // A distinct birth date per run: the same child entered twice is (rightly)
  // stopped by the duplicate-pupil check at enrolment.
  const dob = new Date(Date.UTC(2018, 0, 1) + (stamp % 1400) * 86_400_000).toISOString().slice(0, 10);
  await dates.nth(1).fill(dob);
  // Every other required choice (gender, nationality, entry, residence, class,
  // relationship): take the first real option of any still-unset selector.
  const selects = form.locator('select');
  for (let i = 0; i < (await selects.count()); i += 1) {
    const sel = selects.nth(i);
    if ((await sel.inputValue()) === '' && (await sel.locator('option').count()) > 1) await sel.selectOption({ index: 1 });
  }
  await registrar.getByRole('button', { name: /^next/i }).click();
  await registrar.getByRole('button', { name: /^submit/i }).click();
  await registrar.goto('/school/applications');
  await expect(registrar.getByText(new RegExp(`Pupil${stamp}`))).toBeVisible();

  /* ── 2. Decision and offer, whatever this school's workflow requires ──── */
  await registrar.goto('/school/admissions');
  const row = registrar.locator('tr', { hasText: `Pupil${stamp}` }).first();
  await expect(row).toBeVisible();

  // The server resolves which actions are available (the row's Actions menu);
  // walk the forward ones until Enroll is offered, whatever this school's
  // workflow requires.
  const FORWARD = /^(enroll|start review|documents received|screen|record interview|exam complete|score|accept|issue offer|offer accepted)/i;
  for (let i = 0; i < 10; i += 1) {
    await row.getByRole('button', { name: /actions/i }).click();
    const items = registrar.getByRole('menuitem');
    const enrollItem = items.filter({ hasText: /^enroll/i });
    if (await enrollItem.count()) {
      await enrollItem.first().click();
      break;
    }
    const next = items.filter({ hasText: FORWARD }).first();
    if (!(await next.count())) throw new Error('No forward admission action is offered for this application');
    await next.click();
    // A decision or offer may ask for a reason or a date.
    const dialog = registrar.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) {
      const reason = dialog.locator('textarea').first();
      if (await reason.isVisible().catch(() => false)) await reason.fill('Journey test decision');
      await dialog.getByRole('button', { name: /^(save|confirm|record|issue|accept|ok|submit)/i }).first().click();
    }
    await registrar.waitForTimeout(800);
  }

  /* ── 3. Enrol: the term offered must belong to the application's year ── */
  const enrollDialog = registrar.getByRole('dialog');
  // One shared dialog: the details come from the application, not re-typed.
  await expect(enrollDialog.getByText(/the year applied for|No terms for/)).toBeVisible();
  await expect(enrollDialog.getByText(`Pupil${stamp}`, { exact: false }).first()).toBeVisible();
  await choose(enrollDialog.getByLabel(/^term/i), TERM || undefined);
  await choose(enrollDialog.getByLabel(/^class/i), CLASS);
  await enrollDialog.getByLabel(/roll number/i).fill(String(stamp % 100000));
  await enrollDialog.getByRole('button', { name: /^enroll pupil/i }).click();
  await expect(registrar.getByText(/enrolled into/)).toBeVisible();
  // The success notice links straight to the new pupil (F22).
  await expect(registrar.getByRole('button', { name: /open pupil/i })).toBeVisible();

  /* ── 4. The pupil is on the course roster without anyone syncing it ──── */
  // Placement reconciles compulsory course rosters, so the teacher's frozen
  // snapshot below includes the pupil enrolled a moment ago.
  const marker = await browser.newPage();
  await signIn(marker, TEACHER_EMAIL, TEACHER_PASSWORD);

  /* ── 5. The teacher sets the CAT and the exam paper ────────────────────── */
  // The school weights continuous assessment 40% and the end-of-term exam 60%,
  // so a result needs both (F02).
  const setAssessment = async (kind: 'CAT' | 'Exam', title: string, validateDates = false) => {
    await marker.goto('/school/assessments');
    await marker.getByRole('button', { name: /new assessment|create assessment/i }).first().click();
    const wizard = marker.getByRole('dialog');
    await choose(wizard.locator('select').first(), COURSE || undefined);
    await wizard.getByRole('button', { name: kind, exact: true }).click();
    await wizard.getByLabel(/^title/i).fill(title);
    await wizard.getByRole('button', { name: /^continue/i }).click();
    if (validateDates) {
      // Step 2 validates inline: an out-of-order date sequence blocks Continue
      // and names the field, rather than failing on submit.
      await wizard.getByLabel(/^opens/i).fill('2026-10-01T08:00');
      await wizard.getByLabel(/^due/i).fill('2026-09-20T08:00');
      await expect(wizard.getByText(/Due cannot be before the assessment opens/)).toBeVisible();
      await expect(wizard.getByRole('button', { name: /^continue/i })).toBeDisabled();
      await wizard.getByLabel(/^due/i).fill('2026-10-08T08:00');
      await expect(wizard.getByText(/Due cannot be before the assessment opens/)).toBeHidden();
    }
    if (kind === 'Exam') {
      // Only open sittings without this course's paper are offered.
      await choose(wizard.locator('label', { hasText: /exam event/i }).locator('select'), 'End of Term 3');
    } else {
      // Summative: bound to the continuous-assessment component (F03).
      await choose(wizard.locator('label', { hasText: /counts toward/i }).locator('select'));
    }
    await wizard.getByRole('button', { name: /^continue/i }).click();
    await wizard.getByRole('button', { name: /capture & freeze/i }).click();
    await expect(wizard.getByText(/learner\(s\) in the frozen snapshot/)).toBeVisible();
    await wizard.getByRole('button', { name: /create assessment draft/i }).click();
    await expect(marker).toHaveURL(/\/school\/assessments\/.+\/mark/);
    // A draft is not marked: publish it to its frozen roster first.
    await marker.getByRole('button', { name: /^publish assessment/i }).click();
    await expect(marker.getByRole('button', { name: /^publish assessment/i })).toBeHidden();
  };

  /* ── 6. Marks for every learner, then submit for approval ─────────────── */
  const markAll = async (base: number, expectApplicant = true) => {
    if (expectApplicant) await expect(marker.getByLabel(`Mark for ${applicant}`, { exact: false }).first()).toBeVisible();
    const boxes = marker.locator('input[aria-label^="Mark for "]');
    await expect(boxes.first()).toBeVisible();
    const n = await boxes.count();
    for (let i = 0; i < n; i += 1) {
      const box = boxes.nth(i);
      if ((await box.isEnabled()) && !(await box.inputValue())) await box.fill(String(base + ((i * 7) % 25)));
    }
    // Nothing to save when every mark was already saved by an earlier session.
    const save = marker.getByRole('button', { name: /^save draft/i });
    if (await save.isEnabled()) await save.click();
    await expect(marker.getByRole('button', { name: /^submit marks/i })).toBeEnabled();
    await marker.getByRole('button', { name: /^submit marks/i }).click();
    await expect(marker.getByText(/sent for approval/i).first()).toBeVisible();
    return n;
  };

  const catTitle = `${assessmentTitle} CAT`;
  const examTitle = `${assessmentTitle} Paper 1`;
  await setAssessment('CAT', catTitle, true);
  const learners = await markAll(55);
  expect(learners).toBeGreaterThan(0);
  await setAssessment('Exam', examTitle);
  await markAll(48);

  /* ── 6b. Nothing left half-marked for this class ──────────────────────── */
  // A term result needs every piece of summative work finished (F02/F05). On
  // a shared demo school an earlier, interrupted run may have left work open;
  // the teacher finishes it the ordinary way — mark, then submit.
  for (let i = 0; i < 10; i += 1) {
    await marker.goto('/school/assessments');
    const pending = marker.getByRole('main').getByRole('button', { name: /^(mark|review & publish|submit marks)$/i });
    await marker.waitForTimeout(1500);
    if (!(await pending.count())) break;
    const next = pending.first();
    const label = ((await next.textContent()) ?? '').trim().toLowerCase();
    await next.click();
    if (label.includes('submit')) {
      await expect(marker.getByText(/sent for approval/i).first()).toBeVisible();
      continue;
    }
    await expect(marker).toHaveURL(/\/school\/assessments\/.+\/mark/);
    await expect(marker.getByRole('tab', { name: /markbook/i })).toBeVisible();
    const publish = marker.getByRole('button', { name: /^publish assessment/i });
    if (await publish.isVisible()) {
      await publish.click();
      await expect(publish).toBeHidden();
    }
    await markAll(50, false);
  }

  /* ── 7. Someone other than the marker approves ────────────────────────── */
  for (const title of [catTitle, examTitle]) {
    await registrar.goto('/school/approvals');
    const approvalRow = registrar.locator('tr', { hasText: title }).first();
    await expect(approvalRow).toBeVisible();
    await approvalRow.getByRole('button', { name: /^approve/i }).click();
    await expect(approvalRow).toBeHidden();
  }
  // …and anything else this class's teacher sent for approval.
  for (let i = 0; i < 10; i += 1) {
    await registrar.goto('/school/approvals');
    const row = registrar.locator('tr', { hasText: 'Journey Check' }).first();
    await registrar.waitForTimeout(1500);
    if (!(await row.count())) break;
    await row.getByRole('button', { name: /^approve/i }).click();
    await expect(registrar.getByText(/mark\(s\) approved/i).first()).toBeVisible();
  }

  /* ── 7b. Close the examination so its papers stop taking marks ────────── */
  // Every open sitting of the term's end-of-term exam — a paper still open for
  // marking must not feed a released result (Phase 5 gate).
  await registrar.goto('/school/exam-operations');
  const examSelect = registrar.getByRole('main').locator('select').first();
  await expect.poll(() => examSelect.locator('option').count()).toBeGreaterThan(0);
  const sittings = examSelect.locator('option', { hasText: 'End of Term 3' });
  const sittingValues = await sittings.evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  const done = registrar.getByText(/nothing further to advance/i);
  for (const value of sittingValues) {
    await examSelect.selectOption(value);
    // Marking → moderation → results ready → closed: each step's gate must pass.
    for (let i = 0; i < 5; i += 1) {
      const move = registrar.getByRole('button', { name: /^move to/i });
      await expect(move.or(done).first()).toBeVisible();
      if (await done.isVisible()) break;
      const label = (await move.textContent()) ?? '';
      await expect(move).toBeEnabled();
      await move.click();
      // Wait until the page shows the following step (or the end).
      await expect
        .poll(
          async () => ((await done.isVisible()) ? 'done' : ((await move.textContent({ timeout: 2000 }).catch(() => '')) ?? '')),
          { timeout: 60_000 },
        )
        .not.toBe(label);
    }
    await expect(done).toBeVisible();
  }

  /* ── 8. Lock the whole-class list for the term, then compute and release ── */
  // Results come from a locked class list of THIS term (F06), never from an
  // assessment's subject roster.
  await registrar.goto('/school/assessment-ops');
  await choose(registrar.getByRole('main').locator('select').first(), TERM || undefined);
  await choose(registrar.getByRole('main').locator('select').nth(1), CLASS);
  await registrar.getByPlaceholder(/name this class list/i).fill(`Journey list ${stamp}`);
  await registrar.getByRole('button', { name: /save class list/i }).click();
  // The saved list is selected; lock it.
  await registrar.getByRole('button', { name: /^freeze/i }).first().click();
  await expect(registrar.getByText(/class list locked/i).first()).toBeVisible();

  await registrar.goto('/school/results');
  await choose(registrar.getByRole('main').locator('select').first(), TERM || undefined);
  await choose(registrar.getByRole('main').locator('select').nth(1), `Journey list ${stamp}`);
  await registrar.getByRole('button', { name: /work out results/i }).click();
  // First release of the term: work out, then release. A term already released
  // (an earlier run) is not recomputed over — that needs an approved amendment
  // (F04) — and its released version is what the report cards use.
  const computed = registrar.getByText(/results worked out/i).first();
  const refused = registrar.getByText(/already released/i).first();
  await expect(computed.or(refused).first()).toBeVisible();
  const firstRelease = await computed.isVisible();
  if (firstRelease) {
    await registrar.getByRole('button', { name: /release to parents/i }).click();
    await expect(registrar.getByText(/results released to parents/i).first()).toBeVisible();
  } else {
    await expect(registrar.getByText(/released/i).first()).toBeVisible();
  }

  /* ── 9. Only now can a report card be released to the family ──────────── */
  // The third handoff: publication requires provenance pinned to the published
  // ResultSet revision, so this must be generated AFTER step 8 to be releasable.
  await registrar.goto('/school/report-cards');
  const rcSelects = registrar.getByRole('main').locator('select');
  await choose(rcSelects.nth(0), CLASS); // class
  await choose(rcSelects.nth(1), TERM || undefined); // term
  await registrar.getByRole('button', { name: /^(build all|generate)/i }).first().click();
  await expect(registrar.getByText(/report cards? ready for/i).first()).toBeVisible();
  await registrar.getByRole('button', { name: /^(release all|publish)/i }).first().click();
  const released = registrar.getByText(/report cards? released to families/i).first();
  await expect(released).toBeVisible();
  // The term's first release puts cards out; a later run finds them already out
  // and holds back cards for pupils admitted after the release (they need an amendment).
  if (firstRelease) expect(Number((await released.textContent())?.match(/\d+/)?.[0] ?? 0)).toBeGreaterThan(0);

  await marker.close();
  await registrar.close();
});
