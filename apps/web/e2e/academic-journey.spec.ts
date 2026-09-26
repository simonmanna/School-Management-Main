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
 *   E2E_TEACHER_EMAIL=... E2E_TEACHER_PASSWORD=...      optional second role
 *   E2E_TERM=...                                        optional: a live term
 *   pnpm --filter @erp/web exec playwright test academic-journey
 *
 * Without the teacher credentials the marking leg runs as the registrar and the
 * test says so — the journey is still proved end to end, the segregation of
 * duties is not.
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

test.skip(!ORG || !EMAIL || !PASSWORD, 'Set E2E_ORG, E2E_EMAIL and E2E_PASSWORD to run the academic journey');

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
    await expect(select.locator('option', { hasText: label }).first()).toBeAttached();
    await select.selectOption({ label });
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
  const applicant = `Journey Pupil ${stamp}`;
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
  await dates.nth(1).fill('2019-03-04');
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
  await choose(enrollDialog.getByLabel(/^class/i));
  await enrollDialog.getByLabel(/roll number/i).fill(String(stamp % 100000));
  await enrollDialog.getByRole('button', { name: /^enroll pupil/i }).click();
  await expect(registrar.getByText(/enrolled into/)).toBeVisible();
  // The success notice links straight to the new pupil (F22).
  await expect(registrar.getByRole('button', { name: /open pupil/i })).toBeVisible();

  /* ── 4. The pupil is on the course roster without anyone syncing it ──── */
  // The handoff the audit found broken: placement now reconciles compulsory
  // course rosters, so the assessment wizard can see this learner immediately.
  const marker = await browser.newPage();
  const teacherRole = !!(TEACHER_EMAIL && TEACHER_PASSWORD);
  await signIn(marker, teacherRole ? TEACHER_EMAIL : EMAIL, teacherRole ? TEACHER_PASSWORD : PASSWORD);

  /* ── 5. The teacher sets an assessment on the frozen roster ───────────── */
  await marker.goto('/school/assessments');
  await marker.getByRole('button', { name: /new assessment|create assessment/i }).first().click();
  const wizard = marker.getByRole('dialog');
  await choose(wizard.locator('select').first()); // course offering
  await wizard.getByLabel(/^title/i).fill(assessmentTitle);
  await wizard.getByRole('button', { name: /^continue/i }).click();

  // Step 2 validates inline now: an out-of-order date sequence must block
  // Continue and say which field is wrong, rather than failing on submit.
  await wizard.getByLabel(/^opens/i).fill('2026-06-01T08:00');
  await wizard.getByLabel(/^due/i).fill('2026-05-01T08:00');
  await expect(wizard.getByText(/Due cannot be before the assessment opens/)).toBeVisible();
  await expect(wizard.getByRole('button', { name: /^continue/i })).toBeDisabled();
  await wizard.getByLabel(/^due/i).fill('2026-06-08T08:00');
  await expect(wizard.getByText(/Due cannot be before the assessment opens/)).toBeHidden();
  // Summative: bound to a weighting component, so it reaches the term result (F03).
  await choose(wizard.locator('label', { hasText: /counts toward/i }).locator('select'));
  await wizard.getByRole('button', { name: /^continue/i }).click();

  // Step 3: freeze the roster the marks will hang off.
  await wizard.getByRole('button', { name: /capture & freeze/i }).click();
  await expect(wizard.getByText(/learner\(s\) in the frozen snapshot/)).toBeVisible();
  await wizard.getByRole('button', { name: /create assessment draft/i }).click();
  await expect(marker).toHaveURL(/\/school\/assessments\/.+\/mark/);
  // A draft is not marked: publish it to its frozen roster first.
  await marker.getByRole('button', { name: /^publish assessment/i }).click();

  /* ── 6. Marks, then submit for approval ───────────────────────────────── */
  await expect(marker.getByText(applicant)).toBeVisible();
  const scoreBox = marker.getByRole('spinbutton').first();
  await scoreBox.fill('72');
  await scoreBox.blur();
  await marker.getByRole('button', { name: /submit for approval|send for approval/i }).first().click();
  await expect(marker.getByText(/submitted|awaiting approval/i).first()).toBeVisible();

  /* ── 7. Someone other than the marker approves ────────────────────────── */
  await registrar.goto('/school/approvals');
  const approvalRow = registrar.getByRole('row', { hasText: assessmentTitle });
  await expect(approvalRow).toBeVisible();
  await approvalRow.getByRole('button', { name: /^approve/i }).click();
  await expect(registrar.getByText(/approved/i).first()).toBeVisible();

  /* ── 8. Lock the whole-class list for the term, then compute and release ── */
  // Results come from a locked class list of THIS term (F06), never from an
  // assessment's subject roster.
  await registrar.goto('/school/assessment-ops');
  await choose(registrar.locator('select').first(), TERM || undefined);
  await choose(registrar.locator('select').nth(1));
  await registrar.getByPlaceholder(/name this class list/i).fill(`Journey list ${stamp}`);
  await registrar.getByRole('button', { name: /save class list/i }).click();
  await registrar.getByRole('button', { name: /^freeze/i }).first().click();

  await registrar.goto('/school/results');
  await choose(registrar.locator('select').first(), TERM || undefined);
  await choose(registrar.locator('select').nth(1), `Journey list ${stamp}`);
  await registrar.getByRole('button', { name: /work out results/i }).click();
  await expect(registrar.getByText(/^Version 1/).first()).toBeVisible();
  await registrar.getByText(/^Version 1/).first().click();
  await registrar.getByRole('button', { name: /release to parents/i }).click();
  await expect(registrar.getByText(/published/i).first()).toBeVisible();

  /* ── 9. Only now can a report card be released to the family ──────────── */
  // The third handoff: publication requires provenance pinned to the published
  // ResultSet revision, so this must be generated AFTER step 8 to be releasable.
  await registrar.goto('/school/report-cards');
  const rcSelects = registrar.locator('select');
  await choose(rcSelects.nth(0)); // class
  await choose(rcSelects.nth(1), TERM || undefined); // term
  await registrar.getByRole('button', { name: /^(build all|generate)/i }).first().click();
  await expect(registrar.getByText(/generated|ready/i).first()).toBeVisible();
  await registrar.getByRole('button', { name: /^(release all|publish)/i }).first().click();
  await expect(registrar.getByText('Published').first()).toBeVisible();

  await marker.close();
  await registrar.close();
});
