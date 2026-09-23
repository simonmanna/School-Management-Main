import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CurriculumService } from '../../src/modules/school/academics/academics.service';
import {
  canTransition,
  CREATABLE_STATUSES,
  ENROLLMENT_STATUSES,
  holdsPlacement,
  isReactivation,
  profileStatusFor,
} from '../../src/modules/school/enrollment/enrollment-fsm';
import { assertStaffTransition, LEAVING_STATUSES } from '../../src/modules/school/people/staff-lifecycle';
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

// ── Enrollment & staff lifecycles (pure state machines) ────────────────────
describe('Enrollment FSM', () => {
  it('only PENDING and ACTIVE may be created directly', () => {
    expect([...CREATABLE_STATUSES].sort()).toEqual(['ACTIVE', 'PENDING']);
  });

  it('WITHDRAWN -> ACTIVE is a reactivation (needs its own grant); SUSPENDED -> ACTIVE is not', () => {
    expect(canTransition('WITHDRAWN', 'ACTIVE')).toBe(true);
    expect(isReactivation('WITHDRAWN', 'ACTIVE')).toBe(true);
    expect(isReactivation('TRANSFERRED', 'ACTIVE')).toBe(true);
    expect(isReactivation('SUSPENDED', 'ACTIVE')).toBe(false);
  });

  it('COMPLETED and CANCELLED are terminal', () => {
    for (const to of ENROLLMENT_STATUSES) {
      expect(canTransition('COMPLETED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('only seat-holding statuses keep an open placement', () => {
    expect(holdsPlacement('ACTIVE')).toBe(true);
    expect(holdsPlacement('SUSPENDED')).toBe(true);
    expect(holdsPlacement('WITHDRAWN')).toBe(false);
  });

  it('a completed membership projects to graduated, not the legacy alumni value', () => {
    expect(profileStatusFor('COMPLETED')).toBe('graduated');
  });
});

describe('Staff lifecycle FSM', () => {
  it('allows leaving from active and re-hire from a leaving status', () => {
    expect(() => assertStaffTransition('active', 'resigned')).not.toThrow();
    expect(() => assertStaffTransition('terminated', 'active')).not.toThrow();
  });

  it('refuses nonsense jumps', () => {
    expect(() => assertStaffTransition('suspended', 'retired')).toThrow(BadRequestException);
    expect(() => assertStaffTransition('resigned', 'on_leave')).toThrow(BadRequestException);
  });

  it('marks terminated / resigned / retired as leaving', () => {
    expect([...LEAVING_STATUSES].sort()).toEqual(['resigned', 'retired', 'terminated']);
  });
});
