import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useVerifyPin } from './api';

interface Props {
  open: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
  onVerified: () => void;
}

export const PinConfirmDialog: React.FC<Props> = ({ open, title, description, onClose, onVerified }) => {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const verify = useVerifyPin();

  useEffect(() => {
    if (!open) { setPin(''); setErr(null); }
  }, [open]);

  const submit = async () => {
    setErr(null);
    if (!pin) { setErr('PIN is required'); return; }
    try {
      await verify.mutateAsync(pin);
      onVerified();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Invalid PIN');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            {title ?? 'Confirm your PIN'}
          </DialogTitle>
          <DialogDescription>
            {description ?? 'Enter your PIN to confirm this action.'}
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label className="flex items-center gap-1">
            <KeyRound className="h-3 w-3" /> Your PIN (4–8 digits)
          </Label>
          <Input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            maxLength={8}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </div>

        {err ? <p className="text-sm text-rose-600">{err}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button onClick={submit} disabled={verify.isPending} style={{ background: '#f59e0b' }}>
            {verify.isPending ? 'Verifying…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
