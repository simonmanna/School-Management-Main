import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { School, MailCheck } from 'lucide-react';
import { api, ORG_CODE } from '@/lib/api';
import { Button, Input, Card, CardContent } from '@/components/ui';

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? 'School Portal';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const request = useMutation({
    mutationFn: async () =>
      (await api.post('/auth/forgot-password', { organizationCode: ORG_CODE, email: email.trim().toLowerCase() })).data,
    // The endpoint always returns ok whether or not the address exists, so that
    // a stranger cannot use this form to discover which parents have accounts.
    // The UI has to keep that promise: same screen either way, including on
    // failure — a visible error for one address and not another would leak
    // exactly what the endpoint refuses to.
    onSettled: () => setSent(true),
  });

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center pb-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <School className="h-7 w-7" />
          </div>
          <h1 className="pt-4 text-2xl font-bold tracking-tight">{SCHOOL_NAME}</h1>
        </div>

        <Card>
          <CardContent>
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <MailCheck className="h-10 w-10 text-primary" />
                <p className="font-semibold">Check your email</p>
                <p className="text-sm text-muted-foreground">
                  If an account exists for {email.trim() || 'that address'}, a reset link is on its way.
                  It expires in 30 minutes.
                </p>
                <Link to="/login" className="pt-2 text-sm font-medium text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <>
                <h2 className="pb-1 text-lg font-semibold">Reset your password</h2>
                <p className="pb-4 text-sm text-muted-foreground">
                  Enter the email address the school has for you.
                </p>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    request.mutate();
                  }}
                >
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Button type="submit" size="lg" className="w-full" disabled={request.isPending}>
                    {request.isPending ? 'Sending…' : 'Send reset link'}
                  </Button>
                </form>
                <div className="pt-4 text-center">
                  <Link to="/login" className="text-sm font-medium text-primary hover:underline">
                    Back to sign in
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
