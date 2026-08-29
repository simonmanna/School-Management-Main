import { SetMetadata } from '@nestjs/common';

export const NO_PERMISSION_REQUIRED_KEY = 'noPermissionRequired';

/**
 * Explicitly marks a handler as not requiring any permission (session-only).
 *
 * Greppable opt-out for the route-permission-coverage ledger. MUST carry a
 * non-empty reason — a bare `@NoPermissionRequired()` is rejected at runtime by
 * the coverage spec, because an undecorated handler is a gap, not a decision.
 *
 * Use only for routes that are genuinely safe for any authenticated user in the
 * tenant (e.g. `GET /auth/me`, health). Everything else should declare
 * `@RequirePermissions`, `@Public`, or this with a reason.
 */
export const NoPermissionRequired = (reason: string) => {
  if (!reason || !reason.trim()) {
    throw new Error('NoPermissionRequired requires a non-empty reason');
  }
  return SetMetadata(NO_PERMISSION_REQUIRED_KEY, reason);
};
