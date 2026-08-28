import { useNavigate } from 'react-router-dom';
import { ShieldQuestion } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { Button, Card, CardContent } from '@/components/ui';

/**
 * Signed in, but not connected to anybody.
 *
 * This is a real and recoverable state, not an error: a staff login with no
 * teacher record, or an account whose portal identity was revoked while they
 * were away. Saying so plainly beats bouncing them around an empty app.
 */
export function NoAccessPage() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex min-h-dvh flex-col justify-center px-4 py-10">
      <Card className="mx-auto w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <ShieldQuestion className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Nothing to show yet</p>
          <p className="text-sm text-muted-foreground">
            {user?.email} is signed in, but it is not linked to a pupil or a teaching record.
            Ask the school office to connect your account.
          </p>
          <Button
            variant="outline"
            className="mt-2 w-full"
            onClick={() => {
              clear();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
