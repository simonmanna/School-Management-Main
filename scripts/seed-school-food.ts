/**
 * scripts/seed-school-food.ts
 * ------------------------------------------------------------------
 * Seeds a curated SCHOOL FOOD catalog (Ugandan local dishes + fruits) into
 * `schooldb-planet` under org `SUNRISE`, as `MenuItem` rows tagged
 * `customFields.__schoolMenu = true`. The Meals UI "Menu" picker reads these
 * via GET /school/meals/menus/school-catalog (NOT the imported POS cafe items).
 *
 * Uses raw SQL (consistent with import-pos-menu.ts) to avoid Prisma Json-filter
 * typing quirks. Idempotent: rows already tagged are skipped.
 *
 * Run:  cd apps/api && DATABASE_URL=...schooldb-planet \
 *         npx tsx ../../scripts/seed-school-food.ts
 */
import { PrismaClient } from '@prisma/client';

const ORG = process.env.DST_ORG_ID ?? 'org_sunrise_academy';
const prisma = new PrismaClient({ datasources: { db: { url: requireEnv('DATABASE_URL') } } });

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}
const uuid = () => crypto.randomUUID();

const CATEGORIES: Record<string, string[]> = {
  'Main Dishes': [
    'Posho (Maize Porridge/Ugali)', 'Matooke (Steamed Plantain)', 'Rice (Plain/Boiled)',
    'Cassava (Boiled)', 'Sweet Potatoes (Boiled)', 'Irish Potatoes (Boiled/Mashed)',
    'Millet Bread (Atapa)', 'Sorghum Porridge', 'Spaghetti/Macaroni', 'Rice & Beans',
  ],
  'Proteins': [
    'Beans (Red/Yellow)', 'Groundnut Sauce (Peanut)', 'Beef Stew', 'Chicken Stew',
    'Fish (Silver Cyprinid/Omena)', 'Egg Stew', 'Soya Meat (Textured Veg Protein)', 'Lentils (Dhal)',
  ],
  'Vegetables & Greens': [
    'Spinach (Dodo)', 'Greens (Sukuma Wiki)', 'Cabbage (Boiled/Fried)', 'Pumpkin (Boiled)',
    'Carrots & Green Beans', 'Avocado Slices', 'Mixed Vegetable Stew',
  ],
  'Fruits': [
    'Banana (Ripened)', 'Mango', 'Orange', 'Pineapple', 'Watermelon', 'Papaya (Pawpaw)',
    'Passion Fruit', 'Guava', 'Apple', 'Jackfruit',
  ],
  'Beverages': [
    'Passion-Fruit Juice', 'Mango Juice', 'Cow Milk', 'Porridge (Milky)', 'Lemma (Local Ginger Drink)',
  ],
};

async function main() {
  console.log(`Seeding school food catalog for ${ORG}…`);

  const categories: Record<string, string> = {};
  for (const name of Object.keys(CATEGORIES)) {
    const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "MenuCategory" WHERE "organizationId"=$1 AND name=$2 LIMIT 1`,
      ORG, name,
    );
    if (existing.length) { categories[name] = existing[0].id; continue; }
    const id = uuid();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MenuCategory" (id, "organizationId", name, "displayOrder", "isActive", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,0,true, now(), now())`,
      id, ORG, name,
    );
    categories[name] = id;
  }
  console.log(`   categories: ${Object.keys(categories).length}`);

  let inserted = 0, skipped = 0;
  for (const [catName, dishes] of Object.entries(CATEGORIES)) {
    const categoryId = categories[catName];
    for (const dish of dishes) {
      const dup = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "MenuItem" WHERE "organizationId"=$1 AND name=$2 AND "customFields"::text LIKE '%"__schoolMenu":true%' LIMIT 1`,
        ORG, dish,
      );
      if (dup.length) { skipped++; continue; }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "MenuItem" (id, "organizationId", name, description, "categoryId", "basePrice", "customFields", "createdAt", "updatedAt", "isInventoryTracked")
         VALUES ($1,$2,$3,$4,$5,0,$6::jsonb, now(), now(), false)`,
        uuid(), ORG, dish, `${dish} — school meal (Ugandan local food)`, categoryId,
        JSON.stringify({ __schoolMenu: true }),
      );
      inserted++;
    }
  }
  console.log(`✅ School food catalog: inserted ${inserted}, skipped ${skipped} (total ${inserted + skipped}).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
