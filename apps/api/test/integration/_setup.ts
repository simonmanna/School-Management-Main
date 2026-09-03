/**
 * Integration test scaffolding. These specs run the full request → DB →
 * response path against a live Postgres.
 *
 * QA-01: `describeDb` used to be `describe.skip` when `DATABASE_URL` was unset,
 * which made 55 of 56 suites report as passing without a database. It is now a
 * plain `describe`, and the absence of a database is a hard failure raised by
 * `jest.setup.ts` (wired as `setupFilesAfterEnv` on the `integration` project).
 * The guard is repeated here so that importing this module fails loudly too,
 * whatever runner picked the spec up.
 *
 * `describeDb` is kept as an export purely so the 55 existing specs need no
 * edit; new specs can use `describe` directly.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Integration tests require DATABASE_URL — see apps/api/test/integration/jest.setup.ts.',
  );
}

jest.setTimeout(180_000);

/** @deprecated Use `describe`. Retained so existing specs compile unchanged. */
const describeDb = describe;

export { describeDb };
