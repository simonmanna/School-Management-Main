/**
 * Academic structure configuration — codes, ordering, lifecycle, delete policy.
 *
 * Phase 1 of the academic structure redesign. What this proves, in the brief's
 * terms (§43 validation, §41 delete policy, §40 audit, §13 progression):
 *
 *   - A class or stream code is unique where it must be, and scoped where it
 *     must be: "North" may exist in P4 and in P5, but not twice in P4.
 *   - A foreign key belonging to another tenant is a 400 naming the problem,
 *     not a 500 from a constraint the caller cannot see.
 *   - Deleting a class or stream that carries enrollment history is refused,
 *     and the refusal names what blocks it.
 *   - Every structural write leaves an audit row with the old and new values,
 *     written inside the same transaction as the change.
 *   - The progression ladder cannot be made circular.
 *   - The academic year lifecycle only moves the way it is allowed to.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { SchoolClassService, SectionService } from '../../src/modules/school/foundation/class.service';
import { GradeLevelService } from '../../src/modules/school/foundation/grade-level.service';
import { AcademicYearService } from '../../src/modules/school/foundation/academic-year.service';
import { AuditService } from '../../src/kernel/audit/audit.service';

describeDb('integration: academic structure attributes (Phase 1)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let classes: SchoolClassService;
  let sections: SectionService;
  let grades: GradeLevelService;
  let years: AcademicYearService;

  const organizationId = `org_struct_${Date.now()}`;
  const otherOrgId = `org_struct_other_${Date.now()}`;
  const perms = ['school:read', 'school:foundation:write', 'school:academics:migrate'];
  const as = <T>(fn: () => Promise<T>, userId = 'user_struct'): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  let gradeP4 = '';
  let gradeP5 = '';
  let classP4 = '';

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
    classes = moduleRef.get(SchoolClassService);
    sections = moduleRef.get(SectionService);
    grades = moduleRef.get(GradeLevelService);
    years = moduleRef.get(AcademicYearService);

    for (const id of [organizationId, otherOrgId]) {
      await raw.organization.upsert({
        where: { id },
        update: {},
        create: { id, name: `Structure spec ${id}`, code: id },
      });
    }
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef?.close();
  });

  describe('codes', () => {
    it('derives a code from the name when one is not supplied', async () => {
      const p4 = await as(() => grades.create({ name: 'Primary 4', order: 4 }));
      gradeP4 = (p4 as { id: string }).id;
      // "Primary 4" normalises by stripping non-alphanumerics and upper-casing.
      expect((p4 as { code: string }).code).toBe('PRIMARY4');

      const p5 = await as(() => grades.create({ name: 'Primary 5', order: 5 }));
      gradeP5 = (p5 as { id: string }).id;

      const cls = await as(() =>
        classes.create({ name: 'P4 East', gradeLevelId: gradeP4 }),
      );
      classP4 = (cls as { id: string }).id;
      expect((cls as { code: string }).code).toBe('P4EAST');
    });

    it('normalises a supplied code so P-4 and P.4 cannot both exist', async () => {
      const cls = await as(() =>
        classes.create({ name: 'P5 West', gradeLevelId: gradeP5, code: 'p-5.west' }),
      );
      expect((cls as { code: string }).code).toBe('P5WEST');
    });

    it('refuses a duplicate class code in the same school', async () => {
      await expect(
        as(() => classes.create({ name: 'Another P4', gradeLevelId: gradeP4, code: 'P4EAST' })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('scopes stream codes to their class, so North may exist in two classes', async () => {
      const p5 = await as(() => classes.create({ name: 'P5 Main', gradeLevelId: gradeP5 }));
      const p5Id = (p5 as { id: string }).id;

      const a = await as(() => sections.create({ classId: classP4, name: 'North' }));
      const b = await as(() => sections.create({ classId: p5Id, name: 'North' }));
      expect((a as { code: string }).code).toBe('NORTH');
      expect((b as { code: string }).code).toBe('NORTH');

      // ...but not twice within one class.
      await expect(
        as(() => sections.create({ classId: classP4, name: 'North', code: 'NORTH' })),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cross-tenant references', () => {
    it('rejects a grade level from another school as a 400, not a 500', async () => {
      const foreign = await raw.gradeLevel.create({
        data: { organizationId: otherOrgId, name: 'Foreign Grade', order: 1 },
      });
      await expect(
        as(() => classes.create({ name: 'Smuggled', gradeLevelId: foreign.id })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('subdivision', () => {
    it('refuses a stream under a class that is not subdivided', async () => {
      const plain = await as(() =>
        classes.create({ name: 'P1 Only', gradeLevelId: gradeP4, allowsStreams: false }),
      );
      await expect(
        as(() => sections.create({ classId: (plain as { id: string }).id, name: 'North' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to turn subdivision off while streams still exist', async () => {
      await expect(
        as(() => classes.update(classP4, { allowsStreams: false })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('progression ladder', () => {
    it('accepts a forward link', async () => {
      const updated = await as(() => grades.update(gradeP4, { nextGradeLevelId: gradeP5 }));
      expect((updated as { nextGradeLevelId: string }).nextGradeLevelId).toBe(gradeP5);
      // Pointing at a successor clears "this is the end of the ladder".
      expect((updated as { isTerminal: boolean }).isTerminal).toBe(false);
    });

    it('refuses a grade that promotes into itself', async () => {
      await expect(
        as(() => grades.update(gradeP5, { nextGradeLevelId: gradeP5 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a cycle, which a foreign key alone cannot catch', async () => {
      // P4 -> P5 already exists; P5 -> P4 would close the loop.
      await expect(
        as(() => grades.update(gradeP5, { nextGradeLevelId: gradeP4 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to deactivate a grade another active grade promotes into', async () => {
      await expect(
        as(() => grades.update(gradeP5, { isActive: false })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delete policy', () => {
    it('deletes a class that has no history', async () => {
      const throwaway = await as(() =>
        classes.create({ name: 'Throwaway', gradeLevelId: gradeP5, code: 'THROWAWAY' }),
      );
      const id = (throwaway as { id: string }).id;
      await as(() => classes.remove(id));
      const row = await raw.schoolClass.findUnique({ where: { id } });
      expect(row?.deletedAt).not.toBeNull();
    });

    it('refuses to delete a class that still has streams, and says why', async () => {
      await expect(as(() => classes.remove(classP4))).rejects.toBeInstanceOf(ConflictException);
      await expect(as(() => classes.remove(classP4))).rejects.toThrow(/stream\(s\)/);
    });

    it('refuses to delete a stream that appears in placement history', async () => {
      // Build the smallest real history: a year, term, cohort, learner,
      // enrollment and a CLOSED placement. A closed placement is the case that
      // matters — "P4 North was used last year" is exactly what must survive.
      const section = await raw.section.findFirst({
        where: { organizationId, classId: classP4, name: 'North' },
      });
      expect(section).not.toBeNull();

      const year = await raw.academicYear.create({
        data: {
          organizationId,
          name: 'Delete-policy year',
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });
      const term = await raw.term.create({
        data: {
          organizationId,
          academicYearId: year.id,
          name: 'Term 1',
          startDate: new Date('2025-01-15'),
          endDate: new Date('2025-04-15'),
        },
      });
      const programme = await raw.academicProgramme.create({
        data: {
          organizationId,
          code: 'STRUCT_SPEC',
          name: 'Structure spec programme',
          effectiveFrom: new Date('2025-01-01'),
        },
      });
      const cohort = await raw.classCohort.create({
        data: { organizationId, academicYearId: year.id, classId: classP4, programmeId: programme.id },
      });
      const partner = await raw.partner.create({
        data: { organizationId, code: `STU-${Date.now()}`, name: 'History Pupil' },
      });
      const student = await raw.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: `ADM-${Date.now()}`,
          enrollmentDate: new Date('2025-01-10'),
        },
      });
      const enrollment = await raw.studentEnrollment.create({
        data: {
          organizationId,
          studentProfileId: student.id,
          academicYearId: year.id,
          programmeId: programme.id,
          gradeLevelId: gradeP4,
          admissionDate: new Date('2025-01-10'),
        },
      });
      await raw.enrollmentPlacement.create({
        data: {
          organizationId,
          enrollmentId: enrollment.id,
          termId: term.id,
          classCohortId: cohort.id,
          sectionId: section!.id,
          effectiveFrom: new Date('2025-01-15'),
          // Closed, i.e. the learner has since moved on. The history remains.
          effectiveTo: new Date('2025-04-15'),
          endReason: 'TERM_ROLLOVER',
        },
      });

      await expect(as(() => sections.remove(section!.id))).rejects.toBeInstanceOf(ConflictException);
      await expect(as(() => sections.remove(section!.id))).rejects.toThrow(/deactivate/i);

      // And the row is still there to be reported on.
      const still = await raw.section.findUnique({ where: { id: section!.id } });
      expect(still?.deletedAt).toBeNull();
    });
  });

  describe('audit', () => {
    it('records old and new values for a rename', async () => {
      const cls = await as(() =>
        classes.create({ name: 'Audit Me', gradeLevelId: gradeP5, code: 'AUDITME' }),
      );
      const id = (cls as { id: string }).id;
      await as(() => classes.update(id, { name: 'Audited' }));

      const rows = await raw.auditLog.findMany({
        where: { organizationId, entity: 'SchoolClass', entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      const actions = rows.map((r) => r.action);
      expect(actions).toContain('create');
      expect(actions).toContain('update');

      const update = rows.find((r) => r.action === 'update');
      expect((update?.oldValues as { name?: string })?.name).toBe('Audit Me');
      expect((update?.newValues as { name?: string })?.name).toBe('Audited');
      expect(update?.actorId).toBe('user_struct');
    });

    it('rolls the change back when the audit write fails', async () => {
      // The whole point of `recordInTx` over fire-and-forget: an audit failure
      // must take the business write with it, or the system quietly accumulates
      // changes nobody can account for. Force the audit insert to throw and
      // prove the class never lands.
      const audit = moduleRef.get(AuditService);
      const spy = jest
        .spyOn(audit, 'recordInTx')
        .mockRejectedValueOnce(new Error('audit storage unavailable'));

      await expect(
        as(() => classes.create({ name: 'Never Committed', gradeLevelId: gradeP5, code: 'NEVERC' })),
      ).rejects.toThrow(/audit storage unavailable/);

      spy.mockRestore();

      const orphan = await raw.schoolClass.findFirst({
        where: { organizationId, code: 'NEVERC' },
      });
      expect(orphan).toBeNull();
    });
  });

  describe('academic year lifecycle', () => {
    let yearId = '';

    it('starts a new year in PLANNING', async () => {
      const y = await as(() =>
        years.create({
          name: 'Lifecycle 2027',
          startDate: '2027-01-01',
          endDate: '2027-12-31',
        }),
      );
      yearId = (y as { id: string }).id;
      expect((y as { status: string }).status).toBe('PLANNING');
    });

    it('refuses to skip straight from PLANNING to CLOSED', async () => {
      await expect(
        as(() => years.setStatus(yearId, { status: 'CLOSED' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('moves PLANNING to ACTIVE to CLOSED, stamping who closed it', async () => {
      await as(() => years.setStatus(yearId, { status: 'ACTIVE' }));
      const closed = await as(() => years.setStatus(yearId, { status: 'CLOSED' }));
      expect((closed as { status: string }).status).toBe('CLOSED');
      expect((closed as { closedAt: Date | null }).closedAt).not.toBeNull();
      expect((closed as { closedById: string | null }).closedById).toBe('user_struct');
      // A closed year cannot also be the one the school is working in.
      expect((closed as { isCurrent: boolean }).isCurrent).toBe(false);
    });

    it('demands a reason to re-open a closed year', async () => {
      await expect(
        as(() => years.setStatus(yearId, { status: 'ACTIVE' })),
      ).rejects.toThrow(/reason/i);

      const reopened = await as(() =>
        years.setStatus(yearId, { status: 'ACTIVE', reason: 'Result correction for P7' }),
      );
      expect((reopened as { status: string }).status).toBe('ACTIVE');
      expect((reopened as { closedAt: Date | null }).closedAt).toBeNull();
    });

    it('treats ARCHIVED as the end of the line', async () => {
      await as(() => years.setStatus(yearId, { status: 'CLOSED' }));
      await as(() => years.setStatus(yearId, { status: 'ARCHIVED' }));
      await expect(
        as(() => years.setStatus(yearId, { status: 'ACTIVE', reason: 'nope' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
