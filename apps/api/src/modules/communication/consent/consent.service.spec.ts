import { ConsentService } from './consent.service';

describe('ConsentService.classifyKeyword', () => {
  it('recognises the standard opt-out keywords, case-insensitively', () => {
    for (const word of ['STOP', 'stop', 'Unsubscribe', 'CANCEL', 'quit', 'optout', 'opt-out']) {
      expect(ConsentService.classifyKeyword(word)).toBe('opt_out');
    }
  });

  it('recognises the opt-in keywords', () => {
    for (const word of ['START', 'unstop', 'Subscribe', 'YES']) {
      expect(ConsentService.classifyKeyword(word)).toBe('opt_in');
    }
  });

  it('tolerates surrounding punctuation and whitespace', () => {
    expect(ConsentService.classifyKeyword('  stop.  ')).toBe('opt_out');
    expect(ConsentService.classifyKeyword('"STOP!"')).toBe('opt_out');
  });

  it('does NOT match a keyword buried in a sentence', () => {
    // Suppressing this parent would silently cut them off from every future fee
    // notice and report card. A human sentence is for a human to read.
    expect(ConsentService.classifyKeyword('Please stop sending to my old number')).toBeNull();
    expect(ConsentService.classifyKeyword('Can you start the bus service earlier?')).toBeNull();
  });

  it('ignores ordinary replies', () => {
    expect(ConsentService.classifyKeyword('Thank you')).toBeNull();
    expect(ConsentService.classifyKeyword('')).toBeNull();
    expect(ConsentService.classifyKeyword('   ')).toBeNull();
  });
});

describe('ConsentService suppression resolution', () => {
  /** Minimal prisma double — only the two calls the service makes. */
  function serviceWith(rows: { address: string; channel: string; status: string; reason?: string | null }[]) {
    const prisma = {
      raw: {
        messagingConsent: {
          findMany: jest.fn(
            async ({
              where,
            }: {
              where: { address?: string | { in: string[] }; channel?: { in: string[] } };
            }) =>
              rows
                .filter((r) => {
                  const a = where.address;
                  if (a === undefined) return true;
                  return typeof a === 'string' ? r.address === a : a.in.includes(r.address);
                })
                .filter((r) => (where.channel ? where.channel.in.includes(r.channel) : true))
                .map((r) => ({ ...r, reason: r.reason ?? null })),
          ),
        },
      },
    };
    return new ConsentService(prisma as never, {} as never);
  }

  it('no row means send', async () => {
    const svc = serviceWith([]);
    await expect(svc.isSuppressed('org1', 'sms', '+256772123456')).resolves.toMatchObject({ suppressed: false });
  });

  it('a blanket opt-out suppresses every channel', async () => {
    const svc = serviceWith([{ address: '+256772123456', channel: 'all', status: 'opted_out' }]);
    const r = await svc.isSuppressed('org1', 'sms', '+256772123456');
    expect(r.suppressed).toBe(true);
    expect(r.scope).toBe('all');
  });

  it('a channel-specific opt-IN overrides a blanket opt-out', async () => {
    // "Stop texting me, WhatsApp is fine" has to be expressible.
    const svc = serviceWith([
      { address: '+256772123456', channel: 'all', status: 'opted_out' },
      { address: '+256772123456', channel: 'whatsapp', status: 'opted_in' },
    ]);
    await expect(svc.isSuppressed('org1', 'whatsapp', '+256772123456')).resolves.toMatchObject({
      suppressed: false,
      scope: 'whatsapp',
    });
    await expect(svc.isSuppressed('org1', 'sms', '+256772123456')).resolves.toMatchObject({ suppressed: true });
  });

  it('an empty address is never suppressed (and never queried)', async () => {
    const svc = serviceWith([{ address: '', channel: 'all', status: 'opted_out' }]);
    await expect(svc.isSuppressed('org1', 'sms', '')).resolves.toEqual({ suppressed: false });
  });

  it('the bulk variant applies the same channel-specific override', async () => {
    const svc = serviceWith([
      { address: '+256700000001', channel: 'sms', status: 'opted_out' },
      { address: '+256700000002', channel: 'all', status: 'opted_out' },
      { address: '+256700000003', channel: 'all', status: 'opted_out' },
      { address: '+256700000003', channel: 'sms', status: 'opted_in' },
    ]);
    const suppressed = await svc.suppressedAddresses('org1', 'sms', [
      '+256700000001',
      '+256700000002',
      '+256700000003',
      '+256700000004',
    ]);
    expect([...suppressed].sort()).toEqual(['+256700000001', '+256700000002']);
  });

  it('the bulk variant issues ONE query for N addresses', async () => {
    // A 400-parent broadcast must not become 400 consent round-trips.
    const svc = serviceWith([]);
    await svc.suppressedAddresses('org1', 'sms', Array.from({ length: 400 }, (_, i) => `+25677000${i}`));
    const findMany = (svc as any).prisma.raw.messagingConsent.findMany as jest.Mock;
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('an empty address list short-circuits without querying', async () => {
    const svc = serviceWith([]);
    await expect(svc.suppressedAddresses('org1', 'sms', [])).resolves.toEqual(new Set());
    expect(((svc as any).prisma.raw.messagingConsent.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});
