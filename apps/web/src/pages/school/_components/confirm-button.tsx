import { useState, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/**
 * A button that asks before it does something that can't be taken back —
 * marking results final, freezing a class list, revoking a certificate.
 *
 * With `reasonLabel`, the dialog also collects a reason (required) and passes
 * it to `onConfirm`; that replaces `window.prompt`, which a browser can block
 * and which gave no way to explain what the reason is for.
 */
export function ConfirmButton({
  children, title, description, confirmLabel = 'Confirm', destructive, reasonLabel,
  onConfirm, disabled, size = 'sm', variant = 'outline', className,
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => void | Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const needsReason = !!reasonLabel;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant} disabled={disabled} className={className}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>
        </AlertDialogHeader>
        {needsReason && (
          <div className="space-y-1">
            <Label className="text-xs">{reasonLabel}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            disabled={needsReason && !reason.trim()}
            onClick={() => { void onConfirm(reason.trim()); }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
