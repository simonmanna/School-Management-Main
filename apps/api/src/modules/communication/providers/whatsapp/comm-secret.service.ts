import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for communication secrets (Baileys session creds, provider tokens).
 *
 * Deliberately keyed off a DEDICATED `COMM_ENCRYPTION_KEY` rather than the kernel
 * EncryptionService (which derives from JWT_ACCESS_SECRET): a WhatsApp session is
 * a live account takeover if leaked, so it must not share a fate with the JWT
 * secret, and the key can be rotated independently. Output format is the single
 * string `iv:tag:ciphertext` (all base64), matching WhatsAppAuthState.valueEnc.
 *
 * The key is read lazily (not in the constructor) so the module loads even when
 * COMM_ENCRYPTION_KEY is unset — only the Baileys transport, gated behind its own
 * flag + an env check in validateEnv, ever calls encrypt/decrypt.
 */
@Injectable()
export class CommSecretService {
  private static readonly ALGO = 'aes-256-gcm';
  private static readonly IV_BYTES = 12;
  private cachedKey: Buffer | null = null;

  private key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = process.env.COMM_ENCRYPTION_KEY;
    if (!raw) throw new Error('COMM_ENCRYPTION_KEY is not set — cannot encrypt communication secrets.');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('COMM_ENCRYPTION_KEY must decode to 32 bytes (base64).');
    this.cachedKey = key;
    return key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(CommSecretService.IV_BYTES);
    const cipher = createCipheriv(CommSecretService.ALGO, this.key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ctB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed communication ciphertext.');
    const decipher = createDecipheriv(CommSecretService.ALGO, this.key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
