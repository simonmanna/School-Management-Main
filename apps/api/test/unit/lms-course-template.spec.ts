import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CourseBackupService } from '../../src/modules/school/lms/moodle/backup/course-backup.service';

/**
 * Course templates (ADR-034).
 *
 * The rules this suite defends:
 *
 *  - A template is a NAMED EXPORT. It carries structure and nothing else — no
 *    cohort, no submissions, no marks — because it is built by the same
 *    `export` rollover uses, with `includeUserData` never set.
 *  - Saving under a code that already exists REPLACES that template. A teacher
 *    pressing save twice must not end up with two "P5 Mathematics" to choose
 *    between.
 *  - Applying a template refuses a course that already has activities, so it
 *    cannot silently double a course.
 *  - A listing never carries the bundles, which run to hundreds of kilobytes.
 *  - A template is scoped to its organization on every read.
 */

const OFFERING = {
  id: 'co_1',
  organizationId: 'org_1',
  termId: 't1',
  subjectId: 'sub_1',
  classId: 'cls_1',
  sectionId: null,
  format: 'weeks',
  numSections: 14,
  summary: null,
  groupMode: 'none',
  completionEnabled: true,
  showGradesToStudents: true,
  coverImageFileId: null,
  deletedAt: null,
};

const SECTION = { id: 'sec_1', sectionNo: 1, name: 'Week 1', summary: null, visible: true, availability: null };
const MODULE = {
  id: 'cm_1', sectionId: 'sec_1', activityType: 'page', instanceId: 'inst_1', sequence: 0,
  visible: true, visibleOnPage: true, availability: null, groupMode: 'none',
  completionMode: 'manual', completionRules: {}, idnumber: null,
  openAt: null, dueAt: null, cutoffAt: null,
};

function build(opts: {
  offerings?: any[];
  sections?: any[];
  modules?: any[];
  templates?: any[];
  existingTargetModules?: number;
} = {}) {
  const {
    offerings = [OFFERING], sections = [SECTION], modules = [MODULE],
    templates = [], existingTargetModules = 0,
  } = opts;

  const templateWrites: any[] = [];
  const offeringUpdates: any[] = [];
  const events: any[] = [];

  const prisma = {
    client: {
      courseOffering: {
        findFirst: jest.fn(async (a: any) => {
          const w = a.where ?? {};
          return offerings.find((o) => w.id === undefined || o.id === w.id) ?? null;
        }),
        findMany: jest.fn(async () => offerings),
        update: jest.fn(async (a: any) => { offeringUpdates.push(a); return {}; }),
        updateMany: jest.fn(async (a: any) => { offeringUpdates.push(a); return { count: 1 }; }),
      },
      courseSection: {
        findMany: jest.fn(async () => sections),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (a: any) => ({ id: `new_sec_${a.data.sectionNo}`, ...a.data })),
        update: jest.fn(async () => ({})),
      },
      courseModule: {
        findMany: jest.fn(async () => modules),
        count: jest.fn(async () => existingTargetModules),
        create: jest.fn(async (a: any) => ({ id: 'new_cm', ...a.data })),
        update: jest.fn(async () => ({})),
      },
      courseModuleCompletion: { findMany: jest.fn(async () => [{ id: 'c1' }]) },
      modAssignSubmission: { findMany: jest.fn(async () => [{ id: 's1' }]) },
      lmsCourseTemplate: {
        findFirst: jest.fn(async (a: any) => {
          const w = a.where ?? {};
          return (
            templates.find(
              (t) =>
                (w.id === undefined || t.id === w.id) &&
                (w.code === undefined || t.code === w.code) &&
                (w.organizationId === undefined || t.organizationId === w.organizationId) &&
                (w.deletedAt === undefined || t.deletedAt === w.deletedAt),
            ) ?? null
          );
        }),
        findMany: jest.fn(async () => templates),
        create: jest.fn(async (a: any) => { templateWrites.push({ op: 'create', ...a }); return { id: 'tpl_new', ...a.data }; }),
        update: jest.fn(async (a: any) => { templateWrites.push({ op: 'update', ...a }); return { id: a.where.id, ...a.data }; }),
      },
      $transaction: jest.fn(async (cb: any) => cb({})),
    },
  } as any;

  const registry = {
    has: () => true,
    get: () => ({
      exportInstance: jest.fn(async () => ({ name: 'Week 1 page' })),
      importInstance: jest.fn(async () => ({ instanceId: 'new_inst' })),
      features: { gradable: false },
    }),
  } as any;

  const svc = new CourseBackupService(
    prisma,
    { organizationId: 'org_1', userId: 'user_1' } as any,
    registry,
    { ensureActivityContext: jest.fn() } as any,
    { ensureAssessment: jest.fn(), fanout: jest.fn() } as any,
    { log: jest.fn(async (e: any) => { events.push(e); }) } as any,
  );
  return { svc, prisma, templateWrites, offeringUpdates, events };
}

describe('course templates — saving', () => {
  it('saves a structure-only bundle', async () => {
    const { svc, templateWrites } = build();
    await svc.saveAsTemplate('co_1', { name: 'P5 Mathematics' });

    expect(templateWrites).toHaveLength(1);
    const bundle = templateWrites[0].data.bundle;
    expect(bundle.formatVersion).toBe(1);
    // THE RULE: no pupils, no submissions, no marks.
    expect(bundle.userData).toBeUndefined();
  });

  it('records what the template is for, and how big it is', async () => {
    const { svc, templateWrites } = build();
    await svc.saveAsTemplate('co_1', { name: 'P5 Mathematics' });

    expect(templateWrites[0].data).toMatchObject({
      organizationId: 'org_1',
      name: 'P5 Mathematics',
      subjectId: 'sub_1',
      sectionCount: 1,
      moduleCount: 1,
      createdById: 'user_1',
    });
  });

  it('derives a readable code when none is given', async () => {
    const { svc, templateWrites } = build();
    await svc.saveAsTemplate('co_1', { name: 'P5 Mathematics — Term 1!' });
    expect(templateWrites[0].data.code).toBe('p5-mathematics-term-1');
  });

  it('honours a code the operator supplies', async () => {
    const { svc, templateWrites } = build();
    await svc.saveAsTemplate('co_1', { name: 'Whatever', code: 'P5-MTC-T1' });
    expect(templateWrites[0].data.code).toBe('P5-MTC-T1');
  });

  it('re-saving under the same code replaces, rather than duplicates', async () => {
    const { svc, templateWrites } = build({
      templates: [{ id: 'tpl_1', organizationId: 'org_1', code: 'p5-mathematics', deletedAt: null }],
    });
    await svc.saveAsTemplate('co_1', { name: 'P5 Mathematics' });

    expect(templateWrites[0].op).toBe('update');
    expect(templateWrites[0].where).toEqual({ id: 'tpl_1' });
  });

  it('un-retires a template that is re-saved under the same code', async () => {
    const { svc, templateWrites } = build({
      templates: [{ id: 'tpl_1', organizationId: 'org_1', code: 'p5-mathematics', deletedAt: new Date() }],
    });
    await svc.saveAsTemplate('co_1', { name: 'P5 Mathematics' });
    expect(templateWrites[0].data.deletedAt).toBeNull();
  });

  it('refuses a template with no name', async () => {
    const { svc } = build();
    await expect(svc.saveAsTemplate('co_1', { name: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('refuses to save an empty course', async () => {
    const { svc } = build({ sections: [], modules: [] });
    await expect(svc.saveAsTemplate('co_1', { name: 'Empty' })).rejects.toThrow(/nothing in it/i);
  });

  it('refuses an unknown course', async () => {
    const { svc } = build({ offerings: [] });
    await expect(svc.saveAsTemplate('nope', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('does not return the bundle to the caller', async () => {
    const { svc } = build();
    const saved: any = await svc.saveAsTemplate('co_1', { name: 'P5 Mathematics' });
    expect(saved.bundle).toBeUndefined();
    expect(saved.moduleCount).toBe(1);
  });
});

describe('course templates — listing and reading', () => {
  it('omits the bundles from a listing', async () => {
    const { svc } = build({
      templates: [
        { id: 'tpl_1', organizationId: 'org_1', code: 'a', name: 'A', bundle: { big: 'x'.repeat(1000) }, deletedAt: null },
      ],
    });
    const rows: any[] = await svc.listTemplates();
    expect(rows[0].bundle).toBeUndefined();
    expect(rows[0].name).toBe('A');
  });

  it('reads one template, bundle included', async () => {
    const { svc } = build({
      templates: [{ id: 'tpl_1', organizationId: 'org_1', code: 'a', bundle: { formatVersion: 1 }, deletedAt: null }],
    });
    const row: any = await svc.getTemplate('tpl_1');
    expect(row.bundle).toEqual({ formatVersion: 1 });
  });

  it('refuses a template from another organization', async () => {
    const { svc } = build({
      templates: [{ id: 'tpl_1', organizationId: 'org_OTHER', code: 'a', deletedAt: null }],
    });
    await expect(svc.getTemplate('tpl_1')).rejects.toThrow(NotFoundException);
  });

  it('refuses a retired template', async () => {
    const { svc } = build({
      templates: [{ id: 'tpl_1', organizationId: 'org_1', code: 'a', deletedAt: new Date() }],
    });
    await expect(svc.getTemplate('tpl_1')).rejects.toThrow(NotFoundException);
  });

  it('retires softly, so it can still be looked at later', async () => {
    const { svc, templateWrites } = build({
      templates: [{ id: 'tpl_1', organizationId: 'org_1', code: 'a', deletedAt: null }],
    });
    await svc.deleteTemplate('tpl_1');
    expect(templateWrites[0].data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('course templates — applying', () => {
  const TPL = {
    id: 'tpl_1',
    organizationId: 'org_1',
    code: 'a',
    coverImageFileId: null,
    deletedAt: null,
    bundle: {
      formatVersion: 1,
      exportedAt: '2026-02-01T00:00:00.000Z',
      course: { format: 'weeks', numSections: 14, summary: null, completionEnabled: true, showGradesToStudents: true },
      sections: [SECTION],
      modules: [
        {
          spine: { ...MODULE, sectionNo: 1 },
          activityType: 'page',
          instance: { name: 'Week 1 page' },
          sourceId: 'cm_1',
        },
      ],
    },
  };

  it('builds the course from the bundle', async () => {
    const { svc } = build({ templates: [TPL] });
    const r = await svc.applyTemplate('co_1', 'tpl_1');
    expect(r.modules).toBeGreaterThan(0);
  });

  it('refuses a course that already has activities', async () => {
    const { svc } = build({ templates: [TPL], existingTargetModules: 3 });
    await expect(svc.applyTemplate('co_1', 'tpl_1')).rejects.toThrow(/already has activities/i);
  });

  it('refuses a bundle saved in an unsupported format', async () => {
    const { svc } = build({
      templates: [{ ...TPL, bundle: { formatVersion: 99 } }],
    });
    await expect(svc.applyTemplate('co_1', 'tpl_1')).rejects.toThrow(/unsupported format/i);
  });

  it('carries the template picture onto a course that has none', async () => {
    const { svc, offeringUpdates } = build({
      templates: [{ ...TPL, coverImageFileId: 'file_1' }],
    });
    await svc.applyTemplate('co_1', 'tpl_1');
    const cover = offeringUpdates.find((u) => u.data?.coverImageFileId === 'file_1');
    expect(cover).toBeTruthy();
    // Only where the course had none: a course's own picture is not overwritten.
    expect(cover.where).toMatchObject({ coverImageFileId: null });
  });

  it('leaves the picture alone when the template has none', async () => {
    const { svc, offeringUpdates } = build({ templates: [TPL] });
    await svc.applyTemplate('co_1', 'tpl_1');
    expect(offeringUpdates.some((u) => 'coverImageFileId' in (u.data ?? {}))).toBe(false);
  });

  it('logs the application against the course', async () => {
    const { svc, events } = build({ templates: [TPL] });
    await svc.applyTemplate('co_1', 'tpl_1');
    const applied = events.find((e) => e.eventName === 'core_backup.template_applied');
    expect(applied).toBeTruthy();
    expect(applied.courseOfferingId).toBe('co_1');
  });
});
