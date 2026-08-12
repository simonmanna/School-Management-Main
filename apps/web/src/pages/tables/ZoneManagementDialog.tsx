/**
 * Zone Management — configurable dining areas / table categories.
 *
 * Full CRUD for the PosTableZone catalog: create, rename, recolor, reorder,
 * archive (soft delete — refused while active tables reference the zone) and
 * restore. Sorted by sortOrder. Opened from TablesPage's "Manage Zones" hero
 * action (gated behind the `tables:zones` permission).
 */
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Archive, RotateCcw, Pencil, Check, X, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useArchiveZone,
  useCreateZone,
  useDeletedZones,
  useRestoreZone,
  useTableZones,
  useUpdateZone,
} from '@/features/tables/api';
import type { PosTableZoneConfig } from '@/features/tables/types';
import { sortZones } from '@/features/tables/utils';

/** Mirror of the API slugifier (lowercase, alnum+underscore, max 40). */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'zone';
}

export const ZoneManagementDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { data: zones = [], isLoading } = useTableZones();
  const { data: deletedZones = [] } = useDeletedZones();
  const create = useCreateZone();
  const update = useUpdateZone();
  const archive = useArchiveZone();
  const restore = useRestoreZone();

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [color, setColor] = useState('#10b981');
  const [sortOrder, setSortOrder] = useState(0);
  const [keyTouched, setKeyTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editOrder, setEditOrder] = useState(0);

  const active = useMemo(() => sortZones(zones.filter((z) => !z.deletedAt)), [zones]);
  const archived = useMemo(() => sortZones(deletedZones), [deletedZones]);

  const keyPreview = keyTouched ? key : slugify(name);

  function resetForm() {
    setName('');
    setKey('');
    setColor('#10b981');
    setSortOrder(0);
    setKeyTouched(false);
  }

  async function doCreate() {
    if (!name.trim()) {
      toast.error('Zone name is required');
      return;
    }
    try {
      await create.mutateAsync({
        key: keyTouched && key.trim() ? key.trim() : undefined,
        name: name.trim(),
        color,
        sortOrder,
      });
      toast.success(`Zone "${name.trim()}" created`);
      resetForm();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to create zone');
    }
  }

  function startEdit(z: PosTableZoneConfig) {
    setEditingId(z.id);
    setEditName(z.name);
    setEditColor(z.color);
    setEditOrder(z.sortOrder);
  }

  async function doSaveEdit(z: PosTableZoneConfig) {
    if (!editName.trim()) {
      toast.error('Zone name is required');
      return;
    }
    try {
      await update.mutateAsync({
        id: z.id,
        body: { name: editName.trim(), color: editColor, sortOrder: editOrder },
      });
      toast.success('Zone updated');
      setEditingId(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to update zone');
    }
  }

  async function doArchive(z: PosTableZoneConfig) {
    try {
      await archive.mutateAsync(z.id);
      toast.success(`Zone "${z.name}" archived`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to archive zone');
    }
  }

  async function doRestore(z: PosTableZoneConfig) {
    try {
      await restore.mutateAsync(z.id);
      toast.success(`Zone "${z.name}" restored`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to restore zone');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Map className="w-5 h-5 text-slate-500" /> Manage Zones
          </DialogTitle>
          <DialogDescription>
            Dining areas &amp; table categories — create, rename, recolor and
            reorder. Archiving is refused while active tables still reference a
            zone.
          </DialogDescription>
        </DialogHeader>

        {/* ── Create form ── */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            New zone
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rooftop"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Key
              </label>
              <Input
                value={keyPreview}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyTouched(true);
                }}
                placeholder={slugify(name) || 'zone'}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Color
              </label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white cursor-pointer"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-28">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Sort order
              </label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
            <Button
              onClick={doCreate}
              disabled={create.isPending}
              className="mt-auto bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add zone
            </Button>
          </div>
        </div>

        {/* ── Active zones ── */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Active zones ({active.length})
          </div>
          {isLoading ? (
            <div className="text-sm text-slate-400 py-4 text-center">Loading zones…</div>
          ) : active.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">
              No zones yet — add one above.
            </div>
          ) : (
            active.map((z) => (
              <div
                key={z.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span
                  className="w-4 h-4 rounded-full shrink-0 border border-slate-200"
                  style={{ background: z.color }}
                />
                {editingId === z.id ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 flex-1"
                    />
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-8 w-10 rounded border border-slate-200 cursor-pointer"
                    />
                    <Input
                      type="number"
                      value={editOrder}
                      onChange={(e) => setEditOrder(Number(e.target.value))}
                      className="h-8 w-20"
                    />
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => doSaveEdit(z)}
                      disabled={update.isPending}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{z.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{z.key}</div>
                    </div>
                    <div className="text-[11px] text-slate-500 w-14 text-right">
                      #{z.sortOrder}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-slate-500"
                      onClick={() => startEdit(z)}
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-rose-600 hover:text-rose-700"
                      onClick={() => doArchive(z)}
                      disabled={archive.isPending}
                      title="Archive"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* ── Archived zones ── */}
        {archived.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Archived ({archived.length})
            </div>
            {archived.map((z) => (
              <div
                key={z.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 opacity-70"
              >
                <span
                  className="w-4 h-4 rounded-full shrink-0 border border-slate-200"
                  style={{ background: z.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate line-through">{z.name}</div>
                  <div className="text-[11px] text-slate-400 font-mono">{z.key}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => doRestore(z)}
                  disabled={restore.isPending}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default ZoneManagementDialog;
