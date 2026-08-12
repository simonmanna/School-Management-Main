/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Default UOM categories + units for a new organization. `factor` = base
 * (reference) units per 1 of this unit; the reference unit has factor 1.
 * `rounding` is the quantity rounding step for that unit.
 */
export const UOM_CATEGORY_SEED = [
  {
    name: 'Quantity',
    ref: 'UNIT',
    units: [
      { code: 'UNIT', name: 'Piece', symbol: 'pc', factor: 1, rounding: 1, uomType: 'reference' },
      { code: 'DOZEN', name: 'Dozen', symbol: 'dz', factor: 12, rounding: 1, uomType: 'bigger' },
    ],
  },
  {
    name: 'Weight',
    ref: 'KG',
    units: [
      { code: 'KG', name: 'Kilogram', symbol: 'kg', factor: 1, rounding: 0.001, uomType: 'reference' },
      { code: 'G', name: 'Gram', symbol: 'g', factor: 0.001, rounding: 0.001, uomType: 'smaller' },
      { code: 'TON', name: 'Tonne', symbol: 't', factor: 1000, rounding: 0.001, uomType: 'bigger' },
    ],
  },
  {
    name: 'Volume',
    ref: 'L',
    units: [
      { code: 'L', name: 'Liter', symbol: 'L', factor: 1, rounding: 0.001, uomType: 'reference' },
      { code: 'ML', name: 'Milliliter', symbol: 'ml', factor: 0.001, rounding: 0.01, uomType: 'smaller' },
    ],
  },
  {
    name: 'Length',
    ref: 'M',
    units: [
      { code: 'M', name: 'Meter', symbol: 'm', factor: 1, rounding: 0.001, uomType: 'reference' },
      { code: 'CM', name: 'Centimeter', symbol: 'cm', factor: 0.01, rounding: 0.01, uomType: 'smaller' },
      { code: 'MM', name: 'Millimeter', symbol: 'mm', factor: 0.001, rounding: 0.01, uomType: 'smaller' },
    ],
  },
  {
    name: 'Time',
    ref: 'HR',
    units: [
      { code: 'HR', name: 'Hour', symbol: 'h', factor: 1, rounding: 0.01, uomType: 'reference' },
      { code: 'DAY', name: 'Day', symbol: 'd', factor: 24, rounding: 0.01, uomType: 'bigger' },
    ],
  },
] as const;

/**
 * Idempotently seed the UOM categories + units for an organization. Doubles as a
 * backfill: re-running sets categoryId/factor/symbol/rounding on existing rows and
 * links each category's reference unit. `db` is any Prisma client exposing the
 * uomCategory / unitOfMeasure delegates (raw or tenant-scoped).
 */
export async function seedUomCategories(db: any, organizationId: string): Promise<void> {
  for (const cat of UOM_CATEGORY_SEED) {
    const category = await db.uomCategory.upsert({
      where: { organizationId_name: { organizationId, name: cat.name } },
      update: {},
      create: { organizationId, name: cat.name },
    });
    let refUomId: string | undefined;
    for (const u of cat.units) {
      const data = {
        name: u.name,
        symbol: u.symbol,
        categoryId: category.id,
        category: cat.name.toLowerCase(),
        factor: u.factor,
        ratio: u.factor,
        roundingPrecision: u.rounding,
        uomType: u.uomType,
        isBase: u.code === cat.ref,
        isActive: true,
      };
      const row = await db.unitOfMeasure.upsert({
        where: { organizationId_code: { organizationId, code: u.code } },
        update: data,
        create: { organizationId, code: u.code, ...data },
      });
      if (u.code === cat.ref) refUomId = row.id;
    }
    if (refUomId) {
      await db.uomCategory.update({ where: { id: category.id }, data: { referenceUomId: refUomId } });
    }
  }
}
