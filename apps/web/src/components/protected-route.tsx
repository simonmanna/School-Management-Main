import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { routePermission, satisfies } from '@/components/layout/app-shell';
import { useAuthStore } from '@/stores/auth.store';

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { pathname } = useLocation();
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }
  const required = routePermission(pathname);
  if (required && !satisfies(required, hasPermission)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">You do not have access to this page</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          It needs the <code>{typeof required === 'string' ? required : required.join(' or ')}</code> permission. Ask an administrator if you should have it.
        </p>
      </div>
    );
  }
  return <Outlet />;
}
