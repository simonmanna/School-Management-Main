import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import {
  COLUMN_KEYS,
  DEFAULTS,
  FIELDS,
  FIELD_BY_KEY,
  GROUPS,
  PRESETS,
  PRESET_BY_KEY,
  groupDefaults,
  resolveSettings,
  sanitizePatch,
  type ColumnItem,
  type GroupKey,
} from './report-card-settings.schema';

/**
 * A patch is any subset of the registry's field keys. Kept loose on purpose —
 * `sanitizePatch` is the validation boundary, so unknown keys and bad values
 * are dropped rather than rejected, and a newer browser talking to an older
 * API degrades instead of erroring.
 */
export type ReportCardSettingsDto = Record<string, unknown>;

export interface ResolvedReportCardSettings extends Record<string, unknown> {
  id: string;
  organizationId: string;
  presetKey: string | null;
  updatedAt: unknown;
}

/**
 * Three student-detail entries have both a checkbox in the "Content Blocks"
 * tab (backed by a real column, and read directly by the report-card viewer)
 * and a row in the ordered "Student Details" list. They are the same setting
 * shown twice, so writes normalise both representations and reads derive the
 * list from the columns.
 */
const MIRRORED: Array<{ item: string; column: string }> = [
  { item: 'termStart', column: 'showTermStartDate' },
  { item: 'termEnd', column: 'showTermEndDate' },
  { item: 'feesBalance', column: 'showFeesBalance' },
];

/** Table columns selected verbatim; `config` is unpacked separately. */
const SELECT_COLUMNS = [
  '"id"',
  '"organizationId"',
  ...COLUMN_KEYS.map((k) => `"${k}"`),
  '"config"',
  '"presetKey"',
  '"createdAt"',
  '"updatedAt"',
].join(', ');

@Injectable()
export class ReportCardSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** The field registry, groups and presets that drive the settings UI. */
  schema() {
    return {
      groups: GROUPS,
      fields: FIELDS,
      presets: PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description, overrides: p.overrides })),
      defaults: DEFAULTS,
    };
  }

  /** GET org settings, creating the org default row on first access. */
  async get(): Promise<ResolvedReportCardSettings> {
    const organizationId = this.tenant.organizationId;
    const rows = await this.prisma.raw.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${SELECT_COLUMNS} FROM "ReportCardSettings" WHERE "organizationId" = $1 LIMIT 1`,
      organizationId,
    );
    if (rows.length) return this.rowToSettings(rows[0]);

    // First access for this org: materialise a row seeded with the registry
    // defaults rather than the (older, all-black) SQL column defaults.
    const seed = Object.fromEntries(COLUMN_KEYS.map((k) => [k, DEFAULTS[k]]));
    const cols = Object.keys(seed);
    const created = await this.prisma.raw.$queryRawUnsafe<Record<string, unknown>[]>(
      `INSERT INTO "ReportCardSettings" ("id","organizationId",${cols.map((c) => `"${c}"`).join(',')},"config","updatedAt")
       VALUES (gen_random_uuid(), $1, ${cols.map((_, i) => `$${i + 2}`).join(',')}, '{}'::jsonb, now())
       ON CONFLICT ("organizationId") DO UPDATE SET "updatedAt" = now()
       RETURNING ${SELECT_COLUMNS}`,
      organizationId,
      ...cols.map((c) => seed[c]),
    );
    return this.rowToSettings(created[0]);
  }

  /** PATCH org settings — only the provided fields change. */
  async update(dto: ReportCardSettingsDto): Promise<ResolvedReportCardSettings> {
    const patch = this.normalize(sanitizePatch(dto ?? {}));
    if (Object.keys(patch).length === 0) return this.get();
    // A manual edit detaches the configuration from whatever preset seeded it.
    return this.persist(patch, { presetKey: null });
  }

  /** Replace the whole configuration with a named preset. */
  async applyPreset(key: string): Promise<ResolvedReportCardSettings> {
    const preset = PRESET_BY_KEY[key];
    if (!preset) {
      throw new BadRequestException(
        `Unknown report card preset '${key}'. Available: ${PRESETS.map((p) => p.key).join(', ')}.`,
      );
    }
    const full = resolveSettings({ ...DEFAULTS, ...preset.overrides });
    return this.persist(this.normalize(full), { presetKey: preset.key });
  }

  /**
   * Reset to registry defaults — the whole card, or a single settings group
   * (`paper`, `brand`, `type`, …) leaving every other group untouched.
   */
  async reset(group?: string): Promise<ResolvedReportCardSettings> {
    if (!group) return this.persist(this.normalize({ ...DEFAULTS }), { presetKey: null });
    if (!GROUPS.some((g) => g.key === group)) {
      throw new BadRequestException(
        `Unknown settings group '${group}'. Available: ${GROUPS.map((g) => g.key).join(', ')}.`,
      );
    }
    return this.persist(this.normalize(groupDefaults(group as GroupKey)), { presetKey: null });
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Write a sanitized patch. Column-backed fields go to their columns; every
   * other field is merged into the `config` blob so untouched options survive.
   */
  private async persist(
    patch: Record<string, unknown>,
    meta: { presetKey: string | null },
  ): Promise<ResolvedReportCardSettings> {
    const organizationId = this.tenant.organizationId;
    await this.get(); // guarantees the row exists before we merge into it

    const colPatch: Record<string, unknown> = {};
    const cfgPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (COLUMN_KEYS.includes(k)) colPatch[k] = v;
      else cfgPatch[k] = v;
    }

    const cols = Object.keys(colPatch);
    const params: unknown[] = [organizationId];
    const assignments: string[] = [];

    for (const c of cols) {
      params.push(colPatch[c]);
      assignments.push(`"${c}" = $${params.length}`);
    }
    if (Object.keys(cfgPatch).length > 0) {
      params.push(JSON.stringify(cfgPatch));
      // `||` shallow-merges, so keys absent from this patch keep their values.
      assignments.push(`"config" = COALESCE("config", '{}'::jsonb) || $${params.length}::jsonb`);
    }
    params.push(meta.presetKey);
    assignments.push(`"presetKey" = $${params.length}`);
    assignments.push('"updatedAt" = now()');

    // Column names are registry constants, never client input.
    await this.prisma.raw.$queryRawUnsafe(
      `UPDATE "ReportCardSettings" SET ${assignments.join(', ')} WHERE "organizationId" = $1`,
      ...params,
    );
    return this.get();
  }

  /** Row (columns + config blob) → fully-resolved settings object. */
  private rowToSettings(row: Record<string, unknown>): ResolvedReportCardSettings {
    const config = (row.config ?? {}) as Record<string, unknown>;
    const columns = Object.fromEntries(COLUMN_KEYS.map((k) => [k, row[k]]));
    // Columns win over the blob: they are the authoritative store for the
    // fields that predate v2 and are read directly elsewhere in the app.
    const resolved = resolveSettings({ ...config, ...columns });
    syncMirrorsFromColumns(resolved);
    return {
      ...resolved,
      id: String(row.id),
      organizationId: String(row.organizationId),
      presetKey: row.presetKey == null ? null : String(row.presetKey),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Make the two representations of the mirrored fields agree before writing.
   * An explicit boolean in the patch wins; otherwise the ordered list decides.
   */
  private normalize(patch: Record<string, unknown>): Record<string, unknown> {
    const out = { ...patch };
    // Copy each item, not just the array: `reset()` passes the module-level
    // DEFAULTS through here, and mutating those objects would corrupt the
    // registry defaults for the lifetime of the process.
    const list = Array.isArray(out.studentFields)
      ? (out.studentFields as ColumnItem[]).map((c) => ({ ...c }))
      : null;

    for (const { item, column } of MIRRORED) {
      const hasBool = Object.prototype.hasOwnProperty.call(out, column);
      const entry = list?.find((c) => c.key === item);
      if (hasBool && entry) entry.enabled = Boolean(out[column]);
      else if (!hasBool && entry) out[column] = entry.enabled;
      else if (hasBool && !entry && list) list.push({ key: item, label: FIELD_BY_KEY[column]?.label ?? item, enabled: Boolean(out[column]) });
    }
    if (list) out.studentFields = list;
    return out;
  }
}

/** Force the ordered student list to agree with the authoritative columns. */
function syncMirrorsFromColumns(resolved: Record<string, unknown>): void {
  const list = resolved.studentFields as ColumnItem[] | undefined;
  if (!Array.isArray(list)) return;
  for (const { item, column } of MIRRORED) {
    const entry = list.find((c) => c.key === item);
    if (entry) entry.enabled = Boolean(resolved[column]);
  }
}
