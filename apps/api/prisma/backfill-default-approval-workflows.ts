/**
 * P0 backfill — install the default approval workflows into EXISTING orgs.
 *
 * `seed.ts` only ever touches the demo organization, so a deployment that was
 * seeded before these defaults existed still has zero `ApprovalWorkflow` rows,
 * which means `ApprovalsService` auto-approves every gate: discounts, refunds,
 * write-offs, stock adjustments. This script closes that gap for every
 * organization in the database.
 *
 * Idempotent, and never modifies a workflow that already exists — an operator's
 * retuning or activation always wins over these defaults. See
 * `default-approval-workflows.ts` for the thresholds and for why the finance
 * workflows ship inactive.
 *
 * DRY-RUN BY DEFAULT — prints what it would do. Pass `--apply` to commit:
 *   npx tsx prisma/backfill-default-approval-workflows.ts           # preview
 *   npx tsx prisma/backfill-default-approval-workflows.ts --apply   # execute
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { applyDefaultApprovalWorkflows, DEFAULT_APPROVAL_WORKFLOWS } from './default-approval-workflows';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '[dry-run] ';

async function main() {
  const activeCount = DEFAULT_APPROVAL_WORKFLOWS.filter((d) => d.isActive).length;
  console.log(
    `${tag}Default approval-workflow backfill — ${DEFAULT_APPROVAL_WORKFLOWS.length} definitions ` +
      `(${activeCount} active, ${DEFAULT_APPROVAL_WORKFLOWS.length - activeCount} inactive).`,
  );

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`${orgs.length} organization(s)\n`);

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    console.log(`  ${org.name}`);
    const res = await applyDefaultApprovalWorkflows(prisma, org.id, {
      apply: APPLY,
      log: (msg) => console.log(`    ${tag}${msg}`),
    });
    if (res.created === 0) console.log('    = all defaults already present');
    created += res.created;
    skipped += res.skipped;
  }

  console.log(
    `\n${tag}Done. ${created} workflow(s) to create, ${skipped} already present.` +
      (APPLY ? '' : ' Re-run with --apply to commit.'),
  );
  if (APPLY && created > 0) {
    console.log(
      '\nNOTE: gates above their threshold now BLOCK until approved. Confirm a second\n' +
        'approver exists (an approver may not approve their own request) and retune the\n' +
        'amounts on the Approval Workflows page for this deployment\'s currency.',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
