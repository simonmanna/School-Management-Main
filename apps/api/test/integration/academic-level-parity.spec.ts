/**
 * Academic level vs programme banding — resolution logic (ADR-028).
 *
 * `ProgrammeGradeLevel` currently owns the answer to "which programme is this
 * grade under", guaranteed unique by `@@unique([organizationId, gradeLevelId])`.
 * ADR-028 moves that answer to `gradeLevel → academicLevel → defaultProgramme`
 * and drops the table.
 *
 * This spec proves the RESOLUTION LOGIC on fixtures it fully controls:
 * precedence when both paths answer, fallback when only the legacy one does, and
 * that a level-banded grade resolves without the legacy row existing at all.
 *
 * It deliberately does NOT sweep the whole database. The integration suite
 * shares one database and every spec seeds its own fixtures — including, below,
 * a grade whose two paths disagree ON PURPOSE. A whole-database sweep running
 * here would measure that test residue rather than the tenants being migrated,
 * and would fail or pass for reasons unrelated to the migration.
 *
 * The data-side gate is `src/scripts/academic-level-parity-report.ts`, run
 * against a real database before `ProgrammeGradeLevel` is dropped. The spec
 * proves the logic; the report proves the data.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { ProgrammeService } from '../../src/modules/school/enrollment/programme.service';
import { AcademicLevelService } from '../../src/modules/school/foundation/academic-level.service';

describeDb('integration: academic level / programme resolution (ADR-028)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let programmes: ProgrammeService;
  let levels: AcademicLevelService;

  const organizationId = `org_levelres_${Date.now()}`;
  const perms = ['school:read', 'school:foundation:write', 'school:programmes:write'];
  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'user_levelres', permissions: perms }, fn);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        KernelModule,
        DocumentsModule,
        CoreModule,
        AccountingModule,
        InventoryModule,
        InvoicingModule,
        SchoolModule,
      ],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    programmes = moduleRef.get(ProgrammeService);
    levels = moduleRef.get(AcademicLevelService);

    await raw.organization.upsert({
      where: { id: organizationId },
      update: {},
      create: { id: organizationId, name: 'Level resolution spec', code: organizationId },
    });
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef?.close();
  });

  it('resolves through the academic level when only the level answers', async () => {
    // The state every tenant ends in once ProgrammeGradeLevel is gone.
    const programme = await raw.academicProgramme.create({
      data: {
        organizationId,
        code: 'LEVEL_ONLY',
        name: 'Level only',
        effectiveFrom: new Date(),
      },
    });
    const level = await as(() =>
      levels.create({ name: 'Level Only Band', code: 'LEVELONLY', defaultProgrammeId: programme.id }),
    );
    const grade = await raw.gradeLevel.create({
      data: {
        organizationId,
        name: 'Level Only Grade',
        code: 'LEVELONLYGRADE',
        order: 1,
        academicLevelId: (level as { id: string }).id,
      },
    });

    const resolved = await as(() => programmes.programmeForGradeLevel(grade.id));
    expect(resolved?.code).toBe('LEVEL_ONLY');
  });

  it('falls back to the legacy link for a grade with no level yet', async () => {
    // A tenant part-way through the backfill must keep resolving. This fallback
    // is what makes the legacy table safe to leave in place for a release.
    const programme = await raw.academicProgramme.create({
      data: {
        organizationId,
        code: 'LEGACY_ONLY',
        name: 'Legacy only',
        effectiveFrom: new Date(),
      },
    });
    const grade = await raw.gradeLevel.create({
      data: { organizationId, name: 'Unbanded Grade', code: 'UNBANDED', order: 2 },
    });
    await raw.programmeGradeLevel.create({
      data: { organizationId, programmeId: programme.id, gradeLevelId: grade.id },
    });

    const resolved = await as(() => programmes.programmeForGradeLevel(grade.id));
    expect(resolved?.code).toBe('LEGACY_ONLY');
  });

  it('prefers the academic level when the two paths disagree', async () => {
    // A deliberately divergent grade. ADR-028 makes the level authoritative, and
    // the service logs the disagreement rather than resolving it silently —
    // silence here would hide a data fault until the legacy table was dropped
    // and the answer changed underneath the school.
    const [winner, loser] = await Promise.all([
      raw.academicProgramme.create({
        data: {
          organizationId,
          code: 'VIA_LEVEL',
          name: 'Resolved through the level',
          effectiveFrom: new Date(),
        },
      }),
      raw.academicProgramme.create({
        data: {
          organizationId,
          code: 'VIA_LINK',
          name: 'Legacy link only',
          effectiveFrom: new Date(),
        },
      }),
    ]);

    const level = await as(() =>
      levels.create({ name: 'Divergent Band', code: 'DIVERGENT', defaultProgrammeId: winner.id }),
    );
    const grade = await raw.gradeLevel.create({
      data: {
        organizationId,
        name: 'Divergent Grade',
        code: 'DIVERGENTGRADE',
        order: 3,
        academicLevelId: (level as { id: string }).id,
      },
    });
    await raw.programmeGradeLevel.create({
      data: { organizationId, programmeId: loser.id, gradeLevelId: grade.id },
    });

    const resolved = await as(() => programmes.programmeForGradeLevel(grade.id));
    expect(resolved?.code).toBe('VIA_LEVEL');
  });

  it('returns null when neither path answers', async () => {
    const grade = await raw.gradeLevel.create({
      data: { organizationId, name: 'Orphan Grade', code: 'ORPHAN', order: 4 },
    });
    const resolved = await as(() => programmes.programmeForGradeLevel(grade.id));
    expect(resolved).toBeNull();
  });

  it('resolves nothing across a tenant boundary', async () => {
    // A level in another school must not resolve a programme for this one, even
    // when the ids are handed over directly.
    const otherOrgId = `${organizationId}_other`;
    await raw.organization.upsert({
      where: { id: otherOrgId },
      update: {},
      create: { id: otherOrgId, name: 'Other school', code: otherOrgId },
    });
    const foreignProgramme = await raw.academicProgramme.create({
      data: {
        organizationId: otherOrgId,
        code: 'FOREIGN',
        name: 'Foreign programme',
        effectiveFrom: new Date(),
      },
    });
    const foreignLevel = await raw.academicLevel.create({
      data: {
        organizationId: otherOrgId,
        code: 'FOREIGNBAND',
        name: 'Foreign band',
        defaultProgrammeId: foreignProgramme.id,
      },
    });
    const foreignGrade = await raw.gradeLevel.create({
      data: {
        organizationId: otherOrgId,
        name: 'Foreign Grade',
        code: 'FOREIGNGRADE',
        order: 1,
        academicLevelId: foreignLevel.id,
      },
    });

    // Asked from THIS school's context, the other school's grade is invisible.
    const resolved = await as(() => programmes.programmeForGradeLevel(foreignGrade.id));
    expect(resolved).toBeNull();
  });
});
