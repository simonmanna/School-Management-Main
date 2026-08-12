import { Logger } from '@nestjs/common';

/**
 * D4-1: refuse-to-start guard. The previous JWT service silently fell back to
 * `dev-access-secret-change-me` if `JWT_ACCESS_SECRET` was unset — which meant
 * a misconfigured production deploy would accept forged tokens. Now boot fails
 * loudly instead.
 *
 * Call once at startup from `main.ts` before NestFactory.create().
 */

const PLACEHOLDER_SECRETS = new Set([
  'dev-access-secret-change-me',
  'dev-refresh-secret-change-me',
  '',
  'changeme',
  'secret',
  // Shipped as the docker-compose default until 2026-07-31. It is 44 chars, so
  // the length check alone waved it through — every deploy that never set the
  // env var shared one publicly-known signing key.
  'change-me-in-prod-32-chars-minimum-secret',
]);

/** Reject secrets that are long enough but obviously not secret. */
const WEAK_SECRET_PATTERNS = [/^change[-_ ]?me/i, /^please[-_ ]?change/i, /^your[-_ ]?secret/i];

const MIN_SECRET_LENGTH = 32;

export interface EnvValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateEnv(): EnvValidationResult {
  const errors: string[] = [];
  const logger = new Logger('EnvValidation');

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = process.env[key];
    if (!value) {
      errors.push(`${key} is not set`);
      continue;
    }
    if (PLACEHOLDER_SECRETS.has(value)) {
      errors.push(`${key} is set to a known development placeholder; refuse to start`);
    }
    if (WEAK_SECRET_PATTERNS.some((re) => re.test(value))) {
      errors.push(`${key} looks like an unedited placeholder; refuse to start`);
    }
    if (value.length < MIN_SECRET_LENGTH) {
      errors.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters long`);
    }
  }

  // Distinct secrets per token type. Sharing one key means a token minted for
  // one purpose verifies for another, which is exactly how a POS cashier token
  // became usable as a back-office access token.
  const access = process.env.JWT_ACCESS_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET;
  if (access && refresh && access === refresh) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }

  // Optional today so existing deploys keep booting; when set it must be a real,
  // distinct secret. Recommended in production — see JwtTokenService.signPos.
  const posSecret = process.env.JWT_POS_SECRET;
  if (posSecret) {
    if (posSecret.length < MIN_SECRET_LENGTH) {
      errors.push(`JWT_POS_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`);
    }
    if (PLACEHOLDER_SECRETS.has(posSecret) || WEAK_SECRET_PATTERNS.some((re) => re.test(posSecret))) {
      errors.push('JWT_POS_SECRET is set to a known placeholder; refuse to start');
    }
    if (posSecret === access) {
      errors.push('JWT_POS_SECRET must differ from JWT_ACCESS_SECRET');
    }
  } else if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'JWT_POS_SECRET is not set — POS cashier tokens are signed with JWT_ACCESS_SECRET. Set a distinct secret.',
    );
  }

  // Database URL is required.
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set');
  }

  // Communication — the WhatsApp Baileys transport persists linked-device session
  // creds; they are AES-256-GCM encrypted at rest with COMM_ENCRYPTION_KEY. A DB
  // dump must not be a session takeover, so the key is mandatory when that
  // transport is enabled. Must be 32 bytes, base64 (`openssl rand -base64 32`).
  const commEnabled = process.env.ENABLE_COMMUNICATION === 'true';
  const waEnabled = commEnabled && process.env.ENABLE_COMMUNICATION_WHATSAPP === 'true';
  if (waEnabled && process.env.WHATSAPP_TRANSPORT === 'baileys') {
    const key = process.env.COMM_ENCRYPTION_KEY;
    if (!key) {
      errors.push('COMM_ENCRYPTION_KEY is required when the Baileys WhatsApp transport is enabled');
    } else {
      let bytes = 0;
      try {
        bytes = Buffer.from(key, 'base64').length;
      } catch {
        bytes = 0;
      }
      if (bytes !== 32) {
        errors.push('COMM_ENCRYPTION_KEY must decode to exactly 32 bytes (base64) for AES-256-GCM');
      }
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      logger.error(err);
    }
    return { ok: false, errors };
  }

  return { ok: true, errors: [] };
}