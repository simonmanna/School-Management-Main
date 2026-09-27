import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import { useCashDesk, useCloseCashDrawer, useOpenCashDrawer } from './api';

const ugx = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString();

function errorText(e: unknown, fallback: string): string {
  const msg = (e as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(' ') : typeof msg === 'string' ? msg : fallback;
}

/**
 * The fee desk's cash drawer (ADR-032 P3, audit F09). In a `drawer` school,
 * cash goes through the cashier's open session and the drawer is counted at
 * close; in a `cashbook` school this says so plainly and stays out of the way.
 */
export function CashDrawerBar() {
  const { data: desk, isLoading, isError } = useCashDesk();
  const open = useOpenCashDrawer();
  const close = useCloseCashDrawer();
  const [float, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);

  if (isLoading) return null;
  if (isError || !desk) {
    return <p className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">Could not load the cash drawer. Reload before taking cash.</p>;
  }
  if (desk.mode === 'cashbook') {
    return (
      <p className="rounded border p-3 text-sm text-muted-foreground">
        Cash is recorded in the daily cashbook. Count it against the cash book at the end of the day.
      </p>
    );
  }
  if (!desk.session) {
    return (
      <div className="flex flex-wrap items-end gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        <div className="flex-1">
          <p className="flex items-center gap-1 font-medium text-amber-900"><Wallet className="h-4 w-4" />Open your cash drawer before taking cash</p>
          <p className="text-xs text-amber-900">Enter the cash already in the drawer (the float).</p>
        </div>
        <Input className="w-36" inputMode="numeric" placeholder="Float, e.g. 0" value={float} onChange={(e) => setFloat(e.target.value)} />
        <Button
          size="sm"
          disabled={open.isPending || (float !== '' && !(Number(float) >= 0))}
          onClick={async () => {
            try {
              await open.mutateAsync(Number(float || 0));
              notify.success('Cash drawer open');
              setFloat('');
            } catch (e) {
              notify.error(errorText(e, 'Could not open the drawer'));
            }
          }}
        >
          Open drawer
        </Button>
      </div>
    );
  }
  const expected = Number(desk.session.expectedCash ?? 0);
  const difference = counted === '' ? 0 : Number(counted) - expected;
  return (
    <div className="space-y-2 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1">
          <Wallet className="h-4 w-4" />
          Drawer open since {new Date(desk.session.openedAt).toLocaleTimeString()} · should hold <strong>{ugx(expected)}</strong>
        </p>
        {!closing && <Button size="sm" variant="outline" onClick={() => setClosing(true)}>Count and close</Button>}
      </div>
      {closing && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-40" inputMode="numeric" placeholder="Cash counted" value={counted} onChange={(e) => setCounted(e.target.value)} />
          {counted !== '' && difference !== 0 && (
            <Input className="min-w-60 flex-1" placeholder={`Why is it ${difference > 0 ? 'over' : 'short'} by ${ugx(Math.abs(difference))}?`} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <Button
            size="sm"
            disabled={close.isPending || counted === '' || !(Number(counted) >= 0) || (difference !== 0 && !reason.trim())}
            onClick={async () => {
              try {
                await close.mutateAsync({ closingCounted: Number(counted), varianceReason: reason.trim() || undefined });
                notify.success(difference === 0 ? 'Drawer closed — it balances' : `Drawer closed with a difference of ${ugx(difference)}`);
                setClosing(false); setCounted(''); setReason('');
              } catch (e) {
                notify.error(errorText(e, 'Could not close the drawer'));
              }
            }}
          >
            Close drawer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClosing(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
