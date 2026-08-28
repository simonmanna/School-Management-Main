import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';

/**
 * The portal's HTTP client.
 *
 * Adapted from the admin app's rather than shared with it: the two run on
 * different origins with different stored sessions, and the admin client also
 * carries POS cashier attribution (`X-Pos-User`) that has no meaning here.
 * What IS worth keeping is the single-flight refresh — without it, a dashboard
 * that fires six queries on a stale token fires six refreshes and rotates the
 * refresh token out from under itself five times.
 */
function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (!raw) return '/api/v1';
  return `${raw.replace(/\/$/, '')}/api/v1`;
}

const baseURL = getApiBaseUrl();
export { getApiBaseUrl };

/** The organization every portal login belongs to. Preset, never typed by a parent. */
export const ORG_CODE: string = import.meta.env.VITE_ORG_CODE ?? 'DEMO';

/** Absolutize a server-minted asset path (PDFs, photos) onto the API origin. */
export function resolveAssetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  const origin = raw ? raw.replace(/\/$/, '') : '';
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

export const api = axios.create({
  baseURL,
  withCredentials: false,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Automatic refresh on 401 (single-flight) ----
let refreshing: Promise<string | null> | null = null;

async function refresh(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  try {
    const res = await axios.post<{ accessToken: string; refreshToken: string }>(
      `${baseURL}/auth/refresh`,
      { refreshToken },
    );
    useAuthStore.getState().setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;

    if (status === 401 && original && !original._retried) {
      original._retried = true;
      refreshing = refreshing ?? refresh().finally(() => { refreshing = null; });
      const token = await refreshing;
      if (token) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` };
        return api.request(original);
      }
      // Refresh failed: the session is genuinely over. The route guard will send
      // them to the login screen once the cleared store re-renders.
      return Promise.reject(error);
    }

    if (status === 403) {
      // A portal 403 is almost always "that is not your child / not your class",
      // which is a rule rather than a fault. Say so plainly.
      notify.error('You do not have access to that.');
    } else if (status && status >= 500) {
      notify.error('The school system is not responding. Please try again shortly.');
    } else if (!error.response) {
      notify.error('No connection. Check your internet and try again.');
    }

    return Promise.reject(error);
  },
);

/** The server's message for a failed request, or a sensible fallback. */
export function apiErrorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as AxiosError<{ message?: string | string[] }>;
  const msg = err?.response?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? fallback;
  return msg ?? fallback;
}
