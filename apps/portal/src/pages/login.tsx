import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { api, ORG_CODE, apiErrorMessage } from '@/lib/api';
import { useAuthStore, type LoginResponse } from '@/stores/auth.store';
import { Button, Input, Card, CardContent } from '@/components/ui';
import { SITE } from '@/site/content';
import { BrandBackdrop, Crest } from '@/site/components';

/**
 * The portal's front door — and the seam between the two halves of this app.
 *
 * The public website and the signed-in portal are one deployment, so this page
 * has to belong to both. On a wide screen it carries the school's own brand
 * panel, because a parent arriving from the home page should not feel they have
 * been handed off to some other system; on a phone that panel collapses and the
 * form takes the whole screen, because at that width nothing matters except the
 * two fields.
 *
 * Two fields, not three. The admin login asks for an organization code and
 * defaults it to "DEMO" — a guardian has no idea what that is, and asking them
 * turns a sign-in into a support call. The portal is built for one school, so
 * the code is baked in at build time (`VITE_ORG_CODE`).
 *
 * There is deliberately no "create an account" link either: portal accounts are
 * minted by the registrar against a real pupil or guardian record. Self-signup
 * would mean anyone could claim to be somebody's parent. The link out of here is
 * to the website's explanation of that, not to a sign-up form.
 */

/** Where a successful sign-in lands when there is no remembered destination. */
const LANDING = '/home';

const REASSURANCE = [
  'Fees, receipts and balances',
  'Attendance, day by day',
  'Results as they are published',
];

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const signedIn = useAuthStore((s) => !!s.accessToken);

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
      navigate(from ?? LANDING, { replace: true });
    },
    onError: (e) => setError(apiErrorMessage(e, 'Wrong email or password.')),
  });

  // Someone already signed in who navigates back to /login wants their portal,
  // not a second sign-in. The landing route asks the server where that is.
  if (signedIn) return <Navigate to={from ?? LANDING} replace />;

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ── Brand panel. Hidden on phones, where it would only push the form
             below the fold. ── */}
      <aside className="relative isolate hidden overflow-hidden bg-[hsl(var(--brand-deep))] text-white lg:flex lg:flex-col lg:justify-between">
        <BrandBackdrop className="text-white" />

        <div className="relative p-12">
          <Link to="/" className="inline-flex items-center gap-3">
            <Crest className="h-10 w-10 text-white" />
            <span className="font-display text-xl font-bold tracking-tight">{SITE.name}</span>
          </Link>
        </div>

        <div className="relative px-12 pb-4">
          <h2 className="max-w-md font-display text-4xl font-bold leading-[1.12] tracking-tight">
            Your child's school, in your pocket.
          </h2>
          <ul className="space-y-3 pt-8">
            {REASSURANCE.map((r) => (
              <li key={r} className="flex items-center gap-3 text-white/80">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {r}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative p-12">
          <p className="flex items-start gap-2.5 text-sm text-white/60">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            The school will never ask for your password by phone, SMS or email.
          </p>
        </div>
      </aside>

      {/* ── Form ── */}
      <div className="flex flex-col justify-center bg-background px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to the website
          </Link>

          <div className="flex flex-col items-center pb-6 text-center lg:hidden">
            <Crest className="h-12 w-12 text-primary" />
            <h1 className="pt-4 font-display text-2xl font-bold tracking-tight">{SITE.name}</h1>
          </div>

          <div className="hidden pb-6 lg:block">
            <h1 className="font-display text-3xl font-bold tracking-tight">Sign in</h1>
          </div>

          <p className="pb-6 text-center text-sm text-muted-foreground lg:text-left">
            Fees, attendance, results and coursework for your family.
          </p>

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
            Accounts are created by the school office. If you have not received an invite,{' '}
            <Link to="/portals" className="font-medium text-primary underline-offset-4 hover:underline">
              see how portal access works
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
