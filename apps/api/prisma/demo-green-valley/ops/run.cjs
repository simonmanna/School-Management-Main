/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Runner for the school-operations demo (finance, HR & payroll, expenses,
 * transport, meals).
 *
 * Unlike the academic stages, money here must go through the application's own
 * services: an invoice is a Document + SchoolFeeInvoice + a posted journal, a
 * receipt is a Payment + allocations + residual updates + a journal, a payroll
 * run is items + payslips + a journal. Re-implementing that in a seed would be a
 * second, drifting copy of the posting rules — and a trial balance that does
 * not tie in front of a client is worse than no demo at all.
 *
 * So this boots the compiled API (dist/) as a Nest application context, with
 * communication and every cron switched off, and hands its services to the
 * TypeScript stages in ./index.ts. Only those stage files go through tsx (a
 * namespaced register); dist/ loads natively, which keeps boot near 20s.
 *
 * Prerequisites: the academic demo (db:seed:sunrise-demo) and a current build
 * (pnpm --filter @erp/api build).
 *
 *   pnpm --filter @erp/api db:seed:sunrise-ops
 */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Before anything reads the environment: no messages leave this process, no
// optional verticals boot, no backup cron.
process.env.ENABLE_COMMUNICATION = 'false';
process.env.ENABLE_COMMUNICATION_SMS = 'false';
process.env.BACKUP_CRON_ENABLED = 'false';
for (const flag of ['ENABLE_MANUFACTURING', 'ENABLE_RENTAL', 'ENABLE_REPAIR', 'ENABLE_ORDERS', 'ENABLE_TASKS', 'ENABLE_BEVERAGE']) {
  process.env[flag] = 'false';
}
require('dotenv/config');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const path = require('node:path');
const fs = require('node:fs');

const DIST = path.resolve(__dirname, '../../../dist');

async function main() {
  if (!fs.existsSync(path.join(DIST, 'app.module.js'))) {
    throw new Error(`No API build at ${DIST}. Run: pnpm --filter @erp/api build`);
  }
  const started = Date.now();
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(path.join(DIST, 'app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  // Crons would fire against the seed's moving clock. Stop every one of them.
  const { SchedulerRegistry } = require('@nestjs/schedule');
  const registry = app.get(SchedulerRegistry);
  for (const job of registry.getCronJobs().values()) job.stop();
  for (const name of registry.getIntervals()) registry.deleteInterval(name);
  for (const name of registry.getTimeouts()) registry.deleteTimeout(name);
  // A replayed year must not text 700 families about February's invoices today.
  // Events whose only consumers are notifications are recorded as already
  // shipped; everything else (DMS ledger, admission fee hooks, leave cover…)
  // still flows through the outbox as normal. The business-fact log is kept.
  const NOTIFY_ONLY = new Set([
    'school.fee.invoice.posted',
    'school.fee.payment.recorded',
    'school.meal.charge.posted',
    'school.meal.topup',
    'school.transport.charge.posted',
    'approval.requested',
    'approval.step_advanced',
    'approval.decided',
    'invoice.created',
    'invoice.posted',
    'payment.received',
  ]);
  const outbox = app.get(require(path.join(DIST, 'kernel/events/event-outbox.service')).EventOutboxService, { strict: false });
  const originalPublish = outbox.publish.bind(outbox);
  outbox.publish = async (tx, eventName, payload) => {
    if (!NOTIFY_ONLY.has(eventName)) return originalPublish(tx, eventName, payload);
    const organizationId = outbox.tenant.optionalOrganizationId ?? '';
    const db = tx ?? outbox.prisma.client;
    await db.eventOutbox.create({ data: { organizationId, eventName, payload, status: 'shipped', shippedAt: new Date() } });
    await outbox.recordFact(db, organizationId, eventName, payload);
  };
  console.log(`API context up in ${Math.round((Date.now() - started) / 1000)}s (crons stopped, comms off, notifications muted)`);

  /** Resolve a service from the compiled API by its dist path and export name. */
  const service = (relPath, exportName) => {
    const mod = require(path.join(DIST, relPath));
    if (!mod[exportName]) throw new Error(`dist/${relPath} has no export ${exportName}`);
    return app.get(mod[exportName], { strict: false });
  };
  /** A dist module itself, for its plain functions (e.g. the COA seeder). */
  const distModule = (relPath) => require(path.join(DIST, relPath));

  const { register } = require('tsx/cjs/api');
  const tsx = register({ namespace: 'demo-ops' });
  const { runOps } = tsx.require('./index.ts', __filename);
  try {
    await runOps({ service, distModule });
  } finally {
    await app.close();
    tsx.unregister();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
