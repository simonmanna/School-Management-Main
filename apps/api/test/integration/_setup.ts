/**
 * D5-1: integration test scaffolding. These specs run against a live Postgres
 * (DATABASE_URL must be reachable). They exercise the full request → DB →
 * response path for the money flows that a POS / cashier must hit during a
 * real shift.
 *
 * Skipped automatically when no DATABASE_URL is configured. In CI we run
 * `docker compose up -d db` then `pnpm test:integration`.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

export { describeDb };
export const skipIfNoDb = (name: string, fn: () => void | Promise<void>) =>
  HAS_DB ? fn() : Promise.resolve();