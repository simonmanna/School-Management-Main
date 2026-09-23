/**
 * Cross-tenant isolation for the School vertical (P2A deliverable).
 *
 * Proves the load-bearing control from ADR-004: the Prisma tenancy extension
 * injects `organizationId = <current org>` into every read and write on an
 * org-scoped model, so one tenant can never see or mutate another's rows —
 * even with a valid, correctly-formatted id from the other tenant.
 *
 * This is the app-layer enforcement, which holds regardless of whether Postgres
 * RLS is switched on (RLS is the second, opt-in line of defence). Because it
 * relies only on the extension it runs on any migrated DB; see
 * school-happy-path.spec.ts for the DB requirements.
 *
 * Two tenants (A, B) each get a student, a guardian, a fee invoice and an
 * attendance row. Acting as A we attempt to read / update / delete B's rows and
 * assert every attempt finds nothing; then the reverse.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { placeInClass } from './_placement';

describeDb('integration: school cross-tenant isolation', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tenant: TenantContextService;

  const stamp = Date.now();
  const orgA = `org_A_${stamp}`;
  const orgB = `org_B_${stamp}`;

  // ids of B's rows, which A must never reach
  const b: Record<string, string> = {};
  const a: Record<string, string> = {};

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  async function seedOrg(orgId: string, tag: string, into: Record<string, string>) {
    await setOrg(orgId);
    await raw.organization.create({ data: { id: orgId, code: `ISO-${tag}-${stamp}`, name: `Iso ${tag}`, currencyCode: 'UGX' } });
    const docType = await raw.documentTypeDef.findFirst({ where: { code: 'sales_invoice' } });
    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId: orgId, name: `G-${tag}`, order: 1 } });
    const schoolClass = await raw.schoolClass.create({
      data: { organizationId: orgId, gradeLevelId: gradeLevel.id, name: `Class ${tag}` },
    });
    const partner = await raw.partner.create({
      data: { organizationId: orgId, code: `P-${tag}`, name: `Student ${tag}`, isCustomer: true },
    });
    const student = await raw.studentProfile.create({
      data: {
        organizationId: orgId,
        partnerId: partner.id,
        admissionNo: `ADM-${tag}`,
        enrollmentDate: new Date(),
        status: 'active',
      },
    });
    await placeInClass(raw, { organizationId: orgId, studentProfileId: student.id, classId: schoolClass.id });
    into.studentId = student.id;
    into.partnerId = partner.id;

    if (docType) {
      const invoice = await raw.document.create({
        data: {
          organizationId: orgId,
          documentNumber: `INV-${tag}-1`,
          documentType: 'sales_invoice',
          documentTypeId: docType.id,
          partnerId: partner.id,
          issueDate: new Date(),
          status: 'posted',
          sourceType: 'school_fee',
          subtotal: 100_000,
          totalAmount: 100_000,
          amountResidual: 100_000,
          amountPaid: 0,
        },
      });
      into.invoiceId = invoice.id;
    }

    const att = await raw.studentAttendance.create({
      data: {
        organizationId: orgId,
        studentProfileId: student.id,
        classId: schoolClass.id,
        date: new Date('2026-02-02'),
        status: 'present',
      },
    });
    into.attendanceId = att.id;
  }

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await seedOrg(orgA, 'A', a);
    await seedOrg(orgB, 'B', b);

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, DocumentsModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    tenant = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId: orgA, userId: 'user_a', permissions: [] }, fn);
  const asB = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId: orgB, userId: 'user_b', permissions: [] }, fn);

  it('A cannot read B\'s student, invoice or attendance by id', async () => {
    await asA(async () => {
      expect(await prisma.client.studentProfile.findFirst({ where: { id: b.studentId } })).toBeNull();
      expect(await prisma.client.studentProfile.findUnique({ where: { id: b.studentId } })).toBeNull();
      if (b.invoiceId) expect(await prisma.client.document.findFirst({ where: { id: b.invoiceId } })).toBeNull();
      expect(await prisma.client.studentAttendance.findFirst({ where: { id: b.attendanceId } })).toBeNull();
      expect(await prisma.client.partner.findFirst({ where: { id: b.partnerId } })).toBeNull();
    });
  });

  it('A\'s list queries return only A\'s rows', async () => {
    await asA(async () => {
      const students = await prisma.client.studentProfile.findMany();
      expect(students.map((s) => s.id)).toContain(a.studentId);
      expect(students.map((s) => s.id)).not.toContain(b.studentId);
      expect(students.every((s) => s.organizationId === orgA)).toBe(true);
    });
  });

  it('A cannot update or delete B\'s rows (writes are org-scoped)', async () => {
    await asA(async () => {
      const upd = await prisma.client.studentProfile.updateMany({
        where: { id: b.studentId },
        data: { status: 'withdrawn' },
      });
      expect(upd.count).toBe(0);

      const del = await prisma.client.studentAttendance.deleteMany({ where: { id: b.attendanceId } });
      expect(del.count).toBe(0);
    });

    // B's rows are untouched.
    await setOrg(orgB);
    const stillActive = await raw.studentProfile.findFirst({ where: { id: b.studentId } });
    expect(stillActive!.status).toBe('active');
    const attStill = await raw.studentAttendance.findFirst({ where: { id: b.attendanceId } });
    expect(attStill).toBeTruthy();
  });

  it('the isolation is symmetric — B cannot see A\'s student', async () => {
    await asB(async () => {
      expect(await prisma.client.studentProfile.findFirst({ where: { id: a.studentId } })).toBeNull();
      const students = await prisma.client.studentProfile.findMany();
      expect(students.map((s) => s.id)).toContain(b.studentId);
      expect(students.map((s) => s.id)).not.toContain(a.studentId);
    });
  });

  it('a findUnique by another tenant\'s unique key still cannot cross the boundary', async () => {
    // admissionNo is unique per org; B querying A's admissionNo must miss.
    await asB(async () => {
      const found = await prisma.client.studentProfile.findFirst({ where: { admissionNo: 'ADM-A' } });
      expect(found).toBeNull();
    });
  });
});
