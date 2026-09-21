import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  const prev = process.env.JWT_ACCESS_SECRET;
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'unit-test-secret';
  });
  afterAll(() => {
    process.env.JWT_ACCESS_SECRET = prev;
  });

  it('decrypts what it encrypts', () => {
    const svc = new EncryptionService();
    const enc = svc.encrypt('CM12345678ABCD')!;
    expect(svc.decrypt(enc)).toBe('CM12345678ABCD');
  });

  it('rejects a tampered payload', () => {
    const svc = new EncryptionService();
    const enc = svc.encrypt('secret')!;
    const tag = Buffer.from(enc.tag, 'base64');
    tag[0] ^= 0xff;
    expect(() => svc.decrypt({ ...enc, tag: tag.toString('base64') })).toThrow();
  });

  it('rejects an unknown version prefix', () => {
    const svc = new EncryptionService();
    const enc = svc.encrypt('secret')!;
    const raw = Buffer.from(enc.ciphertext, 'base64');
    raw[1] = 'x'.charCodeAt(0);
    expect(() => svc.decrypt({ ...enc, ciphertext: raw.toString('base64') })).toThrow(/unknown version/);
  });

  it('passes null through', () => {
    const svc = new EncryptionService();
    expect(svc.encrypt('')).toBeNull();
    expect(svc.decrypt(null)).toBeNull();
  });
});
