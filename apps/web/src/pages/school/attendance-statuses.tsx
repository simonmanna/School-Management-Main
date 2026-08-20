import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import {
  useAttendanceStatuses,
  useCreateAttendanceStatus,
  useUpdateAttendanceStatus,
  useDeleteAttendanceStatus,
  type AttendanceStatusConfig,
} from '@/features/school/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { notify } from '@/lib/notify';

interface FormState {
  code: string;
  label: string;
  color: string;
  isDefault: boolean;
  sortOrder: number;
  isPresent: boolean;
  isLate: boolean;
  isAbsent: boolean;
}

const emptyForm: FormState = {
  code: '',
  label: '',
  color: '#6b7280',
  isDefault: false,
  sortOrder: 0,
  isPresent: false,
  isLate: false,
  isAbsent: false,
};

export function SchoolAttendanceStatusesPage() {
  const { data, isLoading } = useAttendanceStatuses();
  const create = useCreateAttendanceStatus();
  const update = useUpdateAttendanceStatus();
  const remove = useDeleteAttendanceStatus();

  const rows: AttendanceStatusConfig[] = useMemo(
    () => (data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [data],
  );

  const [editing, setEditing] = useState<AttendanceStatusConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setForm({ ...emptyForm, sortOrder: rows.length + 1 }); setCreating(true); };
  const openEdit = (r: AttendanceStatusConfig) => {
    setForm({
      code: r.code,
      label: r.label,
      color: r.color,
      isDefault: r.isDefault,
      sortOrder: r.sortOrder,
      isPresent: r.isPresent,
      isLate: r.isLate,
      isAbsent: r.isAbsent,
    });
    setEditing(r);
  };
  const close = () => { setEditing(null); setCreating(false); setForm(emptyForm); };

  const save = async () => {
    if (!form.code.trim() || !form.label.trim()) { notify.error('Code and label are required'); return; }
    if (!/^[a-z0-9_]+$/.test(form.code.trim())) { notify.error('Code must be lowercase letters/numbers/underscore'); return; }
    setSaving(true);
    const payload = {
      code: form.code.trim().toLowerCase(),
      label: form.label.trim(),
      color: form.color,
      isDefault: form.isDefault,
      sortOrder: Number(form.sortOrder) || 0,
      isPresent: form.isPresent,
      isLate: form.isLate,
      isAbsent: form.isAbsent,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
      else await create.mutateAsync(payload);
      notify.success(editing ? 'Status updated' : 'Status created');
      close();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const del = async (r: AttendanceStatusConfig) => {
    if (!confirm(`Delete status "${r.label}"? This cannot be undone.`)) return;
    try {
      await remove.mutateAsync(r.id);
      notify.success('Status deleted');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Delete failed');
    }
  };

  const flagBadge = (label: string, on: boolean) =>
    on ? <Badge className="bg-slate-700 text-white">{label}</Badge> : null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Attendance Statuses</h1>
          <p className="text-sm text-muted-foreground">
            Configure the attendance options staff can mark (e.g. Absent, Present, Late). Seeded defaults: Absent / Present / Late.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1"><Plus className="h-4 w-4" /> Add status</Button>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No statuses yet. Click "Add status" to create one.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Color</th>
                <th className="px-4 py-2">Flags</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />
                      <span className="font-medium">{r.label}</span>
                      {r.isDefault && <Badge className="bg-emerald-600 text-white">default</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-2"><code className="text-xs">{r.color}</code></td>
                  <td className="px-4 py-2"><div className="flex flex-wrap gap-1">
                    {flagBadge('Present', r.isPresent)}
                    {flagBadge('Late', r.isLate)}
                    {flagBadge('Absent', r.isAbsent)}
                  </div></td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => del(r)} aria-label="Delete"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={creating || !!editing} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit status` : `New attendance status`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Status name *</Label>
                <Input value={form.label} placeholder="Late" onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Code *</Label>
                <Input value={form.code} placeholder="late" onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} />
                <p className="text-xs text-muted-foreground">Stable key, lowercase (e.g. "present"). Cannot change after creation.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Color</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 w-12 rounded border bg-card" />
                  <Input value={form.color} placeholder="#ff0000" onChange={(e) => setForm({ ...form, color: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Sort order</Label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Roll-up behaviour</Label>
              <div className="flex flex-wrap gap-4">
                <Check label="Default (first shown)" checked={form.isDefault} onChange={(v) => setForm({ ...form, isDefault: v })} />
                <Check label="Counts as Present" checked={form.isPresent} onChange={(v) => setForm({ ...form, isPresent: v })} />
                <Check label="Counts as Late" checked={form.isLate} onChange={(v) => setForm({ ...form, isLate: v })} />
                <Check label="Counts as Absent" checked={form.isAbsent} onChange={(v) => setForm({ ...form, isAbsent: v })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={save} disabled={saving} className="gap-1">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
