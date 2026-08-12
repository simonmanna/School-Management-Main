import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePosChangePassword } from '@/features/pos/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PosChangePasswordDialog({ open, onOpenChange }: Props) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const changePassword = usePosChangePassword();

  const reset = () => { setCurrentPin(''); setNewPassword(''); setConfirmPassword(''); };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const mismatch = newPassword !== confirmPassword;
  const canSubmit = currentPin.length >= 4 && newPassword.length >= 8 && !mismatch;

  const handleSubmit = async () => {
    try {
      await changePassword.mutateAsync({ currentPin, newPassword });
      reset();
      onOpenChange(false);
    } catch {
      /* toast handled by interceptor */
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Use your current POS PIN to verify your identity, then set a new password.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="currentPin">Current PIN</Label>
            <Input
              id="currentPin"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="4-8 digits"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
            {mismatch && confirmPassword.length > 0 && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || changePassword.isPending}>
            {changePassword.isPending ? 'Saving…' : 'Change Password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
