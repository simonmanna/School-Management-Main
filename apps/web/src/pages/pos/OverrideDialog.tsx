// Manager override dialog. Verifies the manager's PIN (or password) via
// POST /pos/override/verify. Returns the managerId on success.
import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useVerifyOverride } from './api';

export interface OverrideResult {
  managerId: string;
  pin: string;
}

interface Props {
  open: boolean;
  /** What is being overridden. Recorded in audit + event. */
  kind: 'discount' | 'void' | 'manual_refund';
  /** Optional title override. */
  title?: string;
  onClose: () => void;
  /** Resolves with the verified manager result (id + pin), or null if cancelled/failed. */
  onVerified: (result: OverrideResult | null) => void;
}

const KIND_LABEL: Record<Props['kind'], string> = {
  discount: 'discount this sale',
  void: 'void this sale',
  manual_refund: 'issue a manual refund',
};

export const OverrideDialog: React.FC<Props> = ({ open, kind, title, onClose, onVerified }) => {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const verify = useVerifyOverride();

  useEffect(() => {
    if (!open) {
      setEmail(''); setPin(''); setPassword(''); setUsePassword(false); setErr(null);
    }
  }, [open]);

  const submit = async () => {
    setErr(null);
    if (!email) { setErr('Manager email is required'); return; }
    if (!usePassword && !pin) { setErr('PIN is required'); return; }
    if (usePassword && !password) { setErr('Password is required'); return; }
    try {
      const res = await verify.mutateAsync({
        email: email.trim().toLowerCase(),
        pin: !usePassword ? pin : undefined,
        password: usePassword ? password : undefined,
        overrideKind: kind,
      });
      onVerified({ managerId: res.managerId, pin });
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Invalid credentials');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            {title ?? `Manager override required`}
          </DialogTitle>
          <DialogDescription>
            To {KIND_LABEL[kind]}, please verify with a manager.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label>Manager email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="manager@cafe.com"
            autoFocus
          />
        </div>

        {!usePassword ? (
          <div>
            <Label className="flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Manager PIN (4–8 digits)
            </Label>
            <Input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              maxLength={8}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
            <button
              type="button"
              onClick={() => setUsePassword(true)}
              className="text-[11px] text-blue-600 hover:underline mt-1"
            >
              Use manager password instead
            </button>
          </div>
        ) : (
          <div>
            <Label>Manager password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
            <button
              type="button"
              onClick={() => setUsePassword(false)}
              className="text-[11px] text-blue-600 hover:underline mt-1"
            >
              Use PIN instead
            </button>
          </div>
        )}

        {err ? <p className="text-sm text-rose-600">{err}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onVerified(null)}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button onClick={submit} disabled={verify.isPending} style={{ background: '#f59e0b' }}>
            {verify.isPending ? 'Verifying…' : 'Verify'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};