/**
 * Stream → Section convergence (ADR-029), end to end.
 *
 * Every disposition the service can reach, on one school built to contain all of
 * them, plus the three properties that make it safe to run on a real database:
 *
 *   - It does not move a learner the grouping rules never placed by stream.
 *   - Running it twice changes nothing the second time.
 *   - Reversing it restores exactly the rows it touched — including in a section
 *     where other learners never had a stream at all.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAcademicSpine, linkLearner, type AcademicSpine } from './_placement';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StreamConvergenceService } from '../../src/modules/school/enrollment/stream-convergence.service';

describeDb('integration: Stream → Section convergence (ADR-029)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let convergence: StreamConvergenceService;

  const organizationId = `org_converge_${Date.now()}`;
  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      { organizationId, userId: 'user_converge', permissions: ['school:read', 'school:academics:migrate'] },
      fn,
    );

  // Fixture handles.
  let p4: AcademicSpine; // genuinely two-level
  let p5: AcademicSpine; // section only; a stray stream rides along
  let p6: AcademicSpine; // stream is the only subdivision
  let p7: AcademicSpine; // stream duplicates an existing section name
  const ids: Record<string, string> = {};

  async function learner(code: string): Promise<string> {
    const partner = await raw.partner.create({ data: { organizationId, code: `${code}-${Date.now()}`, name: code } });
    const s = await raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: `${code}-${Date.now()}`,
        enrollmentDate: new Date('2026-01-10'),
        status: 'active',
      },
    });
    return s.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    convergence = moduleRef.get(StreamConvergenceService);

    await raw.organization.upsert({
      where: { id: organizationId },
      update: {},
      create: { id: organizationId, name: 'Convergence spec', code: organizationId },
    });

    const spine = (grade: string, order: number, section: string | null) =>
      ensureAcademicSpine(raw, {
        organizationId,
        yearName: '2026',
        gradeName: grade,
        gradeOrder: order,
        className: grade,
        sectionName: section,
      });
    p4 = await spine('P4', 4, 'A');
    p5 = await spine('P5', 5, 'North');
    p6 = await spine('P6', 6, null);
    p7 = await spine('P7', 7, 'West');

    // P4 runs section AND stream: the one genuine two-level case.
    await raw.classCohort.update({ where: { id: p4.classCohortId }, data: { groupingMode: 'SECTION_AND_STREAM' } });

    const stream = (classId: string, name: string, sectionId: string | null = null) =>
      raw.stream.create({ data: { organizationId, classId, name, sectionId } });
    ids.east = (await stream(p4.classId, 'East', p4.sectionId)).id;
    ids.loose = (await stream(p5.classId, 'Loose', p5.sectionId)).id;
    ids.red = (await stream(p6.classId, 'Red')).id;
    ids.westStream = (await stream(p7.classId, 'West')).id;
    ids.ghost = (await stream(p7.classId, 'Ghost')).id;

    // FLATTENED: P4 / A / East.
    ids.flattenedPupil = await learner('FLAT');
    const f = await linkLearner(raw, { spine: p4, studentProfileId: ids.flattenedPupil });
    await raw.enrollmentPlacement.update({ where: { id: f.placementId }, data: { streamId: ids.east } });

    // SUPPLEMENTARY: P5 / North / Loose, plus a classmate in North with no stream.
    ids.loosePupil = await learner('LOOSE');
    const l = await linkLearner(raw, { spine: p5, studentProfileId: ids.loosePupil });
    await raw.enrollmentPlacement.update({ where: { id: l.placementId }, data: { streamId: ids.loose } });
    ids.plainPupil = await learner('PLAIN');
    const plain = await linkLearner(raw, { spine: p5, studentProfileId: ids.plainPupil });
    ids.plainPlacement = plain.placementId;

    // CREATED: P6 has no section; a legacy enrollment names only stream Red.
    ids.redPupil = await learner('RED');
    await raw.enrollment.create({
      data: {
        organizationId,
        studentProfileId: ids.redPupil,
        classId: p6.classId,
        streamId: ids.red,
        termId: p6.termId,
        rollNumber: '1',
      },
    });

    // MERGED: a profile's only subdivision is the West STREAM, and a West SECTION
    // already exists in P7.
    ids.westPupil = await learner('WEST');
    await raw.studentProfile.update({
      where: { id: ids.westPupil },
      data: { currentClassId: p7.classId, currentStreamId: ids.westStream },
    });
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef?.close();
  });

  it('plans every disposition without writing anything', async () => {
    const plan = await as(() => convergence.dryRun());
    const by = Object.fromEntries(plan.plan.map((p) => [p.streamId, p.disposition]));
    expect(by[ids.east]).toBe('FLATTENED');
    expect(by[ids.loose]).toBe('SUPPLEMENTARY');
    expect(by[ids.red]).toBe('CREATED');
    expect(by[ids.westStream]).toBe('MERGED');
    expect(by[ids.ghost]).toBe('UNUSED');
    expect(plan.applied).toBe(false);

    // Nothing moved.
    const still = await raw.enrollmentPlacement.count({ where: { organizationId, streamId: { not: null } } });
    expect(still).toBe(2);
  });

  let runId = '';

  it('converges, leaving no stream reference anywhere', async () => {
    const result = await as(() => convergence.apply());
    runId = result.migrationRunId!;
    expect(result.applied).toBe(true);

    const leftovers = await Promise.all([
      raw.enrollmentPlacement.count({ where: { organizationId, streamId: { not: null } } }),
      raw.enrollment.count({ where: { organizationId, streamId: { not: null } } }),
      raw.studentProfile.count({ where: { organizationId, currentStreamId: { not: null } } }),
    ]);
    expect(leftovers).toEqual([0, 0, 0]);
  });

  it('flattens a genuine two-level pair into its own section', async () => {
    const p = await raw.enrollmentPlacement.findFirst({
      where: { organizationId, enrollment: { studentProfileId: ids.flattenedPupil } },
      include: { section: true },
    });
    expect(p?.section?.name).toBe('A / East');
    expect(p?.section?.isSynthesized).toBe(true);
    expect(p?.section?.legacyParentSectionId).toBe(p4.sectionId);
  });

  it('does not move a learner whose stream the rules never used', async () => {
    const p = await raw.enrollmentPlacement.findFirst({
      where: { organizationId, enrollment: { studentProfileId: ids.loosePupil } },
    });
    // Still in North — the whole point of SUPPLEMENTARY.
    expect(p?.sectionId).toBe(p5.sectionId);
  });

  it('creates a section for a stream that was the only subdivision', async () => {
    const e = await raw.enrollment.findFirst({ where: { organizationId, studentProfileId: ids.redPupil }, include: { section: true } });
    expect(e?.section?.name).toBe('Red');
    expect(e?.section?.legacyStreamId).toBe(ids.red);
  });

  it('merges a stream into the same-named section rather than duplicating it', async () => {
    const s = await raw.studentProfile.findUnique({ where: { id: ids.westPupil } });
    expect(s?.currentSectionId).toBe(p7.sectionId);
    const wests = await raw.section.count({ where: { organizationId, classId: p7.classId, name: 'West' } });
    expect(wests).toBe(1);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    const before = await raw.section.count({ where: { organizationId } });
    const again = await as(() => convergence.apply());
    expect(again.streams).toBe(0);
    expect(await raw.section.count({ where: { organizationId } })).toBe(before);
  });

  it('reverses exactly the rows it touched and no others', async () => {
    const reversed = await as(() => convergence.reverse(runId));
    expect(reversed.reversed).toBeGreaterThan(0);

    const loose = await raw.enrollmentPlacement.findFirst({
      where: { organizationId, enrollment: { studentProfileId: ids.loosePupil } },
    });
    expect(loose?.streamId).toBe(ids.loose);

    // The classmate in North never had a stream. Restoring "rows in North with no
    // stream" would have stamped Loose onto them; the touched-row ledger does not.
    const plain = await raw.enrollmentPlacement.findUnique({ where: { id: ids.plainPlacement } });
    expect(plain?.streamId).toBeNull();

    const flat = await raw.enrollmentPlacement.findFirst({
      where: { organizationId, enrollment: { studentProfileId: ids.flattenedPupil } },
    });
    expect(flat?.sectionId).toBe(p4.sectionId);
    expect(flat?.streamId).toBe(ids.east);

    // Synthesized sections are removed.
    expect(await raw.section.count({ where: { organizationId, isSynthesized: true } })).toBe(0);
  });
});
