/**
 * Integration-project setup (`setupFilesAfterEnv`).
 *
 * QA-01. Integration specs used to opt out of themselves: `_setup.ts` exported
 * `describe.skip` when `DATABASE_URL` was unset, so 55 of 56 suites reported as
 * passing without ever touching a database. A green run proved nothing.
 *
 * This file runs before every spec in the `integration` project and fails the
 * whole project when the database it needs is absent. It is wired through jest
 * config rather than an import, so a new spec that forgets to import `_setup.ts`
 * is still covered.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Integration tests require DATABASE_URL. They must fail, not skip: a suite ' +
      'that silently passes without a database is worse than no suite at all. ' +
      'Start one with `docker compose up -d db`, or run only the unit project ' +
      'with `jest --selectProjects unit`.',
  );
}

// A full Nest module graph plus a seeded organization in `beforeAll` comfortably
// exceeds Jest's 5s default, especially with several suites sharing one database.
jest.setTimeout(180_000);
