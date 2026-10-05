/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Runner for the admissions & enrollment demo.
 *
 * An admission is not a row. It is a status machine with a frozen workflow
 * snapshot, a seat ledger that must not over-admit, identity matching against
 * the existing roll, an application-fee invoice with its own journal entry, and
 * — at the end — a Partner, a StudentProfile, an enrollment and a placement.
 * Writing those by hand would be a second copy of the admission rules, drifting
 * from the one the client is about to click.
 *
 * So this boots the compiled API (dist/) as a Nest application context, with
 * communication and every cron switched off, and hands its services to the
 * TypeScript stage in ./index.ts.
 *
 * Prerequisites: the academic demo (db:seed:sunrise-demo), the operations demo
 * (db:seed:sunrise-ops, for the chart of accounts and fiscal periods the
 * application fee posts into) and a current build (pnpm --filter @erp/api build).
 *
 *   pnpm --filter @erp/api db:seed:sunrise-admissions
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

  // Crons would fire against the seed's moving clock — including the offer-expiry
  // worker, which this stage calls deliberately, at a date it chooses.
  const { SchedulerRegistry } = require('@nestjs/schedule');
  const registry = app.get(SchedulerRegistry);
  for (const job of registry.getCronJobs().values()) job.stop();
  for (const name of registry.getIntervals()) registry.deleteInterval(name);
  for (const name of registry.getTimeouts()) registry.deleteTimeout(name);

  // A replayed intake must not text a hundred families about offers they were
  // made in August. Events whose only consumers are notifications are recorded
  // as already shipped; everything else still flows through the outbox, and the
  // business-fact log is kept intact.
  const NOTIFY_ONLY = new Set([
    'school.admission.submitted',
    'school.admission.status_changed',
    'school.admission.decision',
    'school.admission.offer_issued',
    'school.admission.offer_accepted',
    'school.admission.enrolled',
    'school.admission.fee.invoiced',
    'school.admission.fee.paid',
    'school.fee.invoice.posted',
    'school.fee.payment.recorded',
    'invoice.created',
    'invoice.posted',
    'payment.received',
    'approval.requested',
    'approval.step_advanced',
    'approval.decided',
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
  const distModule = (relPath) => require(path.join(DIST, relPath));

  const { register } = require('tsx/cjs/api');
  const tsx = register({ namespace: 'demo-admissions' });
  const { runAdmissions } = tsx.require('./index.ts', __filename);
  try {
    await runAdmissions({ service, distModule });
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
