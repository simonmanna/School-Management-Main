import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth.store';
import { getPosToken } from '@/features/pos/pos-session';
import { notify } from '@/lib/notify';

function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (!raw) return '/api/v1';
  return `${raw.replace(/\/$/, '')}/api/v1`;
}

const baseURL = getApiBaseUrl();
export { getApiBaseUrl };

/**
 * Absolutize a server-provided asset path (e.g. a signed file download URL) so
 * it loads from the API origin, not the web dev-server origin.
 *
 * The API mints image URLs as relative paths like `/api/v1/files/:id/download`.
 * When VITE_API_URL points at a different origin (dev: API on :3000, web on
 * :5173) and there is no proxy, an <img src="/api/v1/..."> would hit :5173 and
 * 404. Prefix the API origin in that case. Already-absolute (http) URLs and the
 * proxy case (no VITE_API_URL) pass through unchanged.
 */
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
  // Attribute POS requests to the cashier who PINned in (the backend overrides
  // the request identity from this token; the bearer JWT still bounds the org).
  const posToken = getPosToken();
  if (posToken) {
    config.headers = config.headers ?? {};
    config.headers['X-Pos-User'] = posToken;
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
  async (err: AxiosError) => {
    const status = err.response?.status;
    const original = err.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (status === 401 && original && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true;
      refreshing = refreshing ?? refresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return api.request(original);
      }
    }
    if (status === 403) notify.error('Permission denied');
    if (status && status >= 500) notify.error('Server error — please retry');
    if (!status) notify.error('Network error — please check your connection');
    throw err;
  },
);
