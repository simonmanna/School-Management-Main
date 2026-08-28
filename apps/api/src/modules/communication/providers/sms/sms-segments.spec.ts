import { countSegments, isGsm7, transliterateToGsm7 } from './sms-segments';

describe('SMS segment accounting', () => {
  it('plain ASCII is GSM-7', () => {
    const r = countSegments('Dear Parent, fees are due.');
    expect(r.encoding).toBe('GSM-7');
    expect(r.segments).toBe(1);
  });

  it('160 GSM-7 characters is exactly one segment', () => {
    const r = countSegments('a'.repeat(160));
    expect(r.segments).toBe(1);
    expect(r.remaining).toBe(0);
  });

  it('161 GSM-7 characters spills to two concatenated segments', () => {
    // Concatenation steals 7 bits per part for the UDH, so capacity drops to 153.
    const r = countSegments('a'.repeat(161));
    expect(r.segments).toBe(2);
    expect(r.units).toBe(161);
  });

  it('306 GSM-7 characters is two segments, 307 is three', () => {
    expect(countSegments('a'.repeat(306)).segments).toBe(2);
    expect(countSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('extension characters cost two GSM-7 units each', () => {
    // 80 euro signs = 160 units = still one segment; 81 tips it over.
    expect(countSegments('€'.repeat(80)).segments).toBe(1);
    expect(countSegments('€'.repeat(81)).segments).toBe(2);
    expect(countSegments('€'.repeat(80)).units).toBe(160);
  });

  it('a single non-GSM character flips the whole body to UCS-2', () => {
    // The cost cliff this module exists to make visible: one smart quote pasted
    // from Word more than halves capacity for the entire message.
    const ascii = countSegments('a'.repeat(100));
    const withCurly = countSegments('a'.repeat(99) + '’');
    expect(ascii.encoding).toBe('GSM-7');
    expect(ascii.segments).toBe(1);
    expect(withCurly.encoding).toBe('UCS-2');
    expect(withCurly.segments).toBe(2);
  });

  it('UCS-2 boundaries are 70 then 67 per part', () => {
    // Cyrillic, deliberately: 'é' looks exotic but IS in the GSM-7 alphabet and
    // would keep this on the 160/153 boundaries instead.
    const base = 'ж';
    expect(countSegments(base.repeat(70)).segments).toBe(1);
    expect(countSegments(base.repeat(71)).segments).toBe(2);
    expect(countSegments(base.repeat(134)).segments).toBe(2);
    expect(countSegments(base.repeat(135)).segments).toBe(3);
  });

  it('astral-plane emoji count as two UCS-2 units (surrogate pair)', () => {
    // Counting code POINTS here would under-bill against the gateway invoice.
    const r = countSegments('\u{1F600}'.repeat(35));
    expect(r.encoding).toBe('UCS-2');
    expect(r.units).toBe(70);
    expect(r.segments).toBe(1);
    expect(countSegments('\u{1F600}'.repeat(36)).segments).toBe(2);
  });

  it('an empty body is still one segment', () => {
    expect(countSegments('').segments).toBe(1);
  });

  it('accented Latin in the GSM alphabet stays GSM-7', () => {
    // The alphabet is narrower than "Latin-1": é è à ä ö ü ñ are in, ë is not.
    expect(isGsm7('Père à Öykü')).toBe(true);
    expect(isGsm7('Noël')).toBe(false);
    expect(isGsm7('Zoë ẞ')).toBe(false);
  });

  it('transliteration rescues typographic characters but not meaningful ones', () => {
    const word = transliterateToGsm7('“Don’t be late” — see you…');
    expect(word).toBe('"Don\'t be late" - see you...');
    expect(countSegments(word).encoding).toBe('GSM-7');
    // A parent's accented name carries meaning and must survive untouched.
    expect(transliterateToGsm7('Zoë')).toBe('Zoë');
  });
});
