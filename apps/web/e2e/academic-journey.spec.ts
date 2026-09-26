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
  await page.getByPlaceholder('DEMO').fill(ORG);
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Pick the first real option of a `select`, or the one whose label matches. */
async function choose(select: ReturnType<Page['locator']>, label?: string) {
  if (label) {
    await select.selectOption({ label });
    return label;
  }
  const options = select.locator('option');
  const count = await options.count();
  expect(count, 'the selector had no options to choose from').toBeGreaterThan(1);
  const text = (await options.nth(1).textContent())!.trim();
  await select.selectOption({ index: 1 });
  return text;
}

test('application → enrolment → assessment → marks → results → published report', async ({ browser }) => {
  const stamp = Date.now();
  const applicant = `Journey Pupil ${stamp}`;
  const assessmentTitle = `Journey Check ${stamp}`;

  const registrar = await browser.newPage();
  await signIn(registrar, EMAIL, PASSWORD);

  /* ── 1. The application arrives ───────────────────────────────────────── */
  await registrar.goto('/school/applications');
  await registrar.getByRole('button', { name: /new application|create/i }).first().click();
  const appDialog = registrar.getByRole('dialog');
  await appDialog.getByLabel(/first name/i).fill('Journey');
  await appDialog.getByLabel(/last name/i).fill(`Pupil${stamp}`);
  // Academic year, then the class applied for. The year matters: the term offered
  // at enrolment is filtered by it (Wave 10 H1).
  const appSelects = appDialog.locator('select');
  await choose(appSelects.nth(0));
  await choose(appSelects.nth(1));
  await appDialog.getByRole('button', { name: /^(save|create|submit)/i }).click();
  await expect(registrar.getByText(new RegExp(`Pupil${stamp}`))).toBeVisible();

  /* ── 2. Decision and offer, whatever this school's workflow requires ──── */
  await registrar.goto('/school/admissions');
  const row = registrar.getByRole('row', { hasText: `Pupil${stamp}` });
  await expect(row).toBeVisible();

  // The server resolves which actions are available; walk them until the
  // application is enrollable rather than assuming a particular workflow.
  for (let i = 0; i < 6; i += 1) {
    const enroll = row.getByRole('button', { name: /^enrol/i });
    if (await enroll.isVisible().catch(() => false)) break;
    const next = row.getByRole('button').filter({ hasNotText: /view|open/i }).first();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    // A decision or offer may ask for a reason; accept the dialog's default.
    const dialog = registrar.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: /^(save|confirm|record|issue|accept|ok)/i }).first().click();
    }
    await registrar.waitForTimeout(500);
  }

  /* ── 3. Enrol: the term offered must belong to the application's year ── */
  await row.getByRole('button', { name: /^enrol/i }).click();
  const enrollDialog = registrar.getByRole('dialog');
  await expect(enrollDialog.getByText(/is the year this application is for|No terms defined for/)).toBeVisible();
  const enrollSelects = enrollDialog.locator('select');
  await choose(enrollSelects.nth(0)); // class
  const termSelect = enrollDialog.getByLabel(/^term/i).or(enrollSelects.nth(2));
  await choose(termSelect, TERM || undefined);
  await enrollDialog.getByLabel(/student name/i).fill(applicant);
  await enrollDialog.getByLabel(/roll number/i).fill(String(stamp % 100000));
  await enrollDialog.getByRole('button', { name: /^enrol/i }).click();
  await expect(registrar.getByText(new RegExp(`${applicant} enrolled into`))).toBeVisible();

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
  await wizard.getByRole('button', { name: /^continue/i }).click();

  // Step 3: freeze the roster the marks will hang off.
  await wizard.getByRole('button', { name: /capture & freeze/i }).click();
  await expect(wizard.getByText(/learner\(s\) in the frozen snapshot/)).toBeVisible();
  await wizard.getByRole('button', { name: /create assessment draft/i }).click();
  await expect(marker).toHaveURL(/\/school\/assessments\/.+\/mark/);

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

  /* ── 8. Compute the term's results and release them ───────────────────── */
  await registrar.goto('/school/results');
  await choose(registrar.locator('select').first(), TERM || undefined);
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
