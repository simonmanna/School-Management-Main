/**
 * Wave 18 — finance review P0/P1 on expenses, against a real database.
 *
 * P0: a paid expense always has a balanced journal; when one cannot be posted
 *     (unmapped category, pay-from account not cash/bank) nothing is written.
 * P1: payment requires APPROVED; the raiser cannot approve; the approver cannot
 *     pay (payer ≠ approver); identities come from the session, not the body;
 *     two concurrent payers settle the expense once; petty cash below the org
 *     threshold is raised+paid by one person, above it waits for approval.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { ExpensesModule } from '../../src/modules/expenses/expenses.module';
import { ExpensesService } from '../../src/modules/expenses/expenses.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: wave 18 expense posting and SoD', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let expenses: ExpensesService;

  const stamp = Date.now();
  let organizationId = '';
  let cashId = '';
  let bankId = '';
  let revenueId = '';
  let expenseAccId = '';
  let mappedCategoryId = '';
  let unmappedCategoryId = '';
  const users: Record<'raiser' | 'approver' | 'payer' | 'payer2', string> = {
    raiser: '',
    approver: '',
    payer: '',
    payer2: '',
  };

  const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['*'] }, fn);

  const draft = (title: string, amount: number, categoryId = mappedCategoryId) =>
    as(users.raiser, () =>
      expenses.create({ title, amount, categoryId, expenseDate: '2026-09-15', paymentType: 'CREDIT' } as any),
    );

  const journalFor = async (expenseId: string) => {
    const pays = await prisma.expensePayment.findMany({ where: { expenseId, status: 'posted' } });
    return Promise.all(
      pays.map((p) =>
        p.journalEntryId
          ? prisma.journalEntry.findUnique({ where: { id: p.journalEntryId }, include: { lines: true } })
          : null,
      ),
    );
  };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Uganda Shilling', decimalPlaces: 0 },
    });
    const org = await prisma.organization.create({
      data: { code: `W18E-${stamp}`, name: 'Wave 18 Expenses', currencyCode: 'UGX' },
    });
    organizationId = org.id;
    for (const code of ['CASH', 'BANK', 'GEN']) {
      await prisma.journal.create({
        data: { organizationId, code, name: code, journalType: code === 'GEN' ? 'general' : (code.toLowerCase() as any) },
      });
    }
    const make = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    cashId = (await make(organizationId, '1100', 'Petty Cash', 'cash')).id;
    bankId = (await make(organizationId, '1200', 'Stanbic', 'bank')).id;
    revenueId = (await make(organizationId, '4100', 'Fees', 'revenue')).id;
    expenseAccId = (await make(organizationId, '6100', 'Stationery', 'operating_expense')).id;
    mappedCategoryId = (
      await prisma.expenseCategory.create({ data: { organizationId, name: 'Stationery', ledgerAccountId: expenseAccId } })
    ).id;
    unmappedCategoryId = (await prisma.expenseCategory.create({ data: { organizationId, name: 'Misc' } })).id;
    for (const k of Object.keys(users) as Array<keyof typeof users>) {
      users[k] = (
        await prisma.user.create({
          data: { organizationId, email: `${k}-${stamp}@w18.test`, passwordHash: 'x', firstName: k },
        })
      ).id;
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, AccountingModule, ExpensesModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    expenses = moduleRef.get(ExpensesService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('a credit expense stays DRAFT with no workflow — nothing is auto-approved', async () => {
    const e = await draft('Chalk', 50_000);
    expect(e.status).toBe('DRAFT');
    expect(e.createdById).toBe(users.raiser);
    expect(e.approvedById).toBeNull();
  });

  it('the raiser cannot approve their own expense', async () => {
    const e = await draft('Markers', 20_000);
    await expect(as(users.raiser, () => expenses.approve(e.id, {} as any))).rejects.toThrow(/Self-approval/);
  });

  it('a DRAFT expense cannot be paid', async () => {
    const e = await draft('Paper', 30_000);
    await expect(
      as(users.payer, () => expenses.pay(e.id, { paymentMethod: 'CASH', accountId: cashId } as any)),
    ).rejects.toThrow(/Only approved expenses/);
  });

  it('approve → pay posts one balanced journal dated with the payment date; approver is the session user', async () => {
    const e = await draft('Exercise books', 125_000);
    const approved = await as(users.approver, () => expenses.approve(e.id, { approvalNotes: 'ok' } as any));
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedById).toBe(users.approver);

    const paid = await as(users.payer, () =>
      expenses.pay(e.id, { paymentMethod: 'BANK_TRANSFER', accountId: bankId, paymentDate: '2026-09-20T10:00:00Z' } as any),
    );
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.status).toBe('POSTED');

    const [je] = await journalFor(e.id);
    expect(je).toBeTruthy();
    expect(je!.status).toBe('posted');
    expect(je!.postingDate.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    const dr = je!.lines.find((l) => Number(l.baseDebit) > 0)!;
    const cr = je!.lines.find((l) => Number(l.baseCredit) > 0)!;
    expect(dr.accountId).toBe(expenseAccId);
    expect(cr.accountId).toBe(bankId);
    expect(Number(dr.baseDebit)).toBe(125_000);
    expect(Number(cr.baseCredit)).toBe(125_000);

    const pay = await prisma.expensePayment.findFirst({ where: { expenseId: e.id } });
    expect(pay!.paidById).toBe(users.payer);
    expect(je!.sourceType).toBe('expense_payment');
    expect(je!.sourceId).toBe(pay!.id);
  });

  it('the approver cannot also pay (payer ≠ approver)', async () => {
    const e = await draft('Toner', 80_000);
    await as(users.approver, () => expenses.approve(e.id, {} as any));
    await expect(
      as(users.approver, () => expenses.pay(e.id, { paymentMethod: 'CASH', accountId: cashId } as any)),
    ).rejects.toThrow(/approver of an expense cannot also pay/);
  });

  it('P0: an unmapped category refuses payment and writes nothing', async () => {
    const e = await draft('Unmapped thing', 40_000, unmappedCategoryId);
    await as(users.approver, () => expenses.approve(e.id, {} as any));
    await expect(
      as(users.payer, () => expenses.pay(e.id, { paymentMethod: 'CASH', accountId: cashId } as any)),
    ).rejects.toThrow(/Map expense category 'Misc'/);
    expect(await prisma.expensePayment.count({ where: { expenseId: e.id } })).toBe(0);
    const after = await prisma.expense.findUnique({ where: { id: e.id } });
    expect(after!.paymentStatus).toBe('UNPAID');
    expect(after!.status).toBe('APPROVED');
  });

  it('P0: paying from a non cash/bank account is refused and writes nothing', async () => {
    const e = await draft('Wrong source', 10_000);
    await as(users.approver, () => expenses.approve(e.id, {} as any));
    await expect(
      as(users.payer, () => expenses.pay(e.id, { paymentMethod: 'CASH', accountId: revenueId } as any)),
    ).rejects.toThrow(/cash or bank/);
    expect(await prisma.expensePayment.count({ where: { expenseId: e.id } })).toBe(0);
  });

  it('two concurrent payers settle the expense exactly once', async () => {
    const e = await draft('Furniture', 900_000);
    await as(users.approver, () => expenses.approve(e.id, {} as any));
    const body = { paymentMethod: 'BANK_TRANSFER', accountId: bankId } as any;
    const results = await Promise.allSettled([
      as(users.payer, () => expenses.pay(e.id, body)),
      as(users.payer2, () => expenses.pay(e.id, body)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.expensePayment.count({ where: { expenseId: e.id } })).toBe(1);
    const jes = (await journalFor(e.id)).filter(Boolean);
    expect(jes).toHaveLength(1);
    const after = await prisma.expense.findUnique({ where: { id: e.id } });
    expect(Number(after!.amountPaid)).toBe(900_000);
  });

  it('rejects fractional shillings', async () => {
    await expect(draft('Half shilling', 1000.5)).rejects.toThrow(/decimal places than UGX/);
  });

  it('an approved expense can no longer be edited', async () => {
    const e = await draft('Frozen', 15_000);
    await as(users.approver, () => expenses.approve(e.id, {} as any));
    await expect(as(users.raiser, () => expenses.update(e.id, { amount: 99_000 } as any))).rejects.toThrow(
      /Only unpaid draft/,
    );
  });

  it('void reverses the payment journal', async () => {
    const e = await draft('To void', 60_000);
    await as(users.approver, () => expenses.approve(e.id, {} as any));
    await as(users.payer, () => expenses.pay(e.id, { paymentMethod: 'CASH', accountId: cashId } as any));
    await as(users.approver, () => expenses.void(e.id, { voidReason: 'duplicate' } as any));
    const p = await prisma.expensePayment.findFirst({ where: { expenseId: e.id } });
    expect(p!.status).toBe('void');
    const je = await prisma.journalEntry.findUnique({ where: { id: p!.journalEntryId! } });
    expect(je!.status).toBe('reversed');
    expect(je!.reversedEntryId).toBeTruthy();
  });

  describe('petty cash', () => {
    beforeAll(async () => {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { settings: { finance: { pettyCashThreshold: 50_000 } } },
      });
    });

    it('at or below the threshold one person raises, approves and pays', async () => {
      const e = await as(users.raiser, () =>
        expenses.create({
          title: 'Bus fare',
          amount: 50_000,
          categoryId: mappedCategoryId,
          expenseDate: '2026-09-16',
          paymentType: 'CASH',
          paymentMethod: 'CASH',
          accountId: cashId,
        } as any),
      );
      expect(e.status).toBe('POSTED');
      expect(e.paymentStatus).toBe('PAID');
      expect(e.approvedById).toBe(users.raiser);
      const [je] = await journalFor(e.id);
      expect(je!.status).toBe('posted');
      const audit = await prisma.auditLog.findFirst({ where: { entity: 'Expense', entityId: e.id, action: 'create' } });
      expect((audit!.newValues as any).pettyCash).toBe(true);
    });

    it('above the threshold a cash expense waits for approval', async () => {
      const e = await as(users.raiser, () =>
        expenses.create({
          title: 'Generator fuel',
          amount: 50_001,
          categoryId: mappedCategoryId,
          expenseDate: '2026-09-16',
          paymentType: 'CASH',
          paymentMethod: 'CASH',
          accountId: cashId,
        } as any),
      );
      expect(e.status).toBe('DRAFT');
      expect(e.paymentStatus).toBe('UNPAID');
      expect(await prisma.expensePayment.count({ where: { expenseId: e.id } })).toBe(0);
    });
  });
});
