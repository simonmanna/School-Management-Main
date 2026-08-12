/**
 * F.5b backfill — migrate legacy ApprovalPolicy rows to the new multi-step
 * ApprovalWorkflow model, and grant the new approval permissions.
 *
 * For each org:
 *   - every ApprovalPolicy → a 1-step ApprovalWorkflow (step1 = the policy's
 *     approverPermissions / requiredCount / minAmount). Idempotent: skips when a
 *     workflow already exists for that (entityType, name).
 *   - link open (pending) ApprovalRequests for that entityType to the new
 *     workflow (workflowId + currentStep=1) so decide() uses the step engine.
 *   - grant `approvals:manage` to roles that can already read approvals, and the
 *     new `*:approve` perms to roles that hold the matching module permission.
 *
 * DRY-RUN BY DEFAULT — prints what it would do. Pass `--apply` to commit:
 *   npx ts-node prisma/backfill-approval-workflows.ts           # preview
 *   npx ts-node prisma/backfill-approval-workflows.ts --apply   # execute
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '[dry-run] ';

// Grant `X:approve` to any role that already holds `X:...` (the module owner).
const APPROVE_GRANTS: { approve: string; impliedBy: string }[] = [
  { approve: 'expense:approve', impliedBy: 'expense:post' },
  { approve: 'debit_note:approve', impliedBy: 'debit_note:post' },
  { approve: 'asset_depreciation:approve', impliedBy: 'asset_depreciation:run' },
];

async function backfillWorkflows() {
  const policies = await prisma.approvalPolicy.findMany();
  for (const p of policies) {
    const existing = await prisma.approvalWorkflow.findFirst({
      where: { organizationId: p.organizationId, entityType: p.entityType, name: p.name },
    });
    if (existing) {
      console.log(`  = workflow "${p.name}" (${p.entityType}) already exists — skipping`);
      continue;
    }
    console.log(`  ${tag}+ workflow "${p.name}" (${p.entityType}) ← policy ${p.id}`);
    if (APPLY) {
      const wf = await prisma.approvalWorkflow.create({
        data: {
          organizationId: p.organizationId,
          name: p.name,
          entityType: p.entityType,
          minAmount: p.minAmount,
          isActive: p.isActive,
          steps: {
            create: [
              {
                organizationId: p.organizationId,
                stepOrder: 1,
                name: 'Approval',
                approverPermissions: p.approverPermissions,
                requiredCount: p.requiredCount,
              },
            ],
          },
        },
      });
      // Link open requests for this entityType that aren't yet on a workflow.
      const linked = await prisma.approvalRequest.updateMany({
        where: {
          organizationId: p.organizationId,
          entityType: p.entityType,
          status: 'pending',
          workflowId: null,
        },
        data: { workflowId: wf.id, currentStep: 1 },
      });
      if (linked.count) console.log(`      ↳ linked ${linked.count} pending request(s)`);
    }
  }
}

async function backfillPermissions() {
  const roles = await prisma.role.findMany({ select: { id: true, name: true, permissions: true } });
  for (const role of roles) {
    const perms: string[] = role.permissions ?? [];
    const additions = new Set<string>();
    if (perms.includes('approvals:read') && !perms.includes('approvals:manage')) {
      additions.add('approvals:manage');
    }
    for (const g of APPROVE_GRANTS) {
      if (perms.includes(g.impliedBy) && !perms.includes(g.approve)) additions.add(g.approve);
    }
    if (!additions.size) continue;
    console.log(`  ${tag}~ role "${role.name}": +${[...additions].join(', ')}`);
    if (APPLY) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: Array.from(new Set([...perms, ...additions])) },
      });
    }
  }
}

async function main() {
  console.log(`${tag}F.5b approval-workflow backfill starting…`);
  await backfillWorkflows();
  await backfillPermissions();
  console.log(`${tag}Done.${APPLY ? '' : ' Re-run with --apply to commit.'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
