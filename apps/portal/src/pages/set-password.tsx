import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { School, CheckCircle2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Button, Input, Card, CardContent } from '@/components/ui';

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? 'School Portal';

/**
 * Choosing a password — for a new invite, and for a reset.
 *
 * Both flows are the same screen because they are the same act: the caller holds
 * a one-time token and nothing else, and hands back a password. Only the endpoint
 * and the wording differ. Neither had any UI at all before this — the endpoints
 * shipped, the emails went out, and there was nowhere for the link to land.
 */
export function SetPasswordPage({ mode }: { mode: 'invite' | 'reset' }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const endpoint = mode === 'invite' ? '/auth/accept-invite' : '/auth/reset-password';

  const submit = useMutation({
    mutationFn: async () => (await api.post(endpoint, { token, newPassword: password })).data,
    onSuccess: () => setDone(true),
    onError: (e) =>
      setError(
        apiErrorMessage(
          e,
          mode === 'invite'
            ? 'That invite link is no longer valid. Ask the school office to send a new one.'
            : 'That reset link is no longer valid. Request a new one.',
        ),
      ),
  });

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !!token && password.length >= 8 && password === confirm && !submit.isPending;

  if (done) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-[hsl(var(--success))]" />
            <p className="font-semibold">Your password is set.</p>
            <p className="text-sm text-muted-foreground">
              {mode === 'invite'
                ? 'Your account is now active. Sign in to see your school portal.'
                : 'You can sign in with your new password.'}
            </p>
            <Button className="mt-2 w-full" size="lg" onClick={() => navigate('/login', { replace: true })}>
              Sign in
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // A link with no token is a mangled email, which is common enough to name.
  if (!token) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="font-semibold">This link is incomplete.</p>
            <p className="text-sm text-muted-foreground">
              Email programs sometimes cut long links in half. Try opening it again from the
              original message, or ask the school office to send another.
            </p>
            <Link to="/login" className="inline-block pt-2 text-sm font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardContent>
          <h2 className="pb-1 text-lg font-semibold">
            {mode === 'invite' ? 'Choose your password' : 'Set a new password'}
          </h2>
          <p className="pb-4 text-sm text-muted-foreground">
            {mode === 'invite'
              ? 'This activates your account. Nobody at the school can see what you choose.'
              : 'Signing in again on your other devices will be required.'}
          </p>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              submit.mutate();
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="pw" className="text-sm font-medium">New password</label>
              <Input
                id="pw"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className={tooShort ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                At least 8 characters.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pw2" className="text-sm font-medium">Type it again</label>
              <Input
                id="pw2"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && <p className="text-xs text-destructive">These do not match.</p>}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
              {submit.isPending ? 'Saving…' : 'Save password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center pb-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <School className="h-7 w-7" />
          </div>
          <h1 className="pt-4 text-2xl font-bold tracking-tight">{SCHOOL_NAME}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
