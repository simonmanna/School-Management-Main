import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { Plus, Section, StickyNote, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { usePartners } from '@/features/partners/api';
import { useProducts } from '@/features/products/api';
import {
  useCreateInvoice,
  usePostInvoice,
  useInvoiceJournalPreview,
  type CreateInvoiceInput,
  type InvoiceJournalPreview,
} from '@/features/invoicing/api';
import {
  usePaymentTerms,
  useFiscalPositions,
  useJournals,
  useCompanySettings,
  type PaymentTerm,
  type Journal,
} from '@/features/accounting/api';
import { useHrEmployees, type HrEmployee } from '@/features/hr/api';

const selectClass =
  'flex h-10 w-full rounded-md border border-sky-200 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';

/** Compact variant for the condensed header table. */
const selectClassSm =
  'flex h-8 w-full rounded-md border border-sky-200 bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';

/** Local date → yyyy-mm-dd without timezone shifting. */
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Client-side mirror of the backend's due-date computation (PaymentTermService). */
export function dueDateForTerm(term: PaymentTerm | undefined, issueDate: string): string {
  if (!term || term.method === 'immediate') return issueDate;
  const base = new Date(`${issueDate}T00:00:00`);
  if (term.method === 'end_of_following_month') {
    const eom = new Date(base.getFullYear(), base.getMonth() + 2, 0);
    eom.setDate(eom.getDate() + term.netDays);
    return fmtLocal(eom);
  }
  base.setDate(base.getDate() + term.netDays);
  return fmtLocal(base);
}

/** Display labels for the back-office invoice payment method (InvoicePaymentMode). */
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_money: 'Mobile Money',
  mixed: 'Mixed',
  credit: 'Credit (house account)',
};

const INCOTERM_OPTIONS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];

/** Odoo file-tab: bold uppercase micro-label row. */
function TabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
        active ? 'border-sky-600 text-sky-700' : 'border-transparent text-muted-foreground hover:text-sky-700'
      }`}
    >
      {children}
    </button>
  );
}

/** Right-panel totals row (mirrors invoice-detail). */
function SummaryRow({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className={`flex justify-between gap-8 text-sm ${bold ? 'font-bold' : ''} ${accent ? 'text-red-700' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className={bold ? 'font-bold' : ''}>{value}</span>
    </div>
  );
}

/** Right-side meta table row holding a form control (mirrors detail's Odoo header). */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th className="text-left text-sky-600 font-medium py-0.5 w-32 align-top">{label}</th>
      <td className="py-0.5">{children}</td>
    </tr>
  );
}

interface LineForm {
  /** 'product' (default) | 'section' | 'note' (Odoo-style display rows). */
  lineType?: string;
  productId?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  discountPercent?: number;
}
interface FormValues {
  partnerId: string;
  issueDate: string;
  dueDate?: string;
  paymentTermId?: string;
  /* Other Info (Odoo-style sale attributes) */
  paymentMode?: string;
  fiscalPositionId?: string;
  invoicingJournalId?: string;
  salespersonId?: string;
  sourceDocument?: string;
  /* Delivery */
  deliveryDate?: string;
  deliveryAddress?: string;
  incoterm?: string;
  incotermLocation?: string;
  reference?: string;
  lines: LineForm[];
}

export function InvoiceCreatePage() {
  const navigate = useNavigate();
  const partners = usePartners({ page: 1, pageSize: 200 });
  const products = useProducts({ page: 1, pageSize: 200 });
  const { data: paymentTerms } = usePaymentTerms();
  const { data: fiscalPositions } = useFiscalPositions();
  const { data: journalsData } = useJournals();
  const { data: employeesData } = useHrEmployees({ pageSize: 200 });
  const createInvoice = useCreateInvoice();
    const postInvoice = usePostInvoice();
    const currency = useAuthStore((s) => s.organization?.currencyCode ?? 'IDR');
    const companySettingsQ = useCompanySettings();
    const journalPreview = useInvoiceJournalPreview();
    const [preview, setPreview] = useState<InvoiceJournalPreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewPending, setPreviewPending] = useState(false);
    const defaultJournalApplied = useRef(false);

  const today = new Date().toISOString().slice(0, 10);
  const { register, control, handleSubmit, watch, setValue, getValues } = useForm<FormValues>({
    defaultValues: {
      partnerId: '',
      issueDate: today,
      dueDate: '',
      paymentTermId: '',
      paymentMode: '',
      fiscalPositionId: '',
      invoicingJournalId: '',
      salespersonId: '',
      sourceDocument: '',
      deliveryDate: '',
      deliveryAddress: '',
      incoterm: '',
      incotermLocation: '',
      reference: '',
      lines: [{ quantity: 1 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const productList = products.data?.data ?? [];
  const terms = paymentTerms?.filter((t) => t.isActive) ?? [];
  const fiscalPositionList = (fiscalPositions ?? []).filter((f) => f.isActive);
  const journalList = (journalsData?.data ?? []).filter(
    (j: Journal) => j.isActive && j.journalType === 'sales',
  );
  const salespersonList = (employeesData?.data ?? []) as HrEmployee[];

  /* When a payment term is chosen, auto-fill the due date from its method. */
  const selectedTermId = watch('paymentTermId');
  const issueDate = watch('issueDate');
  const partnerId = watch('partnerId');
  const invoicingJournalId = watch('invoicingJournalId');
  const selectedTerm = terms.find((t) => t.id === selectedTermId);
  const [activeTab, setActiveTab] = useState<'lines' | 'info' | 'delivery' | 'journal'>('lines');
  useEffect(() => {
    if (selectedTermId && issueDate) {
      setValue('dueDate', dueDateForTerm(selectedTerm, issueDate));
    }
  }, [selectedTermId, issueDate, selectedTerm, setValue]);

  /* Preselect the org's Default Sales Journal (Company Settings) in the
     "Invoicing Journal" picker when the user hasn't chosen one yet — so the
     entry is "automatic in the default sales journal" by default. */
  useEffect(() => {
    if (defaultJournalApplied.current || !companySettingsQ.data) return;
    defaultJournalApplied.current = true;
    const defId = companySettingsQ.data.defaultSalesJournalId;
    if (defId && !watch('invoicingJournalId')) setValue('invoicingJournalId', defId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySettingsQ.data, invoicingJournalId, setValue]);

  /* Live, read-only preview of the journal entry that Save & Post will create.
     Uses getValues() when the debounce fires (watch('lines') from a useFieldArray
     can lag nested setValue calls), so the payload always carries the current
     line selections. */
  useEffect(() => {
    if (activeTab !== 'journal') return;
    let cancelled = false;
    const values = getValues();
    if (!values.partnerId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const payload: CreateInvoiceInput = {
      partnerId: values.partnerId,
      issueDate: values.issueDate || today,
      invoicingJournalId: values.invoicingJournalId || undefined,
      lines: (values.lines ?? [])
        .filter((l) => l.productId)
        .map((l) => ({
          lineType: l.lineType ?? 'product',
          productId: l.productId,
          description: l.description || undefined,
          quantity: Number.isFinite(l.quantity) ? Number(l.quantity) : 1,
          unitPrice: Number.isFinite(l.unitPrice) ? Number(l.unitPrice) : undefined,
          discountPercent: Number.isFinite(l.discountPercent) ? Number(l.discountPercent) : undefined,
        })),
    };
    const t = setTimeout(async () => {
      setPreviewPending(true);
      try {
        const data = await journalPreview.mutateAsync(payload);
        if (!cancelled) {
          setPreview(data);
          setPreviewError(null);
        }
      } catch (e: any) {
        if (!cancelled) setPreviewError(e?.response?.data?.message ?? e?.message ?? 'Could not compute the entry');
      } finally {
        if (!cancelled) setPreviewPending(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, partnerId, invoicingJournalId, lines]);

  const lineTotal = (l?: LineForm): number => {
    if (!l) return 0;
    const product = productList.find((p) => p.id === l.productId);
    const price = Number.isFinite(l.unitPrice)
      ? Number(l.unitPrice)
      : product?.salesPrice != null
        ? Number(product.salesPrice)
        : 0;
    const qty = Number.isFinite(l.quantity) ? Number(l.quantity) : 0;
    const disc = Number.isFinite(l.discountPercent) ? Number(l.discountPercent) : 0;
    return qty * price * (1 - disc / 100);
  };
  const subtotal = (lines ?? []).reduce((s, l) => s + lineTotal(l), 0);

  const onProductChange = (index: number, productId: string) => {
    setValue(`lines.${index}.productId`, productId);
    const p = productList.find((x) => x.id === productId);
    if (p) {
      setValue(`lines.${index}.description`, p.name);
      if (p.salesPrice != null) setValue(`lines.${index}.unitPrice`, Number(p.salesPrice));
    }
  };

  const onSubmit = handleSubmit(async (values, event) => {
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)?.submitter as
      | HTMLButtonElement
      | undefined;
    const action = submitter?.value ?? 'save';

    const payload: CreateInvoiceInput = {
      partnerId: values.partnerId,
      issueDate: values.issueDate,
      dueDate: values.dueDate || undefined,
      paymentTermId: values.paymentTermId || undefined,
      paymentMode: values.paymentMode || undefined,
      fiscalPositionId: values.fiscalPositionId || undefined,
      invoicingJournalId: values.invoicingJournalId || undefined,
      salespersonId: values.salespersonId || undefined,
      deliveryDate: values.deliveryDate || undefined,
      deliveryAddress: values.deliveryAddress || undefined,
      incoterm: values.incoterm || undefined,
      incotermLocation: values.incotermLocation || undefined,
      sourceDocument: values.sourceDocument || undefined,
      reference: values.reference || undefined,
      lines: values.lines.map((l) => ({
        lineType: l.lineType ?? 'product',
        productId: l.productId || undefined,
        description: l.description || undefined,
        quantity: Number.isFinite(l.quantity) ? Number(l.quantity) : 1,
        unitPrice: Number.isFinite(l.unitPrice) ? Number(l.unitPrice) : undefined,
        discountPercent: Number.isFinite(l.discountPercent) ? Number(l.discountPercent) : undefined,
      })),
    };

    const invoice = await createInvoice.mutateAsync(payload);
    if (action === 'post') await postInvoice.mutateAsync(invoice.id);
    navigate(`/invoices/${invoice.id}`);
  });

  const busy = createInvoice.isPending || postInvoice.isPending;

  return (
    <form onSubmit={onSubmit} className="max-w-[1600px] mx-auto space-y-0 px-1 md:px-2">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900"
        >
          Invoices
        </button>
        <span className="text-sky-300">/</span>
        <span className="text-sm text-sky-900 font-semibold">New Invoice</span>
      </div>

      {/* Title bar */}
      <div className="rounded-t-lg bg-gradient-to-r from-sky-400 to-sky-500 px-6 py-3 flex items-center justify-between shadow-sm gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-white font-bold text-base tracking-wide whitespace-nowrap">NEW CUSTOMER INVOICE</h1>
          <Badge className="bg-white text-sky-700 border-white/60">Draft</Badge>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            type="submit"
            name="action"
            value="save"
            size="sm"
            variant="outline"
            className="bg-white/15 border-white/40 text-white hover:bg-white/25"
            disabled={busy}
          >
            Save draft
          </Button>
          <Button
            type="submit"
            name="action"
            value="post"
            size="sm"
            className="bg-white text-sky-700 hover:bg-sky-50 font-semibold shadow-sm"
            disabled={busy}
          >
            Save &amp; Post
          </Button>
        </div>
      </div>

      {/* Document card */}
      <div className="bg-white border border-t-0 border-sky-100 shadow-sm rounded-b-lg overflow-hidden">
        {/* Odoo header: customer left, meta right */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-sky-100 text-xs">
          <div className="px-4 py-3 bg-sky-50/30">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-sky-100">
                <MetaRow label="Customer">
                  <select className={selectClassSm} {...register('partnerId', { required: true })}>
                    <option value="">Select customer</option>
                    {(partners.data?.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </MetaRow>
                <MetaRow label="Reference">
                  <Input id="reference" className="h-8 text-xs px-2 py-1 border-sky-200 focus-visible:ring-sky-400" {...register('reference')} />
                </MetaRow>
                <MetaRow label="Invoice Date">
                  <Input id="issueDate" type="date" className="h-8 text-xs px-2 py-1 border-sky-200 focus-visible:ring-sky-400" {...register('issueDate', { required: true })} />
                </MetaRow>
                <MetaRow label="Payment Terms">
                  <select id="paymentTermId" className={selectClassSm} {...register('paymentTermId')}>
                    <option value="">No payment terms</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </MetaRow>
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 bg-sky-50/20">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-sky-100">
                <MetaRow label="Due Date">
                  <Input id="dueDate" type="date" className="h-8 text-xs px-2 py-1 border-sky-200 focus-visible:ring-sky-400" {...register('dueDate')} />
                </MetaRow>
                <MetaRow label="Currency">
                  <span className="text-sky-800 font-semibold">{currency}</span>
                </MetaRow>
                <MetaRow label="Salesperson">
                  <select id="salespersonId" className={selectClassSm} {...register('salespersonId')}>
                    <option value="">— Not assigned —</option>
                    {salespersonList.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.firstName} {e.lastName ?? ''}
                      </option>
                    ))}
                  </select>
                </MetaRow>
                <MetaRow label="Source Doc">
                  <Input id="sourceDocument" placeholder="SO/PO/reference of the originating doc" className="h-8 text-xs px-2 py-1 border-sky-200 focus-visible:ring-sky-400" {...register('sourceDocument')} />
                </MetaRow>
              </tbody>
            </table>
          </div>
        </div>

        {selectedTerm && (
          <div className="border-t border-sky-100 bg-muted/30">
            <div className="flex items-center justify-between px-6 py-3 text-sm">
              <span className="text-muted-foreground">
                Due date derived from <strong className="text-foreground">{selectedTerm.name}</strong>
              </span>
              <span className="font-mono">{dueDateForTerm(selectedTerm, issueDate)}</span>
            </div>
          </div>
        )}

        {/* Odoo file tabs */}
        <div className="border-b border-sky-200 px-4 bg-sky-50/40 flex gap-1 overflow-x-auto">
          <TabBtn active={activeTab === 'lines'} onClick={() => setActiveTab('lines')}>
            Invoice Lines
          </TabBtn>
          <TabBtn active={activeTab === 'info'} onClick={() => setActiveTab('info')}>
            Other Info
          </TabBtn>
          <TabBtn active={activeTab === 'delivery'} onClick={() => setActiveTab('delivery')}>
            Delivery
          </TabBtn>
          <TabBtn active={activeTab === 'journal'} onClick={() => setActiveTab('journal')}>
            Journal Entry
          </TabBtn>
        </div>

        {/* INVOICE LINES tab */}
        {activeTab === 'lines' && (
          <div>
            <div className="flex flex-col lg:flex-row">
              <div className="flex-1 overflow-x-auto">
                <div className="flex items-center justify-end gap-2 p-4 border-b border-sky-100 bg-sky-50/30">
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ quantity: 1 })}>
                    <Plus className="h-4 w-4" /> Add a line
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ lineType: 'section', description: '', quantity: 0 })}>
                    <Section className="h-4 w-4" /> Add a section
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ lineType: 'note', description: '', quantity: 0 })}>
                    <StickyNote className="h-4 w-4" /> Add a note
                  </Button>
                </div>
                <div className="space-y-2 p-4">
                  {fields.map((field, index) => {
                    const rowType = watch(`lines.${index}.lineType`) ?? 'product';
                    const isMeta = rowType === 'section' || rowType === 'note';
                    if (isMeta) {
                      return (
                        <div key={field.id} className="grid grid-cols-12 items-center gap-2">
                          <div className="col-span-11">
                            <Label className="text-xs">{rowType === 'section' ? 'Section title' : 'Note'}</Label>
                            <Input
                              className={rowType === 'section' ? 'font-bold uppercase tracking-wide' : 'italic text-slate-600'}
                              placeholder={rowType === 'section' ? 'e.g. Services' : 'e.g. Courtesy discount approved by manager'}
                              {...register(`lines.${index}.description`)}
                            />
                          </div>
                          <div className="col-span-1">
                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={fields.length <= 1}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={field.id} className="grid grid-cols-12 items-end gap-2 border-b border-sky-50 pb-2">
                        <div className="col-span-3">
                          <Label className="text-xs text-sky-600 font-bold uppercase tracking-wider">Product</Label>
                          <select
                            className={selectClass}
                            value={watch(`lines.${index}.productId`) ?? ''}
                            onChange={(e) => onProductChange(index, e.target.value)}
                          >
                            <option value="">— none —</option>
                            {productList.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-xs text-sky-600 font-bold uppercase tracking-wider">Description</Label>
                          <Input {...register(`lines.${index}.description`)} />
                        </div>
                        <div className="col-span-1">
                          <Label className="text-xs text-sky-600 font-bold uppercase tracking-wider">Qty</Label>
                          <Input type="number" step="any" className="border-sky-200 focus-visible:ring-sky-400" {...register(`lines.${index}.quantity`, { valueAsNumber: true })} />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs text-sky-600 font-bold uppercase tracking-wider">Unit price</Label>
                          <Input type="number" step="any" className="border-sky-200 focus-visible:ring-sky-400" {...register(`lines.${index}.unitPrice`, { valueAsNumber: true })} />
                        </div>
                        <div className="col-span-1">
                          <Label className="text-xs text-sky-600 font-bold uppercase tracking-wider">Disc %</Label>
                          <Input
                            type="number"
                            step="any"
                            className="border-sky-200 focus-visible:ring-sky-400"
                            {...register(`lines.${index}.discountPercent`, { valueAsNumber: true })}
                          />
                        </div>
                        <div className="col-span-1 pb-2 text-right text-sm font-semibold text-sky-900">{money(lineTotal(lines?.[index]))}</div>
                        <div className="col-span-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            disabled={fields.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Odoo right totals panel */}
              <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-sky-100 bg-gradient-to-b from-sky-50/60 to-sky-100/30 p-4 shrink-0">
                <div className="space-y-2">
                  <SummaryRow label="Untaxed Amount" value={money(subtotal)} />
                  <div className="border-t-2 border-sky-200 pt-2">
                    <SummaryRow label="TOTAL" value={money(subtotal)} bold />
                  </div>
                  <SummaryRow label="Amount Due" value={money(subtotal)} bold accent={subtotal > 0.005} />
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Tax is applied from each product when the invoice is posted.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* OTHER INFO tab */}
        {activeTab === 'info' && (
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
              <dl>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Fiscal Position</dt>
                  <dd className="mt-1">
                    <select id="fiscalPositionId" className={selectClass} {...register('fiscalPositionId')}>
                      <option value="">— No fiscal position —</option>
                      {fiscalPositionList.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Invoicing Journal</dt>
                  <dd className="mt-1">
                    <select id="invoicingJournalId" className={selectClass} {...register('invoicingJournalId')}>
                      <option value="">— Default sales journal —</option>
                      {journalList.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
              </dl>
              <dl>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Payment Method</dt>
                  <dd className="mt-1">
                    <select id="paymentMode" className={selectClass} {...register('paymentMode')}>
                      <option value="">— Not set —</option>
                      {Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Salesperson</dt>
                  <dd className="mt-1 text-sm text-sky-900">
                    {salespersonList.length === 0 ? '—' : 'Set above in the header.'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        {/* DELIVERY tab */}
        {activeTab === 'delivery' && (
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
              <dl>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Delivery Date</dt>
                  <dd className="mt-1">
                    <Input id="deliveryDate" type="date" className="border-sky-200 focus-visible:ring-sky-400" {...register('deliveryDate')} />
                  </dd>
                </div>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Delivery Address</dt>
                  <dd className="mt-1">
                    <Input id="deliveryAddress" placeholder="Street, city, region" className="border-sky-200 focus-visible:ring-sky-400" {...register('deliveryAddress')} />
                  </dd>
                </div>
              </dl>
              <dl>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Incoterm</dt>
                  <dd className="mt-1">
                    <select id="incoterm" className={selectClass} {...register('incoterm')}>
                      <option value="">— None —</option>
                      {INCOTERM_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div className="py-1.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Incoterm Location</dt>
                  <dd className="mt-1">
                    <Input id="incotermLocation" placeholder="e.g. Jakarta (ID)" className="border-sky-200 focus-visible:ring-sky-400" {...register('incotermLocation')} />
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        {/* JOURNAL ENTRY tab — read-only preview of the entry created on post */}
        {activeTab === 'journal' && (
          <div className="p-5 space-y-4">
            <div className="rounded-md border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs text-sky-800">
              When this invoice is <strong>posted</strong>, a journal entry is created automatically: it
              debits the customer receivable and credits the income and tax accounts of each product
              line. The entry lands in the <strong>Invoicing Journal</strong> chosen under Other Info, or
              in the business&apos;s default sales journal (Company Settings → Sales Journals). The
              numbers below are a live preview — the final entry is computed at post time.
            </div>

            {!partnerId || !(lines ?? []).some((l) => l.productId) ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Select a customer and add at least one product line to preview the journal entry.
              </div>
            ) : previewError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {previewError}
              </div>
            ) : preview ? (
              <div className="rounded-lg border border-sky-100 overflow-hidden bg-background">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-sky-100 bg-sky-50/60 px-4 py-3 text-xs">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Journal</div>
                    <div className="text-sm font-semibold text-sky-900">
                      {preview.journal.name}{' '}
                      <span className="font-mono text-xs font-normal text-muted-foreground">({preview.journal.code})</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Entry Date</div>
                    <div className="text-sm text-sky-900">{preview.postingDate}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Memo</div>
                    <div className="truncate text-sm text-sky-900">{preview.description ?? '—'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        preview.balanced
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-red-200 bg-red-50 text-red-700'
                      }
                    >
                      {preview.balanced ? 'Balanced' : 'Unbalanced'}
                    </Badge>
                    {previewPending && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> updating…
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-sky-100 bg-muted/30">
                      <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        <th className="px-4 py-2 w-10">#</th>
                        <th className="px-4 py-2">Account</th>
                        <th className="px-4 py-2">Label</th>
                        <th className="px-4 py-2">Partner</th>
                        <th className="px-4 py-2 text-right">Debit</th>
                        <th className="px-4 py-2 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sky-50">
                      {preview.lines.map((line) => (
                        <tr key={line.lineNumber}>
                          <td className="px-4 py-2 text-muted-foreground">{line.lineNumber}</td>
                          <td className="px-4 py-2">
                            {line.account ? (
                              <span className="font-mono text-xs text-sky-900">
                                {line.account.code} <span className="text-muted-foreground">·</span>{' '}
                                {line.account.name}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sky-900">{line.description ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{line.partnerName ?? '—'}</td>
                          <td className="px-4 py-2 text-right text-sky-900">
                            {line.debit ? money(Number(line.debit)) : ''}
                          </td>
                          <td className="px-4 py-2 text-right text-sky-900">
                            {line.credit ? money(Number(line.credit)) : ''}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-sky-100 bg-muted/30 font-semibold text-sky-900">
                        <td colSpan={4} className="px-4 py-2 text-right">
                          Total
                        </td>
                        <td className="px-4 py-2 text-right">{money(Number(preview.debitTotal))}</td>
                        <td className="px-4 py-2 text-right">{money(Number(preview.creditTotal))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-sky-100 px-4 py-2 text-[11px] text-muted-foreground">
                  Preview only — the entry number and sequence are assigned when the invoice is posted.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Computing journal entry…
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
