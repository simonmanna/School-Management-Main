import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type DecisionAction = 'accept' | 'reject' | 'waitlist' | 'withdraw' | (string & {});

interface DecisionDialogProps {
  open: boolean;
  action?: DecisionAction;
  /** Human-readable applicant label shown in the title. */
  applicantName?: string;
  /** When true, the reason is optional (advisory actions). We gate the
   *  required-reason actions at the API too, so this is purely UX. */
  reasonRequired?: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, notes: string) => void;
}

const ACTION_LABEL: Record<string, string> = {
  accept: 'Accept',
  reject: 'Reject',
  waitlist: 'Waitlist',
  withdraw: 'Withdraw',
};

/**
 * Shared administrative decision dialog. Replaces the legacy `window.prompt`
 * flow so a mandatory reason can be captured with proper UX. The reason
 * requirement is enforced again server-side, so bypassing the UI is impossible.
 */
export function DecisionDialog({
  open,
  action,
  applicantName,
  reasonRequired = true,
  submitting = false,
  onCancel,
  onConfirm,
}: DecisionDialogProps) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  // Reset fields every time the dialog is (re)opened for a new action.
  useEffect(() => {
    if (open) {
      setReason('');
      setNotes('');
    }
  }, [open]);

  const label = action ? ACTION_LABEL[action] ?? action.replace(/_/g, ' ') : 'Decision';
  const canConfirm = !reasonRequired || reason.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {label}
            {applicantName ? ` — ${applicantName}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="decision-reason">
              Reason{reasonRequired ? ' *' : ''}
            </Label>
            <Textarea
              id="decision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this decision being recorded?"
              rows={3}
              disabled={submitting}
            />
            {reasonRequired && reason.trim().length === 0 && (
              <p className="text-xs text-muted-foreground">A reason is required for this decision.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="decision-notes">Additional notes</Label>
            <Input
              id="decision-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={action === 'reject' || action === 'withdraw' ? 'destructive' : 'default'}
            onClick={() => onConfirm(reason.trim(), notes.trim())}
            disabled={!canConfirm || submitting}
          >
            {submitting ? 'Working…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
