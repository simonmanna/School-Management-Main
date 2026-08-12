/**
 * DMS registry seeding — pure functions executed by both the runtime boot
 * seeder (dms.seeder.ts) and `prisma seed.ts`. Idempotent upserts keyed on
 * stable codes. Validation failures throw (guard vocabulary G4, state targets).
 */
import type { PrismaClient } from '@prisma/client';
import {
  DMS_LIFECYCLES,
  DMS_RELATION_TYPES,
  DMS_TEMPLATE_SEEDS,
  DMS_TYPE_POLICIES,
  buildPermissionRows,
} from './dms.seed-data';
import type { LifecycleSeed, TypePolicy } from './dms.types';
import { validateGuardJson } from './dms.types';

type AnyClient = PrismaClient | Record<string, any>;

export interface SeedDmsResult {
  lifecycles: number;
  transitions: number;
  types: number;
  relationTypes: number;
  templates: number;
  permissions: number;
}

/**
 * Pure validation of lifecycle seeds: initial state ∈ states, every
 * transition endpoint ∈ states, no duplicate (from, action), guard keys from
 * the fixed vocabulary. Returns the transition count. Throws on violations.
 */
export function validateLifecycleSeeds(lifecycles: LifecycleSeed[]): number {
  let transitions = 0;
  for (const lc of lifecycles) {
    if (!lc.states.includes(lc.initialState)) {
      throw new Error(`DMS lifecycle ${lc.code}: initialState '${lc.initialState}' not in states`);
    }
    const seen = new Set<string>();
    for (const t of lc.transitions) {
      if (seen.has(`${t.from}.${t.action}`)) {
        throw new Error(`DMS lifecycle ${lc.code}: duplicate transition ${t.from}.${t.action}`);
      }
      seen.add(`${t.from}.${t.action}`);
      if (!lc.states.includes(t.from)) {
        throw new Error(`DMS lifecycle ${lc.code}: fromState '${t.from}' not in states`);
      }
      if (!lc.states.includes(t.to)) {
        throw new Error(`DMS lifecycle ${lc.code}: toState '${t.to}' not in states`);
      }
      validateGuardJson(t.guard, `${lc.code}.${t.from}.${t.action}`);
      transitions += 1;
    }
  }
  return transitions;
}

/** Pure validation of type seeds: every type references an existing lifecycle. */
export function validateTypePolicies(policies: TypePolicy[], lifecycleCodes: string[]): void {
  for (const t of policies) {
    if (!lifecycleCodes.includes(t.lifecycle)) {
      throw new Error(`DMS type ${t.code}: unknown lifecycle '${t.lifecycle}'`);
    }
  }
}

export async function seedDmsRegistry(client: AnyClient): Promise<SeedDmsResult> {
  // ---- Validate first (pure, no DB) ----
  const transitionCount = validateLifecycleSeeds(DMS_LIFECYCLES);
  validateTypePolicies(DMS_TYPE_POLICIES, DMS_LIFECYCLES.map((l) => l.code));

  const lifecycleIds = new Map<string, string>();

  // ---- Lifecycles ----
  for (const lc of DMS_LIFECYCLES) {
    const row = await client.documentLifecycle.upsert({
      where: { code: lc.code },
      update: {
        name: lc.name,
        description: lc.description ?? null,
        states: lc.states,
        initialState: lc.initialState,
        isSystem: true,
      },
      create: {
        code: lc.code,
        name: lc.name,
        description: lc.description ?? null,
        states: lc.states,
        initialState: lc.initialState,
        isSystem: true,
      },
    });
    lifecycleIds.set(lc.code, row.id);
  }

  // ---- Transitions ----
  let transitions = 0;
  for (const lc of DMS_LIFECYCLES) {
    const lifecycleId = lifecycleIds.get(lc.code)!;
    for (const t of lc.transitions) {
      const guard = validateGuardJson(t.guard, `${lc.code}.${t.from}.${t.action}`);
      await client.documentTransition.upsert({
        where: { lifecycleId_fromState_action: { lifecycleId, fromState: t.from, action: t.action } },
        update: { toState: t.to, guardJson: guard },
        create: {
          lifecycleId,
          fromState: t.from,
          toState: t.to,
          action: t.action,
          guardJson: guard,
          isSystem: true,
        },
      });
      transitions += 1;
    }
  }

  // ---- Relation types ----
  let relationTypes = 0;
  for (const r of DMS_RELATION_TYPES) {
    await client.documentRelationType.upsert({
      where: { code: r.code },
      update: {
        name: r.name,
        description: r.description ?? null,
        direction: r.direction ?? 'out',
        allowedSourceCategories: r.allowedSourceCategories ?? [],
        allowedTargetCategories: r.allowedTargetCategories ?? [],
        cardinality: r.cardinality ?? 'many',
        inverseImplicit: r.inverseImplicit ?? false,
        duplicatesAllowed: r.duplicatesAllowed ?? false,
        isSystem: true,
      },
      create: {
        code: r.code,
        name: r.name,
        description: r.description ?? null,
        direction: r.direction ?? 'out',
        allowedSourceCategories: r.allowedSourceCategories ?? [],
        allowedTargetCategories: r.allowedTargetCategories ?? [],
        cardinality: r.cardinality ?? 'many',
        inverseImplicit: r.inverseImplicit ?? false,
        duplicatesAllowed: r.duplicatesAllowed ?? false,
        isSystem: true,
      },
    });
    relationTypes += 1;
  }

  // ---- Document types ----
  let types = 0;
  const typeIds = new Map<string, string>();
  for (const t of DMS_TYPE_POLICIES) {
    const lifecycleId = lifecycleIds.get(t.lifecycle)!;
    const data = {
      name: t.name,
      description: t.description ?? null,
      category: t.category,
      isSystem: true,
      numberingKey: t.numberingKey ?? null,
      numberingPrefix: t.numberingPrefix ?? null,
      numberingPadding: t.numberingPadding ?? 6,
      lifecycleId,
      approvalPolicy: t.approvalPolicy ?? undefined,
      postingPolicy: t.postingPolicy ?? undefined,
      paymentPolicy: undefined,
      cancellationPolicy: t.cancellationPolicy ?? undefined,
      editPolicy: t.editPolicy ?? 'EDITABLE',
      snapshotPolicy: t.snapshotPolicy ?? undefined,
      printProfile: t.printProfile ?? undefined,
      businessEffects: t.businessEffects ?? undefined,
      security: t.security ?? undefined,
      isFinancial: t.isFinancial ?? false,
      isInventoryRelevant: t.isInventoryRelevant ?? false,
      requiresPosting: t.requiresPosting ?? false,
    };
    const typeRow = await client.documentTypeDef.upsert({
      where: { code: t.code },
      update: data,
      create: { code: t.code, ...data },
    });
    typeIds.set(t.code, typeRow.id);
    types += 1;
  }

  // ---- Render templates (Phase 4): one A4 per type + thermal for receipts ----
  let templates = 0;
  for (const te of DMS_TEMPLATE_SEEDS) {
    const documentTypeId = typeIds.get(te.typeCode);
    if (!documentTypeId) continue;
    const where = { templateKey_version: { templateKey: te.templateKey, version: 1 } };
    await client.templateDefinition.upsert({
      where,
      update: { name: te.name, format: te.format, engine: te.engine, content: te.content, isActive: true },
      create: {
        templateKey: te.templateKey,
        documentTypeId,
        format: te.format,
        engine: te.engine,
        version: 1,
        name: te.name,
        content: te.content,
        isActive: true,
      },
    });
    templates += 1;
  }

  // ---- Permission catalog (generic + dynamic per-type keys) ----
  let permissions = 0;
  for (const p of buildPermissionRows()) {
    await client.permission.upsert({
      where: { key: p.key },
      update: {},
      create: { key: p.key, resource: p.resource, action: p.action, description: p.description },
    });
    permissions += 1;
  }

  return {
    lifecycles: DMS_LIFECYCLES.length,
    transitions: transitionCount,
    types,
    relationTypes,
    templates,
    permissions,
  };
}

/**
 * Append all DMS permission keys to every system role (Administrator etc.) so
 * bootstrapped orgs can act on documents without per-org provisioning (O7).
 * Idempotent; preserves any role-specific grants.
 */
export async function wireDmsRoleKeys(client: AnyClient): Promise<number> {
  const roles = await client.role.findMany({
    where: { isSystem: true },
    select: { id: true, permissions: true },
  });
  const keys = buildPermissionRows().map((r) => r.key);
  let updated = 0;
  for (const role of roles) {
    const current: string[] = Array.isArray(role.permissions) ? role.permissions : [];
    const merged = Array.from(new Set([...current, ...keys]));
    if (merged.length !== current.length) {
      await client.role.update({ where: { id: role.id }, data: { permissions: merged } });
      updated += 1;
    }
  }
  return updated;
}