import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { usePartners } from '@/features/partners/api';
import { useProducts } from '@/features/products/api';
import { useCreateExpense, usePostExpense, type CreateExpenseInput } from '@/features/invoicing/api';

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface LineForm {
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
  reference?: string;
  lines: LineForm[];
}

export function ExpenseCreatePage() {
  const navigate = useNavigate();
  const partners = usePartners({ page: 1, pageSize: 200 });
  const products = useProducts({ page: 1, pageSize: 200 });
  const createExpense = useCreateExpense();
  const postExpense = usePostExpense();

  const today = new Date().toISOString().slice(0, 10);
  const { register, control, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: { partnerId: '', issueDate: today, dueDate: '', reference: '', lines: [{ quantity: 1 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const productList = products.data?.data ?? [];

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

    const payload: CreateExpenseInput = {
      partnerId: values.partnerId,
      issueDate: values.issueDate,
      dueDate: values.dueDate || undefined,
      reference: values.reference || undefined,
      lines: values.lines.map((l) => ({
        productId: l.productId || undefined,
        description: l.description || undefined,
        quantity: Number.isFinite(l.quantity) ? Number(l.quantity) : 1,
        unitPrice: Number.isFinite(l.unitPrice) ? Number(l.unitPrice) : undefined,
        discountPercent: Number.isFinite(l.discountPercent) ? Number(l.discountPercent) : undefined,
      })),
    };

    const bill = await createExpense.mutateAsync(payload);
    if (action === 'post') await postExpense.mutateAsync(bill.id);
    navigate(`/expenses/${bill.id}`);
  });

  const busy = createExpense.isPending || postExpense.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New Expense</h1>
        <div className="flex gap-2">
          <Button type="submit" name="action" value="save" variant="outline" disabled={busy}>
            Save draft
          </Button>
          <Button type="submit" name="action" value="post" disabled={busy}>
            Save &amp; Post
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Supplier</Label>
            <select className={selectClass} {...register('partnerId', { required: true })}>
              <option value="">Select supplier</option>
              {(partners.data?.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" {...register('reference')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="issueDate">Bill date</Label>
            <Input id="issueDate" type="date" {...register('issueDate', { required: true })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dueDate">Due date</Label>
            <Input id="dueDate" type="date" {...register('dueDate')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Lines</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => append({ quantity: 1 })}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-3">
                <Label className="text-xs">Product</Label>
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
                <Label className="text-xs">Description</Label>
                <Input {...register(`lines.${index}.description`)} />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">Qty</Label>
                <Input type="number" step="any" {...register(`lines.${index}.quantity`, { valueAsNumber: true })} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Unit price</Label>
                <Input type="number" step="any" {...register(`lines.${index}.unitPrice`, { valueAsNumber: true })} />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">Disc %</Label>
                <Input
                  type="number"
                  step="any"
                  {...register(`lines.${index}.discountPercent`, { valueAsNumber: true })}
                />
              </div>
              <div className="col-span-1 pb-2 text-right text-sm">{money(lineTotal(lines?.[index]))}</div>
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
          ))}

          <div className="flex justify-end border-t pt-3">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal (net of discount)</span>
                <span>{money(subtotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Tax is applied from each product when the bill is posted.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
