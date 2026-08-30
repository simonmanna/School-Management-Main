import { useState } from 'react';
import { Plus, Pencil, Trash2, CheckCircle2, XCircle, Loader2, Tag } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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
import {
  useStudentCategories,
  useCreateStudentCategory,
  useUpdateStudentCategory,
} from '@/features/school/api';

export function SchoolStudentCategoriesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useStudentCategories();
  const create = useCreateStudentCategory();
  const update = useUpdateStudentCategory();

  const rows = (data ?? []).slice().sort((a: any, b: any) => a.name.localeCompare(b.name));

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; description: string | null } | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const add = async () => {
    const v = name.trim();
    if (!v) return;
    try {
      await create.mutateAsync({ name: v, description: description.trim() || undefined });
      notify.success('Student category added');
      setName('');
      setDescription('');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not add student category');
    }
  };

  const startEdit = (r: any) => {
    setEditing({ id: r.id, name: r.name, description: r.description });
    setEditName(r.name);
    setEditDescription(r.description ?? '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const v = editName.trim();
    if (!v) return;
    try {
      await update.mutateAsync({
        id: editing.id,
        name: v,
        description: editDescription.trim() || undefined,
      });
      notify.success('Student category updated');
      setEditing(null);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not update student category');
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await update.mutateAsync({ id, isActive: !isActive });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not update student category');
    }
  };

  const remove = async (r: any) => {
    if (!confirm(`Delete "${r.name}"? Students using it will keep their value but the category becomes unavailable for new selections.`)) return;
    try {
      await api.delete(`/school/student-categories/${r.id}`);
      notify.success('Student category deleted');
      qc.invalidateQueries({ queryKey: ['school', 'studentCategories'] });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not delete student category');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Student Categories</h1>
          <p className="text-sm text-muted-foreground">
            Group students for reporting and fee/sponsorship rules (e.g. Day-Scholar, Boarder, Sponsored, Orphan).
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No student categories yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.description ?? '—'}</td>
                  <td className="px-4 py-2">
                    {r.isActive ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-600" /> Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <XCircle className="h-3 w-3 text-slate-400" /> Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" onClick={() => toggleActive(r.id, r.isActive)} aria-label="Toggle active">
                      {r.isActive ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => startEdit(r)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r)} aria-label="Delete">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Tag className="h-4 w-4" /> Add student category
        </h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Boarder" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <Button onClick={add} disabled={create.isPending} className="gap-1">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit student category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={update.isPending} className="gap-1">
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
