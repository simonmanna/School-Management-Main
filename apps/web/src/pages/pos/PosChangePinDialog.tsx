import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePosChangePin } from '@/features/pos/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PosChangePinDialog({ open, onOpenChange }: Props) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const changePin = usePosChangePin();

  const reset = () => { setCurrentPin(''); setNewPin(''); };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const canSubmit = currentPin.length >= 4 && newPin.length >= 4 && currentPin !== newPin;

  const handleSubmit = async () => {
    try {
      await changePin.mutateAsync({ currentPin, newPin });
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
          <DialogTitle>Change PIN</DialogTitle>
          <DialogDescription>Enter your current PIN and choose a new 4-8 digit PIN for the terminal.</DialogDescription>
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
            <Label htmlFor="newPin">New PIN</Label>
            <Input
              id="newPin"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="4-8 digits"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || changePin.isPending}>
            {changePin.isPending ? 'Saving…' : 'Change PIN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
