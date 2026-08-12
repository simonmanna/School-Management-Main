import { MilestoneService } from './milestone.service';
import { MilestoneRegistry } from './milestone.registry';

/**
 * Phase B — the milestone projection. Asserts the recall-recovery property that
 * motivates the whole approach: the earliest matching fact wins, so a metric
 * survives a rework loop that the denormalized column would have erased.
 */
describe('MilestoneService', () => {
  const orgId = 'org-1';
  let registry: MilestoneRegistry;
  let prisma: any;
  let svc: MilestoneService;

  const fact = (eventName: string, iso: string, payload: Record<string, unknown> = {}, actorId = 'u1') => ({
    eventName,
    occurredAt: new Date(iso),
    actorId,
    payload,
  });

  beforeEach(() => {
    registry = new MilestoneRegistry();
    registry.registerAll([
      { key: 'confirmed', label: 'Confirmed', entityType: 'order', fromEvent: 'order.confirmed' as any, sequence: 10 },
      {
        key: 'kitchen_ready', label: 'Kitchen Ready', entityType: 'order',
        fromEvent: 'fulfillment.completed' as any,
        match: (p) => p.strategy === 'kitchen', occurrence: 'first', sequence: 20,
      },
    ]);
    prisma = { client: { domainEventLog: { findMany: jest.fn() } } };
    svc = new MilestoneService(prisma as any, { organizationId: orgId } as any, registry);
  });

  it('returns every declared milestone in sequence order, reached flag set from facts', async () => {
    prisma.client.domainEventLog.findMany.mockResolvedValue([
      fact('order.confirmed', '2026-01-01T10:00:00Z'),
    ]);
    const out = await svc.forEntity('order', 'o1');
    expect(out.map((m) => m.key)).toEqual(['confirmed', 'kitchen_ready']);
    expect(out[0]).toMatchObject({ reached: true, count: 1 });
    expect(out[0].occurredAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(out[1]).toMatchObject({ reached: false, occurredAt: null, count: 0 });
  });

  it('discriminates shared event names by the match predicate', async () => {
    prisma.client.domainEventLog.findMany.mockResolvedValue([
      fact('fulfillment.completed', '2026-01-01T10:05:00Z', { strategy: 'delivery' }),
      fact('fulfillment.completed', '2026-01-01T10:06:00Z', { strategy: 'kitchen' }),
    ]);
    const out = await svc.forEntity('order', 'o1');
    const ready = out.find((m) => m.key === 'kitchen_ready')!;
    expect(ready.reached).toBe(true);
    // Only the kitchen fact matched — the delivery one is ignored.
    expect(ready.count).toBe(1);
    expect(ready.occurredAt?.toISOString()).toBe('2026-01-01T10:06:00.000Z');
  });

  it('records the FIRST matching fact — a recall does not overwrite the first ready', async () => {
    prisma.client.domainEventLog.findMany.mockResolvedValue([
      fact('fulfillment.completed', '2026-01-01T10:00:00Z', { strategy: 'kitchen' }), // first ready
      fact('fulfillment.completed', '2026-01-01T10:09:00Z', { strategy: 'kitchen' }), // ready again after recall
    ]);
    const out = await svc.forEntity('order', 'o1');
    const ready = out.find((m) => m.key === 'kitchen_ready')!;
    expect(ready.occurredAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(ready.count).toBe(2); // both preserved; the metric uses the first
  });

  it('returns [] for an entity type with no registered milestones', async () => {
    const out = await svc.forEntity('invoice', 'i1');
    expect(out).toEqual([]);
    expect(prisma.client.domainEventLog.findMany).not.toHaveBeenCalled();
  });
});
