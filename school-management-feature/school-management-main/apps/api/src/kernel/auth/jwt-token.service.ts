import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  sub: string; // user id
  organizationId: string;
  email: string;
  permissions: string[];
}

export interface RefreshTokenPayload {
  sub: string;
  organizationId: string;
  type: 'refresh';
}

/** The shape attached to `req.auth` and returned by the @CurrentUser decorator. */
export type AuthUser = AccessTokenPayload;

@Injectable()
export class JwtTokenService {
  private readonly accessSecret = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me';
  private readonly refreshSecret = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me';
  private readonly accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
  private readonly refreshTtl = process.env.JWT_REFRESH_TTL ?? '7d';

  signAccess(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.accessSecret, { expiresIn: this.accessTtl as never });
  }

  signRefresh(payload: Omit<RefreshTokenPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'refresh' }, this.refreshSecret, {
      expiresIn: this.refreshTtl as never,
    });
  }

  verifyAccess(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, this.accessSecret) as AccessTokenPayload;
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
}
