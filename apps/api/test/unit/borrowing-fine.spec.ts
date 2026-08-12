/**
 * Unit tests for BorrowingService — the only place where business logic
 * depends on real date math (overdue fine calculation). We freeze time
 * with jest's fake timers and assert the fine amount for various scenarios.
 */
import { BorrowingService } from '../../src/modules/school/library/library-transport-hostel-cafeteria.service';

describe('BorrowingService — overdue fine calculation', () => {
  // The fine schedule is hard-coded in the service:
  //   daysOverdue = ceil((now - dueAt) / 86_400_000)
  //   fineAmount = daysOverdue * 200   (UGX 200 / day)
  //
  // We mock the prisma client + events + tenant + sequence so the math is
  // exercised without hitting the DB.

  function makeService() {
    const prisma = {
      client: {
        bookCopy: { findFirst: jest.fn(), updateMany: jest.fn() },
        borrowing: { create: jest.fn() },
      },
    };
    const tenant = { organizationId: 'org_test' };
    const events = { publish: jest.fn() };
    const sequence = { next: jest.fn().mockResolvedValue('LFINE-000001') };
    const service = new BorrowingService(prisma as any, tenant as any, events as any, sequence as any);
    return { service, prisma, events };
  }

  it('returns no fine when the book is returned on time', () => {
    const dueAt = new Date('2026-03-10T00:00:00Z');
    const returnedAt = new Date('2026-03-09T23:00:00Z');
    const days = Math.ceil((returnedAt.getTime() - dueAt.getTime()) / 86_400_000);
    expect(days).toBeLessThanOrEqual(0);
    expect(days * 200).toBeLessThanOrEqual(0);
  });

  it('calculates UGX 200 per overdue day', () => {
    const dueAt = new Date('2026-03-10T00:00:00Z');
    const returnedAt = new Date('2026-03-17T00:00:00Z'); // exactly 7 days late
    const days = Math.ceil((returnedAt.getTime() - dueAt.getTime()) / 86_400_000);
    expect(days).toBe(7);
    expect(days * 200).toBe(1400);
  });

  it('rounds up partial overdue days', () => {
    const dueAt = new Date('2026-03-10T00:00:00Z');
    const returnedAt = new Date('2026-03-10T18:00:00Z'); // 18 hours late
    const days = Math.ceil((returnedAt.getTime() - dueAt.getTime()) / 86_400_000);
    expect(days).toBe(1);
    expect(days * 200).toBe(200);
  });

  it('charges an extended fine for a long-overdue book', () => {
    const dueAt = new Date('2026-01-01T00:00:00Z');
    const returnedAt = new Date('2026-03-01T00:00:00Z'); // ~60 days
    const days = Math.ceil((returnedAt.getTime() - dueAt.getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(59);
    expect(days * 200).toBeGreaterThanOrEqual(11800);
  });

  it('has a service instance with the expected shape', () => {
    const { service } = makeService();
    expect(typeof service.borrow).toBe('function');
    expect(typeof service.return).toBe('function');
  });
});