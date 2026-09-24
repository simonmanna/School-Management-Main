import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Staff "choose a password" — landing page for the invite and reset emails.
 *
 * `POST /users/invite` and `POST /auth/forgot-password` email links to
 * `${WEB_URL}/accept-invite?token=…` and `${WEB_URL}/reset-password?token=…`,
 * but the web app had neither route, so every invited staff member and every
 * forgotten password hit the login screen with nothing to do (E2E audit A3).
 * Same act for both flows — the holder of a one-time token hands back a
 * password — so one screen, two endpoints. Modelled on the portal's page.
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
    onError: (e: unknown) => {
      const message = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setError(
        (Array.isArray(message) ? message.join(' ') : message) ??
          (mode === 'invite'
            ? 'That invite link is no longer valid. Ask your administrator to send a new one.'
            : 'That reset link is no longer valid. Request a new one from the sign-in page.'),
      );
    },
  });

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !!token && password.length >= 8 && password === confirm && !submit.isPending;

  if (done) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="font-semibold">Your password is set.</p>
            <p className="text-sm text-muted-foreground">
              {mode === 'invite'
                ? 'Your account is now active. Sign in with your school code and email.'
                : 'Sign in with your new password. Other devices have been signed out.'}
            </p>
            <Button className="mt-2 w-full" onClick={() => navigate('/login', { replace: true })}>
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
              Email programs sometimes cut long links in half. Open it again from the original message, or ask for a
              new one.
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
        <CardContent className="pt-6">
          <h2 className="pb-1 text-lg font-semibold">
            {mode === 'invite' ? 'Choose your password' : 'Set a new password'}
          </h2>
          <p className="pb-4 text-sm text-muted-foreground">
            {mode === 'invite'
              ? 'This activates your account. Nobody else can see what you choose.'
              : 'You will need to sign in again on your other devices.'}
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
              <Label htmlFor="pw">New password</Label>
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
              <Label htmlFor="pw2">Type it again</Label>
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
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {submit.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save password
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
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="h-6 w-6" />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
