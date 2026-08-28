import { describeSelector, parseAudienceSelector } from './audience-selector';

describe('parseAudienceSelector', () => {
  it('applies the school-sensible defaults', () => {
    const s = parseAudienceSelector({ scope: 'class', ids: ['c1'] });
    expect(s.recipients).toBe('guardians');
    // One message per family, not one per adult on file — three copies of a
    // closure notice is three SMS charges and an annoyed parent.
    expect(s.primaryGuardianOnly).toBe(true);
    expect(s.dedupe).toBe('per_recipient');
    expect(s.studentStatus).toEqual(['active']);
  });

  it('rejects an unknown scope', () => {
    expect(() => parseAudienceSelector({ scope: 'everyone' as never })).toThrow(/audience.scope/);
  });

  it('requires ids for scopes that need them', () => {
    expect(() => parseAudienceSelector({ scope: 'class' })).toThrow(/audience.ids is required/);
    expect(() => parseAudienceSelector({ scope: 'grade', ids: [] })).toThrow(/audience.ids is required/);
  });

  it('does not require ids for all/staff', () => {
    expect(() => parseAudienceSelector({ scope: 'all' })).not.toThrow();
    expect(() => parseAudienceSelector({ scope: 'staff' })).not.toThrow();
  });

  it("rejects ids on scope 'all', which would otherwise be silently ignored", () => {
    expect(() => parseAudienceSelector({ scope: 'all', ids: ['c1'] })).toThrow(/not meaningful/);
  });

  it('strips empty ids rather than querying for them', () => {
    const s = parseAudienceSelector({ scope: 'class', ids: ['c1', '', 'c2'] });
    expect(s.ids).toEqual(['c1', 'c2']);
  });

  it('rejects an unknown dedupe mode', () => {
    expect(() => parseAudienceSelector({ scope: 'all', dedupe: 'per_family' as never })).toThrow(/audience.dedupe/);
  });

  it('keeps an explicit studentStatus list', () => {
    const s = parseAudienceSelector({ scope: 'all', studentStatus: ['active', 'suspended'] });
    expect(s.studentStatus).toEqual(['active', 'suspended']);
  });
});

describe('describeSelector', () => {
  it('names the classes when labels are available', () => {
    const names = new Map([['c1', 'P5 East']]);
    expect(describeSelector({ scope: 'class', ids: ['c1'], recipients: 'guardians' }, names)).toBe(
      'Class: P5 East → guardians',
    );
  });

  it('falls back to raw ids when no labels are supplied', () => {
    expect(describeSelector({ scope: 'grade', ids: ['g1'] })).toBe('Grade: g1 → guardians');
  });

  it('describes staff without a recipient kind', () => {
    expect(describeSelector({ scope: 'staff', staffCategory: ['teaching'] })).toBe('Staff (teaching)');
    expect(describeSelector({ scope: 'staff' })).toBe('All staff');
  });

  it('describes the whole school', () => {
    expect(describeSelector({ scope: 'all', recipients: 'both' })).toBe('All students → guardians + students');
  });
});
