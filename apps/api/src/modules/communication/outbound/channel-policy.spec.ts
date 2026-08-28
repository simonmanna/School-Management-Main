import {
  DEFAULT_CHANNEL_POLICY,
  describePolicy,
  parseChannelPolicy,
  stepCanAddress,
} from './channel-policy';

describe('parseChannelPolicy', () => {
  it('falls back to the default chain when nothing is specified', () => {
    expect(parseChannelPolicy(undefined)).toEqual(DEFAULT_CHANNEL_POLICY);
    expect(parseChannelPolicy(null)).toEqual(DEFAULT_CHANNEL_POLICY);
    expect(parseChannelPolicy({})).toEqual(DEFAULT_CHANNEL_POLICY);
  });

  it('accepts the array shorthand the composer sends', () => {
    const p = parseChannelPolicy(['whatsapp', 'sms']);
    expect(p.steps).toEqual([{ providerId: 'whatsapp' }, { providerId: 'sms' }]);
    expect(p.fallbackOnFailure).toBe(true);
  });

  it('keeps the two WhatsApp transports distinct', () => {
    // They share a providerId on purpose (swapping them must not rewrite message
    // history), so `transport` is the only thing separating Cloud from Baileys.
    const p = parseChannelPolicy({
      steps: [
        { providerId: 'whatsapp', transport: 'cloud' },
        { providerId: 'whatsapp', transport: 'baileys' },
      ],
    });
    expect(p.steps).toHaveLength(2);
  });

  it('drops a repeated step', () => {
    // A duplicate can only waste an escalation on a transport that just failed
    // for the same reason.
    const p = parseChannelPolicy(['sms', 'sms', 'internal']);
    expect(p.steps.map((s) => s.providerId)).toEqual(['sms', 'internal']);
  });

  it('rejects an unknown provider instead of silently skipping it', () => {
    expect(() => parseChannelPolicy(['carrier-pigeon'])).toThrow(/unknown provider/);
  });

  it('honours fallbackOnFailure: false', () => {
    const p = parseChannelPolicy({ steps: [{ providerId: 'sms' }], fallbackOnFailure: false });
    expect(p.fallbackOnFailure).toBe(false);
  });
});

describe('stepCanAddress', () => {
  it('internal needs a login account, not a phone', () => {
    expect(stepCanAddress({ providerId: 'internal' }, { userId: 'u1' })).toBe(true);
    expect(stepCanAddress({ providerId: 'internal' }, { address: '+256772123456' })).toBe(false);
  });

  it('external transports need a phone, not a login', () => {
    expect(stepCanAddress({ providerId: 'sms' }, { address: '+256772123456' })).toBe(true);
    expect(stepCanAddress({ providerId: 'sms' }, { userId: 'u1' })).toBe(false);
    expect(stepCanAddress({ providerId: 'whatsapp' }, { address: null, userId: 'u1' })).toBe(false);
  });
});

describe('describePolicy', () => {
  it('reads as a chain when fallback is on', () => {
    expect(describePolicy(DEFAULT_CHANNEL_POLICY)).toBe('whatsapp/cloud → whatsapp/baileys → sms → internal');
  });

  it('names only the single transport when fallback is off', () => {
    expect(describePolicy({ steps: [{ providerId: 'sms' }, { providerId: 'internal' }], fallbackOnFailure: false })).toBe(
      'sms',
    );
  });
});
