import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CurriculumService } from '../../src/modules/school/academics/academics.service';
import { EnrollmentService } from '../../src/modules/school/people/enrollment.service';
import { AuditService } from '../../src/kernel/audit/audit.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { EventBus } from '../../src/kernel/events/event-bus';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';

// ── Helpers ────────────────────────────────────────────────────────────────
function mockPrisma(handlers: Record<string, any> = {}) {
  const store: Record<string, any> = {};
  const make = (name: string) => ({
    findFirst: jest.fn(async (args: any) => (store[name] ? store[name] : handlers[name]?.findFirst ? handlers[name].findFirst(args) : null)),
    findMany: jest.fn(async () => []),
    create: jest.fn(async (a: any) => { const row = { id: 'new', ...a.data }; store[name] = row; return row; }),
    createMany: jest.fn(async () => ({ count: 1 })),
    updateMany: jest.fn(async (a: any) => { store[name] = { ...(store[name] ?? { id: a.where?.id ?? 'x' }), ...a.data }; return { count: 1 }; }),
    update: jest.fn(async (a: any) => { const row = { id: a.where?.id ?? 'x', ...a.data }; store[name] = row; return row; }),
    deleteMany: jest.fn(async () => ({ count: 1 })),
  });
  const curriculum = make('curriculum');
  const enrollment = make('enrollment');
  const enrollmentHistory = make('enrollmentHistory');
  const studentProfile = make('studentProfile');
  const tx = { curriculum, enrollment, enrollmentHistory, studentProfile };
  const client = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    curriculum, enrollment, enrollmentHistory, studentProfile,
  };
  return { client, tx, store };
}

function makeCurriculumService(curRow: any | null, handlers: Record<string, any> = {}) {
  const { client } = mockPrisma({ curriculum: { findFirst: async () => curRow } });
  const tenant = { organizationId: 'org_test', userId: 'user_1' } as any;
  const audit = { recordInTx: jest.fn(async () => undefined) } as any;
  const events = { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any;
  const service = new CurriculumService({ client } as any, tenant, audit, events);
  void handlers;
  return { service, audit, events };
}

function makeEnrollmentService(enrRow: any | null) {
  const { client } = mockPrisma({ enrollment: { findFirst: async () => enrRow } });
  const tenant = { organizationId: 'org_test', userId: 'user_1' } as any;
  const audit = { recordInTx: jest.fn(async () => undefined) } as any;
  const events = { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any;
  // SequenceService is the fifth constructor argument. It was added and this call
  // was not updated, so the whole file stopped compiling (TS2554) and every test
  // in it silently stopped running — the same rot that had killed admission-fsm.spec.
  const sequence = { next: jest.fn(async () => 'STU-000001') } as any;
  const service = new EnrollmentService({ client } as any, tenant, audit, events, sequence);
  return { service, audit, events };
}

// ── Curriculum version lifecycle ──────────────────────────────────────────
describe('CurriculumService — version lifecycle (immutable published versions)', () => {
  it('publishes a draft → published', async () => {
    const { service, events } = makeCurriculumService({ id: 'c1', status: 'draft', version: 1 });
    const res = await service.publish('c1');
    expect(res).toBeDefined();
    expect(events.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ curriculumId: 'c1', version: 1 }),
    );
  });

  it('rejects publishing a non-draft curriculum', async () => {
    const { service } = makeCurriculumService({ id: 'c1', status: 'published', version: 1 });
    await expect(service.publish('c1')).rejects.toThrow(BadRequestException);
  });

  it('archives a published version', async () => {
    const { service } = makeCurriculumService({ id: 'c1', status: 'published', version: 1 });
    const res = await service.archive('c1');
    expect(res).toBeDefined();
  });

  it('rejects archiving a draft', async () => {
    const { service } = makeCurriculumService({ id: 'c1', status: 'draft', version: 1 });
    await expect(service.archive('c1')).rejects.toThrow(BadRequestException);
  });

  it('blocks editing a published version (immutability)', async () => {
    const { service } = makeCurriculumService({ id: 'c1', status: 'published', version: 1 });
    await expect(service.update('c1', { name: 'Renamed' } as any)).rejects.toThrow(BadRequestException);
  });

  it('allows editing a draft', async () => {
    const { service } = makeCurriculumService({ id: 'c1', status: 'draft', version: 1 });
    const res = await service.update('c1', { name: 'Renamed' } as any);
    expect(res).toBeDefined();
  });

  it('throws on publish of missing curriculum', async () => {
    const { service } = makeCurriculumService(null);
    await expect(service.publish('missing')).rejects.toThrow(NotFoundException);
  });
});

// ── Enrollment history (first-class historical entity) ────────────────────
describe('EnrollmentService — enrollment history FSM', () => {
  it('enrolls and records an initial history row', async () => {
    const { service, events } = makeEnrollmentService(null);
    const res = await service.enroll({
      studentProfileId: 's1', classId: 'c1', sectionId: 'sec1', streamId: 'st1',
      termId: 't1', rollNumber: 'R1',
    });
    expect(res.status).toBe('enrolled');
    expect(events.publishInTx).toHaveBeenCalled();
  });

  it('rejects a second active enrollment for the same student+term (concurrency)', async () => {
    const { service } = makeEnrollmentService(null, );
    // Simulate existing active enrollment by stubbing the findFirst inside the tx.
    (service as any).prisma = {
      client: {
        $transaction: jest.fn(async (cb: any) => cb({
          enrollment: { findFirst: jest.fn(async () => ({ id: 'existing', status: 'enrolled' })), create: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
          enrollmentHistory: { create: jest.fn() },
          studentProfile: { updateMany: jest.fn() },
        })),
      },
    } as any;
    await expect(service.enroll({ studentProfileId: 's1', classId: 'c1', termId: 't1', rollNumber: 'R1' }))
      .rejects.toThrow(BadRequestException);
  });

  it('transfers out an active enrollment and appends history', async () => {
    const { service } = makeEnrollmentService({ id: 'e1', status: 'enrolled' });
    const res = await service.transferOut('e1', { reason: 'moved schools' });
    expect(res.status).toBe('transferred_out');
  });

  it('rejects transferring an already-withdrawn enrollment', async () => {
    const { service } = makeEnrollmentService({ id: 'e1', status: 'withdrawn' });
    await expect(service.transferOut('e1', { reason: 'x' })).rejects.toThrow(BadRequestException);
  });

  it('withdraws an active enrollment', async () => {
    const { service } = makeEnrollmentService({ id: 'e1', status: 'enrolled' });
    const res = await service.withdraw('e1', { reason: 'left' });
    expect(res.status).toBe('withdrawn');
  });

  it('re-enrolls a withdrawn enrollment', async () => {
    const { service } = makeEnrollmentService({ id: 'e1', status: 'withdrawn' });
    const res = await service.reEnroll('e1', { reason: 'returned' });
    expect(res.status).toBe('enrolled');
  });

  it('rejects re-enrolling an already-active enrollment', async () => {
    const { service } = makeEnrollmentService({ id: 'e1', status: 'enrolled' });
    await expect(service.reEnroll('e1', { reason: 'x' })).rejects.toThrow(BadRequestException);
  });
});
