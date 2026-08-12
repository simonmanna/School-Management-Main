import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM field-level encryption (Phase B1 hardening).
 *
 * Used to encrypt at-rest secrets that the DB itself does not protect:
 *   - User.mfaSecret (TOTP seeds)
 *   - ApiKey raw values
 *   - Webhook signing secrets at rest (in addition to DB column ACLs)
 *
 * Key derivation: scryptSync(JWT_ACCESS_SECRET, salt, 32). Salt is a fixed,
 * versioned constant — the JWT secret itself is rotated by redeploying with a
 * new secret; we accept re-encrypt overhead during that window. For KMS-backed
 * production, swap the `deriveKey` call for a `KMS.decrypt` lookup.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger('EncryptionService');
  private readonly key: Buffer;
  private static readonly SALT = Buffer.from('erp-platform-v1-encryption-salt-do-not-change', 'utf8');
  private static readonly ALGO = 'aes-256-gcm';
  private static readonly IV_BYTES = 12;
  private static readonly VERSION = 'v1';

  constructor() {
    const secret = process.env.JWT_ACCESS_SECRET ?? process.env.ENCRYPTION_KEY;
    if (!secret) {
      throw new Error(
        'EncryptionService requires JWT_ACCESS_SECRET or ENCRYPTION_KEY to derive its key. Refusing to start.',
      );
    }
    this.key = scryptSync(secret, EncryptionService.SALT, 32);
  }

  /** Returns `{ ciphertext, iv, tag }` — all base64-encoded. */
  encrypt(plaintext: string | null | undefined): { ciphertext: string; iv: string; tag: string } | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = randomBytes(EncryptionService.IV_BYTES);
    const cipher = createCipheriv(EncryptionService.ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([Buffer.from(EncryptionService.VERSION), ct]).toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  /** Inverse of encrypt. Returns null when any input is null. Throws on tamper. */
  decrypt(payload: { ciphertext: string; iv: string; tag: string } | null | undefined): string | null {
    if (!payload) return null;
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const raw = Buffer.from(payload.ciphertext, 'base64');
    if (raw.length < 3 || raw.subarray(0, 3).toString('utf8') !== EncryptionService.VERSION) {
      throw new Error('Encrypted payload has unknown version; cannot decrypt');
    }
    const ct = raw.subarray(3);
    const decipher = createDecipheriv(EncryptionService.ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }
}
