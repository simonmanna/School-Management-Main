import { ForbiddenException } from '@nestjs/common';
import { assertProvisioningSecret, ProvisioningSecretGuard } from '../../src/modules/core/organizations.controller';

/** Tenant bootstrap used to be anonymous: anyone on the internet could mint an organization. */
describe('assertProvisioningSecret', () => {
  const saved = process.env.PROVISIONING_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.PROVISIONING_SECRET;
    else process.env.PROVISIONING_SECRET = saved;
  });

  it('is closed when no secret is configured', () => {
    delete process.env.PROVISIONING_SECRET;
    expect(() => assertProvisioningSecret('anything')).toThrow(ForbiddenException);
  });

  it('refuses a missing or wrong header', () => {
    process.env.PROVISIONING_SECRET = 'correct-horse-battery';
    expect(() => assertProvisioningSecret(undefined)).toThrow(ForbiddenException);
    expect(() => assertProvisioningSecret('wrong')).toThrow(ForbiddenException);
    expect(() => assertProvisioningSecret('correct-horse-batterx')).toThrow(ForbiddenException);
  });

  it('accepts the configured secret', () => {
    process.env.PROVISIONING_SECRET = 'correct-horse-battery';
    expect(() => assertProvisioningSecret('correct-horse-battery')).not.toThrow();
  });
});

/** The check is a guard so it runs before the ValidationPipe: anonymous callers get 403, not a 400 field list. */
describe('ProvisioningSecretGuard', () => {
  const saved = process.env.PROVISIONING_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.PROVISIONING_SECRET;
    else process.env.PROVISIONING_SECRET = saved;
  });
  const ctx = (headers: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it('rejects a request without the header', () => {
    process.env.PROVISIONING_SECRET = 'correct-horse-battery';
    expect(() => new ProvisioningSecretGuard().canActivate(ctx({}))).toThrow(ForbiddenException);
  });

  it('admits a request carrying the configured secret', () => {
    process.env.PROVISIONING_SECRET = 'correct-horse-battery';
    expect(new ProvisioningSecretGuard().canActivate(ctx({ 'x-provisioning-secret': 'correct-horse-battery' }))).toBe(true);
  });
});
