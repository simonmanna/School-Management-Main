import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of a host-held secret. Fails closed when the env var
 * is unset or the caller sent nothing — an operator action is never reachable
 * by default.
 */
export function assertHostSecret(envName: string, provided: string | undefined, message: string): void {
  const expected = process.env[envName];
  if (!expected || !provided) throw new ForbiddenException(message);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException(message);
}

/**
 * Operator-only routes (audit 2026-09-29 A03).
 *
 * Whole-database backup, its schedule and its destinations belong to whoever
 * runs the host, not to any one school: the dump holds every tenant and the
 * scheduler is process-wide. No tenant role — not even a school Administrator —
 * can pass this guard; the caller must present `X-Operator-Secret` matching the
 * host's `OPERATOR_SECRET`.
 */
@Injectable()
export class OperatorSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest().headers?.['x-operator-secret'];
    assertHostSecret('OPERATOR_SECRET', Array.isArray(header) ? header[0] : header, 'Operator access is required');
    return true;
  }
}
