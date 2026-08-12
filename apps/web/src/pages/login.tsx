// src/pages/LoginPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Building2, Eye, EyeOff, KeyRound, Loader2, LogIn, Mail, Monitor, Calendar, FileText, Coffee, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';

// CSS Styles
const styles = `
  .login-root {
    --amber: 38 92% 50%;
    --amber-lite: 43 96% 56%;
    background:
      radial-gradient(1200px 600px at 15% -10%, hsl(230 70% 22% / 0.55), transparent 60%),
      radial-gradient(1000px 700px at 110% 20%, hsl(20 90% 30% / 0.35), transparent 55%),
      radial-gradient(900px 900px at 50% 120%, hsl(260 70% 25% / 0.45), transparent 60%),
      #070b18;
    color: #e7ecf5;
  }

  /* animated aurora sheet */
  .aurora {
    position: absolute; inset: -20%;
    background:
      conic-gradient(from 120deg at 30% 30%, hsl(217 91% 60% / 0.30), transparent 40%),
      conic-gradient(from 300deg at 70% 60%, hsl(38 92% 50% / 0.28), transparent 45%),
      conic-gradient(from 200deg at 50% 80%, hsl(275 80% 60% / 0.25), transparent 40%);
    filter: blur(60px);
    animation: aurora-spin 24s linear infinite;
  }

  /* moving perspective grid */
  .grid-floor {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(hsl(217 60% 70% / 0.08) 1px, transparent 1px),
      linear-gradient(90deg, hsl(217 60% 70% / 0.08) 1px, transparent 1px);
    background-size: 46px 46px;
    mask-image: radial-gradient(circle at 50% 40%, black, transparent 75%);
    -webkit-mask-image: radial-gradient(circle at 50% 40%, black, transparent 75%);
    animation: grid-pan 20s linear infinite;
  }

  .glass-card {
    background: linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 30px 80px -20px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.15);
  }

  /* animated glowing border ring behind the card */
  .glow-ring::before {
    content: '';
    position: absolute; inset: -1px;
    border-radius: 1.6rem;
    padding: 1px;
    background: conic-gradient(from var(--a, 0deg),
      hsl(217 91% 60%), hsl(38 92% 55%), hsl(275 80% 62%), hsl(217 91% 60%));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    opacity: 0.55;
    animation: ring-rotate 8s linear infinite;
  }

  .btn-shine { position: relative; overflow: hidden; }
  .btn-shine::before {
    content: ''; position: absolute; top: 0; left: -120%; width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
    transition: left 0.55s ease;
  }
  .btn-shine:hover::before { left: 120%; }

  .float-slow { animation: float 9s ease-in-out infinite; }

  .text-gradient {
    background: linear-gradient(135deg, hsl(217 91% 68%), hsl(38 96% 60%));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }

  /* rising coffee steam / spark particles */
  .steam { position: absolute; bottom: -12px; width: 8px; height: 8px; border-radius: 999px;
    background: radial-gradient(circle, hsl(38 96% 62% / 0.9), transparent 70%);
    animation: rise linear infinite; }

  .field-in { animation: field-in 0.5s cubic-bezier(.2,.8,.2,1) both; }

  @keyframes aurora-spin { to { transform: rotate(360deg); } }
  @keyframes grid-pan { to { background-position: 0 46px, 46px 0; } }
  @keyframes ring-rotate { to { --a: 360deg; } }
  @keyframes float {
    0%,100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-22px) rotate(6deg); }
  }
  @keyframes rise {
    0% { transform: translateY(0) scale(0.6); opacity: 0; }
    15% { opacity: 0.9; }
    100% { transform: translateY(-220px) scale(1.4); opacity: 0; }
  }
  @keyframes field-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  @property --a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
`;

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; firstName: string; lastName: string | null; roles: string[] };
  permissions: string[];
  organization?: { id: string; code: string; name: string; currencyCode: string; timezone: string };
}

type View = 'login' | 'mfa' | 'forgot' | 'forgot-sent';

export function LoginPage() {
  const [view, setView] = useState<View>('login');
  const [orgCode, setOrgCode] = useState('DEMO');
  const [email, setEmail] = useState('admin@demo.test');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const login = useMutation({
    mutationFn: async () =>
      (await api.post<LoginResponse>('/auth/login', { organizationCode: orgCode, email, password })).data,
    onSuccess: (data) => {
      if ((data as any).requiresMfa) {
        setMfaToken((data as any).mfaToken);
        setView('mfa');
        return;
      }
      setSession(data);
      notify.success(`Welcome back, ${data.user.firstName}`);
      navigate('/');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Sign in failed'),
  });

  const mfa = useMutation({
    mutationFn: async () =>
      (await api.post<LoginResponse>('/auth/mfa-login', { mfaToken, code: mfaCode })).data,
    onSuccess: (data) => {
      setSession(data);
      notify.success(`Welcome back, ${data.user.firstName}`);
      navigate('/');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Invalid MFA code'),
  });

  const forgot = useMutation({
    mutationFn: async () => (await api.post('/auth/forgot-password', { organizationCode: orgCode, email })).data,
    onSuccess: () => setView('forgot-sent'),
    onError: () => setView('forgot-sent'),
  });

  return (
    <>
      <style>{styles}</style>
      <div className="login-root flex min-h-screen items-center justify-center p-4 relative overflow-hidden">
        {/* Ambient layers */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="aurora" />
          <div className="grid-floor" />
          <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl float-slow" />
          <div className="absolute -right-24 bottom-12 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl float-slow" style={{ animationDelay: '2s' }} />
          <div className="absolute right-1/3 top-1/4 h-48 w-48 rounded-full bg-indigo-500/15 blur-3xl float-slow" style={{ animationDelay: '4s' }} />
        </div>

        <div className="relative w-full max-w-5xl grid md:grid-cols-2 gap-6 items-stretch">
          {/* ── Brand panel ── */}
          <div className="hidden md:flex flex-col justify-between p-10 rounded-3xl text-white overflow-hidden relative min-h-[600px] glass-card">
            {/* inner gradient + steam */}
            <div className="absolute inset-0 opacity-90 pointer-events-none"
                 style={{ background: 'radial-gradient(at 85% 0%, hsl(217 91% 55% / 0.35) 0%, transparent 55%), radial-gradient(at 5% 100%, hsl(38 92% 50% / 0.30) 0%, transparent 55%)' }} />
            <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none overflow-hidden">
              {[12, 28, 44, 60, 76, 88].map((left, i) => (
                <span key={left} className="steam"
                      style={{ left: `${left}%`, animationDuration: `${4 + (i % 3)}s`, animationDelay: `${i * 0.8}s` }} />
              ))}
            </div>

            <div className="relative flex items-center gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-md border border-white/25">
                <Coffee className="h-6 w-6 text-amber-300" />
              </div>
              <div className="text-xl font-extrabold tracking-tight">Cafe POS</div>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-400/15 border border-emerald-300/30 px-3 py-1 text-xs font-bold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
              </span>
            </div>

            <div className="relative flex flex-col items-start justify-center flex-1 text-left">
              <h1 className="text-5xl font-black leading-[1.05] tracking-tight mb-5 max-w-md">
                Run your floor,<br />tables & till —<br />
                <span className="text-gradient">all in one place.</span>
              </h1>
              <p className="text-white/70 max-w-sm text-sm leading-relaxed">
                One command center for orders, kitchen, inventory and books. Fast at the counter, honest in the ledger.
              </p>

              <div className="mt-8 flex gap-6">
                <Stat value="99.9%" label="Uptime" />
                <div className="w-px bg-white/15" />
                <Stat value="<200ms" label="Order sync" />
                <div className="w-px bg-white/15" />
                <Stat value="24/7" label="Offline-ready" />
              </div>
            </div>

            <div className="relative grid grid-cols-3 gap-3 mt-10">
              <Feature icon={<Monitor className="h-5 w-5" />} label="Tables" />
              <Feature icon={<Calendar className="h-5 w-5" />} label="Reservations" />
              <Feature icon={<FileText className="h-5 w-5" />} label="Audit" />
            </div>
          </div>

          {/* ── Form panel ── */}
          <div className="glass-card glow-ring relative p-8 md:p-12 rounded-3xl">
            {/* Mobile-only brand row */}
            <div className="md:hidden flex items-center gap-2 mb-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 border border-white/20 text-amber-300">
                <Coffee className="h-4 w-4" />
              </div>
              <div className="font-extrabold text-base text-gradient">Cafe POS</div>
            </div>

            <div className="mb-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 border border-white/15 text-blue-300 mb-4">
                <Building2 className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                {view === 'login' && 'Welcome back'}
                {view === 'mfa' && 'Two-factor authentication'}
                {view === 'forgot' && 'Reset your password'}
                {view === 'forgot-sent' && 'Check your inbox'}
              </h2>
              <p className="text-sm text-white/60 mt-2">
                {view === 'login' && 'Sign in to your organization to continue.'}
                {view === 'mfa' && 'Enter the 6-digit code from your authenticator.'}
                {view === 'forgot' && "We'll email you a secure reset link."}
                {view === 'forgot-sent' && 'If the account exists, a reset link is on its way.'}
              </p>
            </div>

            {view === 'login' && (
              <form
                className="space-y-4"
                onSubmit={(e) => { e.preventDefault(); login.mutate(); }}
              >
                <Field label="Organization Code">
                  <Input
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value)}
                    autoComplete="organization"
                    required
                    className="h-12 rounded-xl bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-amber-400 focus:ring-amber-400/40"
                    placeholder="DEMO"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    className="h-12 rounded-xl bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-amber-400 focus:ring-amber-400/40"
                    placeholder="your@email.com"
                  />
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="h-12 pr-12 rounded-xl bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-amber-400 focus:ring-amber-400/40"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                    >
                      {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </Field>
                <Button
                  type="submit"
                  className="w-full h-12 font-bold btn-shine shadow-lg shadow-amber-500/25 rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-amber-500 hover:from-blue-600 hover:via-indigo-600 hover:to-amber-600 text-white border-0"
                  disabled={login.isPending}
                >
                  {login.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <LogIn className="mr-2 h-4 w-4" />}
                  Sign in
                </Button>
                <button
                  type="button"
                  onClick={() => setView('forgot')}
                  className="block w-full text-center text-sm text-amber-300/90 hover:text-amber-200 font-medium transition-colors"
                >
                  Forgot password?
                </button>
              </form>
            )}

            {view === 'mfa' && (
              <form
                className="space-y-4"
                onSubmit={(e) => { e.preventDefault(); mfa.mutate(); }}
              >
                <Field label="Authenticator code">
                  <Input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    pattern="\d{6}"
                    autoFocus
                    required
                    className="h-14 text-center text-2xl tracking-[0.4em] font-extrabold rounded-xl bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-amber-400 focus:ring-amber-400/40"
                  />
                </Field>
                <Button
                  type="submit"
                  className="w-full h-12 font-bold btn-shine rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-amber-500 hover:from-blue-600 hover:via-indigo-600 hover:to-amber-600 text-white border-0"
                  disabled={mfa.isPending || mfaCode.length !== 6}
                >
                  {mfa.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <KeyRound className="mr-2 h-4 w-4" />}
                  Verify
                </Button>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="block w-full text-center text-sm text-white/50 hover:text-white transition-colors"
                >
                  Back
                </button>
              </form>
            )}

            {view === 'forgot' && (
              <form
                className="space-y-4"
                onSubmit={(e) => { e.preventDefault(); forgot.mutate(); }}
              >
                <Field label="Organization code">
                  <Input value={orgCode} onChange={(e) => setOrgCode(e.target.value)} required className="h-12 rounded-xl bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-amber-400 focus:ring-amber-400/40" />
                </Field>
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 rounded-xl bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-amber-400 focus:ring-amber-400/40" />
                </Field>
                <Button
                  type="submit"
                  className="w-full h-12 font-bold btn-shine rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-amber-500 hover:from-blue-600 hover:via-indigo-600 hover:to-amber-600 text-white border-0"
                  disabled={forgot.isPending}
                >
                  {forgot.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Mail className="mr-2 h-4 w-4" />}
                  Send reset link
                </Button>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="block w-full text-center text-sm text-white/50 hover:text-white transition-colors"
                >
                  Back to sign in
                </button>
              </form>
            )}

            {view === 'forgot-sent' && (
              <div className="space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 border border-white/15 text-blue-300">
                  <Mail className="h-8 w-8" />
                </div>
                <p className="text-sm text-white/70">
                  If an account exists for <strong className="text-white">{email}</strong>,
                  a reset link has been sent.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setView('login')}
                  className="w-full h-12 rounded-xl bg-white/5 border-white/20 text-white hover:bg-white/10"
                >
                  Back to sign in
                </Button>
              </div>
            )}

            <div className="mt-8 flex items-center justify-center gap-4 text-[11px] text-white/40">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Encrypted</span>
              <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5" /> Offline-first</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="field-in">
    <label className="text-sm font-semibold text-white/75 block mb-2">
      {label}
    </label>
    {children}
  </div>
);

const Feature: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 px-4 py-3 flex items-center gap-2 text-sm font-bold hover:bg-white/15 transition-colors">
    <div className="text-amber-300">{icon}</div>
    <span>{label}</span>
  </div>
);

const Stat: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div>
    <div className="text-2xl font-black tracking-tight text-white">{value}</div>
    <div className="text-xs text-white/50 mt-0.5">{label}</div>
  </div>
);
