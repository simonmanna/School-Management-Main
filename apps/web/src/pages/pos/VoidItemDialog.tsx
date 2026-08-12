import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { CartLine } from '@/features/pos/types';

interface Props {
  open: boolean;
  line: CartLine | null;
  onClose: () => void;
  onConfirm: (lineId: string, reason: string) => void;
}

export const VoidItemDialog: React.FC<Props> = ({ open, line, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');

  React.useEffect(() => {
    if (!open) { setReason(''); }
  }, [open]);

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <AlertTriangle className="w-4 h-4" /> Void Item
          </DialogTitle>
          <DialogDescription>
            Remove <strong>{line.name}</strong> (×{line.quantity}) from this order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-slate-500">
            A reason is required. This action is logged for audit.
          </div>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer changed mind, wrong item ordered…"
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm resize-none h-20"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => { onConfirm(line.lineId, reason.trim()); onClose(); }}
          >
            <AlertTriangle className="w-4 h-4 mr-1" /> Void Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VoidItemDialog;
