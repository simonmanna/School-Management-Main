/**
 * Account links, end to end against a real database (E2E audit A1, A2, logout):
 *
 *   1. MFA enrol → verify → sign out → sign in with password + a real TOTP code
 *      succeeds. It used to lock the account: the secret was read back with an
 *      empty iv/tag, so the ciphertext was fed to the TOTP check.
 *   2. Forgot-password emails a link whose token `/auth/reset-password` accepts,
 *      and the stored notification row does not keep the token.
 *   3. Logout revokes the refresh token: the next refresh is 401.
 *   4. Login matches the email case-insensitively.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AuthModule } from '../../src/kernel/auth/auth.module';
import { AuthService } from '../../src/kernel/auth/auth.service';
import { OneTimeTokenService } from '../../src/kernel/auth/one-time-token.service';
import { PasswordService } from '../../src/kernel/auth/password.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../src/kernel/notifications/notifications.service';

/**
 * otplib ships ESM only, which this ts-jest (CJS) project cannot load. A small
 * RFC 6238 TOTP stands in for it — the defect under test is how the SECRET is
 * stored and read back, not the TOTP arithmetic.
 */
jest.mock('otplib', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac, randomBytes } = require('node:crypto');
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b32 = (buf: Buffer) => {
    let bits = '';
    for (const b of buf) bits += b.toString(2).padStart(8, '0');
    return (bits.match(/.{1,5}/g) ?? []).map((c) => A[parseInt(c.padEnd(5, '0'), 2)]).join('');
  };
  const unb32 = (s: string) => {
    const bits = s.replace(/=+$/, '').split('').map((c) => A.indexOf(c).toString(2).padStart(5, '0')).join('');
    return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  };
  const totp = (secret: string, drift = 0) => {
    const counter = Math.floor(Date.now() / 30000) + drift;
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const h = createHmac('sha1', unb32(secret)).update(msg).digest();
    const o = h[h.length - 1] & 0xf;
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
  };
  return {
    generateSecret: () => b32(randomBytes(20)),
    generateSync: ({ secret }: { secret: string }) => totp(secret),
    verifySync: ({ token, secret }: { token: string; secret: string }) => ({
      valid: [-1, 0, 1].some((d) => totp(secret, d) === token),
    }),
    generateURI: ({ secret }: { secret: string }) => `otpauth://totp/test?secret=${secret}`,
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateSync } = require('otplib') as { generateSync: (o: { secret: string }) => string };

describe('integration: account links (MFA, reset, logout)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let auth: AuthService;
  let tokens: OneTimeTokenService;
  let tenant: TenantContextService;
  let sendSpy: jest.SpyInstance;

  const stamp = Date.now();
  const organizationId = `org_auth_${stamp}`;
  const organizationCode = `AUTH-${stamp}`;
  const email = `staff.${stamp}@school.test`;
  const PASSWORD = 'Initial#Pass1';
  let userId = '';

  beforeAll(async () => {
    process.env.WEB_URL = 'http://web.test';
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: organizationCode, name: 'Auth School', currencyCode: 'UGX' },
    });

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AuthModule] }).compile();
    await moduleRef.init();
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(OneTimeTokenService);
    tenant = moduleRef.get(TenantContextService);
    sendSpy = jest.spyOn(moduleRef.get(NotificationsService), 'send');

    const passwordHash = await moduleRef.get(PasswordService).hash(PASSWORD);
    userId = (
      await raw.user.create({
        data: { organizationId, email, passwordHash, firstName: 'Staff', isActive: true },
      })
    ).id;
  });

  afterAll(async () => {
    sendSpy?.mockRestore();
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const whoami = () => ({ sub: userId, organizationId, email, permissions: [] }) as any;
  const asUser = <T>(fn: () => Promise<T>) => tenant.run({ organizationId, userId, permissions: [] }, fn);

  it('matches the login email case-insensitively', async () => {
    const res: any = await auth.login({ organizationCode, email: email.toUpperCase(), password: PASSWORD } as any);
    expect(res.accessToken).toBeTruthy();
  });

  it('an enrolled MFA user can sign in with a valid code (A1)', async () => {
    const { secret } = await asUser(() => auth.enrollMfa(whoami()));
    await asUser(() => auth.verifyMfaEnrollment(whoami(), generateSync({ secret })));

    const stored = await raw.user.findFirstOrThrow({ where: { id: userId } });
    expect(stored.mfaSecret).not.toBe(secret); // encrypted at rest
    expect(stored.mfaSecretIv).toBeTruthy();

    const step1: any = await auth.login({ organizationCode, email, password: PASSWORD } as any);
    expect(step1.mfaRequired ?? !!step1.mfaToken).toBeTruthy();
    const step2: any = await auth.mfaLogin({ mfaToken: step1.mfaToken, code: generateSync({ secret }) } as any);
    expect(step2.accessToken).toBeTruthy();

    // A wrong code is still refused.
    const again: any = await auth.login({ organizationCode, email, password: PASSWORD } as any);
    await expect(auth.mfaLogin({ mfaToken: again.mfaToken, code: '000000' } as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // Clean up so the remaining scenarios sign in with a password only.
    await raw.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaSecretIv: null, mfaSecretTag: null, mfaEnrolledAt: null, failedLoginCount: 0 },
    });
  });

  it('the reset email carries a working link and the stored row does not keep the token (A2)', async () => {
    sendSpy.mockClear();
    await tokens.requestReset(email, organizationCode);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0];
    const match = /\/reset-password\?token=([^&\s]+)/.exec(sent.body);
    expect(match).not.toBeNull();
    expect(sent.body.startsWith('Someone asked')).toBe(true);
    expect(JSON.stringify(sent.payload)).not.toContain(decodeURIComponent(match![1]));

    const row = await raw.notification.findFirstOrThrow({
      where: { organizationId, userId, category: 'auth' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.body).not.toContain(decodeURIComponent(match![1]));

    await tokens.applyReset(decodeURIComponent(match![1]), 'Changed#Pass2');
    const res: any = await auth.login({ organizationCode, email, password: 'Changed#Pass2' } as any);
    expect(res.accessToken).toBeTruthy();
  });

  it('logout revokes the refresh token, so refresh is 401', async () => {
    const res: any = await auth.login({ organizationCode, email, password: 'Changed#Pass2' } as any);
    await expect(auth.logout({ refreshToken: res.refreshToken } as any)).resolves.toEqual({ ok: true });
    await expect(auth.refresh({ refreshToken: res.refreshToken } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    // Idempotent and non-revealing for an unknown token.
    await expect(auth.logout({ refreshToken: 'not-a-token' } as any)).resolves.toEqual({ ok: true });
  });
});
