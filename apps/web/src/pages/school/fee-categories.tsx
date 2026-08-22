import { useState } from 'react';
import {
  useFeeCategories,
  useCreateFeeCategory,
  useUpdateFeeCategory,
  useDeleteFeeCategory,
  type FeeCategory,
} from '@/features/school/api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { CatalogPage, CatalogDialog, Field, selectCls } from './_components/catalog-page';
import { apiError } from './fees-shared';

type Draft = {
  code: string;
  name: string;
  type: 'mandatory' | 'optional';
  description: string;
  paymentOrder: number;
  isActive: boolean;
};

const emptyDraft: Draft = {
  code: '',
  name: '',
  type: 'mandatory',
  description: '',
  paymentOrder: 1,
  isActive: true,
};

export function SchoolFeeCategoriesPage() {
  const { data, isLoading } = useFeeCategories();
  const createCat = useCreateFeeCategory();
  const updateCat = useUpdateFeeCategory();
  const deleteCat = useDeleteFeeCategory();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const rows = [...(data?.data ?? [])].sort(
    (a, b) => a.paymentOrder - b.paymentOrder || a.name.localeCompare(b.name),
  );
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const openCreate = () => {
    // Default the payment order to the end of the list so a new category does
    // not silently tie with an existing one.
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.paymentOrder)) + 1 : 1;
    setDraft({ ...emptyDraft, paymentOrder: nextOrder });
    setEditingId(null);
    setOpen(true);
  };

  const openEdit = (c: FeeCategory) => {
    setDraft({
      code: c.code,
      name: c.name,
      type: c.type,
      description: c.description ?? '',
      paymentOrder: c.paymentOrder,
      isActive: c.isActive,
    });
    setEditingId(c.id);
    setOpen(true);
  };

  const save = async () => {
    const payload = {
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      type: draft.type,
      description: draft.description.trim() || undefined,
      paymentOrder: Number(draft.paymentOrder) || 0,
      isActive: draft.isActive,
    };
    if (!payload.code || !payload.name) {
      notify.error('Code and name are required');
      return;
    }
    try {
      if (editingId) {
        await updateCat.mutateAsync({ id: editingId, ...payload });
        notify.success('Fees category updated successfully!');
      } else {
        await createCat.mutateAsync(payload);
        notify.success('Fees category created successfully!');
      }
      setOpen(false);
    } catch (e) {
      notify.error(apiError(e, 'Could not save fee category'));
    }
  };

  const remove = async (c: FeeCategory) => {
    try {
      await deleteCat.mutateAsync(c.id);
      notify.success('Fees category deleted');
    } catch (e) {
      notify.error(apiError(e, 'Could not delete fee category'));
    }
  };

  /**
   * Payment order is editable inline: reordering is the one edit a bursar makes
   * constantly, and making them open a modal for it is the friction the old
   * screen had.
   */
  const changeOrder = async (c: FeeCategory, paymentOrder: number) => {
    try {
      await updateCat.mutateAsync({ id: c.id, paymentOrder });
    } catch (e) {
      notify.error(apiError(e, 'Could not reorder'));
    }
  };

  return (
    <>
      <CatalogPage<FeeCategory>
        title="Fees Categories"
        subtitle="A list of all the fees categories in this school. Mandatory categories bill every student in a structure's scope; optional ones bill only the students you assign them to."
        rows={rows}
        isLoading={isLoading}
        rowKey={(c) => c.id}
        searchFields={(c) => [c.code, c.name, c.type, c.description ?? '']}
        addLabel="Add Fees Category"
        onAdd={openCreate}
        onEdit={openEdit}
        onDelete={remove}
        deleteLabel={(c) => `"${c.name}"`}
        emptyMessage="No fees categories yet. Add one to start building fee structures."
        exportFilename="fees-categories"
        columns={[
          {
            key: 'paymentOrder',
            label: 'Payment Order',
            className: 'w-32',
            exportValue: (c) => String(c.paymentOrder),
            render: (c) => (
              <select
                className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
                value={c.paymentOrder}
                onChange={(e) => void changeOrder(c, Number(e.target.value))}
              >
                {Array.from({ length: Math.max(rows.length, c.paymentOrder) + 1 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ),
          },
          { key: 'code', label: 'Code', className: 'font-mono text-xs' },
          { key: 'name', label: 'Fees category', className: 'font-medium' },
          {
            key: 'type',
            label: 'Mandatory/Optional',
            exportValue: (c) => (c.type === 'mandatory' ? 'Mandatory' : 'Optional'),
            render: (c) => (
              <Badge variant={c.type === 'mandatory' ? 'default' : 'secondary'}>
                {c.type === 'mandatory' ? 'Mandatory' : 'Optional'}
              </Badge>
            ),
          },
          {
            key: 'description',
            label: 'Description',
            exportValue: (c) => c.description ?? '',
            render: (c) => <span className="text-muted-foreground">{c.description || '—'}</span>,
          },
          {
            key: 'isActive',
            label: 'Status',
            exportValue: (c) => (c.isActive ? 'Active' : 'Inactive'),
            render: (c) => (
              <Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
            ),
          },
        ]}
      />

      <CatalogDialog
        open={open}
        onOpenChange={setOpen}
        title={editingId ? 'Edit Fees Category' : 'Create New Fees Category'}
        description="Categories are the reusable fee types every fee structure prices."
        onSave={save}
        saving={createCat.isPending || updateCat.isPending}
        saveLabel={editingId ? 'Update Fees Category' : 'Create Fees Category'}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" required hint="Short unique key used on invoices, e.g. TUITION.">
            <Input
              value={draft.code}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              placeholder="TUITION"
            />
          </Field>
          <Field label="Fees category name" required>
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="School Fees" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Mandatory / Optional"
            required
            hint={
              draft.type === 'mandatory'
                ? 'Billed to every student the fee structure applies to.'
                : 'Billed only to students you assign it to on the Optional Fees screen.'
            }
          >
            <select
              className={selectCls}
              value={draft.type}
              onChange={(e) => set({ type: e.target.value as Draft['type'] })}
            >
              <option value="mandatory">Mandatory</option>
              <option value="optional">Optional</option>
            </select>
          </Field>
          <Field label="Payment order" hint="Lower numbers are collected and displayed first.">
            <Input
              type="number"
              min={0}
              value={draft.paymentOrder}
              onChange={(e) => set({ paymentOrder: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            rows={2}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Optional notes shown to bursars"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active
        </label>
      </CatalogDialog>
    </>
  );
}
