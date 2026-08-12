// Receipt preview + print / reprint / email actions.
import React, { useRef, useState } from 'react';
import { Printer, Download, RefreshCw, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  invoiceId: string | null;
  invoiceNumber?: string;
  receiptHtml?: string;
  onClose: () => void;
  onVoid?: (invoiceId: string, invoiceNumber: string) => void;
  canReprint?: boolean;
}

export const ReceiptPreviewDialog: React.FC<Props> = ({ open, invoiceId, invoiceNumber, receiptHtml, onClose, onVoid: _onVoid, canReprint = false }) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<'print' | 'email' | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // (Re)load the PDF blob URL when the dialog opens or invoiceId changes (fallback
  // when receiptHtml isn't available).
  React.useEffect(() => {
    if (!open || !invoiceId || receiptHtml) {
      if (!receiptHtml) setPdfUrl(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const res = await api.get<Blob>(`/pos/receipts/${invoiceId}/pdf`, { responseType: 'blob' });
        if (cancelled) return;
        url = URL.createObjectURL(res.data);
        setPdfUrl(url);
      } catch (e: any) {
        if (!cancelled) toast.error('Could not load receipt PDF');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, invoiceId, receiptHtml]);

  const onPrint = async () => {
    if (!invoiceId) return;
    setBusy('print');
    try {
      const r = await api.post<{ ok: boolean; backend: string; message?: string }>(`/pos/receipts/${invoiceId}/print`);
      if (r.data.ok) {
        toast.success(r.data.backend === 'escpos' ? 'Receipt sent to printer' : r.data.message ?? 'Receipt logged (no printer)');
      } else {
        toast.warning(r.data.message ?? 'Printer error');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Print failed');
    } finally { setBusy(null); }
  };

  const onDownload = () => {
    if (receiptHtml && invoiceNumber) {
      const blob = new Blob([receiptHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${invoiceNumber}.html`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (!pdfUrl || !invoiceNumber) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `receipt-${invoiceNumber}.pdf`;
    a.click();
  };

  const onReprint = async () => {
    if (!invoiceId) return;
    setBusy('print');
    try {
      const r = await api.post<{ ok: boolean; backend: string }>(`/pos/receipts/${invoiceId}/reprint`);
      toast.success(`Re-printed via ${r.data.backend}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Reprint failed');
    } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[820px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-slate-700 to-slate-900 text-white p-4">
          <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
            <Printer className="h-4 w-4" /> Receipt {invoiceNumber ?? ''}
          </DialogTitle>
          <DialogDescription className="text-slate-300 text-xs">
            Print, email, or download the receipt for this sale.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-slate-200 p-4 flex justify-center min-h-[500px]">
          {receiptHtml ? (
            <iframe ref={iframeRef} srcDoc={receiptHtml} title="Receipt preview" className="bg-white shadow-md" style={{ width: 340, height: 600 }} />
          ) : pdfUrl ? (
            <iframe ref={iframeRef} src={pdfUrl} title="Receipt preview" className="bg-white shadow-md" style={{ width: 340, height: 600 }} />
          ) : (
            <div className="flex items-center justify-center text-slate-500 text-sm">
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Loading receipt…
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50 flex gap-2 justify-between">
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDownload} disabled={!pdfUrl && !receiptHtml}>
              <Download className="h-4 w-4 mr-1" /> {receiptHtml ? 'Download HTML' : 'Download PDF'}
            </Button>
            {canReprint && (
              <Button variant="outline" onClick={onReprint} disabled={busy !== null}>
                <RefreshCw className="h-4 w-4 mr-1" /> Reprint
              </Button>
            )}
            <Button variant="outline" onClick={onPrint} disabled={busy !== null} title="Send to thermal printer">
              <Printer className="h-4 w-4 mr-1" /> {busy === 'print' ? 'Sending…' : 'Thermal'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};