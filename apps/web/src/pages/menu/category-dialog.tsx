import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CreateCategoryInput, MenuCategory } from '@/features/menu/api';

interface Props {
  open: boolean;
  category?: MenuCategory | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: CreateCategoryInput) => Promise<void>;
}

export function CategoryDialog({ open, category, onOpenChange, onSubmit }: Props) {
  const isEdit = Boolean(category);
  const [name, setName] = useState('');
  const [displayOrder, setDisplayOrder] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (category) {
      setName(category.name);
      setDisplayOrder(String(category.displayOrder));
    } else {
      setName('');
      setDisplayOrder('');
    }
  }, [open, category]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <div className="bg-[#3b82f6] text-white px-6 py-4">
          <h2 className="text-base font-semibold">{isEdit ? 'Edit Category' : 'Add New Category'}</h2>
          <p className="text-white/75 text-xs mt-0.5">
            {isEdit ? 'Update category details below.' : 'Fill in the details to create a new category.'}
          </p>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setSubmitting(true);
            try {
              await onSubmit({
                name: name.trim(),
                displayOrder: displayOrder ? Number(displayOrder) : undefined,
              });
              onOpenChange(false);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div>
            <Label htmlFor="cat-name" className="text-sm font-medium text-slate-700 mb-1.5">Name</Label>
            <Input
              id="cat-name"
              autoFocus
              placeholder="e.g. Hot Drinks"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="cat-order" className="text-sm font-medium text-slate-700 mb-1.5">Display order (optional)</Label>
            <Input
              id="cat-order"
              type="number"
              placeholder="0 = top"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </div>
          <DialogFooter className="px-5 py-3 border-t bg-slate-50 gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="rounded-lg border-gray-300 hover:bg-gray-100">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()} className="rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white">
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
