import { Injectable, Logger } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';

/**
 * Phase B1: TOTP (RFC 6238) MFA service. Backed by `otplib` v13.
 *
 * The `mfaSecret` is stored on `User.mfaSecret`. In production this should
 * itself be encrypted with a KMS-managed key (Phase F's "field-level
 * encryption"); for the beta it's stored plaintext — adequate behind
 * field-level DB access controls.
 *
 * Algorithm: SHA1, 6 digits, 30-second window. Compatible with Google
 * Authenticator / Authy / 1Password etc.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger('MfaService');
  private readonly issuer = process.env.MFA_ISSUER ?? 'ERP Platform';

  /** Generate a fresh TOTP secret (base32, 20 chars). */
  generateSecret(): string {
    return generateSecret();
  }

  /** Build the otpauth:// URI + a data-URL QR code PNG for enrollment. */
  async buildEnrollmentQr(
    userEmail: string,
    secret: string,
  ): Promise<{ uri: string; qrDataUrl: string }> {
    const uri = generateURI({ strategy: 'totp', secret, label: userEmail, issuer: this.issuer });
    const qrDataUrl = await qrcode.toDataURL(uri);
    return { uri, qrDataUrl };
  }

  /** Verify a 6-digit code against the stored secret. */
  verify(secret: string, code: string): boolean {
    if (!secret || !code) return false;
    try {
      // verifySync allows a ±1 step window (90s) to tolerate clock skew.
      const result = verifySync({ token: code.replace(/\s+/g, ''), secret });
      return result.valid === true;
    } catch (err) {
      this.logger.warn(`TOTP verify failed: ${String(err)}`);
      return false;
    }
  }
}