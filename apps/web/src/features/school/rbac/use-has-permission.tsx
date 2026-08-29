import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Client-side permission guard. Reads the permission array the auth store
 * already holds for the logged-in user (populated from the login response), so
 * this is a pure synchronous check — no network call.
 */
export function useHasPermission(permission: string): boolean {
  return useAuthStore((s) => s.permissions.includes(permission));
}

/** True if the user holds ANY of the supplied permission keys. */
export function useHasAnyPermission(permissions: string[]): boolean {
  const perms = useAuthStore((s) => s.permissions);
  return permissions.some((p) => perms.includes(p));
}

/**
 * Declarative wrapper: renders `children` only when the current user holds
 * `permission`, otherwise `fallback` (null by default). Use it to hide nav
 * links, buttons or whole sections the user lacks access to.
 */
export function Protected({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useHasPermission(permission);
  return <>{allowed ? children : fallback}</>;
}
