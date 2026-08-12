import { useAuthStore } from '@/stores/auth.store';
import { useMemo, useState } from 'react';
import { Printer, Download, X, CheckCircle2 } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  note?: string;
  /** Selected modifier names, e.g. ["Large", "Extra shot"]. Printed under the item. */
  modifiers?: string[];
  variantName?: string;
  accompanimentNames?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  type: 'bill' | 'kot';
  title: string;
  lines: ReceiptLine[];
  total: number;
  discountPercent?: number;
  discountAmount?: number;
  orderTypeLabel?: string;
  tableLabel?: string;
  customerName?: string;
  subtitle?: string;
  /** For additional bills: previous subtotal already billed */
  previousSubtotal?: number;
  /** For additional bills: grand total including all items */
  grandTotal?: number;
  onPrint?: () => void;
}

const money = (n: number | string) => Number(n || 0).toLocaleString();
const currencyOf = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
const ugx = (n: number | string) => `${currencyOf()} ${money(n)}`;

/**
 * Build a standalone 80mm monospace thermal document for the bill / KOT and
 * print it through a hidden iframe — the same isolated-print mechanism the
 * settlement receipt uses. `window.print()` on the app page pulls in the whole
 * UI; this prints only the ticket.
 */
function buildThermalHtml(p: {
  type: 'bill' | 'kot';
  lines: ReceiptLine[];
  total: number;
  discountPercent?: number;
  discountAmount?: number;
  orderTypeLabel?: string;
  tableLabel?: string;
  customerName?: string;
  subtitle?: string;
  previousSubtotal?: number;
  grandTotal?: number;
}): string {
  const W = 44;
  const out: string[] = [];
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2));
    return ' '.repeat(pad) + s;
  };
  const two = (l: string, r: string) => {
    const gap = Math.max(1, W - l.length - r.length);
    return l + ' '.repeat(gap) + r;
  };

  out.push('='.repeat(W));
  out.push(center('ABILIZ CAFE AND PATISSERIE'));
  out.push(center('AFEE COMPLEX, KASANGA'));
  out.push(center('Kampala, Uganda'));
  out.push(center('Tel: +256757920771'));
  if (p.orderTypeLabel) out.push(center(p.orderTypeLabel));
  if (p.tableLabel) out.push(center(p.tableLabel));
  if (p.customerName) out.push(center('Customer: ' + p.customerName));
  if (p.subtitle) out.push(center(p.subtitle));
  if (p.type === 'kot') out.push(center('** KITCHEN ORDER TICKET **'));
  out.push('-'.repeat(W));

  if (p.type === 'kot') {
    // Kitchen ticket: quantity + item + modifiers/notes, no prices.
    if (p.lines.length === 0) out.push(center('No items'));
    for (const it of p.lines) {
      out.push(`${('x' + it.quantity).padStart(4)}  ${it.name.slice(0, W - 6)}`);
      if (it.variantName) out.push(`       ${it.variantName}`);
      if (it.accompanimentNames?.length) out.push(`       + ${it.accompanimentNames.join(', ')}`);
      if (it.modifiers?.length) out.push(`       + ${it.modifiers.join(', ')}`);
      if (it.note) out.push(`       Note: ${it.note}`);
    }
    out.push('-'.repeat(W));
    out.push(center('Prepare and serve with care'));
  } else {
    const descW = 26;
    const qtyW = 3;
    const priceW = 7;
    const totalW = 5;
    out.push(`${'Item'.padEnd(descW)} ${'Qty'.padStart(qtyW)} ${'Price'.padStart(priceW)} ${'Total'.padStart(totalW)}`);
    out.push('-'.repeat(W));
    if (p.lines.length === 0) out.push(center('No items'));
    let subtotal = 0;
    for (const it of p.lines) {
      const lineTotal = it.unitPrice * it.quantity;
      subtotal += lineTotal;
      out.push(
        `${it.name.slice(0, descW).padEnd(descW)} ${String(it.quantity).padStart(qtyW)} ${money(it.unitPrice).padStart(priceW)} ${money(lineTotal).padStart(totalW)}`,
      );
      if (it.variantName) out.push(`  ${it.variantName}`);
      if (it.accompanimentNames?.length) out.push(`  + ${it.accompanimentNames.join(', ')}`);
      if (it.modifiers?.length) out.push(`  + ${it.modifiers.join(', ')}`);
      if (it.discountPercent > 0) out.push(`  -${it.discountPercent}% disc`);
      if (it.note) out.push(`  Note: ${it.note}`);
    }
    out.push('-'.repeat(W));
    out.push(two('Subtotal', ugx(subtotal)));
    if (p.discountPercent && p.discountPercent > 0) {
      out.push(two(`Discount (${p.discountPercent}%)`, '-' + money(p.discountAmount ?? 0)));
    }
    if (p.subtitle && p.previousSubtotal != null && p.grandTotal != null) {
      out.push(two('Previous Total', ugx(p.previousSubtotal)));
      out.push(two('Additional Total', ugx(p.total)));
      out.push('='.repeat(W));
      out.push(two('Grand Total Due', ugx(p.grandTotal)));
    } else {
      out.push('='.repeat(W));
      out.push(two('TOTAL', ugx(p.total)));
    }
    out.push('-'.repeat(W));
    out.push(center('Thank you for your visit!'));
  }

  const text = out.join('\n');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Print</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { margin:0; padding:0; width:72mm; height:auto; }
  body { font-family:'Courier New',Courier,monospace; font-size:10px; line-height:1.25; white-space:pre; padding:1mm 1mm 14mm; }
  @media print { @page { margin:0; size:72mm 297mm; } html,body { width:72mm; height:auto; } }
</style></head>
<body>${esc(text).replace(/\n/g, '<br>')}<script>
  // "size:80mm auto" is invalid CSS (dropped by browsers), which left the page
  // size to the driver's custom thermal paper — that broke print preview and
  // paginated long tickets so the cutter fired mid-receipt. Instead, size the
  // page to the exact content height: one continuous page, one cut at the end.
  // The 14mm bottom padding feeds the last lines past the tear bar/cutter.
  window.onload = function () {
    var mm = Math.max(40, Math.ceil(document.body.scrollHeight * 25.4 / 96) + 4);
    var s = document.createElement('style');
    s.textContent = '@page { size:72mm ' + mm + 'mm; margin:0; }';
    document.head.appendChild(s);
  };
</script></body></html>`;
}


export const ReceiptPreview: React.FC<Props> = ({
  open, onClose, type, title, lines, total,
  discountPercent, discountAmount, orderTypeLabel, tableLabel, customerName,
  subtitle, previousSubtotal, grandTotal, onPrint,
}) => {
  const [printed, setPrinted] = useState(false);

  const html = useMemo(
    () => buildThermalHtml({
      type, lines, total, discountPercent, discountAmount,
      orderTypeLabel, tableLabel, customerName, subtitle, previousSubtotal, grandTotal,
    }),
    [type, lines, total, discountPercent, discountAmount, orderTypeLabel, tableLabel, customerName, subtitle, previousSubtotal, grandTotal],
  );

  const doPrint = () => {
    onPrint?.();
    setPrinted(true);
  };

  const doDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-${(title.replace(/\s+/g, '-').toLowerCase() || type)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => { setPrinted(false); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-slate-700 to-slate-900 text-white p-4">
          <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
            <Printer className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription className="text-slate-300 text-xs">
            {subtitle ?? (type === 'kot' ? 'Kitchen order ticket' : 'Bill receipt')}
          </DialogDescription>
        </DialogHeader>

        {printed ? (
          <div className="p-8 flex flex-col items-center justify-center min-h-[200px] text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
            <p className="text-base font-semibold text-slate-800">Sent to printer</p>
            <p className="text-sm text-slate-500 mt-1">The {type === 'kot' ? 'KOT' : 'bill'} has been sent to the thermal printer.</p>
          </div>
        ) : (
          <div className="bg-slate-200 p-4 flex justify-center">
            <iframe srcDoc={html} title="Preview" className="bg-white shadow-md" style={{ width: 340, height: 440 }} />
          </div>
        )}

        <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50 flex gap-2 justify-between">
          <Button variant="ghost" onClick={handleClose}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={doDownload}>
              <Download className="h-4 w-4 mr-1" /> Download HTML
            </Button>
            {!printed && (
              <Button onClick={doPrint} style={{ background: '#16a34a' }}>
                <Printer className="h-4 w-4 mr-1" /> Print {type === 'kot' ? 'KOT' : 'Bill'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
