import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export const ReprintDialog: React.FC<Props> = ({ open, title, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');

  React.useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sky-700">
            <Printer className="w-4 h-4" /> Reprint {title}
          </DialogTitle>
          <DialogDescription>
            Reprinting requires manager authorization. Provide a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-slate-500">
            Reason is required. This action is logged for audit.
          </div>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Printer jam, customer requested duplicate…"
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm resize-none h-20"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="default"
            className="bg-sky-700 hover:bg-sky-800"
            disabled={!reason.trim()}
            onClick={() => { onConfirm(reason.trim()); onClose(); }}
          >
            <Printer className="w-4 h-4 mr-1" /> Reprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReprintDialog;
