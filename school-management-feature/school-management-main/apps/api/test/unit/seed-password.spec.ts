/**
 * Unit tests for the seed admin password resolver (P0-11, C-3).
 *
 * Bug: the seed script hard-coded 'Admin@123' in source AND the login
 * UI pre-filled the same value. A shipping mistake that included the
 * seed file in a production migration — or a leaked screenshot of the
 * login page — gave an attacker a working credentials pair.
 *
 * Fix: read the seed password from the SEED_ADMIN_PASSWORD env var.
 * Refuse to seed an admin in production if the env var is unset.
 * In dev/test, fall back to the documented dev default so local
 * smoke scripts keep working. Also remove pre-filled values from
 * the login UI.
 */
import { resolveSeedAdminPassword } from '../../prisma/seed';

describe('resolveSeedAdminPassword (P0-11, C-3)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    // Restore env between tests.
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns SEED_ADMIN_PASSWORD when set (production-safe)', () => {
    process.env.SEED_ADMIN_PASSWORD = 'S3cret!From-Vault-2026';
    process.env.NODE_ENV = 'production';
    expect(resolveSeedAdminPassword()).toBe('S3cret!From-Vault-2026');
  });

  it('returns SEED_ADMIN_PASSWORD when set (dev too)', () => {
    process.env.SEED_ADMIN_PASSWORD = 'dev-only-pw';
    process.env.NODE_ENV = 'development';
    expect(resolveSeedAdminPassword()).toBe('dev-only-pw');
  });

  it('throws in production if SEED_ADMIN_PASSWORD is not set', () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    process.env.NODE_ENV = 'production';
    expect(() => resolveSeedAdminPassword()).toThrow(
      /SEED_ADMIN_PASSWORD is required when NODE_ENV=production/,
    );
  });

  it('falls back to the dev default in development', () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    expect(resolveSeedAdminPassword()).toBe('Admin@123');
  });

  it('falls back to the dev default in test', () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    process.env.NODE_ENV = 'test';
    expect(resolveSeedAdminPassword()).toBe('Admin@123');
  });

  it('falls back to the dev default when NODE_ENV is unset', () => {
    delete process.env.SEED_ADMIN_PASSWORD;
    delete process.env.NODE_ENV;
    expect(resolveSeedAdminPassword()).toBe('Admin@123');
  });

  it('does not log or print the password in the resolver', () => {
    process.env.SEED_ADMIN_PASSWORD = 'S3cret!From-Vault-2026';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = resolveSeedAdminPassword();
    expect(result).toBe('S3cret!From-Vault-2026');
    // No console.log should have been called from the resolver itself.
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
