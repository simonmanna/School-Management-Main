import { useState } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Paginated } from '@/features/school/api';

const S = '/school';

export interface CrudField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'boolean' | 'textarea' | 'readonly';
  required?: boolean;
  /** Static options for select. */
  options?: { value: string; label: string }[];
  /** Async loader for select options (e.g. parent entity). */
  optionsLoader?: () => Promise<{ value: string; label: string }[]>;
  /** Hide from the create/edit form. */
  hideForm?: boolean;
  /** Placeholder */
  placeholder?: string;
}

export interface SimpleCrudProps {
  title: string;
  endpoint: string; // e.g. 'academic-years' -> /school/academic-years
  /** Field shown as the row's primary label. */
  nameField: string;
  /** Columns in the table (defaults to all non-form fields). */
  columns: { key: string; label: string; render?: (row: any) => React.ReactNode }[];
  fields: CrudField[];
  /** Extra query key segment to isolate caches. */
  queryKey: string;
  /** Optional subtitle. */
  subtitle?: string;
}

export function SimpleCrud({ title, endpoint, nameField, columns, fields, queryKey, subtitle }: SimpleCrudProps) {
  const qc = useQueryClient();
  const path = `${S}/${endpoint}`;
  const { data, isLoading } = useQuery({
    queryKey: ['school', queryKey],
    queryFn: async () => (await api.get<Paginated<any>>(path, { params: { pageSize: 300 } })).data,
  });
  const rows = data?.data ?? [];

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [optionsCache, setOptionsCache] = useState<Record<string, { value: string; label: string }[]>>({});

  const loadOptions = async (f: CrudField) => {
    if (f.options) return f.options;
    if (f.optionsLoader) {
      if (!optionsCache[f.name]) setOptionsCache((c) => ({ ...c, [f.name]: [] }));
      const opts = await f.optionsLoader();
      setOptionsCache((c) => ({ ...c, [f.name]: opts }));
      return opts;
    }
    return [];
  };

  const openCreate = () => {
    const base: Record<string, any> = {};
    for (const f of fields) if (f.type === 'boolean') base[f.name] = false;
    setForm(base);
    setCreating(true);
  };
  const formatDateForInput = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  };

  const formatDateForDisplay = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  };

  const openEdit = (row: any) => {
    const base: Record<string, any> = {};
    for (const f of fields) {
      const val = row[f.name];
      base[f.name] = f.type === 'date' || f.type === 'datetime'
        ? formatDateForInput(val)
        : val ?? (f.type === 'boolean' ? false : '');
    }
    setForm(base);
    setEditing(row);
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
    setForm({});
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      for (const f of fields) {
        if (f.hideForm || f.type === 'readonly') continue;
        let v = form[f.name];
        if (f.type === 'number') v = v === '' || v === undefined ? undefined : Number(v);
        if (f.type === 'boolean') v = !!v;
        if (editing) {
          // An edit sends only what the user CHANGED. Sending every field made
          // saving an unrelated edit re-assert flags like `isCurrent`, and the
          // API treats that as "make this the current year" — which cleared the
          // school's current term (E2E audit Y1). Clearing a field sends null.
          const before = editing[f.name];
          const was =
            f.type === 'date' || f.type === 'datetime'
              ? formatDateForInput(before)
              : f.type === 'boolean'
                ? !!before
                : (before ?? '');
          const now = v === undefined ? '' : v;
          if (String(now) === String(was)) continue;
          payload[f.name] = now === '' ? null : now;
          continue;
        }
        if (v !== undefined && v !== '') payload[f.name] = v;
      }
      if (editing && Object.keys(payload).length === 0) {
        close();
        return;
      }
      if (editing) {
        await api.patch(`${path}/${editing.id}`, payload);
        notify.success('Updated');
      } else {
        await api.post(path, payload);
        notify.success('Created');
      }
      qc.invalidateQueries({ queryKey: ['school', queryKey] });
      close();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: any) => {
    if (!confirm(`Delete "${row[nameField]}"?`)) return;
    try {
      await api.delete(`${path}/${row.id}`);
      notify.success('Deleted');
      qc.invalidateQueries({ queryKey: ['school', queryKey] });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Delete failed');
    }
  };

  const formFields = fields.filter((f) => !f.hideForm && f.type !== 'readonly');
  const dialogOpen = creating || !!editing;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <Button onClick={openCreate} className="gap-1">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No {title.toLowerCase()} yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2">{c.label}</th>
                ))}
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                  {columns.map((c) => {
                    let val = c.render ? c.render(row) : row[c.key];
                    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
                      val = formatDateForDisplay(val);
                    }
                    return <td key={c.key} className="px-4 py-2">{val}</td>;
                  })}
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(row)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(row)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${title}` : `New ${title}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {formFields.map((f) => (
              <FormField
                key={f.name}
                field={f}
                value={form[f.name]}
                options={optionsCache[f.name] ?? []}
                onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))}
                onLoadOptions={() => loadOptions(f)}
              />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="gap-1">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormField({
  field,
  value,
  options,
  onChange,
  onLoadOptions,
}: {
  field: CrudField;
  value: any;
  options: { value: string; label: string }[];
  onChange: (v: any) => void;
  onLoadOptions: () => Promise<{ value: string; label: string }[]>;
}) {
  const [loaded, setLoaded] = useState(false);
  const type = field.type ?? 'text';

  if (type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} id={field.name} />
        <Label htmlFor={field.name}>{field.label}</Label>
      </div>
    );
  }
  if (type === 'select') {
    if (!loaded && field.optionsLoader) {
      onLoadOptions().then(() => setLoaded(true));
    }
    const opts = field.options ?? options;
    return (
      <div className="space-y-1">
        <Label>{field.label}</Label>
        <select
          className="h-9 w-full rounded-md border bg-card px-3 text-sm"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }
  if (type === 'textarea') {
    return (
      <div className="space-y-1">
        <Label>{field.label}</Label>
        <Textarea value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label>{field.label}{field.required && ' *'}</Label>
      <Input
        type={type === 'number' ? 'number' : type === 'date' || type === 'datetime' ? 'date' : 'text'}
        value={value ?? ''}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export { Badge };
