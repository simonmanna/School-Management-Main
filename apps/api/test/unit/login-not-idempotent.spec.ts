/**
 * Wave 7 · the public login is not an @Idempotent route. The idempotency store
 * is keyed per organization and login runs before a tenant exists, so any
 * client that sent an Idempotency-Key got a 500 ("No tenant context"); and a
 * replayed login would have handed out the same tokens twice.
 */
import 'reflect-metadata';
import { AuthController } from '../../src/kernel/auth/auth.controller';
import { IDEMPOTENT_KEY } from '../../src/kernel/idempotency/idempotent.decorator';

jest.mock('otplib', () => ({ authenticator: {} }));

describe('login idempotency', () => {
  it('login carries no @Idempotent metadata', () => {
    expect(Reflect.getMetadata(IDEMPOTENT_KEY, AuthController.prototype.login)).toBeUndefined();
  });
});
