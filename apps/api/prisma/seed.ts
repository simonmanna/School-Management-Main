import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, type ProductType } from '@erp/shared';
import { seedUomCategories } from '../src/modules/core/product/uom-seed';
import { seedAccountingCore } from '../src/modules/accounting/coa/coa-seeder';
import { seedDmsRegistry, wireDmsRoleKeys } from '../src/modules/documents/dms.seed-registry';
import { applyDefaultApprovalWorkflows } from './default-approval-workflows';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // --- Global currencies ----------------------------------------------------
  const currencies = [
    { code: 'USD', symbol: '$', name: 'US Dollar', decimalPlaces: 2 },
    { code: 'EUR', symbol: 'EUR', name: 'Euro', decimalPlaces: 2 },
    { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }

  // --- Global permission catalog -------------------------------------------
  for (const key of ALL_PERMISSIONS) {
    const sep = key.includes(':') ? ':' : '.';
    const idx = key.lastIndexOf(sep);
    const resource = idx >= 0 ? key.slice(0, idx) : key;
    const action = idx >= 0 ? key.slice(idx + 1) : key;
    await prisma.permission.upsert({
      where: { key },
      update: { resource, action },
      create: { key, resource, action },
    });
  }

  // --- Organization (tenant) -----------------------------------------------
  const org = await prisma.organization.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: {
      code: 'DEMO',
      name: 'Demo Organization',
      currencyCode: 'UGX',
      timezone: 'Africa/Kampala',
      receiptHeader: {
        businessName: 'Abiliz Cafe',
        addressLine1: 'AFEE COMPLEX, KASANGA',
        addressLine2: 'Kampala, Uganda',
        phone: '+256757920771',
        // TIN prints on receipts once set (skipped while empty).
        taxId: '',
      },
      receiptFooter: {
        message: 'Thank you!',
      },
    },
  });

  // --- Administrator role (all permissions) --------------------------------
  const adminRole = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Administrator' } },
    update: { permissions: ALL_PERMISSIONS },
    create: {
      organizationId: org.id,
      name: 'Administrator',
      description: 'Full platform access',
      isSystem: true,
      permissions: ALL_PERMISSIONS,
    },
  });

  // --- Default table zones (dining areas) -----------------------------------
  // Config master: PosTable.zone keys must resolve for a fresh org. Kept in
  // sync with DEFAULT_ZONES in pos-table-zones.service.ts + the
  // table_zones_configurable migration.
  const tableZoneDefs = [
    { key: 'indoor', name: 'Indoor', sortOrder: 1, color: '#10b981' },
    { key: 'outdoor', name: 'Outdoor', sortOrder: 2, color: '#f59e0b' },
    { key: 'terrace', name: 'Terrace', sortOrder: 3, color: '#fb923c' },
    { key: 'vip', name: 'VIP', sortOrder: 4, color: '#a855f7' },
    { key: 'garden', name: 'Garden', sortOrder: 5, color: '#22c55e' },
    { key: 'bar', name: 'Bar', sortOrder: 6, color: '#ec4899' },
  ];
  await prisma.posTableZone.createMany({
    data: tableZoneDefs.map((z) => ({ organizationId: org.id, ...z, active: true })),
    skipDuplicates: true,
  });

  // --- Admin user -----------------------------------------------------------
  const passwordHash = await bcrypt.hash('Admin@123', 10);
  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'admin@demo.test' } },
    update: { roles: { set: [{ id: adminRole.id }] } },
    create: {
      organizationId: org.id,
      email: 'admin@demo.test',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      roles: { connect: [{ id: adminRole.id }] },
    },
  });

  // --- Units of measure (category + factor engine) --------------------------
  // `factor` = base (reference) units per 1 of this unit; reference unit = 1.
  await seedUomCategories(prisma, org.id);

  // --- Tax ------------------------------------------------------------------
    let tax = await prisma.tax.findFirst({
      where: { organizationId: org.id, code: 'NOTAX' },
    });
    if (tax) {
      tax = await prisma.tax.update({ where: { id: tax.id }, data: { rate: 0, name: 'No Tax' } });
    } else {
      tax = await prisma.tax.upsert({
        where: { organizationId_name: { organizationId: org.id, name: 'No Tax' } },
        update: {},
        create: { organizationId: org.id, name: 'No Tax', code: 'NOTAX', type: 'vat', rate: 0 },
      });
    }

    // Uganda standard-rate VAT, available for per-item assignment in the menu
    // editor. Items stay on 'No Tax' by default until the business is
    // VAT-registered and opts in.
    await prisma.tax.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'VAT 18%' } },
      update: { rate: 18 },
      create: { organizationId: org.id, name: 'VAT 18%', code: 'VAT18', type: 'vat', rate: 18 },
    });

    // --- Categories -----------------------------------------------------------
    const productCategory = await prisma.productCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'General' } },
      update: {},
      create: { organizationId: org.id, name: 'General' },
    });
  const partnerCategory = await prisma.partnerCategory.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'General' } },
    update: {},
    create: { organizationId: org.id, name: 'General' },
  });

  // --- Sample partners ------------------------------------------------------
  const partners = [
    { code: 'CUST-001', name: 'Acme Retail Ltd', isCustomer: true, isCompany: true, email: 'orders@acme.test' },
    { code: 'SUPP-001', name: 'Global Supplies Co', isSupplier: true, isCompany: true, email: 'sales@globalsupplies.test' },
  ];
  for (const p of partners) {
    await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: org.id, code: p.code } },
      update: {},
      create: { organizationId: org.id, categoryId: partnerCategory.id, ...p },
    });
  }

  // --- Sample products ------------------------------------------------------
  const baseUom = await prisma.unitOfMeasure.findFirst({
    where: { organizationId: org.id, code: 'UNIT' },
  });
  const products: { code: string; name: string; productType: ProductType; salesPrice: number; costPrice: number }[] = [
    { code: 'PRD-001', name: 'Generic Widget', productType: 'stockable', salesPrice: 10, costPrice: 6 },
    { code: 'SRV-001', name: 'Consulting Hour', productType: 'service', salesPrice: 50, costPrice: 0 },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { organizationId_code: { organizationId: org.id, code: p.code } },
      update: {},
      create: { organizationId: org.id, categoryId: productCategory.id, uomId: baseUom?.id, ...p },
    });
  }

  // --- Fiscal period (current year) ----------------------------------------
  const year = new Date().getFullYear();
  await prisma.fiscalPeriod.upsert({
    where: { organizationId_name: { organizationId: org.id, name: `FY${year}` } },
    update: {},
    create: {
      organizationId: org.id,
      name: `FY${year}`,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31)),
      status: 'open',
    },
  });

  // --- Branch ---------------------------------------------------------------
  await prisma.branch.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
    update: {},
    create: { organizationId: org.id, code: 'MAIN', name: 'Head Office' },
  });

  // --- Chart of accounts, journals and GL mappings --------------------------
  // Single source of truth shared with OrganizationsService — see
  // src/modules/accounting/coa/coa-template.ts.
  const { accountIds } = await seedAccountingCore(prisma, org.id);

  // --- Link master data to accounts ----------------------------------------
  await prisma.productCategory.update({
    where: { id: productCategory.id },
    data: { incomeAccountId: accountIds['4100'], expenseAccountId: accountIds['5100'] },
  });
  await prisma.tax.update({
    where: { id: tax.id },
    data: { accountId: accountIds['2200'] },
  });

  // --- Inventory (Phase 4) --------------------------------------------------
  const warehouse = await prisma.inventoryLocation.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
    update: {},
    create: { organizationId: org.id, code: 'MAIN', name: 'Main Warehouse', type: 'warehouse' },
  });

  const widget = await prisma.product.findFirst({
    where: { organizationId: org.id, code: 'PRD-001' },
  });
  if (widget) {
    await prisma.product.update({
      where: { id: widget.id },
      data: { trackInventory: true, minQuantity: 10 },
    });

    const openingQty = 100;
    await prisma.stockItem.upsert({
      where: { organizationId_productId_variantKey_locationId: { organizationId: org.id, productId: widget.id, variantKey: '', locationId: warehouse.id } },
      update: { runningAverageCost: 6 },
      create: { organizationId: org.id, productId: widget.id, variantKey: '', locationId: warehouse.id, quantity: openingQty, runningAverageCost: 6 },
    });

    // Ledger no longer uses a (org, ledgerCode) unique (one code spans multiple
    // rows), so upsert-by-code is replaced with an idempotent find-or-create.
    const existingOpening = await prisma.inventoryLedger.findFirst({
      where: { organizationId: org.id, ledgerCode: 'STK/OPENING' },
    });
    if (existingOpening) {
      await prisma.inventoryLedger.update({
        where: { id: existingOpening.id },
        data: { quantityChange: openingQty, balanceAfter: openingQty, unitCost: 6, totalValue: 600 },
      });
    } else {
      await prisma.inventoryLedger.create({
        data: {
          organizationId: org.id,
          ledgerCode: 'STK/OPENING',
          productId: widget.id,
          locationId: warehouse.id,
          type: 'opening_balance',
          quantityChange: openingQty,
          balanceAfter: openingQty,
          unitCost: 6,
          totalValue: 600,
          notes: 'Opening balance from seed',
        },
      });
    }
  }

  // --- Clear old demo menu data (idempotent) ---------------------------------
  await prisma.menuProduct.deleteMany({ where: { organizationId: org.id } });
  await prisma.menuItem.deleteMany({ where: { organizationId: org.id } });
  await prisma.menuCategory.deleteMany({ where: { organizationId: org.id } });

  // --- Sunrise Cafe demo data ----------------------------------------------
  // Adds cafe-specific categories + 32 products + stock + a cash register
  // so a cashier opening /pos/terminal for the first time has a populated
  // catalog and can open a shift without setup work.
  await seedSunriseCafe(org.id, warehouse.id, tax.id, accountIds['1100']);

  // --- Demo menu (79 items across 8 categories) -----------------------------
  await seedDemoMenu(org.id, tax.id);

  // --- Demo staff, PIN, and tables ------------------------------------------
  await seedStaffAndTables(org.id, adminRole.id);

  // --- Default approval workflows -------------------------------------------
  // Without these the approval engine matches nothing and auto-approves every
  // gate. See default-approval-workflows.ts for the thresholds and for why the
  // finance workflows ship inactive.
  const wf = await applyDefaultApprovalWorkflows(prisma, org.id);
  console.log(`Approval workflows: ${wf.created} created, ${wf.skipped} already present.`);

    console.log('Seed complete (incl. chart of accounts, journals, account mappings, inventory).');
    console.log('Login -> organization: "DEMO", email: "admin@demo.test", password: "Admin@123"');
  }

  /** Sunrise Cafe demo data — categories, products, stock, cash register. */
    async function seedSunriseCafe(orgId: string, warehouseId: string, taxId: string, cashAccountId: string): Promise<void> {
      const categoryDefs: Array<{ name: string }> = [
        { name: 'Drinks' },
        { name: 'Mains' },
        { name: 'Desserts' },
        { name: 'Pastries' },
        { name: 'Breakfast' },
        { name: 'Sides & Snacks' },
        { name: 'Milkshakes' },
      ];
      const categories = new Map<string, string>();
      for (const c of categoryDefs) {
        const row = await prisma.productCategory.upsert({
          where: { organizationId_name: { organizationId: orgId, name: c.name } },
          update: {},
          create: { organizationId: orgId, name: c.name },
        });
        categories.set(c.name, row.id);
      }

    // Product catalog — 32 cafe items. Code is the SKU the cashier scans.
      const productDefs: Array<{
        code: string; sku: string; name: string; price: number; cost: number;
        category: string; productType: 'stockable' | 'service'; trackInventory: boolean;
        stock: number; minStock: number; taxInclusive: boolean;
      }> = [
      // Drinks — P10: priced VAT-inclusive (typical for Ugandan cafes).
          { code: 'P-COFFEE-S', sku: 'COF-S', name: 'Small Espresso', price: 5000, cost: 1500, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-COFFEE-M', sku: 'COF-M', name: 'Medium Cappuccino', price: 8000, cost: 2500, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-LATTE-L', sku: 'LAT-L', name: 'Large Café Latte', price: 12000, cost: 3500, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-MOCHA', sku: 'MOCH', name: 'Caramel Mocha', price: 14000, cost: 4000, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-HOT-CHOC', sku: 'HOT-CHOC', name: 'Hot Chocolate', price: 7000, cost: 2200, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-ICED-LATTE', sku: 'ICED-LAT', name: 'Iced Latte', price: 13000, cost: 3800, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-FLAT-WHITE', sku: 'FLAT-W', name: 'Flat White', price: 9500, cost: 2800, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-AMERICANO', sku: 'AMER-M', name: 'Medium Americano', price: 7000, cost: 2000, category: 'Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-TEA', sku: 'TEA', name: 'English Breakfast Tea', price: 6000, cost: 1000, category: 'Tea & Other Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-GREEN-TEA', sku: 'GRN-TEA', name: 'Green Tea', price: 7000, cost: 1200, category: 'Tea & Other Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-GINGER-TEA', sku: 'GING-TEA', name: 'Ginger Tea', price: 8000, cost: 1500, category: 'Tea & Other Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-ICED-LEMON', sku: 'ICED-LMN', name: 'Iced Lemon Tea', price: 9000, cost: 2000, category: 'Tea & Other Drinks', productType: 'service', trackInventory: false, stock: 0, minStock: 0, taxInclusive: true },
          { code: 'P-SMOOTHIE', sku: 'SMTH', name: 'Mango Smoothie', price: 15000, cost: 5000, category: 'Tea & Other Drinks', productType: 'stockable', trackInventory: true, stock: 30, minStock: 10, taxInclusive: true },
          { code: 'P-ORANGE-J', sku: 'ORG-J', name: 'Fresh Orange Juice', price: 8000, cost: 3000, category: 'Tea & Other Drinks', productType: 'stockable', trackInventory: true, stock: 20, minStock: 5, taxInclusive: true },
          // Mains — VAT additive (price excludes tax; tax added at checkout).
          { code: 'P-SAND-CLUB', sku: 'SND-CLUB', name: 'Club Sandwich', price: 18000, cost: 6000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 20, minStock: 5, taxInclusive: false },
          { code: 'P-BURGER', sku: 'BRG', name: 'Beef Burger + Chips', price: 22000, cost: 8000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 15, minStock: 5, taxInclusive: false },
          { code: 'P-PIZZA-M', sku: 'PZA-M', name: 'Margherita Pizza (M)', price: 25000, cost: 9000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 12, minStock: 4, taxInclusive: false },
          { code: 'P-FISH-CHIPS', sku: 'FISH-CH', name: 'Fish & Chips', price: 20000, cost: 7000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-WINGS', sku: 'WING-10', name: 'Chicken Wings (10pc)', price: 18000, cost: 6500, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-CAESAR', sku: 'CAESAR', name: 'Caesar Salad', price: 16000, cost: 5000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: false },
          { code: 'P-WRAP', sku: 'WRAP-CH', name: 'Chicken Wrap', price: 14000, cost: 4500, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 12, minStock: 3, taxInclusive: false },
          // Pastries — VAT-inclusive (the cafe's preferred display style).
          { code: 'P-CROISSANT', sku: 'CRS', name: 'Butter Croissant', price: 6000, cost: 2000, category: 'Pastries', productType: 'stockable', trackInventory: true, stock: 24, minStock: 6, taxInclusive: true },
          { code: 'P-CINNABON', sku: 'CNN', name: 'Cinnamon Roll', price: 8000, cost: 2500, category: 'Pastries', productType: 'stockable', trackInventory: true, stock: 18, minStock: 5, taxInclusive: true },
          { code: 'P-APPLE-PIE', sku: 'APL-PIE', name: 'Apple Pie Slice', price: 9000, cost: 3000, category: 'Pastries', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: true },
          { code: 'P-MUFFIN', sku: 'MUF-BL', name: 'Blueberry Muffin', price: 7000, cost: 2200, category: 'Pastries', productType: 'stockable', trackInventory: true, stock: 16, minStock: 4, taxInclusive: true },
          // Desserts — VAT additive.
          { code: 'P-CAKE', sku: 'CAKE', name: 'Chocolate Cake Slice', price: 12000, cost: 4000, category: 'Desserts', productType: 'stockable', trackInventory: true, stock: 16, minStock: 4, taxInclusive: false },
          { code: 'P-CHEESECAKE', sku: 'CHS-CAKE', name: 'Vanilla Cheesecake', price: 14000, cost: 5000, category: 'Desserts', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-TIRAMISU', sku: 'TIRA', name: 'Tiramisu', price: 15000, cost: 5500, category: 'Desserts', productType: 'stockable', trackInventory: true, stock: 8, minStock: 2, taxInclusive: false },
          // Drinks extras
          { code: 'P-ICED-TEA', sku: 'ICED-TEA', name: 'Iced Tea', price: 5000, cost: 800, category: 'Drinks', productType: 'stockable', trackInventory: true, stock: 50, minStock: 10, taxInclusive: true },
          { code: 'P-SODA', sku: 'SODA', name: 'Soda / Soft Drink', price: 3000, cost: 600, category: 'Drinks', productType: 'stockable', trackInventory: true, stock: 60, minStock: 15, taxInclusive: true },
          { code: 'P-WATER', sku: 'WATER', name: 'Mineral Water', price: 2000, cost: 400, category: 'Drinks', productType: 'stockable', trackInventory: true, stock: 80, minStock: 20, taxInclusive: true },
          // Mains extras
          { code: 'P-PASTA-BOLO', sku: 'PST-BOLO', name: 'Spaghetti Bolognese', price: 18000, cost: 7000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-RICE-CHICKEN', sku: 'RICE-CHK', name: 'Rice & Chicken', price: 20000, cost: 8000, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-OMELETTE', sku: 'OMEL-GRN', name: 'Cheese Omelette', price: 12000, cost: 4500, category: 'Mains', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          // Pastries extras
          { code: 'P-DONUT', sku: 'DONUT-GL', name: 'Glazed Donut', price: 4000, cost: 1500, category: 'Pastries', productType: 'stockable', trackInventory: true, stock: 20, minStock: 5, taxInclusive: true },
          { code: 'P-SCONE', sku: 'SCONE-JM', name: 'Scone with Jam', price: 5000, cost: 1800, category: 'Pastries', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
          // Desserts extras
          { code: 'P-PUDDING', sku: 'PUDD-BAN', name: 'Banana Pudding', price: 10000, cost: 3500, category: 'Desserts', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-GELATO', sku: 'GELATO', name: 'Gelato (2 scoops)', price: 8000, cost: 2500, category: 'Desserts', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: false },
          // Breakfast (new category)
          { code: 'P-BFST-BREA', sku: 'BFST-BRD', name: 'Toast with Butter', price: 3000, cost: 800, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 30, minStock: 8, taxInclusive: true },
          { code: 'P-BFST-EGGS', sku: 'BFST-EGG', name: 'Fried Eggs (2pc)', price: 5000, cost: 2000, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 20, minStock: 5, taxInclusive: false },
          { code: 'P-BFST-PORR', sku: 'BFST-POR', name: 'Porridge with Honey', price: 4000, cost: 1200, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
          { code: 'P-BFST-CROISSANT', sku: 'BFST-CRS', name: 'Croissant Sandwich', price: 8000, cost: 3000, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
          { code: 'P-BFST-AVOCADO', sku: 'BFST-AVO', name: 'Avocado Toast', price: 12000, cost: 4500, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-BFST-PANCAKE', sku: 'BFST-PNC', name: 'Pancakes (3pc + Syrup)', price: 10000, cost: 3500, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 12, minStock: 3, taxInclusive: true },
          { code: 'P-BFST-SET', sku: 'BFST-SET', name: 'Full Breakfast Set', price: 18000, cost: 7000, category: 'Breakfast', productType: 'stockable', trackInventory: true, stock: 8, minStock: 2, taxInclusive: false },
          // Sides & Snacks (new category)
          { code: 'P-SIDE-FRIES', sku: 'SIDE-FRI', name: 'French Fries', price: 6000, cost: 2000, category: 'Sides & Snacks', productType: 'stockable', trackInventory: true, stock: 30, minStock: 8, taxInclusive: true },
          { code: 'P-SIDE-NACHOS', sku: 'SIDE-NAC', name: 'Nachos with Cheese', price: 9000, cost: 3500, category: 'Sides & Snacks', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-SIDE-ONION', sku: 'SIDE-ONI', name: 'Onion Rings', price: 7000, cost: 2500, category: 'Sides & Snacks', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
          { code: 'P-SIDE-WINGS', sku: 'SIDE-WNG', name: 'BBQ Wings (6pc)', price: 12000, cost: 5000, category: 'Sides & Snacks', productType: 'stockable', trackInventory: true, stock: 10, minStock: 3, taxInclusive: false },
          { code: 'P-SIDE-BBS', sku: 'SIDE-BBS', name: 'Wings Combo Bucket', price: 22000, cost: 9000, category: 'Sides & Snacks', productType: 'stockable', trackInventory: true, stock: 8, minStock: 2, taxInclusive: false },
          // Milkshakes (new category)
          { code: 'P-SHake-VAN', sku: 'SHK-VAN', name: 'Vanilla Milkshake', price: 12000, cost: 4000, category: 'Milkshakes', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
          { code: 'P-SHake-CHOC', sku: 'SHK-CHOC', name: 'Chocolate Milkshake', price: 12000, cost: 4000, category: 'Milkshakes', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
          { code: 'P-SHake-STRAW', sku: 'SHK-STR', name: 'Strawberry Milkshake', price: 12000, cost: 4000, category: 'Milkshakes', productType: 'stockable', trackInventory: true, stock: 15, minStock: 4, taxInclusive: true },
      ];

    for (const p of productDefs) {
      const product = await prisma.product.upsert({
        where: { organizationId_code: { organizationId: orgId, code: p.code } },
        update: {
          name: p.name,
          salesPrice: p.price,
          costPrice: p.cost,
          productType: p.productType as any,
          trackInventory: p.trackInventory,
          minQuantity: p.minStock,
          categoryId: categories.get(p.category) ?? null,
          taxId,
          sku: p.sku,
          isActive: true,
          // P10: re-upsert the tax-inclusive flag every time the seed runs.
          taxInclusive: p.taxInclusive,
        },
        create: {
          organizationId: orgId,
          code: p.code,
          sku: p.sku,
          name: p.name,
          salesPrice: p.price,
          costPrice: p.cost,
          productType: p.productType as any,
          trackInventory: p.trackInventory,
          minQuantity: p.minStock,
          categoryId: categories.get(p.category) ?? null,
          taxId,
          isActive: true,
        },
      });

      // Opening stock for stockable items.
      if (p.trackInventory && p.stock > 0) {
        await prisma.stockItem.upsert({
          where: {
            organizationId_productId_variantKey_locationId: {
              organizationId: orgId, productId: product.id, variantKey: '', locationId: warehouseId,
            },
          },
          update: { quantity: p.stock, runningAverageCost: p.cost },
          create: {
            organizationId: orgId,
            productId: product.id,
            variantKey: '',
            locationId: warehouseId,
            quantity: p.stock,
            runningAverageCost: p.cost,
          },
        });
      }
    }

    // Cash register so a cashier can open a shift.
      await prisma.cashRegister.upsert({
        where: { organizationId_code: { organizationId: orgId, code: 'MAIN-REG' } },
        update: { name: 'Main Counter Register', isActive: true, defaultAccountId: cashAccountId },
        create: {
          organizationId: orgId,
          code: 'MAIN-REG',
          name: 'Main Counter Register',
          isActive: true,
          defaultAccountId: cashAccountId,
        },
      });

    console.log('Sunrise Cafe demo data seeded (4 categories, 32 products, stock, MAIN-REG cash register).');
    }

  /** Demo menu — 79 items across 8 categories, all linked to Products. */
  async function seedDemoMenu(orgId: string, taxId: string): Promise<void> {
    const baseUom = await prisma.unitOfMeasure.findFirst({
      where: { organizationId: orgId, code: 'UNIT' },
    });

    // --- Menu categories ---------------------------------------------------
    const catDefs = [
      { name: 'PASTRIES', order: 1 },
      { name: 'CAKES', order: 2 },
      { name: 'COOKIES', order: 3 },
      { name: 'FULL (OCCASION) CAKES', order: 4 },
      { name: 'BREAKFAST & SNACKS', order: 5 },
      { name: 'COFFEE', order: 6 },
      { name: 'TEA', order: 7 },
      { name: 'COLD DRINKS', order: 8 },
    ];
    const cats = new Map<string, string>();
    for (const c of catDefs) {
      const row = await prisma.menuCategory.upsert({
        where: { organizationId_name_parentId: { organizationId: orgId, name: c.name, parentId: '' } },
        update: { displayOrder: c.order },
        create: { organizationId: orgId, name: c.name, displayOrder: c.order },
      });
      cats.set(c.name, row.id);
    }

    // --- Item definitions --------------------------------------------------
    type ItemDef = {
      code: string;
      name: string;
      category: string;
      taxInclusive: boolean;
      basePrice: number;
      variants?: { name: string; price: number }[];
    };

    const allItems: ItemDef[] = [
      // PASTRIES
      ...(['Boxenia','Mini-Boxenia','Eclair','Mini-Eclair','Bigne','Mini-Bigne',
           'Milefolli','Tarts','Mini Tarts','Croissant','Mi-Croissant','Brioch'] as const).map((n, i) => ({
        code: `PRD-PAST-${String(i+1).padStart(3,'0')}`,
        name: n,
        category: 'PASTRIES',
        taxInclusive: true,
        basePrice: [5000,3000,7000,4000,6000,4000,8000,6000,4000,7000,5000,7000][i],
      })),
      // CAKES
      ...(['Panna','Tiramisu','Vanilla','Caramel','Chees Cake','Carrot Cake','Browni',
           'Crostata','Crosta-ricotta','Crosta-Choco','Choco-Cake','Choco-Fudge'] as const).map((n, i) => ({
        code: `PRD-CAKE-${String(i+1).padStart(3,'0')}`,
        name: n,
        category: 'CAKES',
        taxInclusive: true,
        basePrice: [8000,10000,9000,10000,14000,10000,7000,8000,10000,10000,10000,10000][i],
      })),
      // COOKIES
      { code: 'PRD-COOK-001', name: 'Biscoti 1/2 kg', category: 'COOKIES', taxInclusive: true, basePrice: 25000 },
      { code: 'PRD-COOK-002', name: 'Cookies 1/2 kg', category: 'COOKIES', taxInclusive: true, basePrice: 30000 },
      // FULL (OCCASION) CAKES
      { code: 'PRD-FULL-001', name: 'Pound Cake', category: 'FULL (OCCASION) CAKES', taxInclusive: true, basePrice: 30000 },
      { code: 'PRD-FULL-002', name: 'Pound Cake-P', category: 'FULL (OCCASION) CAKES', taxInclusive: true, basePrice: 5000 },
      // BREAKFAST & SNACKS
      { code: 'PRD-BFST-001', name: 'Donuts plain', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 4000 },
      { code: 'PRD-BFST-002', name: 'Donuts', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 5000 },
      { code: 'PRD-BFST-003', name: 'Mi-Donut pl', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 2000 },
      { code: 'PRD-BFST-004', name: 'Mini-Donuts', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 3000 },
      { code: 'PRD-BFST-005', name: 'Mini-Donut 1/2 kg', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 25000 },
      { code: 'PRD-BFST-006', name: 'Cupcake', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 5000 },
      { code: 'PRD-BFST-007', name: 'Mi-Cupcake', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 4000 },
      { code: 'PRD-BFST-008', name: 'Span. Omelette', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 12000 },
      { code: 'PRD-BFST-009', name: 'Omelette C&H', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 18000 },
      { code: 'PRD-BFST-010', name: 'Frittata', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 12000 },
      { code: 'PRD-BFST-011', name: 'Fritta Special', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 16000 },
      { code: 'PRD-BFST-012', name: 'Croissant Sand.', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 18000 },
      { code: 'PRD-BFST-013', name: 'Kitcha Ftf Flour', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 16000 },
      { code: 'PRD-BFST-014', name: 'Kitcha Ftf Taff', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 18000 },
      { code: 'PRD-BFST-015', name: 'Kitcha Ftf Sgem', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 18000 },
      { code: 'PRD-BFST-016', name: 'Geat', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 15000 },
      { code: 'PRD-BFST-017', name: 'Full medemes', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 13000 },
      { code: 'PRD-BFST-018', name: 'Full special', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 15000 },
      { code: 'PRD-BFST-019', name: 'Pizza S Margerita', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 12000 },
      { code: 'PRD-BFST-020', name: 'Pizza S Chiken', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 18000 },
      { code: 'PRD-BFST-021', name: 'Pizza S Africana', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 18000 },
      { code: 'PRD-BFST-022', name: 'Pizza M Margerita', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 25000 },
      { code: 'PRD-BFST-023', name: 'Pizza M Chiken', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 28000 },
      { code: 'PRD-BFST-024', name: 'Pizza M Africana', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 28000 },
      { code: 'PRD-BFST-025', name: 'Pizza L Margerita', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 30000 },
      { code: 'PRD-BFST-026', name: 'Pizza L Chiken', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 32000 },
      { code: 'PRD-BFST-027', name: 'Pizza L Africana', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 32000 },
      { code: 'PRD-BFST-028', name: 'Mini-Pizza', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 2000 },
      { code: 'PRD-BFST-029', name: 'Mini-Pizza 1/2 kg', category: 'BREAKFAST & SNACKS', taxInclusive: false, basePrice: 25000 },
      // COFFEE
      { code: 'PRD-COF-001', name: 'Espresso', category: 'COFFEE', taxInclusive: false, basePrice: 4000, variants: [
        { name: 'S', price: 4000 }, { name: 'M', price: 5000 },
      ]},
      { code: 'PRD-COF-002', name: 'Cappuccino', category: 'COFFEE', taxInclusive: false, basePrice: 7000, variants: [
        { name: 'S', price: 7000 }, { name: 'M', price: 9000 },
      ]},
      { code: 'PRD-COF-003', name: 'Macchiato', category: 'COFFEE', taxInclusive: false, basePrice: 5000, variants: [
        { name: 'S', price: 5000 }, { name: 'M', price: 7000 },
      ]},
      { code: 'PRD-COF-004', name: 'Café Mocha', category: 'COFFEE', taxInclusive: false, basePrice: 9000, variants: [
        { name: 'S', price: 9000 }, { name: 'M', price: 12000 },
      ]},
      { code: 'PRD-COF-005', name: 'Café Americano', category: 'COFFEE', taxInclusive: false, basePrice: 5000, variants: [
        { name: 'S', price: 5000 }, { name: 'M', price: 7000 },
      ]},
      { code: 'PRD-COF-006', name: 'Café Late', category: 'COFFEE', taxInclusive: false, basePrice: 7000, variants: [
        { name: 'S', price: 7000 }, { name: 'M', price: 9000 },
      ]},
      { code: 'PRD-COF-007', name: 'Hot Chocolate', category: 'COFFEE', taxInclusive: false, basePrice: 10000 },
      // TEA
      { code: 'PRD-TEA-001', name: 'Balk Tea', category: 'TEA', taxInclusive: true, basePrice: 3000 },
      { code: 'PRD-TEA-002', name: 'African Tea', category: 'TEA', taxInclusive: true, basePrice: 5000 },
      { code: 'PRD-TEA-003', name: 'Green Tea', category: 'TEA', taxInclusive: true, basePrice: 5000 },
      { code: 'PRD-TEA-004', name: 'Herbal Tea', category: 'TEA', taxInclusive: true, basePrice: 5000 },
      { code: 'PRD-TEA-005', name: 'Dawa Tea', category: 'TEA', taxInclusive: true, basePrice: 6000 },
      // COLD DRINKS
      { code: 'PRD-COLD-001', name: 'Water/Rwenzori', category: 'COLD DRINKS', taxInclusive: true, basePrice: 3000 },
      { code: 'PRD-COLD-002', name: 'Soda Water', category: 'COLD DRINKS', taxInclusive: true, basePrice: 3000 },
      { code: 'PRD-COLD-003', name: 'Soda Glass', category: 'COLD DRINKS', taxInclusive: true, basePrice: 3000 },
    ];

    // --- Products + MenuItems + MenuProducts + Variants --------------------
    for (let i = 0; i < allItems.length; i++) {
      const it = allItems[i];

      const product = await prisma.product.upsert({
        where: { organizationId_code: { organizationId: orgId, code: it.code } },
        update: {
          name: it.name,
          salesPrice: it.basePrice,
          costPrice: 0,
          productType: 'service',
          trackInventory: false,
          minQuantity: 0,
          categoryId: null,
          taxId,
          sku: it.code,
          isActive: true,
          taxInclusive: it.taxInclusive,
        },
        create: {
          organizationId: orgId,
          code: it.code,
          sku: it.code,
          name: it.name,
          salesPrice: it.basePrice,
          costPrice: 0,
          productType: 'service',
          trackInventory: false,
          minQuantity: 0,
          categoryId: null,
          uomId: baseUom?.id,
          taxId,
          isActive: true,
        },
      });

      const menuItem = await prisma.menuItem.upsert({
        where: { organizationId_code: { organizationId: orgId, code: it.code } },
        update: {
          name: it.name,
          basePrice: it.basePrice,
          categoryId: cats.get(it.category) ?? null,
          isAvailable: true,
          displayOrder: i,
        },
        create: {
          organizationId: orgId,
          code: it.code,
          name: it.name,
          basePrice: it.basePrice,
          categoryId: cats.get(it.category) ?? null,
          isAvailable: true,
          displayOrder: i,
        },
      });

      await prisma.menuProduct.upsert({
        where: { menuItemId_productId: { menuItemId: menuItem.id, productId: product.id } },
        update: { quantity: 1 },
        create: {
          organizationId: orgId,
          menuItemId: menuItem.id,
          productId: product.id,
          quantity: 1,
        },
      });

      if (it.variants) {
        for (const v of it.variants) {
          await prisma.menuItemVariant.upsert({
            where: {
              organizationId_menuItemId_name: {
                organizationId: orgId,
                menuItemId: menuItem.id,
                name: v.name,
              },
            },
            update: { price: v.price, isActive: true, sortOrder: v.name === 'S' ? 0 : 1 },
            create: {
              organizationId: orgId,
              menuItemId: menuItem.id,
              name: v.name,
              price: v.price,
              sortOrder: v.name === 'S' ? 0 : 1,
              isActive: true,
            },
          });
        }
      }
    }

    console.log('Demo menu seeded (8 categories, 79 items, 6 coffees with size variants).');
  }

  /** Demo staff, PIN, and tables for POS testing (no menu items). */
  async function seedStaffAndTables(orgId: string, adminRoleId: string): Promise<void> {
    const branch = await prisma.branch.findFirst({
      where: { organizationId: orgId, code: 'MAIN' },
    });

    // --- Admin PIN -----------------------------------------------------------
    const adminPinHash = await bcrypt.hash('1234', 10);
    const admin = await prisma.user.findFirst({
      where: { organizationId: orgId, email: 'admin@demo.test' },
    });
    if (admin) {
      await prisma.user.update({
        where: { id: admin.id },
        data: { pinHash: adminPinHash, pinHashRounds: 10 },
      });
    }

    // --- Staff roles ---------------------------------------------------------
    const cashierPerms = [
      'pos:read', 'pos:checkout', 'pos:hold', 'pos:discount', 'pos:void', 'pos:kds',
      'cash_session:open', 'cash_session:read', 'cash_session:close',
      'tables:view', 'tables:transfer', 'tables:edit',
      'partner:read',
      'partners.view',
      'products.view',
      'menu.view',
    ];
    const cashierRole = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: orgId, name: 'Cashier' } },
      update: { permissions: cashierPerms },
      create: {
        organizationId: orgId,
        name: 'Cashier',
        description: 'Can operate the POS terminal',
        isSystem: true,
        permissions: cashierPerms,
      },
    });

    const waiterPerms = [
      'pos:read',
      // Taking orders goes through POST /pos/orders which requires
      // pos:checkout; without it the Waiter role cannot ring anything in.
      'pos:checkout', 'pos:hold', 'pos:kds',
      'tables:view', 'tables:transfer', 'tables:merge', 'tables:split', 'tables:edit',
      'partner:read',
      'partners.view',
      'products.view',
      'menu.view',
      'menu_categories.view',
    ];
    const waiterRole = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: orgId, name: 'Waiter' } },
      update: { permissions: waiterPerms },
      create: {
        organizationId: orgId,
        name: 'Waiter',
        description: 'Can take orders and manage tables',
        isSystem: true,
        permissions: waiterPerms,
      },
    });

    const supervisorPerms = [
      'inventory_count:read', 'inventory_count:count', 'inventory_count:submit',
      'inventory:read', 'inventory:move', 'inventory_location:read',
      'inventory_doc:read', 'inventory_doc:create', 'inventory_doc:approve',
      'product:read', 'products.view', 'partner:read',
      'pos:read', 'pos:reports', 'pos:kds',
      // Beverage Control — runs bottle counts + product setup. NOT beverage:approve
      // (segregation of duties: the person who counts cannot approve their own
      // over-tolerance count — that stays with an Administrator/manager).
      'beverage:read', 'beverage:count', 'beverage:setup',
    ];
    await prisma.role.upsert({
      where: { organizationId_name: { organizationId: orgId, name: 'Supervisor' } },
      update: { permissions: supervisorPerms },
      create: {
        organizationId: orgId,
        name: 'Supervisor',
        description: 'Runs stock counts and inventory adjustments',
        isSystem: true,
        permissions: supervisorPerms,
      },
    });

    // Kitchen / Chef — sees the Kitchen Display board and advances tickets, but
    // never prices, payments or reports. pos:read lets it load the station list.
    const kitchenPerms = ['pos:read', 'pos:kds'];
    await prisma.role.upsert({
      where: { organizationId_name: { organizationId: orgId, name: 'Kitchen' } },
      update: { permissions: kitchenPerms },
      create: {
        organizationId: orgId,
        name: 'Kitchen',
        description: 'Kitchen Display — prepares and advances orders',
        isSystem: true,
        permissions: kitchenPerms,
      },
    });

    // --- Kitchen stations (KDS routing) -------------------------------------
    // The three defaults keep legacy Product.station codes (bar/kitchen/cafe)
    // resolving after the PosStation enum→string migration. `cafe` is the
    // fallback (isDefault) for products with no valid station.
    const stationDefs = [
      { name: 'Kitchen', code: 'kitchen', color: '#f43f5e', icon: 'ChefHat', displayOrder: 0, isDefault: false },
      { name: 'Bar', code: 'bar', color: '#f59e0b', icon: 'Coffee', displayOrder: 1, isDefault: false },
      { name: 'Cafe', code: 'cafe', color: '#10b981', icon: 'Sandwich', displayOrder: 2, isDefault: true },
    ];
    // KitchenStation is RLS-enabled, so set the tenant context (app.org_id) for
    // the transaction the way PrismaService does at runtime; the policy's
    // WITH CHECK then accepts these org-scoped inserts. (Other seed tables have
    // RLS inert in dev, so they don't need this.)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      for (const st of stationDefs) {
        await tx.kitchenStation.upsert({
          where: { organizationId_code: { organizationId: orgId, code: st.code } },
          update: { name: st.name, color: st.color, icon: st.icon, displayOrder: st.displayOrder },
          create: { organizationId: orgId, ...st },
        });
      }
    });

    // --- Staff users ---------------------------------------------------------
    const staffDefs: Array<{
      email: string; firstName: string; lastName: string; roleName: string;
      password: string; pin: string;
    }> = [
      { email: 'sarah@demo.test', firstName: 'Sarah', lastName: 'Cashier', roleName: 'Cashier', password: 'Demo@123', pin: '1111' },
      { email: 'john@demo.test', firstName: 'John', lastName: 'Waiter', roleName: 'Waiter', password: 'Demo@123', pin: '2222' },
      { email: 'mary@demo.test', firstName: 'Mary', lastName: 'Supervisor', roleName: 'Supervisor', password: 'Demo@123', pin: '3333' },
      { email: 'chef@demo.test', firstName: 'Chef', lastName: 'Kitchen', roleName: 'Kitchen', password: 'Demo@123', pin: '4444' },
    ];

    for (const s of staffDefs) {
      const pwHash = await bcrypt.hash(s.password, 10);
      const pinHash = await bcrypt.hash(s.pin, 10);
      const role = await prisma.role.findFirst({
        where: { organizationId: orgId, name: s.roleName },
      });
      await prisma.user.upsert({
        where: { organizationId_email: { organizationId: orgId, email: s.email } },
        update: {
          firstName: s.firstName, lastName: s.lastName,
          roles: { set: role ? [{ id: role.id }] : [] },
          pinHash, pinHashRounds: 10,
          defaultBranchId: branch?.id ?? null,
        },
        create: {
          organizationId: orgId,
          email: s.email,
          passwordHash: pwHash,
          firstName: s.firstName,
          lastName: s.lastName,
          roles: { connect: role ? [{ id: role.id }] : [] },
          pinHash, pinHashRounds: 10,
          defaultBranchId: branch?.id ?? null,
        },
      });
    }

    // --- POS tables ---------------------------------------------------------
    const tableDefs = [
      { name: 'Table 1', number: 1, seats: 2, zone: 'indoor' as const, posX: 40, posY: 40 },
      { name: 'Table 2', number: 2, seats: 2, zone: 'indoor' as const, posX: 180, posY: 40 },
      { name: 'Table 3', number: 3, seats: 4, zone: 'indoor' as const, posX: 40, posY: 180 },
      { name: 'Table 4', number: 4, seats: 4, zone: 'indoor' as const, posX: 180, posY: 180 },
      { name: 'Table 5', number: 5, seats: 6, zone: 'outdoor' as const, posX: 40, posY: 320 },
      { name: 'Table 6', number: 6, seats: 6, zone: 'outdoor' as const, posX: 180, posY: 320 },
      { name: 'Bar Counter', number: 7, seats: 3, zone: 'bar' as const, posX: 320, posY: 40 },
    ];
    for (const t of tableDefs) {
      await prisma.posTable.upsert({
        where: { organizationId_number: { organizationId: orgId, number: t.number } },
        // No `status` here: re-seeding must never stomp live occupancy —
        // status is only set on create and owned by the order lifecycle after.
        update: { name: t.name, seats: t.seats, zone: t.zone, active: true },
        create: {
          organizationId: orgId,
          name: t.name,
          number: t.number,
          seats: t.seats,
          zone: t.zone,
          active: true,
          status: 'available',
          shape: 'square',
          posX: t.posX,
          posY: t.posY,
          width: 120,
          height: 120,
        },
      });
    }

    // --- DMS registry (global lifecycles, types, relation types, keys) ------
        await seedDmsRegistry(prisma);
        await wireDmsRoleKeys(prisma);

        console.log('Demo staff (Sarah cashier 1111, John waiter 2222) and 7 tables seeded.');
        console.log('Admin PIN: 1234');
  }

    main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
