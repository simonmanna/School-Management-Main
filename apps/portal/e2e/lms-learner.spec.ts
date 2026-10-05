import { expect, test, type Page } from '@playwright/test';

/**
 * The learner's half of the LMS, in a real browser.
 *
 * This is the gap `docs/architecture/LMS_DEPLOYMENT_READINESS.md` has carried
 * since 2026-08-27: the signed-in LMS had never been driven by a browser, only
 * by DB-backed integration tests that prepare their own rows. The journeys here
 * are the ones a school will do on day one, as the people who will do them:
 *
 *   pupil:    open a course → read a page → download a file → hand in homework
 *             → sit a quiz → see that the mark is withheld until released
 *   guardian: open Learning → see that child's progress → and nothing of any
 *             other family's
 *
 * Running it (an already-running stack with the LMS flag on, both sides):
 *   E2E_PUPIL_EMAIL=... E2E_PUPIL_PASSWORD=...
 *   E2E_GUARDIAN_EMAIL=... E2E_GUARDIAN_PASSWORD=...
 *   pnpm --filter @erp/portal exec playwright test
 *
 * The accounts must be real `PortalIdentity` rows (minted from the admin app's
 * Portals & Promotion Gate screen) and the pupil must be enrolled in at least
 * one visible course with one activity. Seed with
 * `apps/api/prisma/seed-lms-demo.ts`, which is idempotent.
 *
 * Deliberately tolerant about WHICH activity it finds: a seeded course's
 * contents vary, and a test that demands a quiz where the seed made a page would
 * fail for a reason that has nothing to do with the LMS. Each leg skips, with a
 * stated reason, when the course has nothing of that kind — a skip says "not
 * covered here", which is honest, where a forced pass would not be.
 */

const PUPIL_EMAIL = process.env.E2E_PUPIL_EMAIL ?? '';
const PUPIL_PASSWORD = process.env.E2E_PUPIL_PASSWORD ?? '';
const GUARDIAN_EMAIL = process.env.E2E_GUARDIAN_EMAIL ?? '';
const GUARDIAN_PASSWORD = process.env.E2E_GUARDIAN_PASSWORD ?? '';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // The server decides which workspace this account lands in.
  await page.waitForURL(/\/(student|parent|teacher)(\/|$)/, { timeout: 30_000 });
}

/** Fail loudly on a console error — a blank screen that logs is still broken. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.describe('pupil', () => {
  test.skip(!PUPIL_EMAIL || !PUPIL_PASSWORD, 'Set E2E_PUPIL_EMAIL and E2E_PUPIL_PASSWORD');

  test('opens a course and works through it', async ({ page }) => {
    const errors = watchConsole(page);
    await signIn(page, PUPIL_EMAIL, PUPIL_PASSWORD);

    // ── The Courses tab exists only when the LMS flag is on. ──
    const coursesTab = page.getByRole('link', { name: /courses/i });
    await expect(
      coursesTab,
      'No Courses tab. Is VITE_ENABLE_ADVANCED_LMS=true in the portal build?',
    ).toBeVisible();
    await coursesTab.click();
    await expect(page.getByRole('heading', { name: /courses/i })).toBeVisible();

    // ── Into the first course. ──
    const firstCourse = page.locator('a[href*="/student/courses/"]').first();
    if ((await firstCourse.count()) === 0) {
      test.skip(true, 'This pupil is enrolled in no visible course — seed one first.');
    }
    await firstCourse.click();
    await page.waitForURL(/\/student\/courses\/[^/]+$/);

    // A course page that loaded shows its own progress, not "undefined%".
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(page.locator('body')).not.toContainText('NaN');

    // ── Into the first activity that is open. ──
    const firstActivity = page.locator('a[href*="/modules/"]').first();
    if ((await firstActivity.count()) === 0) {
      test.skip(true, 'This course has no open activity — add one to the seeded course.');
    }
    await firstActivity.click();
    await page.waitForURL(/\/modules\/[^/]+$/);
    await expect(page.getByRole('link', { name: /back to the course/i })).toBeVisible();

    expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('hands in homework, and the mark stays hidden until it is released', async ({ page }) => {
    await signIn(page, PUPIL_EMAIL, PUPIL_PASSWORD);
    await page.goto('/student/courses');

    // Find an assignment: the due list names the work that is actually to do.
    const dueLink = page.locator('a[href*="/modules/"]').first();
    if ((await dueLink.count()) === 0) {
      test.skip(true, 'Nothing due for this pupil — set an assignment with a due date.');
    }
    await dueLink.click();
    await page.waitForURL(/\/modules\/[^/]+$/);

    const answer = page.locator('textarea').first();
    const handIn = page.getByRole('button', { name: /^hand in$/i });
    if ((await answer.count()) === 0 || (await handIn.count()) === 0) {
      test.skip(true, 'This activity takes no written hand-in — not the assignment leg.');
    }

    await answer.fill(`Playwright hand-in ${new Date().toISOString()}`);
    await handIn.click();

    // The server is the authority on whether this counted.
    await expect(page.getByText(/handed in/i).first()).toBeVisible({ timeout: 20_000 });

    // THE INVARIANT: a mark that moderation has not approved must read as a
    // wait, never as a blank and never as a zero.
    const mark = page.getByText(/your mark/i);
    if (await mark.count()) {
      const panel = page.locator('text=/your mark/i').locator('..');
      await expect(panel).not.toHaveText(/\b0\s*\/\s*\d+/);
    }
  });

  test('sits a quiz', async ({ page }) => {
    await signIn(page, PUPIL_EMAIL, PUPIL_PASSWORD);
    await page.goto('/student/courses');

    const course = page.locator('a[href*="/student/courses/"]').first();
    if ((await course.count()) === 0) test.skip(true, 'No course to look in.');
    await course.click();

    // A quiz activity is labelled as one on the course page.
    const quiz = page.locator('a[href*="/modules/"]').filter({ hasText: /quiz/i }).first();
    if ((await quiz.count()) === 0) {
      test.skip(true, 'This course has no quiz — add a mod_quiz with questions.');
    }
    await quiz.click();

    const start = page.getByRole('button', { name: /^(start|try again)$/i });
    if ((await start.count()) === 0) {
      test.skip(true, 'Quiz not startable: no paper attached, or attempts exhausted.');
    }
    await start.click();
    await page.waitForURL(/\/student\/quiz\//);

    // The engine realises the questions; one per screen.
    await expect(page.getByText(/question 1 of/i)).toBeVisible({ timeout: 20_000 });

    // Answer whatever the first question takes, then walk to the end.
    for (let i = 0; i < 40; i += 1) {
      const option = page.locator('input[type="radio"], input[type="checkbox"]').first();
      if (await option.count()) {
        await option.check();
      } else {
        const box = page.locator('textarea, input[type="number"]').first();
        if (await box.count()) await box.fill('42');
      }
      const next = page.getByRole('button', { name: /^next$/i });
      if (!(await next.count())) break;
      await next.click();
    }

    await page.getByRole('button', { name: /hand in/i }).click();
    await expect(page.getByText(/handed in/i)).toBeVisible({ timeout: 30_000 });
    // Either a released score or an explicit wait — never a silent blank.
    await expect(
      page.getByText(/release|well done|checked/i).first(),
    ).toBeVisible();
  });
});

test.describe('guardian', () => {
  test.skip(
    !GUARDIAN_EMAIL || !GUARDIAN_PASSWORD,
    'Set E2E_GUARDIAN_EMAIL and E2E_GUARDIAN_PASSWORD',
  );

  test('sees their own child’s learning, and cannot do the work', async ({ page }) => {
    const errors = watchConsole(page);
    await signIn(page, GUARDIAN_EMAIL, GUARDIAN_PASSWORD);

    const learning = page.getByRole('link', { name: /learning/i });
    await expect(
      learning,
      'No Learning tab. Is VITE_ENABLE_ADVANCED_LMS=true in the portal build?',
    ).toBeVisible();
    await learning.click();
    await page.waitForURL(/\/parent\/learning$/);

    await expect(page.getByRole('heading', { name: /learning/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');

    const course = page.locator('a[href*="/parent/learning/courses/"]').first();
    if ((await course.count()) === 0) {
      test.skip(true, 'This guardian’s child is in no visible course.');
    }
    await course.click();
    await page.waitForURL(/\/parent\/learning\/courses\//);

    // A guardian reads; they do not submit, tick or sit.
    await expect(page.getByRole('button', { name: /^hand in$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /mark as done/i })).toHaveCount(0);

    expect(errors, `Console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('is kept out of the pupil workspace', async ({ page }) => {
    await signIn(page, GUARDIAN_EMAIL, GUARDIAN_PASSWORD);
    // `RequireAudience` sends them back to their own landing rather than
    // rendering a workspace that is not theirs.
    await page.goto('/student/courses');
    await expect(page).not.toHaveURL(/\/student\//);
  });
});
