import { PrismaClient } from '@prisma/client';
import { SequenceService } from './sequence.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Concurrent sequence test — proves the D1-1 fix.
 *
 * Pre-fix: 100 parallel calls to a fresh tenant's sequence would race on the
 * `Sequence` row INSERT and 1-N of them would throw `unique violation`.
 *
 * Post-fix: native `nextval()` is a single atomic catalog operation; all 100
 * calls return unique values.
 *
 * Requires a live Postgres (DATABASE_URL must be set and reachable). The test
 * creates an ephemeral organization so it never collides with seeded data.
 * Skipped automatically when no DATABASE_URL is configured.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

describeDb('SequenceService (concurrent / native Postgres sequences)', () => {
  const prisma = new PrismaClient();
  const tenant = { organizationId: '00000000-0000-0000-0000-000000000000' } as any;
  const tenantSvc = { organizationId: tenant.organizationId } as any;
  const svc = new SequenceService({ client: prisma, raw: prisma } as any, tenantSvc);

  let createdOrgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { code: `TEST-${Date.now()}`, name: 'Sequence Test Org', currencyCode: 'USD' },
    });
    createdOrgId = org.id;
    (tenant as any).organizationId = createdOrgId;
  });

  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(
        `DROP SEQUENCE IF EXISTS "seq_${createdOrgId.replace(/-/g, '').slice(0, 8)}_stock_move"`,
      );
    } catch {
      /* ignore */
    }
    await prisma.organization.delete({ where: { id: createdOrgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('returns 100 unique codes under concurrent pressure', async () => {
    const N = 100;
    const codes = await Promise.all(
      Array.from({ length: N }, () => svc.next('stock_move', { prefix: 'STK/', padding: 6 })),
    );
    const set = new Set(codes);
    expect(set.size).toBe(N);
    for (const code of codes) {
      expect(code).toMatch(/^STK\/\d{6}$/);
    }
  });

  it('numbers are strictly monotonic within a single sequence', async () => {
    const a = await svc.next('stock_move', { prefix: 'STK/', padding: 6 });
    const b = await svc.next('stock_move', { prefix: 'STK/', padding: 6 });
    expect(Number(b.replace(/^STK\//, ''))).toBeGreaterThan(Number(a.replace(/^STK\//, '')));
  });

  it('different keys produce independent sequences', async () => {
    const a = await svc.next('invoice', { prefix: 'INV-', padding: 6 });
    const b = await svc.next('stock_move', { prefix: 'STK/', padding: 6 });
    expect(a.startsWith('INV-')).toBe(true);
    expect(b.startsWith('STK/')).toBe(true);
  });
});

/**
 * Pure unit tests (no DB) — exercise the sequence-name sanitization that is
 * critical for safe Postgres identifier construction.
 */
describe('SequenceService (pure / sanitization)', () => {
  it('seqName builds a safe identifier from an org UUID', () => {
    const svc = new SequenceService({} as any, {} as any);
    const name = (svc as any).seqName('12345678-aaaa-bbbb-cccc-1234567890ab', 'invoice:2026');
    // First 8 chars of UUID (no dashes), underscore-joined sanitized key.
    expect(name).toMatch(/^seq_12345678_invoice_2026$/);
  });

  it('seqName strips unsafe characters from keys', () => {
    const svc = new SequenceService({} as any, {} as any);
    const name = (svc as any).seqName('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'a/b:c d');
    expect(name).toMatch(/^seq_aaaaaaaa_a_b_c_d$/);
  });
});