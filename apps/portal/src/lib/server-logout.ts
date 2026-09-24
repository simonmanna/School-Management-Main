import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Revoke this session's refresh token on the server (`POST /auth/logout`).
 *
 * Sign-out used to only drop the tokens from local storage, so a refresh token
 * copied off the device stayed valid for its whole lifetime. The token is read
 * synchronously, so callers can clear the store straight after calling this.
 * Best-effort: an offline sign-out still signs out locally.
 */
export function serverLogout(): void {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return;
  void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
}
