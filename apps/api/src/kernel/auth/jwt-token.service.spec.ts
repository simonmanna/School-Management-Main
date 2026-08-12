import { UnauthorizedException } from '@nestjs/common';
import { JwtTokenService } from './jwt-token.service';

/**
 * Token-type confinement.
 *
 * The regression these lock down: POS cashier tokens were signed with the
 * access secret and `verifyAccess` never inspected the `type` claim, so a POS
 * token — minted from a 4-digit PIN, valid 12h, carrying the cashier's full
 * aggregated role permissions — was accepted as a back-office access token.
 * A low-assurance credential stood in for a high-assurance one.
 */
describe('JwtTokenService — token type confinement', () => {
  const ACCESS = 'test-access-secret-at-least-32-chars-long';
  const REFRESH = 'test-refresh-secret-at-least-32-chars-long';
  const POS = 'test-pos-secret-at-least-32-characters-long';

  const cashier = {
    sub: 'user-1',
    organizationId: 'org-1',
    email: 'cashier@example.com',
    permissions: ['pos:read', 'pos:write'],
  };

  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    process.env.JWT_ACCESS_SECRET = ACCESS;
    process.env.JWT_REFRESH_SECRET = REFRESH;
    delete process.env.JWT_POS_SECRET;
  });

  afterEach(() => {
    process.env = saved;
  });

  /** Secrets are read in the constructor, so build after mutating env. */
  const build = () => new JwtTokenService();

  it('rejects a POS token presented as an access token', () => {
    const svc = build();
    const posToken = svc.signPos(cashier);

    expect(() => svc.verifyAccess(posToken)).toThrow(UnauthorizedException);
  });

  it('still rejects a POS token when JWT_POS_SECRET gives it its own key', () => {
    process.env.JWT_POS_SECRET = POS;
    const svc = build();
    const posToken = svc.signPos(cashier);

    expect(() => svc.verifyAccess(posToken)).toThrow(UnauthorizedException);
    // ...and remains valid on its own path.
    expect(svc.verifyPos(posToken).sub).toBe('user-1');
  });

  it('rejects a refresh token presented as an access token', () => {
    const svc = build();
    const refreshToken = svc.signRefresh({ sub: 'user-1', organizationId: 'org-1' });

    expect(() => svc.verifyAccess(refreshToken)).toThrow(UnauthorizedException);
  });

  it('accepts a genuine access token and stamps it with type=access', () => {
    const svc = build();
    const token = svc.signAccess(cashier);
    const decoded = svc.verifyAccess(token);

    expect(decoded.sub).toBe('user-1');
    expect(decoded.type).toBe('access');
  });

  it('accepts a legacy access token that predates the type claim', () => {
    // Tokens minted before `type` existed must keep working until they expire,
    // otherwise deploying the fix logs every signed-in user out.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jwt = require('jsonwebtoken');
    const legacy = jwt.sign(cashier, ACCESS, { expiresIn: '15m' });
    const svc = build();

    expect(svc.verifyAccess(legacy).sub).toBe('user-1');
  });

  it('does not accept an access token on the POS path', () => {
    const svc = build();
    const accessToken = svc.signAccess(cashier);

    expect(() => svc.verifyPos(accessToken)).toThrow();
  });

  it('signs POS tokens with JWT_POS_SECRET when set, so the access key cannot verify them', () => {
    process.env.JWT_POS_SECRET = POS;
    const posToken = build().signPos(cashier);

    // A service that only knows the access secret must not be able to read it.
    delete process.env.JWT_POS_SECRET;
    expect(() => build().verifyPos(posToken)).toThrow();
  });
});
