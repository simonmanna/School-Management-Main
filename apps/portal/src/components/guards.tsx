import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { usePortalContext } from '@/lib/portal-api';
import { Skeleton } from '@/components/ui';

/**
 * Route guards.
 *
 * The admin app's `ProtectedRoute` checks only that a token exists, which is why
 * any signed-in account there can type any URL and have the page render (the API
 * refuses the data, but the shell draws). The portal cannot work that way: a
 * guardian who lands on a teacher screen has not found a bug, they have found a
 * dead end, and the app should send them where they belong instead.
 *
 * None of this is a security boundary. The server decides what any token may
 * read; these guards decide what the app bothers to draw.
 */

/** A signed-in session, with the portal context loaded before anything renders. */
export function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setPortal = useAuthStore((s) => s.setPortal);
  const location = useLocation();

  const { data, isLoading, isError } = usePortalContext(!!accessToken);

  useEffect(() => {
    if (data) setPortal(data);
  }, [data, setPortal]);

  if (!accessToken) {
    // Remember where they were headed: a parent following a "your fees are due"
    // link should land on fees after signing in, not on the home screen.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  const cached = useAuthStore.getState().portal;
  if (isLoading && !cached) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  // A failed context call with nothing cached means we cannot tell who this is.
  // Signing them out is honest; guessing a workspace is not.
  if (isError && !cached) return <Navigate to="/login" replace />;

  return <Outlet />;
}

/** Send a signed-in session to the workspace the server says is theirs. */
export function LandingRedirect() {
  const portal = useAuthStore((s) => s.portal);
  if (!portal) return null;

  switch (portal.defaultLanding) {
    case 'parent':
      return <Navigate to="/parent" replace />;
    case 'student':
      return <Navigate to="/student" replace />;
    case 'teacher':
      return <Navigate to="/teacher" replace />;
    default:
      return <Navigate to="/no-access" replace />;
  }
}

/**
 * Keep an audience inside its own workspace.
 *
 * Staff are allowed everywhere: a member of staff who is also a teacher may
 * legitimately need to preview what a pupil sees, and the API still gates every
 * individual read.
 */
export function RequireAudience({ audience }: { audience: 'parent' | 'student' | 'teacher' }) {
  const portal = useAuthStore((s) => s.portal);
  if (!portal) return null;

  const permitted =
    (audience === 'parent' && portal.kind === 'guardian') ||
    (audience === 'student' && portal.kind === 'student') ||
    (audience === 'teacher' && (portal.kind === 'staff' || !!portal.teacher)) ||
    portal.kind === 'staff';

  if (!permitted) return <LandingRedirect />;
  return <Outlet />;
}
