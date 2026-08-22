import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, CalendarClock, Users } from 'lucide-react';
import {
  useFeeStructures,
  useCreateFeeStructure,
  useUpdateFeeStructure,
  useDeleteFeeStructure,
  useFeeCategories,
  useAcademicYears,
  useClasses,
  useServiceProducts,
  type FeeComponent,
  type FeeStructure,
} from '@/features/school/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { CatalogPage, CatalogDialog, Field, selectCls } from './_components/catalog-page';
import { money, apiError } from './fees-shared';

type Draft = {
  name: string;
  academicYearId: string;
  classIds: string[];
  isActive: boolean;
  components: FeeComponent[];
};

const emptyDraft: Draft = { name: '', academicYearId: '', classIds: [], isActive: true, components: [] };

export function SchoolFeeStructuresPage() {
  const { data: structures, isLoading } = useFeeStructures();
  const { data: categories } = useFeeCategories();
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: products } = useServiceProducts();

  const createStructure = useCreateFeeStructure();
  const updateStructure = useUpdateFeeStructure();
  const deleteStructure = useDeleteFeeStructure();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const rows = structures?.data ?? [];
  const cats = useMemo(
    () => [...(categories?.data ?? [])].filter((c) => c.isActive).sort((a, b) => a.paymentOrder - b.paymentOrder),
    [categories],
  );
  const classById = useMemo(
    () => new Map((classes?.data ?? []).map((c) => [c.id, c.name])),
    [classes],
  );
  const yearById = useMemo(
    () => new Map((years?.data ?? []).map((y) => [y.id, y.name])),
    [years],
  );

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const total = (comps: FeeComponent[]) => comps.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const openCreate = () => {
    const currentYear = (years?.data ?? []).find((y) => y.isCurrent) ?? (years?.data ?? [])[0];
    setDraft({ ...emptyDraft, academicYearId: currentYear?.id ?? '', components: [] });
    setEditingId(null);
    setOpen(true);
  };

  const openEdit = (s: FeeStructure) => {
    setDraft({
      name: s.name,
      academicYearId: s.academicYearId,
      classIds: s.applicableTo?.classIds ?? [],
      isActive: s.isActive ?? true,
      components: (s.components ?? []).map((c) => ({ ...c })),
    });
    setEditingId(s.id);
    setOpen(true);
  };

  /* ── component row editing ── */

  const addComponent = () => {
    // Pre-select the first category not already priced, so clicking Add twice
    // does not create two rows for the same fee.
    const used = new Set(draft.components.map((c) => c.feeCategoryId));
    const next = cats.find((c) => !used.has(c.id)) ?? cats[0];
    if (!next) {
      notify.error('Create a fee category first — structures are priced per category.');
      return;
    }
    set({
      components: [
        ...draft.components,
        {
          code: next.code,
          name: next.name,
          feeCategoryId: next.id,
          amount: 0,
          isOptional: next.type === 'optional',
          productId: undefined,
        },
      ],
    });
  };

  const setComponent = (i: number, patch: Partial<FeeComponent>) =>
    set({ components: draft.components.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });

  /** Switching the category re-derives code, label and mandatory/optional. */
  const pickCategory = (i: number, feeCategoryId: string) => {
    const cat = cats.find((c) => c.id === feeCategoryId);
    if (!cat) return;
    setComponent(i, {
      feeCategoryId: cat.id,
      code: cat.code,
      name: cat.name,
      isOptional: cat.type === 'optional',
    });
  };

  const removeComponent = (i: number) => set({ components: draft.components.filter((_, idx) => idx !== i) });

  const save = async () => {
    const components = draft.components.filter((c) => c.feeCategoryId || c.code);
    if (!draft.name.trim()) return notify.error('Name is required');
    if (!draft.academicYearId) return notify.error('Academic year is required');
    if (components.length === 0) return notify.error('Add at least one fee component');
    if (components.some((c) => Number(c.amount) <= 0)) return notify.error('Every component needs an amount above zero');

    const payload = {
      name: draft.name.trim(),
      academicYearId: draft.academicYearId,
      components,
      applicableTo: draft.classIds.length ? { classIds: draft.classIds } : {},
      isActive: draft.isActive,
    };
    try {
      if (editingId) {
        await updateStructure.mutateAsync({ id: editingId, ...payload });
        notify.success('Fees structure updated successfully!');
      } else {
        await createStructure.mutateAsync(payload);
        notify.success('Fees structure set successfully!');
      }
      setOpen(false);
    } catch (e) {
      notify.error(apiError(e, 'Could not save fee structure'));
    }
  };

  const remove = async (s: FeeStructure) => {
    try {
      await deleteStructure.mutateAsync(s.id);
      notify.success('Fees structure deleted');
    } catch (e) {
      notify.error(apiError(e, 'Could not delete fee structure'));
    }
  };

  const scopeLabel = (s: FeeStructure) => {
    const ids = s.applicableTo?.classIds ?? [];
    if (ids.length === 0) return 'All classes';
    return ids.map((id) => classById.get(id) ?? id).join(', ');
  };

  return (
    <>
      <CatalogPage<FeeStructure>
        title="Fees Structure"
        subtitle="What each fee category costs, per academic year and class. Schedule a structure to a term, then run billing to invoice students."
        rows={rows}
        isLoading={isLoading}
        rowKey={(s) => s.id}
        searchFields={(s) => [s.name, yearById.get(s.academicYearId) ?? '', scopeLabel(s), ...(s.components ?? []).map((c) => c.name || c.code)]}
        addLabel="Add Fees Structure"
        onAdd={openCreate}
        onEdit={openEdit}
        onDelete={remove}
        deleteLabel={(s) => `"${s.name}"`}
        emptyMessage="No fees structures yet. Add one to price your fee categories."
        exportFilename="fees-structure"
        toolbarExtra={
          <>
            <Button variant="outline" asChild>
              <Link to="/school/fees/schedules">
                <CalendarClock className="h-4 w-4" /> Schedules
              </Link>
            </Button>
            <Button variant="destructive" asChild>
              <Link to="/school/fees?tab=billing">
                <Users className="h-4 w-4" /> Invoice Students
              </Link>
            </Button>
          </>
        }
        columns={[
          { key: 'name', label: 'Fees structure', className: 'font-medium' },
          {
            key: 'academicYearId',
            label: 'Year',
            exportValue: (s) => yearById.get(s.academicYearId) ?? '',
            render: (s) => yearById.get(s.academicYearId) ?? '—',
          },
          {
            key: 'classes',
            label: 'Class level',
            exportValue: scopeLabel,
            render: (s) => <span className="text-muted-foreground">{scopeLabel(s)}</span>,
          },
          {
            key: 'components',
            label: 'Fees categories',
            exportValue: (s) => (s.components ?? []).map((c) => `${c.name || c.code} ${c.amount}`).join(' | '),
            render: (s) => (
              <div className="flex flex-wrap gap-1">
                {(s.components ?? []).map((c, i) => (
                  <Badge key={`${c.code}-${i}`} variant={c.isOptional ? 'secondary' : 'default'} className="font-normal">
                    {c.name || c.code} · {money(c.amount)}
                    {c.isOptional && ' (opt)'}
                  </Badge>
                ))}
                {(s.components ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
              </div>
            ),
          },
          {
            key: 'total',
            label: 'Mandatory total',
            exportValue: (s) => String(total((s.components ?? []).filter((c) => !c.isOptional))),
            render: (s) => (
              <span className="font-semibold">{money(total((s.components ?? []).filter((c) => !c.isOptional)))}</span>
            ),
          },
          {
            key: 'schedules',
            label: 'Scheduled',
            exportValue: (s) => String(s.schedules?.length ?? 0),
            render: (s) =>
              (s.schedules?.length ?? 0) > 0 ? (
                <Badge variant="default">{s.schedules!.length} term(s)</Badge>
              ) : (
                <Badge variant="secondary">Not scheduled</Badge>
              ),
          },
        ]}
      />

      <CatalogDialog
        open={open}
        onOpenChange={setOpen}
        wide
        title={editingId ? 'Edit Fees Structure' : 'Create New Fees Structure'}
        description="Price each fee category once. Optional categories are only charged to students you assign them to."
        onSave={save}
        saving={createStructure.isPending || updateStructure.isPending}
        saveLabel={editingId ? 'Update Fees Structure' : 'Create Fees Structure'}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fees structure name" required>
            <Input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Standard Term Fees"
            />
          </Field>
          <Field label="Current study year" required>
            <select
              className={selectCls}
              value={draft.academicYearId}
              onChange={(e) => set({ academicYearId: e.target.value })}
            >
              <option value="">Select a year…</option>
              {(years?.data ?? []).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Class level"
          hint="Leave every class unticked to apply this structure to all classes."
        >
          <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-3">
            {(classes?.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.classIds.includes(c.id)}
                  onChange={(e) =>
                    set({
                      classIds: e.target.checked
                        ? [...draft.classIds, c.id]
                        : draft.classIds.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.name}
              </label>
            ))}
            {(classes?.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No classes defined yet.</p>
            )}
          </div>
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Fees categories &amp; amounts</span>
            <Button type="button" variant="outline" size="sm" onClick={addComponent}>
              <Plus className="h-4 w-4" /> Add category
            </Button>
          </div>

          {draft.components.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No categories priced yet. Click <strong>Add category</strong> to pull one in from the Fees Categories
              catalog.
            </p>
          )}

          {draft.components.map((c, i) => (
            <div key={i} className="grid items-end gap-2 rounded-md border p-2 sm:grid-cols-[1.4fr_1fr_1.2fr_auto]">
              <Field label="Fees category">
                <select className={selectCls} value={c.feeCategoryId ?? ''} onChange={(e) => pickCategory(i, e.target.value)}>
                  <option value="">Select…</option>
                  {cats.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} ({cat.type === 'mandatory' ? 'Mandatory' : 'Optional'})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount">
                <Input
                  type="number"
                  min={0}
                  value={c.amount || ''}
                  placeholder="E.G. 400000"
                  onChange={(e) => setComponent(i, { amount: Number(e.target.value) })}
                />
              </Field>
              <Field label="Revenue product" hint="Optional — defaults to the fee revenue account.">
                <select
                  className={selectCls}
                  value={c.productId ?? ''}
                  onChange={(e) => setComponent(i, { productId: e.target.value || undefined })}
                >
                  <option value="">Default account</option>
                  {(products?.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeComponent(i)} title="Remove">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
              <div className="sm:col-span-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!c.isOptional}
                    onChange={(e) => setComponent(i, { isOptional: e.target.checked })}
                  />
                  Optional — bill only students assigned this fee on the Optional Fees screen
                </label>
              </div>
            </div>
          ))}

          {draft.components.length > 0 && (
            <div className="flex justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span>Mandatory total (billed to every student in scope)</span>
              <span className="font-semibold">
                {money(total(draft.components.filter((c) => !c.isOptional)))}
              </span>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active
        </label>
      </CatalogDialog>
    </>
  );
}
