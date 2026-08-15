/**
 * scripts/import-pos-menu.ts
 * ------------------------------------------------------------------
 * One-time ETL: copy the POS-cafe catalog (org DEMO) from the `cafe-pos`
 * database into `schooldb-planet` under org `SUNRISE`, so the school
 * database is fully self-contained (no runtime dependency on cafe-pos).
 *
 * Imported tables (dependency order):
 *   UnitOfMeasure -> Product -> MenuCategory -> MenuItem -> MenuItemVariant
 *   -> MenuProduct (BOM, links MenuItem <-> Product)
 *
 * Approach: generic column copy. For each row we generate a new UUID,
 * overwrite organizationId, and remap any `*Id` FK column present in the
 * id-map. Idempotent: rows already imported (tagged customFields.__posSourceId)
 * are skipped; FK relationships survive via the in-memory id-map. Colliding
 * org-scoped `code` values are suffixed with -posN.
 *
 * Run:  cd apps/api && DATABASE_URL=...schooldb-planet SRC_DATABASE_URL=...cafe-pos \
 *         npx tsx ../../scripts/import-pos-menu.ts
 */
import { PrismaClient } from '@prisma/client';

const SRC_ORG = process.env.SRC_ORG_ID ?? '6d4e1701-affb-4bdd-b930-de6d88ec6917'; // DEMO
const DST_ORG = process.env.DST_ORG_ID ?? 'org_sunrise_academy'; // SUNRISE

const src = new PrismaClient({ datasources: { db: { url: requireEnv('SRC_DATABASE_URL') } } });
const dst = new PrismaClient({ datasources: { db: { url: requireEnv('DATABASE_URL') } } });

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

const uuid = () => crypto.randomUUID();
type IdMap = Map<string, string>; // `${table}:${oldId}` -> newId

async function columnsOf(client: PrismaClient, table: string): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    table,
  );
  return rows.map((r) => r.column_name);
}

function fkTableFor(col: string): string {
  if (col === 'uomId') return 'UnitOfMeasure';
  if (col === 'categoryId') return 'MenuCategory';
  if (col === 'menuItemId') return 'MenuItem';
  if (col === 'productId') return 'Product';
  if (col === 'purchaseUomId' || col === 'salesUomId' || col === 'recipeUomId' || col === 'productionUomId') return 'UnitOfMeasure';
  // taxId/brandId/supplierId point to tables we do NOT import -> null them out.
  if (col === 'taxId' || col === 'brandId' || col === 'supplierId') return '__NULL__';
  return '';
}
function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

async function copyTable(
  table: string,
  idMap: IdMap,
  opts: { fkColumns?: string[]; dedupeCode?: boolean } = {},
): Promise<void> {
  const cols = await columnsOf(src, table);
  const idCol = cols.includes('id') ? 'id' : null;
  const customFieldsCol = cols.includes('customFields') ? 'customFields' : null;
  const hasCode = cols.includes('code');

  // Auto-detect enum columns (pg user-defined types) so we cast them explicitly.
  const enumCols: Record<string, string> = {};
  const enumRows = await src.$queryRawUnsafe<{ column_name: string; udt_name: string }[]>(
    `SELECT column_name, udt_name FROM information_schema.columns
     WHERE table_name = $1 AND data_type = 'USER-DEFINED'`,
    table,
  );
  enumRows.forEach((r) => { enumCols[r.column_name] = r.udt_name; });

  const takenCodes = new Set<string>();
  if (opts.dedupeCode && hasCode) {
    const rows = await dst.$queryRawUnsafe<{ code: string }[]>(
      `SELECT "code" FROM "${table}" WHERE "organizationId" = $1 AND "code" IS NOT NULL`,
      DST_ORG,
    );
    rows.forEach((r) => takenCodes.add(r.code));
  }

  const rows = await src.$queryRawUnsafe<any[]>(
    `SELECT * FROM "${table}" WHERE "organizationId" = $1`,
    SRC_ORG,
  );

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const oldId: string | undefined = idCol ? row[idCol] : undefined;
    if (customFieldsCol && row[customFieldsCol]) {
      try {
        const cf = typeof row[customFieldsCol] === 'string' ? JSON.parse(row[customFieldsCol]) : row[customFieldsCol];
        if (cf && cf.__posSourceId) {
          const existing = await dst.$queryRawUnsafe<{ id: string }[]>(
            `SELECT "id" FROM "${table}" WHERE "organizationId" = $1 AND "customFields"::text LIKE '%"__posSourceId":"${oldId}"%' LIMIT 1`,
            DST_ORG,
          );
          if (existing.length && oldId) idMap.set(`${table}:${oldId}`, existing[0].id);
          skipped++;
          continue;
        }
      } catch { /* ignore */ }
    }

    const newId = uuid();
    if (oldId) idMap.set(`${table}:${oldId}`, newId);

    const insertCols: string[] = [];
    const insertVals: any[] = [];
    for (const c of cols) {
      if (c === idCol) { insertCols.push('"id"'); insertVals.push(newId); continue; }
      if (c === 'organizationId') { insertCols.push('"organizationId"'); insertVals.push(DST_ORG); continue; }
      let val = row[c];
      const fkTable = opts.fkColumns?.includes(c) ? fkTableFor(c) : '';
      if (fkTable === '__NULL__') val = null;
      else if (fkTable && val != null) val = idMap.get(`${fkTable}:${val}`) ?? null;
      if (c === customFieldsCol) {
        const cf = val && typeof val === 'string' ? safeParse(val) : (val ?? {});
        cf.__posSourceId = oldId ?? null;
        cf.__posSource = 'cafe-pos';
        val = JSON.stringify(cf);
      }
      if (c === 'code' && opts.dedupeCode && val != null) {
        let candidate = String(val);
        let n = 1;
        while (takenCodes.has(candidate)) candidate = `${val}-pos${n++ > 1 ? n - 1 : ''}`;
        takenCodes.add(candidate);
        val = candidate;
      }
      if (val === undefined) continue;
      insertCols.push(`"${c}"`);
      insertVals.push(val);
    }

    const placeholders: string[] = [];
    let qi = 1;
    for (const c of insertCols) {
      const colName = c.replace(/"/g, '');
      const cast = enumCols[colName] ? `::"${enumCols[colName]}"` : (colName === 'customFields' ? '::jsonb' : '');
      placeholders.push(`$${qi}${cast}`);
      qi++;
    }

    const codeIdx = insertCols.findIndex((c) => c.replace(/"/g, '') === 'code');
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await dst.$executeRawUnsafe(
          `INSERT INTO "${table}" (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT ("id") DO NOTHING`,
          ...insertVals,
        );
        break;
      } catch (e: any) {
        const msg = e?.message ?? '';
        const isUnique = msg.includes('23505') || msg.toLowerCase().includes('unique');
        if (isUnique && codeIdx >= 0 && attempt < 5) {
          attempt++;
          insertVals[codeIdx] = `${String(insertVals[codeIdx])}-pos${attempt}`;
          continue;
        }
        throw e;
      }
    }
    inserted++;
  }
  console.log(`   - ${table}: inserted ${inserted}, skipped ${skipped}`);
}

async function main() {
  console.log(`Importing POS-cafe catalog: ${SRC_ORG} -> ${DST_ORG}`);
  const idMap: IdMap = new Map();

  await copyTable('UnitOfMeasure', idMap, { fkColumns: ['categoryId'] });
  await copyTable('Product', idMap, {
    fkColumns: ['categoryId', 'uomId', 'purchaseUomId', 'salesUomId', 'recipeUomId', 'productionUomId', 'brandId', 'supplierId', 'taxId'],
    dedupeCode: true,
  });
  await copyTable('MenuCategory', idMap, {});
  await copyTable('MenuItem', idMap, { fkColumns: ['categoryId'] });
  await copyTable('MenuItemVariant', idMap, { fkColumns: ['menuItemId'] });
  await copyTable('MenuProduct', idMap, { fkColumns: ['menuItemId', 'productId', 'uomId'] });

  console.log('✅ POS-cafe catalog imported into schooldb-planet (org SUNRISE).');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await src.$disconnect(); await dst.$disconnect(); });
