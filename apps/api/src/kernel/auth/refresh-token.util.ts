import { createHash, randomBytes } from 'node:crypto';

/**
 * D4-4: refresh-token rotation helper. We persist only the SHA-256 hash of
 * the token, never the raw value. The token returned to the client is the raw
 * value; on refresh we hash and look up.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshTokenValue(): { value: string; hash: string; expiresAt: Date } {
  const value = randomBytes(48).toString('base64url');
  const hash = hashRefreshToken(value);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d
  return { value, hash, expiresAt };
}