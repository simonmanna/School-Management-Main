/**
 * POS Terminal Login Screen — select a staff member and enter a PIN.
 *
 * Shown full-screen when the terminal opens and no POS user is logged in.
 * After successful PIN verification, the store is hydrated and the terminal
 * unlocks.
 */
import React, { useEffect, useState } from 'react';
import { Coffee, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { usePosAuthStore } from '@/features/pos/pos-auth.store';

interface Props {
  onLoggedIn: () => void;
  onBeforeSubmit?: () => void;
}

const PosLoginScreen: React.FC<Props> = ({ onLoggedIn, onBeforeSubmit }) => {
  const login = usePosAuthStore((s) => s.login);
  const loading = usePosAuthStore((s) => s.loading);
  const error = usePosAuthStore((s) => s.error);

  const [step, setStep] = useState<'select' | 'pin'>('select');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/pos/auth/staff');
        setStaff(res.data);
      } catch {
        console.warn('Failed to load POS staff list');
      } finally {
        setStaffLoading(false);
      }
    })();
  }, []);

  const activeUsers = staff.filter((u: any) => u.hasPin);

  const selectedUser = activeUsers.find((u: any) => u.id === selectedUserId);

  // Reset when component mounts
  useEffect(() => {
    setStep('select');
    setSelectedUserId('');
    setPin('');
    setLocalError(null);
  }, []);

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setPin('');
    setLocalError(null);
    setStep('pin');
  };

  const MIN_PIN = 4;
  const MAX_PIN = 8;

  const handlePinDigit = (digit: string) => {
    if (pin.length >= MAX_PIN) return;
    const newPin = pin + digit;
    setPin(newPin);
    setLocalError(null);
    if (newPin.length >= MIN_PIN) {
      onBeforeSubmit?.();
      submitLogin(selectedUserId, newPin);
    }
  };

  const handleClearPin = () => {
    setPin('');
    setLocalError(null);
  };

  const handleBackspace = () => {
    setPin((p) => p.slice(0, -1));
  };

  const handleBack = () => {
    setStep('select');
    setPin('');
    setLocalError(null);
  };

  const submitLogin = async (userId: string, pinValue: string) => {
    if (!userId || pinValue.length < MIN_PIN) {
      setLocalError(`Enter at least ${MIN_PIN} digits`);
      return;
    }
    try {
      await login(userId, pinValue);
      onLoggedIn();
    } catch {
      // error is in the store
      setPin('');
    }
  };

  // Physical keyboard: type the PIN, Backspace to correct, Enter to sign in.
  useEffect(() => {
    if (step !== 'pin') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); handlePinDigit(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); handleBackspace(); }
      else if (e.key === 'Enter') { e.preventDefault(); onBeforeSubmit?.(); submitLogin(selectedUserId, pin); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pin, selectedUserId, loading]);

  const displayError = localError || error;

  if (step === 'select') {
    return (
      <div className="fixed inset-0 z-[100] bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mb-4">
            <Coffee className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">POS Terminal</h1>
          <p className="text-slate-400 text-sm mt-1">Select your name to start</p>
        </div>

        {staffLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading staff…
          </div>
        ) : activeUsers.length === 0 ? (
          <div className="text-slate-400 text-center max-w-sm">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No active staff found.</p>
            <p className="text-xs mt-1">Ask a manager to create staff accounts with POS PINs.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg w-full px-4">
            {activeUsers.map((u: any) => (
              <button
                key={u.id}
                onClick={() => handleSelectUser(u.id)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 hover:border-white/30 transition-all text-white"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-lg font-bold">
                  {(u.firstName?.[0] || '?').toUpperCase()}
                </div>
                <span className="text-sm font-semibold text-center leading-tight">
                  {u.firstName}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // PIN entry step
  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center">
      <button
        onClick={handleBack}
        className="absolute top-6 left-6 text-slate-400 hover:text-white text-sm flex items-center gap-1"
      >
        ← Back
      </button>

      <div className="mb-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl font-bold text-white mx-auto mb-3">
          {(selectedUser?.firstName?.[0] || '?').toUpperCase()}
        </div>
        <h2 className="text-xl font-bold text-white">
          {selectedUser?.firstName}
        </h2>
        <p className="text-slate-400 text-sm mt-1">Enter your POS PIN</p>
      </div>

      {/* PIN dots — grow from MIN_PIN up to MAX_PIN as the cashier types */}
      <div className="flex gap-3 mb-6">
        {Array.from({ length: Math.min(MAX_PIN, Math.max(MIN_PIN, pin.length)) }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all ${
              pin.length > i
                ? 'bg-emerald-400 border-emerald-400'
                : 'border-slate-500'
            }`}
          />
        ))}
      </div>

      {displayError && (
        <div className="text-rose-400 text-sm mb-4 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {displayError}
        </div>
      )}

      {/* PIN pad */}
      <div className="grid grid-cols-3 gap-3 max-w-[260px]">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button
            key={d}
            onClick={() => handlePinDigit(String(d))}
            disabled={loading}
            className="w-20 h-16 rounded-xl bg-white/10 hover:bg-white/20 text-white text-2xl font-bold border border-white/10 hover:border-white/30 transition-all disabled:opacity-40"
          >
            {d}
          </button>
        ))}
        <button
          onClick={handleClearPin}
          disabled={loading}
          className="w-20 h-16 rounded-xl bg-white/5 text-slate-400 text-xs font-semibold border border-white/10 hover:bg-white/10 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          onClick={() => handlePinDigit('0')}
          disabled={loading}
          className="w-20 h-16 rounded-xl bg-white/10 hover:bg-white/20 text-white text-2xl font-bold border border-white/10 hover:border-white/30 transition-all disabled:opacity-40"
        >
          0
        </button>
        <button
          onClick={handleBackspace}
          disabled={loading}
          className="w-20 h-16 rounded-xl bg-white/5 text-slate-400 text-xs font-semibold border border-white/10 hover:bg-white/10 disabled:opacity-40"
        >
          ⌫
        </button>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
        </div>
      )}
    </div>
  );
};

export default PosLoginScreen;
