import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Order panel — Odoo-style POS control panel.
//
// Layout (top → bottom):
//   • header      — item count + order-type + customer + clear
//   • order lines — tap a line to SELECT it (highlighted); no per-line steppers
//   • totals      — subtotal / discount / total
//   • control row — Customer · Disc · More (dialog: Note, Void, Delete, Discount %, Move, Split, Hold, Held, Handover)
//   • numpad      — 1-9 0 . ⌫ + Qty / % / Price mode selectors + ±
//   • primary     — Bill · KOT · Pay
//
// The numpad is the Odoo interaction model: pick a line, choose a mode
// (Qty / % / Price), then type digits — they live-apply to the selected line.
// Removal is NOT done from the numpad (it clamps qty to a positive value) so the
// PIN-gated Void / Delete controls stay the only way to drop a line.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ShoppingCart,
  StickyNote,
  Trash2,
  X,
  Tag,
  CreditCard,
  Receipt,
  User,
  AlertTriangle,
  Printer,
  Pause,
  ArrowLeftRight,
  Split as SplitIcon,
  Percent,
  Delete as BackspaceIcon,
  MoreHorizontal,
  Flame,
  Utensils,
} from "lucide-react";
import {
  selectItemCount,
  selectSubtotal,
  selectTxDiscountAmount,
  selectTotal,
  useCartStore,
} from "@/features/pos/cart.store";
import type { CartLine } from "@/features/pos/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type OrderTypeOption = 'dine-in' | 'takeaway' | 'delivery';

interface Props {
  customerName?: string;
  orderTypeLabel?: string;
  orderType: OrderTypeOption;
  onChangeOrderType: (t: OrderTypeOption) => void;
  tableLabel?: string;
  tableId?: string;
  onInc: (line: CartLine) => void;
  onDec: (line: CartLine) => void;
  onRemove?: (line: CartLine) => void;
  onNote: (line: CartLine) => void;
  onLineDiscount: (line: CartLine) => void;
  onPrintBill: () => void;
  onCharge: () => void;
  onSplit: () => void;
  onAddCustomer: () => void;
  onAddDiscount: () => void;
  onCloseOrder: () => void;
  onPrintKot: () => void;
  onVoidItem?: (line: CartLine) => void;
  onMoveItems?: () => void;
  /** Dine-in: settle (pay) the table's order. */
  onSettleTab?: () => void;
  billAlreadyPrinted?: boolean;
  onPrintAdditionalBill?: () => void;
  /** When true, hide cafe/restaurant-specific buttons (KOT, split, move items, settle tab). */
  hideCafeFeatures?: boolean;
  /** Cashier holds `pos:discount` — gates the numpad % mode + Disc/Discount buttons. Default true. */
  canDiscount?: boolean;
  /** Cashier may override a line's unit price (numpad Price mode). Default true. */
  canOverridePrice?: boolean;
  /** Retail: park current cart as a held order. */
  onHold?: () => void;
  /** Retail: open held-orders recall dialog. */
  onHeldOrders?: () => void;
  /** Retail: shift handover to another cashier. */
  onHandover?: () => void;
  /** Retail: open customer profile dialog (loyalty, store credit). */
  onCustomerProfile?: () => void;
  /** P5: fire a specific course (1=starter, 2=main, …) of the order to the kitchen. */
  onFireCourse?: (course: number) => void;
}

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

/** Course labels for the fire/hold controls. */
const COURSES: Array<{ n: number; label: string }> = [
  { n: 1, label: 'Starter' },
  { n: 2, label: 'Main' },
  { n: 3, label: 'Dessert' },
];
const courseLabel = (n: number) => COURSES.find((c) => c.n === n)?.label ?? `Course ${n}`;

const ORDER_TYPES: Array<{ key: 'dine-in' | 'takeaway' | 'delivery'; label: string }> = [
  { key: 'dine-in', label: 'Dine In' },
  { key: 'takeaway', label: 'Takeaway' },
  { key: 'delivery', label: 'Delivery' },
];

type NumMode = 'qty' | 'disc' | 'price';

export const OrderPanel: React.FC<Props> = ({
  customerName,
  orderType,
  onChangeOrderType,
  tableId,
  onRemove,
  onNote,
  onLineDiscount,
  onPrintBill,
  onCharge,
  onSplit,
  onAddCustomer,
  onAddDiscount,
  onCloseOrder,
  onPrintKot,
  onVoidItem,
  onMoveItems,
  onSettleTab,
  billAlreadyPrinted = false,
  onPrintAdditionalBill,
  hideCafeFeatures = false,
  canDiscount = true,
  canOverridePrice = true,
  onHold,
  onHeldOrders,
  onHandover,
  onCustomerProfile,
  onFireCourse,
}) => {
  const lines = useCartStore((s) => s.lines);
  const setCourse = useCartStore((s) => s.setCourse);
  const transactionDiscountPercent = useCartStore((s) => s.transactionDiscountPercent);
  const subtotal = useCartStore(selectSubtotal);
  const txDisc = useCartStore(selectTxDiscountAmount);
  const total = useCartStore(selectTotal);
  const itemCount = useCartStore(selectItemCount);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const setUnitPrice = useCartStore((s) => s.setUnitPrice);
  const empty = lines.length === 0;
  const hasCourses = lines.some((l) => l.course);

  /* ============== Odoo numpad state ============== */
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [mode, setMode] = useState<NumMode>('qty');
  const [editing, setEditing] = useState(false);
  const bufferRef = useRef<string>('');
  const selectedLine = lines.find((l) => l.lineId === selectedLineId) ?? null;

  /* Auto-select the newest line so the numpad always has a target. */
  useEffect(() => {
    if (lines.length === 0) {
      if (selectedLineId !== null) setSelectedLineId(null);
      return;
    }
    if (!selectedLineId || !lines.some((l) => l.lineId === selectedLineId)) {
      setSelectedLineId(lines[lines.length - 1].lineId);
      setMode('qty');
      bufferRef.current = '';
      setEditing(false);
    }
  }, [lines, selectedLineId]);

  const selectLine = useCallback((id: string) => {
    setSelectedLineId(id);
    setMode('qty');
    bufferRef.current = '';
    setEditing(false);
  }, []);

  const pickMode = useCallback((m: NumMode) => {
    if (m === 'disc' && !canDiscount) return;
    if (m === 'price' && !canOverridePrice) return;
    setMode(m);
    bufferRef.current = '';
    setEditing(false);
  }, [canDiscount, canOverridePrice]);

  /* A permission that was revoked (or a mode the cashier can't use) must never
   * stay active — fall back to Qty so digits can't apply to a gated field. */
  useEffect(() => {
    if ((mode === 'disc' && !canDiscount) || (mode === 'price' && !canOverridePrice)) {
      setMode('qty');
      bufferRef.current = '';
      setEditing(false);
    }
  }, [mode, canDiscount, canOverridePrice]);

  /** Apply the current buffer to the selected line for the active mode. */
  const applyBuffer = useCallback(() => {
    const line = useCartStore.getState().lines.find((l) => l.lineId === selectedLineId);
    if (!line) return;
    const raw = bufferRef.current;
    const num = raw === '' || raw === '-' || raw === '.' || raw === '-.' ? NaN : parseFloat(raw);
    if (mode === 'qty') {
      // Numpad never removes a line (that's PIN-gated Void/Delete) — clamp > 0.
      if (Number.isNaN(num) || num <= 0) return;
      setQuantity(line.lineId, num);
    } else if (mode === 'disc') {
      if (!canDiscount) return; // gated: requires pos:discount
      setDiscount(line.lineId, Number.isNaN(num) ? 0 : Math.max(0, Math.min(100, num)), 'percentage');
    } else {
      if (!canOverridePrice) return; // gated: price override right
      setUnitPrice(line.lineId, Number.isNaN(num) ? 0 : Math.max(0, num));
    }
  }, [mode, selectedLineId, canDiscount, canOverridePrice, setQuantity, setDiscount, setUnitPrice]);

  const pressDigit = useCallback((d: string) => {
    if (!selectedLineId) return;
    if (!editing) { bufferRef.current = d; setEditing(true); }
    else bufferRef.current += d;
    applyBuffer();
  }, [applyBuffer, editing, selectedLineId]);

  const pressDot = useCallback(() => {
    if (!selectedLineId) return;
    if (!editing) { bufferRef.current = '0.'; setEditing(true); }
    else if (!bufferRef.current.includes('.')) bufferRef.current += '.';
    applyBuffer();
  }, [applyBuffer, editing, selectedLineId]);

  const pressBackspace = useCallback(() => {
    if (!selectedLineId) return;
    if (editing && bufferRef.current.length > 0) {
      bufferRef.current = bufferRef.current.slice(0, -1);
    } else {
      bufferRef.current = '';
      setEditing(false);
    }
    applyBuffer();
  }, [applyBuffer, editing, selectedLineId]);

  const pressSign = useCallback(() => {
    if (!selectedLineId || mode === 'qty') return; // sign is meaningful for %/price only
    if (!editing) return;
    bufferRef.current = bufferRef.current.startsWith('-') ? bufferRef.current.slice(1) : '-' + bufferRef.current;
    applyBuffer();
  }, [applyBuffer, editing, mode, selectedLineId]);

  /** Live value shown under each mode chip so the cashier sees what they're editing. */
  const modeValue = (m: NumMode): string => {
    if (!selectedLine) return '';
    if (m === 'qty') return String(selectedLine.quantity);
    if (m === 'disc') return `${selectedLine.discountPercent || 0}%`;
    return Number(selectedLine.unitPrice || 0).toLocaleString();
  };

  const noSel = !selectedLine;

  return (
    <div className="pos-order-pro">
      {/* Header */}
      <div className="pos-order-head">
        <div className="flex items-center gap-2 min-w-0">
          <div className="pos-ord-num shrink-0">
            {empty ? "No items" : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
          </div>
        </div>
        {customerName ? (
          <div className="pos-ord-customer ml-2 cursor-pointer" onClick={onCustomerProfile} title="View customer profile">
            <User className="h-3 w-3" />
            {customerName}
          </div>
        ) : null}
        <div className="pos-ord-actions">
          <div className="mr-1 pr-1.5 flex items-center">
            <select
              className="text-[13px] font-bold cursor-pointer appearance-none bg-white/15 text-white rounded-md px-2 py-1 pr-5 border border-white/20"
              value={orderType}
              onChange={(e) => onChangeOrderType(e.target.value as OrderTypeOption)}
              title="Order type"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3e%3cpath fill=%27%23fff%27 d=%27M5 6l3 3 3-3%27/%3e%3c/svg%3e")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '10px' }}
            >
              {ORDER_TYPES.map((ot) => (
                <option key={ot.key} value={ot.key} className="text-slate-800">{ot.label}</option>
              ))}
            </select>
          </div>
          {lines.length > 0 ? (
            <button type="button" className="pos-ord-action" onClick={onCloseOrder} title="Clear cart">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Lines list — tap to select; numpad edits the selected line. */}
      {empty ? (
        <div className="pos-order-empty">
          <div className="pos-empty-icon">
            <ShoppingCart className="h-7 w-7" />
          </div>
          <p className="font-semibold text-base text-slate-300">
            {tableId ? "Empty order" : "No items yet"}
          </p>
          <p className="text-xs text-slate-500">
            {tableId ? "Pick items — they auto-save to this table" : "Pick a product to start the order"}
          </p>
        </div>
      ) : (
        <div className="pos-order-list min-h-0">
          {lines.map((it) => {
            const isCombo = Boolean(it.comboId);
            const lineSub = it.quantity * it.unitPrice * (1 - it.discountPercent / 100);
            const isSel = it.lineId === selectedLineId;
            return (
              <div
                key={it.lineId}
                className={"pos-oline" + (isSel ? " selected" : "")}
                onClick={() => selectLine(it.lineId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLine(it.lineId); } }}
              >
                <div className="pos-oline-qty">{it.quantity}</div>
                <div className="pos-oline-body">
                  <div className="pos-oline-name truncate">
                    {it.name}
                    {isCombo ? <span className="pos-oline-combo">COMBO</span> : null}
                    {it.course ? <span className="pos-oline-combo" style={{ background: '#7c3aed' }} title={courseLabel(it.course)}>C{it.course}</span> : null}
                  </div>
                  <div className="pos-oline-sub">
                    {it.discountPercent > 0 ? ` −${it.discountPercent}%` : ""}
                  </div>
                  {it.variantName && <div className="pos-oline-meta truncate">{it.variantName}</div>}
                  {it.accompanimentNames && it.accompanimentNames.length > 0 && (
                    <div className="pos-oline-meta truncate">+ {it.accompanimentNames.join(", ")}</div>
                  )}
                  {it.modifiers && it.modifiers.length > 0 ? (
                    <div className="pos-oline-meta amber truncate">
                      {it.modifiers.map((m) => (m as any).kitchenPrintName ?? m.name).filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                  {it.note ? <div className="pos-oline-note truncate">! {it.note}</div> : null}
                </div>
                <div className="pos-oline-price">{fmt(lineSub)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Totals */}
      <div className="pos-order-totals">
        <div className="pos-totals-row">
          <span>Subtotal</span>
          <span className="pos-amt">{fmt(subtotal)}</span>
        </div>
        {transactionDiscountPercent > 0 ? (
          <div className="pos-totals-row">
            <span>Discount ({transactionDiscountPercent}%)</span>
            <span className="pos-amt text-emerald-600">−{fmt(txDisc)}</span>
          </div>
        ) : null}
        <div className="pos-totals-row big">
          <span>TOTAL</span>
          <span className="pos-amt">{fmt(total)}</span>
        </div>
      </div>

      {/* Control rows — act on the selected line / order */}
      <div className="pos-ctl-rows">
        <div className="pos-ctl-row">
          <button type="button" className="pos-ctl-btn" onClick={onAddCustomer} title="Customer">
            <User className="h-4 w-4" /><span>Customer</span>
          </button>
          <button type="button" className="pos-ctl-btn" disabled={noSel || !canDiscount} onClick={() => selectedLine && onLineDiscount(selectedLine)} title={canDiscount ? "Line discount on selected item" : "Requires discount permission"}>
            <Tag className="h-4 w-4" /><span>Disc</span>
          </button>
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="pos-ctl-btn" disabled={noSel && empty} title="More actions">
                <MoreHorizontal className="h-4 w-4" /><span>More</span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>More Actions</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 p-2">
                {/* Line actions (require selection) */}
                {!noSel && (
                  <>
                    <Button variant="outline" className="w-full justify-start" onClick={() => selectedLine && onNote(selectedLine)}>
                      <StickyNote className="h-4 w-4 mr-2" /> Note
                    </Button>
                    {onVoidItem && (
                      <Button variant="destructive" className="w-full justify-start" onClick={() => selectedLine && onVoidItem(selectedLine)}>
                        <AlertTriangle className="h-4 w-4 mr-2" /> Void
                      </Button>
                    )}
                    {onRemove && (
                      <Button variant="destructive" className="w-full justify-start" onClick={() => selectedLine && onRemove(selectedLine)}>
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </Button>
                    )}
                    {/* P5 — assign this line to a course for fire/hold. */}
                    {!hideCafeFeatures && (
                      <div className="pt-1">
                        <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1"><Utensils className="h-3.5 w-3.5" /> Course</div>
                        <div className="flex gap-1.5 flex-wrap">
                          <Button size="sm" variant={!selectedLine?.course ? 'default' : 'outline'} onClick={() => selectedLine && setCourse(selectedLine.lineId, undefined)}>None</Button>
                          {COURSES.map((c) => (
                            <Button key={c.n} size="sm" variant={selectedLine?.course === c.n ? 'default' : 'outline'} onClick={() => selectedLine && setCourse(selectedLine.lineId, c.n)}>{c.n} · {c.label}</Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {/* Order-level actions */}
                {!empty && (
                  <>
                    <hr className="my-2 border-slate-200" />
                    <Button variant="outline" className="w-full justify-start" disabled={!canDiscount} onClick={onAddDiscount} title={canDiscount ? "Order discount" : "Requires discount permission"}>
                      <Percent className="h-4 w-4 mr-2" /> Discount %
                    </Button>
                    {!hideCafeFeatures && onMoveItems && (
                      <Button variant="outline" className="w-full justify-start" onClick={onMoveItems} title="Move items to another table">
                        <ArrowLeftRight className="h-4 w-4 mr-2" /> Move
                      </Button>
                    )}
                    {!hideCafeFeatures && onSplit && (
                      <Button variant="outline" className="w-full justify-start" onClick={onSplit} title="Split the bill">
                        <SplitIcon className="h-4 w-4 mr-2" /> Split
                      </Button>
                    )}
                    {hideCafeFeatures && onHold && (
                      <Button variant="outline" className="w-full justify-start" onClick={onHold} title="Park this order">
                        <Pause className="h-4 w-4 mr-2" /> Hold
                      </Button>
                    )}
                    {hideCafeFeatures && onHeldOrders && (
                      <Button variant="outline" className="w-full justify-start" onClick={onHeldOrders} title="Recall a parked order">
                        <Pause className="h-4 w-4 mr-2" /> Held
                      </Button>
                    )}
                    {hideCafeFeatures && onHandover && (
                      <Button variant="outline" className="w-full justify-start" onClick={onHandover} title="Hand over shift">
                        <ArrowLeftRight className="h-4 w-4 mr-2" /> Handover
                      </Button>
                    )}
                    {/* P5 — fire a course to the kitchen (leaves other courses held). */}
                    {!hideCafeFeatures && onFireCourse && hasCourses && (
                      <>
                        <hr className="my-2 border-slate-200" />
                        <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1"><Flame className="h-3.5 w-3.5" /> Fire course to kitchen</div>
                        <div className="flex flex-wrap gap-1.5">
                          {COURSES.map((c) => (
                            <Button key={c.n} variant="outline" size="sm" onClick={() => onFireCourse(c.n)} title={`Fire ${c.label} now`}>
                              <Flame className="h-4 w-4 mr-1" /> {c.label}
                            </Button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Numpad — Odoo model: pick a line, choose a mode, type digits. */}
        <div className="pos-numpad">
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('1')}>1</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('2')}>2</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('3')}>3</button>
          <button type="button" className={"pos-numkey mode" + (mode === 'qty' ? ' active' : '')} disabled={noSel} onClick={() => pickMode('qty')} title="Edit quantity">
            <span className="pos-numkey-lbl">Qty</span>
            <span className="pos-numkey-val">{modeValue('qty')}</span>
          </button>

          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('4')}>4</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('5')}>5</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('6')}>6</button>
          <button type="button" className={"pos-numkey mode" + (mode === 'disc' ? ' active' : '')} disabled={noSel || !canDiscount} onClick={() => pickMode('disc')} title={canDiscount ? "Edit discount %" : "Requires discount permission"}>
            <span className="pos-numkey-lbl">%</span>
            <span className="pos-numkey-val">{modeValue('disc')}</span>
          </button>

          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('7')}>7</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('8')}>8</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('9')}>9</button>
          <button type="button" className={"pos-numkey mode" + (mode === 'price' ? ' active' : '')} disabled={noSel || !canOverridePrice} onClick={() => pickMode('price')} title={canOverridePrice ? "Edit unit price" : "Requires price-override permission"}>
            <span className="pos-numkey-lbl">Price</span>
            <span className="pos-numkey-val">{modeValue('price')}</span>
          </button>

          <button type="button" className="pos-numkey op" disabled={noSel || mode === 'qty'} onClick={pressSign} title="Toggle sign">±</button>
          <button type="button" className="pos-numkey" disabled={noSel} onClick={() => pressDigit('0')}>0</button>
          <button type="button" className="pos-numkey op" disabled={noSel} onClick={pressDot}>.</button>
          <button type="button" className="pos-numkey back" disabled={noSel} onClick={pressBackspace} title="Backspace">
            <BackspaceIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Primary actions — print + pay */}
      <div className="pos-order-actions">
        {!hideCafeFeatures && (
          <button type="button" className="pos-action-btn-pro bg-sky-600" onClick={onPrintKot} disabled={empty}>
            <Printer className="pos-action-icon" />KOT
          </button>
        )}

        <button
          type="button"
          className="pos-action-btn-pro bg-purple"
          onClick={billAlreadyPrinted ? onPrintAdditionalBill : onPrintBill}
          disabled={empty}
          title={billAlreadyPrinted ? 'Print additional bill for new items' : 'Print bill (F8)'}
        >
          <Receipt className="pos-action-icon" /> {billAlreadyPrinted ? 'Add Bill' : 'Bill'}{' '}
          {!billAlreadyPrinted && <span className="pos-kbd">F8</span>}
        </button>


        {tableId && onSettleTab ? (
          <button type="button" className="pos-action-btn-pro bg-emerald pos-pay" onClick={onSettleTab} disabled={empty} title="Settle (pay) this table's order">
            <CreditCard className="pos-action-icon" /> Settle Bill
          </button>
        ) : (
          <button type="button" className="pos-action-btn-pro bg-emerald pos-pay" onClick={onCharge} disabled={empty}>
            <CreditCard className="pos-action-icon" /> Pay <span className="pos-kbd">F2</span>
          </button>
        )}
      </div>
    </div>
  );
};
