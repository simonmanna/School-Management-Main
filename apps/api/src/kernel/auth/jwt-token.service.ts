import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  sub: string; // user id
  organizationId: string;
  email: string;
  permissions: string[];
  /**
   * Optional on the interface because tokens minted before this claim existed
   * are still valid until they expire. `verifyAccess` rejects a *mismatched*
   * type but tolerates a missing one — see the note there.
   */
  type?: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  organizationId: string;
  type: 'refresh';
}

/**
 * Short-lived POS cashier token. Minted by `pinLogin` and sent on the
 * `X-Pos-User` header so the server can attribute POS writes to the cashier who
 * PINned in — distinct from the back-office user whose JWT opened the terminal.
 */
export interface PosTokenPayload {
  sub: string; // cashier user id
  organizationId: string;
  email: string;
  permissions: string[];
  type: 'pos';
}

/** The shape attached to `req.auth` and returned by the @CurrentUser decorator. */
export type AuthUser = AccessTokenPayload;

@Injectable()
export class JwtTokenService {
  private readonly accessSecret!: string;
  private readonly refreshSecret!: string;
  private readonly posSecret!: string;
  private readonly accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
  private readonly refreshTtl = process.env.JWT_REFRESH_TTL ?? '7d';
  // A POS shift fits comfortably inside 12h; re-PIN is required after.
  private readonly posTtl = process.env.JWT_POS_TTL ?? '12h';

  constructor() {
    if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET env var is required');
    if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET env var is required');
    this.accessSecret = process.env.JWT_ACCESS_SECRET;
    this.refreshSecret = process.env.JWT_REFRESH_SECRET;
    // Defense in depth: a dedicated POS secret makes a POS token structurally
    // unusable as an access token even if a `type` check is ever lost. Falls
    // back to the access secret so setting it is a no-downtime opt-in — once
    // set, cashiers re-PIN at their next shift.
    this.posSecret = process.env.JWT_POS_SECRET || process.env.JWT_ACCESS_SECRET;
  }

  signAccess(payload: AccessTokenPayload): string {
    return jwt.sign({ ...payload, type: 'access' }, this.accessSecret, {
      expiresIn: this.accessTtl as never,
    });
  }

  signRefresh(payload: Omit<RefreshTokenPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'refresh' }, this.refreshSecret, {
      expiresIn: this.refreshTtl as never,
    });
  }

  /**
   * Verify a back-office access token.
   *
   * The `type` check is load-bearing. POS cashier tokens are signed with the
   * same secret by default (see {@link signPos}) and carry the cashier's full
   * aggregated role permissions for 12h, so without it a 4-digit PIN would mint
   * a long-lived full-API bearer token — a lower-assurance credential standing
   * in for a higher-assurance one.
   *
   * A *missing* `type` is accepted so access tokens minted before this claim
   * existed keep working until they expire (15m); a *mismatched* one never is.
   */
  verifyAccess(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.accessSecret) as AccessTokenPayload;
      if (decoded.type !== undefined && decoded.type !== 'access') {
        throw new Error('wrong token type');
      }
      return decoded;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  verifyRefresh(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, this.refreshSecret) as RefreshTokenPayload;
      if (decoded.type !== 'refresh') throw new Error('wrong token type');
      return decoded;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /** Sign a POS cashier token (`JWT_POS_SECRET` if set, else the access secret). */
  signPos(payload: Omit<PosTokenPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'pos' }, this.posSecret, {
      expiresIn: this.posTtl as never,
    });
  }

  /** Verify a POS cashier token. Throws on an invalid/expired/wrong-type token. */
  verifyPos(token: string): PosTokenPayload {
    const decoded = jwt.verify(token, this.posSecret) as PosTokenPayload;
    if (decoded.type !== 'pos') throw new Error('wrong token type');
    return decoded;
  }
}
