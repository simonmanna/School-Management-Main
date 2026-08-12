import React, { useEffect, useState } from 'react';
import { Tag, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (reason: string) => void;
}

const REASONS = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'loyalty', label: 'Loyalty Program' },
  { value: 'employee', label: 'Employee Discount' },
  { value: 'senior', label: 'Senior Citizen' },
  { value: 'student', label: 'Student Discount' },
  { value: 'defect', label: 'Defective Item' },
  { value: 'complaint', label: 'Customer Complaint' },
  { value: 'clearance', label: 'Clearance Sale' },
  { value: 'wholesale', label: 'Wholesale / Bulk' },
  { value: 'voucher', label: 'Voucher / Gift Card' },
];

export const DiscountReasonDialog: React.FC<Props> = ({ open, onClose, onSelect }) => {
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    if (!open) { setCustom(''); setShowCustom(false); }
  }, [open]);

  const pick = (value: string) => {
    if (value === 'other') { setShowCustom(true); return; }
    onSelect(value);
    onClose();
  };

  const submitCustom = () => {
    if (!custom.trim()) return;
    onSelect(custom.trim());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-amber-600" /> Discount Reason
          </DialogTitle>
          <DialogDescription>
            Select a reason for this discount. Required for manual discounts.
          </DialogDescription>
        </DialogHeader>

        {!showCustom ? (
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className="px-3 py-2.5 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50 text-sm font-medium text-left transition"
                onClick={() => pick(r.value)}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              className="px-3 py-2.5 rounded-lg border border-dashed border-slate-300 hover:border-amber-300 hover:bg-amber-50 text-sm font-medium text-left transition col-span-2 flex items-center gap-2"
              onClick={() => pick('other')}
            >
              <MessageSquare className="h-4 w-4 text-slate-400" /> Other — type a reason
            </button>
          </div>
        ) : (
          <div>
            <Label>Enter reason</Label>
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. Grand opening promotion"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') submitCustom(); }}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {showCustom ? (
            <Button onClick={submitCustom} disabled={!custom.trim()} style={{ background: '#f59e0b' }}>
              Apply
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
