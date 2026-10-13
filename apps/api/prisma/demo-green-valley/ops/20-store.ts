/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 20 — the school store (inventory).
 *
 * What the storekeeper looks after: the main store behind the staff room, the
 * scholastic and uniform store the bursar opens at the start of term, the sick
 * bay cupboard, the sports and boarding store, and the cleaners' store. Stock
 * arrives on a purchase order (stage 21), is transferred to the store that
 * needs it, and is issued out against a requisition — chalk and exercise books
 * to the classes, detergent to the cleaners, plasters to the sick bay.
 *
 * Every term closes with a physical count, which is where the differences show
 * up: a missing box of chalk, two extra reams found behind the shelf, expired
 * ORS sachets written off.
 *
 * Opening stock is the 2025 closing count, received on 5 January at cost.
 */
import { ok, log, rng, int, pick } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso, schoolDaysIso } from './kit';
import type { Books } from './13-accounts';
import type { Roster } from './roster';

type Loc = { code: string; name: string; type: string };

const LOCATIONS: Loc[] = [
  { code: 'STORE-MAIN', name: 'Main Store (behind the staff room)', type: 'warehouse' },
  { code: 'STORE-SCHOL', name: 'Scholastic & Uniform Store', type: 'store' },
  { code: 'STORE-CLEAN', name: 'Cleaners’ Store', type: 'storage_room' },
  { code: 'STORE-SICK', name: 'Sick Bay Cupboard', type: 'store' },
  { code: 'STORE-SPORT', name: 'Sports & Boarding Store', type: 'store' },
];

const UOMS: Array<{ code: string; name: string; symbol: string }> = [
  { code: 'PC', name: 'Piece', symbol: 'pc' },
  { code: 'DOZ', name: 'Dozen', symbol: 'doz' },
  { code: 'BOX', name: 'Box', symbol: 'box' },
  { code: 'PKT', name: 'Packet', symbol: 'pkt' },
  { code: 'REAM', name: 'Ream (500 sheets)', symbol: 'ream' },
  { code: 'BALE', name: 'Bale', symbol: 'bale' },
  { code: 'SET', name: 'Set', symbol: 'set' },
  { code: 'PAIR', name: 'Pair', symbol: 'pair' },
  { code: 'LTR', name: 'Litre', symbol: 'L' },
  { code: 'KG', name: 'Kilogramme', symbol: 'kg' },
  { code: 'BAG', name: 'Bag (50kg)', symbol: 'bag' },
  { code: 'TIN', name: 'Tin', symbol: 'tin' },
];

type Item = {
  code: string;
  name: string;
  group: 'Scholastic Materials' | 'Uniform & Requirements' | 'Cleaning & Sanitation Supplies' | 'Sick Bay Supplies' | 'Sports & Boarding Supplies' | 'Office & ICT Supplies';
  uom: string;
  cost: number;
  /** Retail price when the item is also sold to parents (uniforms, books). */
  price?: number;
  home: string;
  opening: number;
  /** Bulk held in the main store, from which the other stores draw. */
  mainStock?: number;
  reorder: number;
  /** How the item leaves the store. */
  usage: 'term' | 'weekly' | 'monthly' | 'rare';
};

const ITEMS: Item[] = [
  // Scholastic
  { code: 'STK-EXB-32', name: 'Exercise book 32 pages (Picfare)', group: 'Scholastic Materials', uom: 'PC', cost: 700, price: 1_000, home: 'STORE-SCHOL', opening: 1_400, mainStock: 1200, reorder: 600, usage: 'term' },
  { code: 'STK-EXB-48', name: 'Exercise book 48 pages (Picfare)', group: 'Scholastic Materials', uom: 'PC', cost: 1_000, price: 1_500, home: 'STORE-SCHOL', opening: 1_100, mainStock: 900, reorder: 500, usage: 'term' },
  { code: 'STK-EXB-96', name: 'Exercise book 96 pages (Picfare)', group: 'Scholastic Materials', uom: 'PC', cost: 1_800, price: 2_500, home: 'STORE-SCHOL', opening: 700, reorder: 300, usage: 'term' },
  { code: 'STK-COUNTER', name: 'Counter book A4 (2 quire)', group: 'Scholastic Materials', uom: 'PC', cost: 9_500, home: 'STORE-MAIN', opening: 90, reorder: 30, usage: 'term' },
  { code: 'STK-PEN-BLUE', name: 'Ball pen, blue (BIC)', group: 'Scholastic Materials', uom: 'PC', cost: 500, price: 700, home: 'STORE-SCHOL', opening: 900, mainStock: 600, reorder: 400, usage: 'monthly' },
  { code: 'STK-PEN-RED', name: 'Ball pen, red (marking)', group: 'Scholastic Materials', uom: 'PC', cost: 500, home: 'STORE-MAIN', opening: 300, reorder: 150, usage: 'monthly' },
  { code: 'STK-PENCIL', name: 'Pencil HB (Staedtler)', group: 'Scholastic Materials', uom: 'PC', cost: 400, price: 600, home: 'STORE-SCHOL', opening: 1_000, mainStock: 700, reorder: 400, usage: 'term' },
  { code: 'STK-CRAYON', name: 'Crayons, packet of 12', group: 'Scholastic Materials', uom: 'PKT', cost: 3_500, price: 5_000, home: 'STORE-SCHOL', opening: 260, mainStock: 250, reorder: 100, usage: 'term' },
  { code: 'STK-CHALK', name: 'Chalk, box of 100 (dustless white)', group: 'Scholastic Materials', uom: 'BOX', cost: 6_500, home: 'STORE-MAIN', opening: 150, reorder: 60, usage: 'weekly' },
  { code: 'STK-MARKER', name: 'Whiteboard marker, black', group: 'Scholastic Materials', uom: 'PC', cost: 2_500, home: 'STORE-MAIN', opening: 180, reorder: 80, usage: 'monthly' },
  { code: 'STK-MANILA', name: 'Manila paper, assorted colours', group: 'Scholastic Materials', uom: 'PC', cost: 1_500, home: 'STORE-MAIN', opening: 400, reorder: 150, usage: 'term' },
  { code: 'STK-RULER', name: 'Ruler 30cm, plastic', group: 'Scholastic Materials', uom: 'PC', cost: 900, price: 1_500, home: 'STORE-SCHOL', opening: 320, reorder: 120, usage: 'term' },
  { code: 'STK-ERASER', name: 'Eraser, white', group: 'Scholastic Materials', uom: 'PC', cost: 500, price: 800, home: 'STORE-SCHOL', opening: 400, reorder: 150, usage: 'term' },
  { code: 'STK-MATHSET', name: 'Mathematical set (geometry)', group: 'Scholastic Materials', uom: 'SET', cost: 6_000, price: 8_500, home: 'STORE-SCHOL', opening: 140, reorder: 50, usage: 'term' },
  { code: 'STK-FILE', name: 'Box file, foolscap', group: 'Office & ICT Supplies', uom: 'PC', cost: 7_500, home: 'STORE-MAIN', opening: 70, reorder: 25, usage: 'monthly' },
  // Office & ICT
  { code: 'STK-PAPER-A4', name: 'Photocopy paper A4, 80gsm', group: 'Office & ICT Supplies', uom: 'REAM', cost: 17_500, home: 'STORE-MAIN', opening: 120, reorder: 40, usage: 'weekly' },
  { code: 'STK-PAPER-A3', name: 'Photocopy paper A3, 80gsm', group: 'Office & ICT Supplies', uom: 'REAM', cost: 34_000, home: 'STORE-MAIN', opening: 24, reorder: 10, usage: 'monthly' },
  { code: 'STK-TONER', name: 'Toner cartridge (Kyocera TK-1170)', group: 'Office & ICT Supplies', uom: 'PC', cost: 185_000, home: 'STORE-MAIN', opening: 7, reorder: 3, usage: 'monthly' },
  { code: 'STK-STAPLES', name: 'Staples 26/6, box', group: 'Office & ICT Supplies', uom: 'BOX', cost: 2_500, home: 'STORE-MAIN', opening: 60, reorder: 20, usage: 'monthly' },
  { code: 'STK-STAMPPAD', name: 'Stamp pad ink, blue', group: 'Office & ICT Supplies', uom: 'PC', cost: 4_500, home: 'STORE-MAIN', opening: 20, reorder: 8, usage: 'rare' },
  // Uniform & requirements
  { code: 'STK-UNI-NUR', name: 'Nursery uniform set (dress/shirt & shorts)', group: 'Uniform & Requirements', uom: 'SET', cost: 28_000, price: 42_000, home: 'STORE-SCHOL', opening: 120, reorder: 40, usage: 'term' },
  { code: 'STK-UNI-PRI', name: 'Primary uniform set (shirt & shorts/skirt)', group: 'Uniform & Requirements', uom: 'SET', cost: 32_000, price: 48_000, home: 'STORE-SCHOL', opening: 180, reorder: 60, usage: 'term' },
  { code: 'STK-SWEATER', name: 'School sweater, maroon', group: 'Uniform & Requirements', uom: 'PC', cost: 26_000, price: 38_000, home: 'STORE-SCHOL', opening: 150, reorder: 50, usage: 'term' },
  { code: 'STK-PEKIT', name: 'P.E. kit (T-shirt & shorts)', group: 'Uniform & Requirements', uom: 'SET', cost: 22_000, price: 32_000, home: 'STORE-SCHOL', opening: 130, reorder: 45, usage: 'term' },
  { code: 'STK-SOCKS', name: 'School socks, pair', group: 'Uniform & Requirements', uom: 'PAIR', cost: 4_500, price: 7_000, home: 'STORE-SCHOL', opening: 260, reorder: 100, usage: 'term' },
  { code: 'STK-BADGE', name: 'School badge, embroidered', group: 'Uniform & Requirements', uom: 'PC', cost: 2_500, price: 4_000, home: 'STORE-SCHOL', opening: 300, reorder: 120, usage: 'term' },
  { code: 'STK-BAG', name: 'School bag, branded', group: 'Uniform & Requirements', uom: 'PC', cost: 35_000, price: 52_000, home: 'STORE-SCHOL', opening: 70, reorder: 25, usage: 'term' },
  // Cleaning
  { code: 'STK-JIK', name: 'Jik bleach, 5 litres', group: 'Cleaning & Sanitation Supplies', uom: 'LTR', cost: 4_200, home: 'STORE-CLEAN', opening: 180, mainStock: 250, reorder: 60, usage: 'weekly' },
  { code: 'STK-SOAP-BAR', name: 'Laundry soap bar (Nomi)', group: 'Cleaning & Sanitation Supplies', uom: 'PC', cost: 3_800, home: 'STORE-CLEAN', opening: 240, mainStock: 300, reorder: 80, usage: 'weekly' },
  { code: 'STK-OMO', name: 'Washing powder, 1kg', group: 'Cleaning & Sanitation Supplies', uom: 'KG', cost: 8_500, home: 'STORE-CLEAN', opening: 90, mainStock: 120, reorder: 30, usage: 'weekly' },
  { code: 'STK-BROOM', name: 'Broom, local (lusambya)', group: 'Cleaning & Sanitation Supplies', uom: 'PC', cost: 3_000, home: 'STORE-CLEAN', opening: 80, reorder: 30, usage: 'monthly' },
  { code: 'STK-MOP', name: 'Mop with handle', group: 'Cleaning & Sanitation Supplies', uom: 'PC', cost: 12_000, home: 'STORE-CLEAN', opening: 30, reorder: 12, usage: 'monthly' },
  { code: 'STK-TISSUE', name: 'Toilet paper, roll', group: 'Cleaning & Sanitation Supplies', uom: 'PC', cost: 1_200, home: 'STORE-CLEAN', opening: 900, mainStock: 1200, reorder: 300, usage: 'weekly' },
  { code: 'STK-HANDSOAP', name: 'Liquid hand soap, 5 litres', group: 'Cleaning & Sanitation Supplies', uom: 'LTR', cost: 5_500, home: 'STORE-CLEAN', opening: 120, mainStock: 150, reorder: 40, usage: 'weekly' },
  { code: 'STK-GLOVES', name: 'Rubber gloves, pair', group: 'Cleaning & Sanitation Supplies', uom: 'PAIR', cost: 6_500, home: 'STORE-CLEAN', opening: 40, reorder: 15, usage: 'monthly' },
  { code: 'STK-BIN', name: 'Waste bin, 20 litres', group: 'Cleaning & Sanitation Supplies', uom: 'PC', cost: 18_000, home: 'STORE-MAIN', opening: 25, reorder: 10, usage: 'rare' },
  // Sick bay
  { code: 'STK-PARA', name: 'Paracetamol 500mg, tin of 1000', group: 'Sick Bay Supplies', uom: 'TIN', cost: 32_000, home: 'STORE-SICK', opening: 8, reorder: 3, usage: 'monthly' },
  { code: 'STK-ORS', name: 'ORS sachets', group: 'Sick Bay Supplies', uom: 'PC', cost: 900, home: 'STORE-SICK', opening: 220, mainStock: 150, reorder: 80, usage: 'weekly' },
  { code: 'STK-COARTEM', name: 'Coartem (artemether-lumefantrine), dose', group: 'Sick Bay Supplies', uom: 'PC', cost: 6_500, home: 'STORE-SICK', opening: 90, mainStock: 70, reorder: 30, usage: 'weekly' },
  { code: 'STK-PLASTER', name: 'Adhesive plasters, box of 100', group: 'Sick Bay Supplies', uom: 'BOX', cost: 12_000, home: 'STORE-SICK', opening: 14, mainStock: 12, reorder: 5, usage: 'monthly' },
  { code: 'STK-SPIRIT', name: 'Surgical spirit, 500ml', group: 'Sick Bay Supplies', uom: 'PC', cost: 6_000, home: 'STORE-SICK', opening: 24, reorder: 8, usage: 'monthly' },
  { code: 'STK-COTTON', name: 'Cotton wool, 500g roll', group: 'Sick Bay Supplies', uom: 'PC', cost: 9_000, home: 'STORE-SICK', opening: 18, reorder: 6, usage: 'monthly' },
  { code: 'STK-THERMO', name: 'Digital thermometer', group: 'Sick Bay Supplies', uom: 'PC', cost: 25_000, home: 'STORE-SICK', opening: 6, reorder: 2, usage: 'rare' },
  // Sports & boarding
  { code: 'STK-BALL-FOOT', name: 'Football, size 5 (Mitre)', group: 'Sports & Boarding Supplies', uom: 'PC', cost: 65_000, home: 'STORE-SPORT', opening: 12, reorder: 4, usage: 'monthly' },
  { code: 'STK-BALL-NET', name: 'Netball, size 5', group: 'Sports & Boarding Supplies', uom: 'PC', cost: 58_000, home: 'STORE-SPORT', opening: 8, reorder: 3, usage: 'monthly' },
  { code: 'STK-JERSEY', name: 'House jersey (inter-house sports)', group: 'Sports & Boarding Supplies', uom: 'PC', cost: 24_000, home: 'STORE-SPORT', opening: 60, reorder: 20, usage: 'rare' },
  { code: 'STK-MATTRESS', name: 'Mattress, 4-inch (3ft × 6ft)', group: 'Sports & Boarding Supplies', uom: 'PC', cost: 95_000, home: 'STORE-SPORT', opening: 14, reorder: 5, usage: 'rare' },
  { code: 'STK-BLANKET', name: 'Blanket, single', group: 'Sports & Boarding Supplies', uom: 'PC', cost: 42_000, home: 'STORE-SPORT', opening: 20, reorder: 8, usage: 'rare' },
  { code: 'STK-BEDSHEET', name: 'Bed sheet, single', group: 'Sports & Boarding Supplies', uom: 'PC', cost: 28_000, home: 'STORE-SPORT', opening: 30, reorder: 10, usage: 'rare' },
];

/** Which GL account each product group expenses to when it leaves the store. */
const GROUP_ACCOUNT: Record<Item['group'], string> = {
  'Scholastic Materials': '5840',
  'Office & ICT Supplies': '5840',
  'Uniform & Requirements': '4180',
  'Cleaning & Sanitation Supplies': '5855',
  'Sick Bay Supplies': '5860',
  'Sports & Boarding Supplies': '5870',
};

export interface Store {
  location: (code: string) => string;
  productId: (code: string) => string;
  item: (code: string) => Item;
  items: Item[];
  /** Items a supplier delivers, by group. */
  byGroup: (group: Item['group']) => Item[];
}

export async function seedStore(ctx: Ctx, tl: Timeline, books: Books, roster: Roster): Promise<Store> {
  const { prisma, O } = ctx;
  const stock = ctx.svc('modules/inventory/stock.service', 'StockService');
  const stockDocs = ctx.svc('modules/inventory/stock-doc.service', 'StockDocService');
  const counts = ctx.svc('modules/inventory/inventory-count.service', 'InventoryCountService');

  // ── 1. Stores, units of measure, the stock list ──────────────────────────
  const locationId = new Map<string, string>();
  for (const l of LOCATIONS) {
    const row = await prisma.inventoryLocation.upsert({
      where: { organizationId_code: { organizationId: O, code: l.code } },
      update: { name: l.name, type: l.type as any, isActive: true, deletedAt: null },
      create: { organizationId: O, code: l.code, name: l.name, type: l.type as any },
    });
    locationId.set(l.code, row.id);
  }

  const uomCategory = await prisma.uomCategory.upsert({
    where: { organizationId_name: { organizationId: O, name: 'School Store Units' } },
    update: {},
    create: { organizationId: O, name: 'School Store Units' },
  });
  const uomId = new Map<string, string>();
  for (const u of UOMS) {
    const existing = await prisma.unitOfMeasure.findFirst({ where: { organizationId: O, code: u.code } });
    const row = existing
      ? await prisma.unitOfMeasure.update({ where: { id: existing.id }, data: { name: u.name, symbol: u.symbol, categoryId: uomCategory.id, isActive: true } })
      : await prisma.unitOfMeasure.create({
          data: { organizationId: O, code: u.code, name: u.name, symbol: u.symbol, categoryId: uomCategory.id, category: 'unit', factor: 1, ratio: 1, isBase: u.code === 'PC', uomType: 'reference' },
        });
    uomId.set(u.code, row.id);
  }
  await prisma.uomCategory.update({ where: { id: uomCategory.id }, data: { referenceUomId: uomId.get('PC') } });

  const groupCategory = new Map<string, string>();
  for (const group of new Set(ITEMS.map((i) => i.group))) {
    const account = GROUP_ACCOUNT[group];
    const cat = await prisma.productCategory.upsert({
      where: { organizationId_name: { organizationId: O, name: group } },
      update: group === 'Uniform & Requirements' ? { incomeAccountId: books.account(account) } : { expenseAccountId: books.account(account) },
      create: {
        organizationId: O,
        name: group,
        ...(group === 'Uniform & Requirements' ? { incomeAccountId: books.account(account) } : { expenseAccountId: books.account(account) }),
      },
    });
    groupCategory.set(group, cat.id);
  }

  // Posting rules: a box of chalk leaving the store is stationery expense, not
  // cost of goods sold. One rule pair per product group, so the P&L reads the
  // way a school's does (the uniform group is the exception — those items are
  // sold, so they do belong in cost of sales).
  for (const [group, catId] of groupCategory) {
    const debit = group === 'Uniform & Requirements' ? '5100' : GROUP_ACCOUNT[group as Item['group']];
    const pairs: Array<{ lineIndex: number; debitOrCredit: 'debit' | 'credit'; literal?: string; mapping?: string }> = [
      { lineIndex: 0, debitOrCredit: 'debit', literal: debit },
      { lineIndex: 1, debitOrCredit: 'credit', mapping: 'stock_valuation' },
    ];
    for (const r of pairs) {
      const existing = await prisma.inventoryPostingRule.findFirst({
        where: { organizationId: O, movementType: 'STOCK_OUT', lineIndex: r.lineIndex, categoryId: catId, productId: null },
      });
      const data = {
        debitOrCredit: r.debitOrCredit,
        accountSource: r.literal ? 'literal' : 'account_mapping',
        literalAccountId: r.literal ? books.account(r.literal) : null,
        accountMappingKey: r.mapping ?? null,
        isActive: true,
      };
      if (existing) await prisma.inventoryPostingRule.update({ where: { id: existing.id }, data });
      else await prisma.inventoryPostingRule.create({ data: { organizationId: O, movementType: 'STOCK_OUT', lineIndex: r.lineIndex, categoryId: catId, ...data } });
    }
  }

  const productId = new Map<string, string>();
  for (const i of ITEMS) {
    const row = await prisma.product.upsert({
      where: { organizationId_code: { organizationId: O, code: i.code } },
      update: {
        name: i.name,
        categoryId: groupCategory.get(i.group),
        uomId: uomId.get(i.uom),
        purchaseUomId: uomId.get(i.uom),
        costPrice: i.cost,
        salesPrice: i.price ?? null,
        productType: 'stockable',
        trackInventory: true,
        reorderQty: i.reorder,
        isActive: true,
      },
      create: {
        organizationId: O,
        code: i.code,
        name: i.name,
        categoryId: groupCategory.get(i.group),
        uomId: uomId.get(i.uom),
        purchaseUomId: uomId.get(i.uom),
        costPrice: i.cost,
        salesPrice: i.price ?? null,
        productType: 'stockable',
        trackInventory: true,
        reorderQty: i.reorder,
        station: 'none',
      },
    });
    productId.set(i.code, row.id);
  }
  ok(`store: ${LOCATIONS.length} stores, ${UOMS.length} units of measure, ${ITEMS.length} stock items, ${groupCategory.size} issue posting rules`);

  const pid = (code: string) => {
    const id = productId.get(code);
    if (!id) throw new Error(`Store product ${code} missing`);
    return id;
  };
  const loc = (code: string) => {
    const id = locationId.get(code);
    if (!id) throw new Error(`Store location ${code} missing`);
    return id;
  };
  const itemByCode = new Map(ITEMS.map((i) => [i.code, i]));

  // ── 2. Opening stock — the 2025 closing count ────────────────────────────
  tl.add({
    at: eat('2026-01-05', '09:00'),
    priority: 2,
    label: 'store opening stock',
    run: async () => {
      for (const i of ITEMS) {
        const places: Array<{ where: string; qty: number; key: string }> = [
          { where: i.home, qty: i.opening, key: `2025-close:${i.code}` },
        ];
        if (i.mainStock && i.home !== 'STORE-MAIN') {
          places.push({ where: 'STORE-MAIN', qty: i.mainStock, key: `2025-close-main:${i.code}` });
        }
        for (const place of places) {
          const already = await prisma.inventoryLedger.findFirst({
            where: { organizationId: O, productId: pid(i.code), referenceType: 'opening_count', referenceId: place.key },
          });
          if (already) continue;
          await ctx.as('bursar', () =>
            stock.receive({
              productId: pid(i.code),
              locationId: loc(place.where),
              quantity: place.qty,
              unitCost: i.cost,
              moveType: 'opening_balance',
              sourceType: 'opening_count',
              sourceId: place.key,
              reference: 'Closing count 31 Dec 2025',
              notes: 'Opening stock carried into 2026',
            }),
          );
        }
      }
      // A bare receive writes no journal, so the ledger rows carry the real
      // clock; the end-of-term count guard reads those as movements from the
      // future. Date them with the count they came from.
      await prisma.inventoryLedger.updateMany({
        where: { organizationId: O, referenceType: 'opening_count' },
        data: { createdAt: eat('2026-01-05', '09:00') },
      });
      await prisma.inventoryBatch.updateMany({
        where: { organizationId: O, receivedAt: { gt: eat(ctx.asOf, '23:59') } },
        data: { receivedAt: eat('2026-01-05', '09:00') },
      });
    },
  });

  // The bare receive above is quantity-only by design (only a source document
  // owns a receipt's accounting), so the value of the stock carried into 2026
  // is brought onto the ledger the way any other opening balance is: against
  // retained earnings, on the same date.
  const openingValue = ITEMS.reduce((sum, i) => sum + (i.opening + (i.home === 'STORE-MAIN' ? 0 : (i.mainStock ?? 0))) * i.cost, 0);
  tl.add({
    at: eat('2026-01-05', '09:30'),
    priority: 3,
    label: 'store opening stock value',
    run: async () => {
      const postingKey = 'demo:opening-stock:2026';
      if (await prisma.journalEntry.findFirst({ where: { organizationId: O, postingKey } })) return;
      const posting = ctx.svc('modules/accounting/posting/posting.service', 'PostingService');
      await ctx.as('bursar', () =>
        posting.post({
          journalCode: 'GEN',
          date: eat('2026-01-05', '09:30'),
          description: 'Store stock carried into 2026 (closing count 31 Dec 2025)',
          sourceType: 'opening_balance',
          postingKey,
          lines: [
            { accountId: books.account('1400'), debit: String(openingValue), description: 'Opening stock at cost' },
            { accountId: books.account('3100'), credit: String(openingValue), description: 'Balance b/f 31 Dec 2025' },
          ],
        }),
      );
    },
  });

  // ── 3. Transfers: the main store feeds the other stores ──────────────────
  const transferPlan: Array<{ day: string; to: string; items: Array<[string, number]>; note: string }> = [];
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    const start = term.start;
    transferPlan.push({
      day: weekday(addDaysIso(start, -3)),
      to: 'STORE-SCHOL',
      note: `Term ${no} opening stock for the scholastic store`,
      items: [
        ['STK-EXB-32', 300],
        ['STK-EXB-48', 240],
        ['STK-PENCIL', 180],
        ['STK-PEN-BLUE', 150],
        ['STK-CRAYON', 60],
      ],
    });
    transferPlan.push({
      day: weekday(addDaysIso(start, 7)),
      to: 'STORE-CLEAN',
      note: `Cleaning supplies issued to the cleaners' store – Term ${no}`,
      items: [
        ['STK-TISSUE', 200],
        ['STK-JIK', 40],
        ['STK-SOAP-BAR', 60],
        ['STK-OMO', 20],
      ],
    });
    transferPlan.push({
      day: weekday(addDaysIso(start, 14)),
      to: 'STORE-SICK',
      note: `Sick bay top-up – Term ${no}`,
      items: [
        ['STK-ORS', 40],
        ['STK-COARTEM', 20],
        ['STK-PLASTER', 3],
      ],
    });
  }
  for (const t of transferPlan) {
    if (t.day > ctx.asOf) continue;
    tl.add({
      at: eat(t.day, '10:00'),
      priority: 36,
      label: `store transfer → ${t.to} ${t.day}`,
      run: async () => {
        const key = `demo:transfer:${t.day}:${t.to}`;
        const already = await prisma.stockTransfer.findFirst({ where: { organizationId: O, notes: { contains: key } } });
        if (already) return;
        // Only move what the main store actually holds on the day.
        const lines: Array<{ productId: string; qtyRequested: number; unit?: string }> = [];
        for (const [code, qty] of t.items) {
          const si = await prisma.stockItem.findFirst({ where: { organizationId: O, productId: pid(code), locationId: loc('STORE-MAIN') } });
          const have = Number(si?.quantity ?? 0);
          if (have <= 0) continue;
          lines.push({ productId: pid(code), qtyRequested: Math.min(qty, Math.floor(have)), unit: itemByCode.get(code)!.uom });
        }
        if (lines.length === 0) return;
        const doc: any = await ctx.as('bursar', () =>
          stockDocs.createTransfer({
            fromLocationId: loc(t.to === 'STORE-SCHOL' ? 'STORE-MAIN' : 'STORE-MAIN'),
            toLocationId: loc(t.to),
            notes: `${t.note} · ${key}`,
            items: lines,
          }),
        );
        await ctx.as('head', () => stockDocs.approveTransfer(doc.id));
      },
    });
  }

  // ── 4. Issues against requisitions ───────────────────────────────────────
  // Chalk, paper and markers go out every week; cleaning stock weekly; the sick
  // bay draws on what it holds; uniforms leave the store when sold (stage 22).
  const issuePlan: Array<{ day: string; from: string; category: string; reason: string; items: Array<[string, number]> }> = [];
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    const end = ctx.asOf < term.end ? ctx.asOf : term.end;
    const days = schoolDaysIso(term.start, end);
    const mondays = days.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
    for (const [w, monday] of mondays.entries()) {
      const r = rng(`issue:${no}:${w}`);
      issuePlan.push({
        day: monday,
        from: 'STORE-MAIN',
        category: 'general_use',
        reason: `Weekly classroom requisition – week ${w + 1} of Term ${no}`,
        items: [
          ['STK-CHALK', int(r, 3, 6)],
          ['STK-PAPER-A4', int(r, 2, 5)],
          ['STK-MARKER', int(r, 2, 5)],
          ['STK-PEN-RED', int(r, 3, 8)],
        ],
      });
      issuePlan.push({
        day: addDaysIso(monday, 1),
        from: 'STORE-CLEAN',
        category: 'general_use',
        reason: `Cleaners' weekly draw – week ${w + 1} of Term ${no}`,
        items: [
          ['STK-TISSUE', int(r, 20, 40)],
          ['STK-JIK', int(r, 3, 6)],
          ['STK-SOAP-BAR', int(r, 4, 8)],
          ['STK-HANDSOAP', int(r, 2, 5)],
        ],
      });
      if (w % 2 === 0) {
        issuePlan.push({
          day: addDaysIso(monday, 2),
          from: 'STORE-SICK',
          category: 'general_use',
          reason: `Sick bay dispensing – week ${w + 1} of Term ${no}`,
          items: [
            ['STK-ORS', int(r, 4, 12)],
            ['STK-COARTEM', int(r, 2, 6)],
            ['STK-PARA', 1],
          ],
        });
      }
      if (w % 4 === 1) {
        issuePlan.push({
          day: addDaysIso(monday, 3),
          from: 'STORE-MAIN',
          category: 'general_use',
          reason: `Office stationery – week ${w + 1} of Term ${no}`,
          items: [
            ['STK-COUNTER', int(r, 1, 3)],
            ['STK-STAPLES', 1],
            ['STK-FILE', int(r, 1, 3)],
          ],
        });
      }
    }
    // What the school shop sold over the term leaves the scholastic store, so
    // the uniform and exercise-book revenue in stage 22 has its cost of sales.
    for (const [k, part] of [[18, 'first half'], [60, 'second half']] as const) {
      const day = weekday(addDaysIso(term.start, k));
      const r = rng(`shopsales:${no}:${k}`);
      issuePlan.push({
        day,
        from: 'STORE-SCHOL',
        category: 'general_use',
        reason: `School shop sales – ${part} of Term ${no}`,
        items: [
          ['STK-UNI-NUR', int(r, 12, 20)],
          ['STK-UNI-PRI', int(r, 16, 26)],
          ['STK-SWEATER', int(r, 14, 22)],
          ['STK-SOCKS', int(r, 30, 50)],
          ['STK-BADGE', int(r, 40, 60)],
          ['STK-PEKIT', int(r, 6, 12)],
          ['STK-BAG', int(r, 4, 9)],
          ['STK-EXB-32', int(r, 120, 200)],
          ['STK-EXB-48', int(r, 80, 140)],
          ['STK-PENCIL', int(r, 60, 110)],
          ['STK-PEN-BLUE', int(r, 50, 90)],
          ['STK-CRAYON', int(r, 10, 20)],
          ['STK-MATHSET', int(r, 6, 14)],
          ['STK-RULER', int(r, 12, 25)],
          ['STK-ERASER', int(r, 15, 30)],
        ],
      });
    }

    // Start-of-term classroom charts and manila for the thematic curriculum.
    issuePlan.push({
      day: weekday(addDaysIso(term.start, 2)),
      from: 'STORE-MAIN',
      category: 'training',
      reason: `Thematic charts and teaching aids – Term ${no}`,
      items: [
        ['STK-MANILA', 40],
        ['STK-MARKER', 12],
        ['STK-CRAYON', 10],
      ],
    });
  }
  let issues = 0;
  for (const p of issuePlan) {
    if (p.day > ctx.asOf) continue;
    issues += 1;
    tl.add({
      at: eat(p.day, '11:30'),
      priority: 38,
      label: `store issue ${p.reason}`,
      run: async () => {
        const key = `demo:issue:${p.day}:${p.from}:${p.reason.slice(0, 40)}`;
        const already = await prisma.stockOut.findFirst({ where: { organizationId: O, notes: { contains: key } } });
        if (already) return;
        const lines: Array<{ productId: string; qty: number; unit?: string }> = [];
        for (const [code, qty] of p.items) {
          const si = await prisma.stockItem.findFirst({ where: { organizationId: O, productId: pid(code), locationId: loc(p.from) } });
          const have = Math.floor(Number(si?.quantity ?? 0));
          if (have <= 0) continue;
          lines.push({ productId: pid(code), qty: Math.min(qty, have), unit: itemByCode.get(code)!.uom });
        }
        if (lines.length === 0) return;
        const doc: any = await ctx.as('bursar', () =>
          stockDocs.createStockOut({
            locationId: loc(p.from),
            category: p.category as any,
            reason: p.reason,
            notes: key,
            items: lines,
          }),
        );
        await ctx.as('head', () => stockDocs.approveStockOut(doc.id));
      },
    });
  }

  // ── 5. Waste: breakages and expiry ───────────────────────────────────────
  const wastePlan: Array<{ day: string; from: string; category: string; note: string; items: Array<[string, number, boolean]> }> = [
    { day: '2026-03-12', from: 'STORE-SICK', category: 'expired', note: 'ORS sachets past their expiry date — destroyed and recorded.', items: [['STK-ORS', 24, true]] },
    { day: '2026-05-14', from: 'STORE-CLEAN', category: 'breakage', note: 'Jik containers burst when the shelf collapsed.', items: [['STK-JIK', 8, false]] },
    { day: '2026-06-18', from: 'STORE-SCHOL', category: 'contaminated', note: 'Rain through the store window soaked a stack of exercise books.', items: [['STK-EXB-32', 35, false]] },
    { day: '2026-08-20', from: 'STORE-SICK', category: 'expired', note: 'Coartem doses expired at the end of August.', items: [['STK-COARTEM', 6, true]] },
    { day: '2026-09-17', from: 'STORE-MAIN', category: 'breakage', note: 'A box of chalk crushed under the paper reams.', items: [['STK-CHALK', 2, false]] },
  ];
  for (const w of wastePlan) {
    if (w.day > ctx.asOf) continue;
    tl.add({
      at: eat(w.day, '14:30'),
      priority: 39,
      label: `store waste ${w.day}`,
      run: async () => {
        const key = `demo:waste:${w.day}:${w.from}`;
        const already = await prisma.wasteRecord.findFirst({ where: { organizationId: O, notes: { contains: key } } });
        if (already) return;
        const lines: Array<{ productId: string; qty: number; isExpiry?: boolean; unit?: string }> = [];
        for (const [code, qty, isExpiry] of w.items) {
          const si = await prisma.stockItem.findFirst({ where: { organizationId: O, productId: pid(code), locationId: loc(w.from) } });
          const have = Math.floor(Number(si?.quantity ?? 0));
          if (have <= 0) continue;
          lines.push({ productId: pid(code), qty: Math.min(qty, have), isExpiry, unit: itemByCode.get(code)!.uom });
        }
        if (lines.length === 0) return;
        const doc: any = await ctx.as('bursar', () =>
          stockDocs.createWaste({ locationId: loc(w.from), category: w.category as any, notes: `${w.note} · ${key}`, items: lines }),
        );
        await ctx.as('head', () => stockDocs.approveWaste(doc.id));
      },
    });
  }

  // ── 6. End-of-term physical counts ───────────────────────────────────────
  // Term 1 and Term 2 counts are submitted (variances posted); the Term 3 count
  // is open on the storekeeper's desk, which is what a demo should show.
  const countDays: Array<{ day: string; location: string; submit: boolean; label: string }> = [
    { day: weekday(addDaysIso(roster.term(1).end, -1)), location: 'STORE-MAIN', submit: true, label: 'Term 1 end-of-term count – main store' },
    { day: weekday(addDaysIso(roster.term(1).end, -1)), location: 'STORE-SCHOL', submit: true, label: 'Term 1 end-of-term count – scholastic store' },
    { day: weekday(addDaysIso(roster.term(2).end, -1)), location: 'STORE-MAIN', submit: true, label: 'Term 2 end-of-term count – main store' },
    { day: weekday(addDaysIso(roster.term(2).end, -1)), location: 'STORE-CLEAN', submit: true, label: 'Term 2 end-of-term count – cleaners’ store' },
    { day: weekday(addDaysIso(ctx.asOf, -2)), location: 'STORE-SICK', submit: false, label: 'Mid-term spot count – sick bay (in progress)' },
  ];
  for (const c of countDays) {
    if (c.day > ctx.asOf) continue;
    tl.add({
      at: eat(c.day, '16:00'),
      priority: 40,
      label: `store count ${c.label}`,
      run: async () => {
        // The stock ledger is dated by the database, so rows this run already
        // wrote carry the real clock; the count's "did anything move after you
        // counted?" guard would read them as movements from the future. Give
        // them their business date first (the same re-dating the run ends with).
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryLedger" il SET "createdAt" = je."postingDate"
             FROM "JournalEntry" je
            WHERE je."organizationId" = il."organizationId" AND je."sourceId" = il."referenceId"
              AND il."organizationId" = $1 AND il."createdAt" > je."postingDate" + interval '1 day'`,
          O,
        );
        let session: any = await prisma.inventoryCountSession.findFirst({
          where: { organizationId: O, notes: { contains: c.label } },
          include: { lines: true },
          orderBy: { startedAt: 'desc' },
        });
        if (!session || session.status === 'cancelled') {
          session = await ctx.as('bursar', () =>
            counts.start({ locationId: loc(c.location), countType: c.submit ? 'closing' : 'opening', notes: c.label }),
          );
          const lines: Array<{ lineId: string; countedQty: number; reason?: string }> = [];
          for (const line of session.lines as any[]) {
            const r = rng(`count:${c.label}:${line.productId}`);
            const system = Number(line.systemQty ?? 0);
            // Lines the store does not hold are left blank rather than counted as
            // zero; a variance on an empty shelf is noise, not a finding.
            if (system <= 0) continue;
            const dice = r();
            // Most lines agree; a few are short, one or two over.
            const counted = dice < 0.84 ? system : dice < 0.95 ? Math.max(0, system - int(r, 1, 3)) : system + int(r, 1, 2);
            lines.push({
              lineId: line.id,
              countedQty: counted,
              reason: counted === system ? undefined : counted < system ? pick(['Issued without a requisition slip', 'Short on the shelf', 'Breakage not recorded'], r) : 'Found behind the shelf',
            });
          }
          if (lines.length === 0) return;
          await ctx.as('bursar', () => counts.saveDraft(session.id, { lines, notes: c.label }));
        }
        if (c.submit && session.status === 'draft') {
          try {
            await ctx.as('head', () => counts.submit(session.id, {}));
          } catch (err: any) {
            // On a re-run the store has already moved past the count date, which
            // the submit guard refuses to absorb silently. Accept it the way a
            // supervisor would, with the reason on the record.
            if (!String(err?.message ?? '').includes('moved after they were counted')) throw err;
            await ctx.as('head', () =>
              counts.submit(session.id, { force: true, forceReason: 'Sheet signed off by the head teacher; later issues already recorded on their own vouchers.' }),
            );
          }
        }
      },
    });
  }

  // ── 7. A standalone cycle-count adjustment the head approves ─────────────
  const adjustments: Array<{ day: string; location: string; reason: string; note: string; items: Array<[string, number]> }> = [
    { day: '2026-04-16', location: 'STORE-MAIN', reason: 'found', note: 'Two reams of A4 found in the head teacher’s office and returned to the store.', items: [['STK-PAPER-A4', 2]] },
    { day: '2026-07-09', location: 'STORE-SPORT', reason: 'damaged', note: 'A netball burst during inter-house sports; written off the register.', items: [['STK-BALL-NET', -1]] },
    { day: '2026-09-24', location: 'STORE-SCHOL', reason: 'cycle_count', note: 'Spot check on sweaters after the Term 3 uniform sales.', items: [['STK-SWEATER', -2]] },
  ];
  for (const a of adjustments) {
    if (a.day > ctx.asOf) continue;
    tl.add({
      at: eat(a.day, '15:30'),
      priority: 41,
      label: `store adjustment ${a.day}`,
      run: async () => {
        const key = `demo:adjust:${a.day}:${a.location}`;
        const already = await prisma.stockAdjustment.findFirst({ where: { organizationId: O, notes: { contains: key } } });
        if (already) return;
        const items: Array<{ productId: string; qtyActual: number; unit?: string }> = [];
        for (const [code, delta] of a.items) {
          const si = await prisma.stockItem.findFirst({ where: { organizationId: O, productId: pid(code), locationId: loc(a.location) } });
          const have = Math.floor(Number(si?.quantity ?? 0));
          if (have <= 0 && delta < 0) continue;
          items.push({ productId: pid(code), qtyActual: Math.max(0, have + delta), unit: itemByCode.get(code)!.uom });
        }
        if (items.length === 0) return;
        const doc: any = await ctx.as('bursar', () =>
          stockDocs.createAdjustment({ locationId: loc(a.location), reason: a.reason as any, notes: `${a.note} · ${key}`, items }),
        );
        await ctx.as('head', () => stockDocs.approveAdjustment(doc.id));
        // Adjustment ledger rows carry no reference, so the end-of-run re-dating
        // cannot find them; stamp them here.
        await prisma.inventoryLedger.updateMany({
          where: { organizationId: O, locationId: loc(a.location), referenceType: null, createdAt: { gt: eat(a.day, '23:59') } },
          data: { createdAt: eat(a.day, '15:30') },
        });
      },
    });
  }

  log(`store movements: ${transferPlan.length} transfers, ${issues} requisitions, ${wastePlan.length} waste records, ${countDays.length} counts, ${adjustments.length} adjustments`);

  return {
    location: loc,
    productId: pid,
    item: (code: string) => {
      const i = itemByCode.get(code);
      if (!i) throw new Error(`Store item ${code} missing`);
      return i;
    },
    items: ITEMS,
    byGroup: (group) => ITEMS.filter((i) => i.group === group),
  };
}

function weekday(isoDate: string): string {
  let d = isoDate;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysIso(d, 1);
  return d;
}
