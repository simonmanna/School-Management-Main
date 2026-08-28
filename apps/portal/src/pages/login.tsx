import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { School, Eye, EyeOff } from 'lucide-react';
import { api, ORG_CODE, apiErrorMessage } from '@/lib/api';
import { useAuthStore, type LoginResponse } from '@/stores/auth.store';
import { Button, Input, Card, CardContent } from '@/components/ui';

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? 'School Portal';

/**
 * The portal's front door.
 *
 * Two fields, not three. The admin login asks for an organization code and
 * defaults it to "DEMO" — a guardian has no idea what that is, and asking them
 * turns a sign-in into a support call. The portal is built for one school, so
 * the code is baked in at build time (`VITE_ORG_CODE`).
 *
 * There is deliberately no "create an account" link either: portal accounts are
 * minted by the registrar against a real pupil or guardian record. Self-signup
 * would mean anyone could claim to be somebody's parent.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from;

  const login = useMutation({
    mutationFn: async () =>
      (
        await api.post<LoginResponse | { mfaToken: string; requiresMfa: true }>('/auth/login', {
          organizationCode: ORG_CODE,
          email: email.trim().toLowerCase(),
          password,
        })
      ).data,
    onSuccess: (data) => {
      if ('requiresMfa' in data) {
        // Portal accounts do not enrol in TOTP, but a member of staff signing in
        // here might have. Say so rather than failing silently.
        setError('This account uses two-factor authentication. Please sign in through the staff app.');
        return;
      }
      setSession(data);
      navigate(from ?? '/', { replace: true });
    },
    onError: (e) => setError(apiErrorMessage(e, 'Wrong email or password.')),
  });

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center pb-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <School className="h-7 w-7" />
          </div>
          <h1 className="pt-4 text-2xl font-bold tracking-tight">{SCHOOL_NAME}</h1>
          <p className="pt-1 text-sm text-muted-foreground">
            Sign in to see fees, attendance, results and coursework.
          </p>
        </div>

        <Card>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                login.mutate();
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="pt-4 text-center">
              <Link to="/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Forgot your password?
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="pt-6 text-center text-xs text-muted-foreground">
          Accounts are created by the school office. If you have not received an invite,
          contact the school.
        </p>
      </div>
    </div>
  );
}
