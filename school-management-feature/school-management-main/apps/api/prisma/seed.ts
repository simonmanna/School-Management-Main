import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  ALL_PERMISSIONS,
  type AccountType,
  type JournalType,
  type ProductType,
} from '@erp/shared';

const prisma = new PrismaClient();

/**
 * P0-11 (C-3): resolve the seed admin password from the environment.
 *
 * Production must always set SEED_ADMIN_PASSWORD — otherwise we refuse
 * to create a default-admin account with a well-known password. In
 * dev/test (NODE_ENV !== 'production'), fall back to the documented
 * dev default so the local smoke scripts continue to work.
 *
 * Exported for unit testing.
 */
export function resolveSeedAdminPassword(): string {
  if (process.env.SEED_ADMIN_PASSWORD) return process.env.SEED_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required when NODE_ENV=production. ' +
        'Refusing to create a default-admin account with a known password.',
    );
  }
  return 'Admin@123';
}

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
    const [resource, action] = key.split(':');
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
    create: { code: 'DEMO', name: 'Demo Organization', currencyCode: 'USD', timezone: 'UTC' },
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

  // --- Admin user -----------------------------------------------------------
  // P0-11 (C-3): the admin password is no longer hard-coded in source.
  // Operators must set SEED_ADMIN_PASSWORD before running this script in
  // production. In dev, the well-known default is provided so the local
  // smoke scripts still work.
  const seedPassword = resolveSeedAdminPassword();
  const passwordHash = await bcrypt.hash(seedPassword, 10);
  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'admin@demo.test' } },
    update: { roles: { set: [{ id: adminRole.id }] } },
    create: {
      organizationId: org.id,
      email: 'admin@demo.test',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      // P0-11: force the seeded admin to change their password on first login.
      mustChangePassword: true,
      roles: { connect: [{ id: adminRole.id }] },
    },
  });

  // --- Units of measure -----------------------------------------------------
  const uoms = [
    { code: 'UNIT', name: 'Piece', category: 'unit', ratio: 1, isBase: true },
    { code: 'KG', name: 'Kilogram', category: 'weight', ratio: 1, isBase: true },
    { code: 'G', name: 'Gram', category: 'weight', ratio: 0.001, isBase: false },
    { code: 'L', name: 'Liter', category: 'volume', ratio: 1, isBase: true },
    { code: 'HR', name: 'Hour', category: 'time', ratio: 1, isBase: true },
  ];
  for (const u of uoms) {
    await prisma.unitOfMeasure.upsert({
      where: { organizationId_code: { organizationId: org.id, code: u.code } },
      update: u,
      create: { organizationId: org.id, ...u },
    });
  }

  // --- Tax ------------------------------------------------------------------
  await prisma.tax.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'VAT 18%' } },
    update: {},
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

  // --- Chart of accounts (Phase 2) -----------------------------------------
  const accountDefs: { code: string; name: string; accountType: AccountType; isGroup?: boolean; cashFlowCategory?: 'operating' | 'investing' | 'financing' }[] = [
    { code: '1000', name: 'Assets', accountType: 'asset', isGroup: true, cashFlowCategory: 'investing' },
    { code: '1100', name: 'Cash', accountType: 'cash', cashFlowCategory: 'operating' },
    { code: '1200', name: 'Bank', accountType: 'bank', cashFlowCategory: 'operating' },
    { code: '1300', name: 'Accounts Receivable', accountType: 'receivable', cashFlowCategory: 'operating' },
    { code: '1400', name: 'Inventory / Stock Valuation', accountType: 'asset', cashFlowCategory: 'operating' },
    { code: '1450', name: 'Input VAT Receivable', accountType: 'asset', cashFlowCategory: 'operating' },
    { code: '2000', name: 'Liabilities', accountType: 'liability', isGroup: true, cashFlowCategory: 'financing' },
    { code: '2100', name: 'Accounts Payable', accountType: 'payable', cashFlowCategory: 'operating' },
    { code: '2150', name: 'Goods Received Not Invoiced (GRNI)', accountType: 'liability', cashFlowCategory: 'operating' },
    { code: '2200', name: 'Tax Payable', accountType: 'tax', cashFlowCategory: 'operating' },
    { code: '3000', name: 'Equity', accountType: 'equity', isGroup: true, cashFlowCategory: 'financing' },
    { code: '3100', name: 'Retained Earnings', accountType: 'equity', cashFlowCategory: 'financing' },
    { code: '4000', name: 'Revenue', accountType: 'revenue', isGroup: true, cashFlowCategory: 'operating' },
    { code: '4100', name: 'Sales Revenue', accountType: 'revenue', cashFlowCategory: 'operating' },
    { code: '5000', name: 'Expenses', accountType: 'expense', isGroup: true, cashFlowCategory: 'operating' },
    { code: '5100', name: 'Cost of Goods Sold', accountType: 'cost_of_goods_sold', cashFlowCategory: 'operating' },
    { code: '5200', name: 'Operating Expenses', accountType: 'expense', cashFlowCategory: 'operating' },
    { code: '5300', name: 'Stock Adjustment Expense', accountType: 'expense', cashFlowCategory: 'operating' },
    { code: '4200', name: 'Stock Adjustment Income', accountType: 'revenue', cashFlowCategory: 'operating' },
  ];
  const accountIds: Record<string, string> = {};
  for (const a of accountDefs) {
    const account = await prisma.account.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: { name: a.name, accountType: a.accountType, isGroup: a.isGroup ?? false, cashFlowCategory: a.cashFlowCategory ?? null },
      create: {
        organizationId: org.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        isGroup: a.isGroup ?? false,
        cashFlowCategory: a.cashFlowCategory ?? null,
      },
    });
    accountIds[a.code] = account.id;
  }

  // --- Journals -------------------------------------------------------------
  const journalDefs: {
    code: string;
    name: string;
    journalType: JournalType;
    defaultDebitAccountId?: string;
  }[] = [
    { code: 'GEN', name: 'General Journal', journalType: 'general' },
    { code: 'SALES', name: 'Sales Journal', journalType: 'sales' },
    { code: 'PURCH', name: 'Purchase Journal', journalType: 'purchase' },
    { code: 'CASH', name: 'Cash Journal', journalType: 'cash', defaultDebitAccountId: accountIds['1100'] },
    { code: 'BANK', name: 'Bank Journal', journalType: 'bank', defaultDebitAccountId: accountIds['1200'] },
    { code: 'INV', name: 'Inventory Journal', journalType: 'general' },
    { code: 'ADJ', name: 'Adjustment Journal', journalType: 'adjustment' },
  ];
  for (const j of journalDefs) {
    await prisma.journal.upsert({
      where: { organizationId_code: { organizationId: org.id, code: j.code } },
      update: { name: j.name, journalType: j.journalType },
      create: { organizationId: org.id, ...j },
    });
  }

  // --- Account determination mappings --------------------------------------
  const mappings: Record<string, string> = {
    accounts_receivable: accountIds['1300'],
    accounts_payable: accountIds['2100'],
    sales_revenue: accountIds['4100'],
    tax_payable: accountIds['2200'],
    tax_receivable: accountIds['1450'],
    default_cash: accountIds['1100'],
    default_bank: accountIds['1200'],
    default_expense: accountIds['5200'],
    retained_earnings: accountIds['3100'],
    // M3 — inventory → GL
    stock_valuation: accountIds['1400'],
    cogs: accountIds['5100'],
    grni_accrued: accountIds['2150'],
    stock_adjustment_income: accountIds['4200'],
    stock_adjustment_expense: accountIds['5300'],
  };
  for (const [key, accountId] of Object.entries(mappings)) {
    await prisma.accountMapping.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      update: { accountId },
      create: { organizationId: org.id, key, accountId },
    });
  }

  // --- Link master data to accounts ----------------------------------------
  await prisma.productCategory.update({
    where: { id: productCategory.id },
    data: { incomeAccountId: accountIds['4100'], expenseAccountId: accountIds['5100'] },
  });
  await prisma.tax.updateMany({
    where: { organizationId: org.id, name: 'VAT 18%' },
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
      where: { organizationId_productId_locationId: { organizationId: org.id, productId: widget.id, locationId: warehouse.id } },
      update: { runningAverageCost: 6 },
      create: { organizationId: org.id, productId: widget.id, locationId: warehouse.id, quantity: openingQty, runningAverageCost: 6 },
    });

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

  console.log('Seed complete (incl. chart of accounts, journals, account mappings, inventory).');
  // P0-11: only print the well-known dev password when actually using it.
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('Login -> organization: "DEMO", email: "admin@demo.test", password: "Admin@123" (dev only)');
  } else {
    console.log('Login -> organization: "DEMO", email: "admin@demo.test" (password from SEED_ADMIN_PASSWORD env var)');
  }
}

// Only run the seed when this file is executed directly (e.g. via
// `pnpm db:seed`). When imported by unit tests we don't want the
// database-touching `main()` to fire.
if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
