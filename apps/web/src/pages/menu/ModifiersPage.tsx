import { useEffect, useMemo, useState } from 'react';
import { Plus, Tag, Trash2, Pencil, Check, X, Search, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  useModifierGroups,
  useCreateModifierGroup,
  useCreateModifier,
  useAssignModifierGroupToMenuItem,
  useUnassignModifierGroupFromMenuItem,
  useUpdateModifierGroup,
  useUpdateModifier,
  useDeleteModifierGroup,
  useDeleteModifier,
  useGroupMenuItems,
} from '@/pages/pos/pos-features-api';

const fmt = (n: number) => `UGX ${n.toLocaleString()}`;
const selectCls = 'w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm';

export default function ModifiersPage() {
  // ── Group list ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('true');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data: paginated, isLoading } = useModifierGroups({
    search: search || undefined,
    isActive: activeFilter === 'all' ? undefined : activeFilter === 'true',
    page,
    pageSize,
  });
  const groups = paginated?.data ?? [];
  const total = paginated?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ── Selected group ────────────────────────────────────────────────────
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  // Reset selected on search/filter/page change
  useEffect(() => { setSelectedGroupId(null); }, [search, activeFilter, page]);

  // ── Group settings form ───────────────────────────────────────────────
  const [sName, setSName] = useState('');
  const [sCategory, setSCategory] = useState('');
  const [sDesc, setSDesc] = useState('');
  const [sColor, setSColor] = useState('');
  const [sGroupType, setSGroupType] = useState<'ADD_ON' | 'MODIFIER'>('ADD_ON');
  const [sRequired, setSRequired] = useState(false);
  const [sMax, setSMax] = useState(2);

  useEffect(() => {
    if (!selectedGroup) return;
    setSName(selectedGroup.name);
    setSCategory(selectedGroup.category ?? '');
    setSDesc(selectedGroup.description ?? '');
    setSColor(selectedGroup.color ?? '');
    setSGroupType(selectedGroup.groupType);
    setSRequired(selectedGroup.minSelect > 0);
    setSMax(selectedGroup.maxSelect);
  }, [selectedGroup?.id]);

  const groupChanged = useMemo(() => {
    if (!selectedGroup) return false;
    return (
      sName !== selectedGroup.name ||
      sCategory !== (selectedGroup.category ?? '') ||
      sDesc !== (selectedGroup.description ?? '') ||
      sColor !== (selectedGroup.color ?? '') ||
      sGroupType !== selectedGroup.groupType ||
      sRequired !== (selectedGroup.minSelect > 0) ||
      sMax !== selectedGroup.maxSelect
    );
  }, [sName, sCategory, sDesc, sColor, sGroupType, sRequired, sMax, selectedGroup]);

  // ── Options edit ──────────────────────────────────────────────────────
  const [editOptId, setEditOptId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eKitchen, setEKitchen] = useState('');
  const [ePrice, setEPrice] = useState('');
  const [eDefault, setEDefault] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [aName, setAName] = useState('');
  const [aKitchen, setAKitchen] = useState('');
  const [aPrice, setAPrice] = useState('');
  const [aDefault, setADefault] = useState(false);

  // ── Assignment checkboxes ─────────────────────────────────────────────
  const { data: groupMenuItems = [] } = useGroupMenuItems(selectedGroupId);
  const [miSearch, setMiSearch] = useState('');

  const filteredMenuItems = useMemo(() => {
    const q = miSearch.toLowerCase().trim();
    if (!q) return groupMenuItems;
    return groupMenuItems.filter((m) => m.name.toLowerCase().includes(q));
  }, [groupMenuItems, miSearch]);

  const assignedCount = groupMenuItems.filter((m) => m.isAssigned).length;

  // ── Mutations ─────────────────────────────────────────────────────────
  const updateGroup = useUpdateModifierGroup();
  const deleteGroup = useDeleteModifierGroup();
  const createModifier = useCreateModifier();
  const updateModifier = useUpdateModifier();
  const deleteModifier = useDeleteModifier();
  const assignToMenuItem = useAssignModifierGroupToMenuItem();
  const unassignFromMenuItem = useUnassignModifierGroupFromMenuItem();

  // ── Delete confirm ────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // ── New group dialog ──────────────────────────────────────────────────
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [gName, setGName] = useState('');
  const [gCategory, setGCategory] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gColor, setGColor] = useState('');
  const [gType, setGType] = useState<'single' | 'multi'>('single');
  const [gRequired, setGRequired] = useState(false);
  const [gMax, setGMax] = useState(2);
  const [gGroupType, setGGroupType] = useState<'ADD_ON' | 'MODIFIER'>('ADD_ON');

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSaveSettings = async () => {
    if (!selectedGroup || !sName.trim()) return;
    try {
      await updateGroup.mutateAsync({
        id: selectedGroup.id,
        name: sName.trim(),
        category: sCategory.trim() || undefined,
        description: sDesc.trim() || undefined,
        color: sColor.trim() || undefined,
        groupType: sGroupType,
        minSelect: sRequired ? 1 : 0,
        maxSelect: sMax,
      });
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save');
    }
  };

  const handleToggleAssignment = async (menuItemId: string, current: boolean) => {
    if (!selectedGroupId) return;
    try {
      if (current) {
        await unassignFromMenuItem.mutateAsync({ menuItemId, modifierGroupId: selectedGroupId });
      } else {
        await assignToMenuItem.mutateAsync({ menuItemId, modifierGroupId: selectedGroupId });
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to update assignment');
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup.mutateAsync(deleteTarget.id);
      toast.success('Group deleted');
      setDeleteTarget(null);
      if (selectedGroupId === deleteTarget.id) setSelectedGroupId(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to delete');
      setDeleteTarget(null);
    }
  };

  const submitOption = async () => {
    if (!selectedGroupId || !aName.trim()) { toast.error('Option name is required'); return; }
    try {
      await createModifier.mutateAsync({
        groupId: selectedGroupId,
        name: aName.trim(),
        kitchenPrintName: aKitchen.trim() || undefined,
        priceDelta: Number(aPrice) || 0,
        isDefault: aDefault,
      });
      toast.success('Option added');
      setAddOpen(false); setAName(''); setAKitchen(''); setAPrice(''); setADefault(false);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to add option'); }
  };

  const saveEditOption = async (modifierId: string) => {
    if (!eName.trim()) { toast.error('Name is required'); return; }
    try {
      await updateModifier.mutateAsync({
        id: modifierId,
        name: eName.trim(),
        kitchenPrintName: eKitchen.trim() || undefined,
        priceDelta: Number(ePrice) || 0,
        isDefault: eDefault,
      });
      setEditOptId(null);
      toast.success('Option updated');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to update'); }
  };

  const removeOption = async (id: string) => {
    try {
      await deleteModifier.mutateAsync(id);
      toast.success('Option removed');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to delete'); }
  };

  const submitNewGroup = async () => {
    if (!gName.trim()) { toast.error('Group name is required'); return; }
    const maxSelect = gType === 'single' ? 1 : Math.max(1, Number(gMax) || 1);
    const minSelect = gRequired ? 1 : 0;
    try {
      const created: any = await createGroupFn.mutateAsync({
        name: gName.trim(),
        category: gCategory.trim() || undefined,
        description: gDesc.trim() || undefined,
        color: gColor.trim() || undefined,
        groupType: gGroupType,
        minSelect, maxSelect,
      });
      toast.success(`"${gName.trim()}" created`);
      setShowNewGroup(false);
      setGName(''); setGCategory(''); setGDesc(''); setGColor('');
      setGType('single'); setGRequired(false); setGMax(2); setGGroupType('ADD_ON');
      if (created?.id) setSelectedGroupId(created.id);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to create'); }
  };
  const createGroupFn = useCreateModifierGroup();

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-2 max-w-[1800px] mx-auto space-y-2">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Menu Modifiers &amp; Add-ons</h1>
          <p className="text-sm text-slate-500">{total} group{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Search groups…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <select
            className={selectCls + ' w-auto h-9 text-sm'}
            value={activeFilter}
            onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}
          >
            <option value="true">Active only</option>
            <option value="all">All (incl. inactive)</option>
          </select>
          <Button onClick={() => setShowNewGroup(true)} style={{ background: '#4f46e5' }} className="h-9">
            <Plus className="h-4 w-4 mr-1" /> New Group
          </Button>
        </div>
      </div>

      {/* ── Master-detail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
        {/* ── Sidebar ── */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-3 py-2 border-b border-slate-100">
            Modifier Groups
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              <Tag className="h-6 w-6 mx-auto mb-1 opacity-50" />
              No groups found
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-y-auto max-h-[70vh]">
              {groups.map((g) => {
                const isSelected = g.id === selectedGroupId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedGroupId(g.id)}
                    className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-slate-50 ${
                      isSelected ? 'bg-indigo-50 border-l-2 border-indigo-500' : 'border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {g.color ? (
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                      ) : null}
                      <span className="font-semibold text-slate-800 text-sm truncate">{g.name}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ml-auto ${
                        g.groupType === 'ADD_ON' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
                      }`}>
                        {g.groupType === 'ADD_ON' ? 'Add-on' : 'Modifier'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex gap-2">
                      <span>{g.modifiers.length} option{g.modifiers.length !== 1 ? 's' : ''}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>

        {/* ── Detail panel ── */}
        <div className="rounded-lg border border-slate-200 bg-white min-h-[400px]">
          {!selectedGroup ? (
            <div className="flex items-center justify-center h-full min-h-[300px] text-slate-400">
              <div className="text-center">
                <Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-semibold">Select a group</p>
                <p className="text-xs">Click a group in the sidebar to edit its settings, options, and menu assignments.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {/* ── Section 1: Group Settings ── */}
              <div className="p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Group Settings</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs font-medium text-slate-600">Name</Label>
                    <Input value={sName} onChange={(e) => setSName(e.target.value)} className="h-9 text-sm mt-0.5" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs font-medium text-slate-600">Category (optional)</Label>
                    <Input value={sCategory} onChange={(e) => setSCategory(e.target.value)} placeholder="e.g. Prep, Milk" className="h-9 text-sm mt-0.5" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs font-medium text-slate-600">Description (optional)</Label>
                    <Input value={sDesc} onChange={(e) => setSDesc(e.target.value)} placeholder="Brief description" className="h-9 text-sm mt-0.5" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-600">Type</Label>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setSGroupType('MODIFIER')}
                        className={`flex-1 h-9 text-sm font-semibold rounded-md border-2 transition-all ${
                          sGroupType === 'MODIFIER'
                            ? 'border-violet-500 bg-violet-50 text-violet-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1.5" />
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => setSGroupType('ADD_ON')}
                        className={`flex-1 h-9 text-sm font-semibold rounded-md border-2 transition-all ${
                          sGroupType === 'ADD_ON'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                        Add-on
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-600">Color (optional)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input value={sColor} onChange={(e) => setSColor(e.target.value)} placeholder="#4f46e5" className="h-9 text-sm flex-1" />
                      {sColor ? <span className="w-7 h-7 rounded border border-slate-300" style={{ background: sColor }} /> : null}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-600">Selection</Label>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setSRequired(false)}
                        className={`flex-1 h-9 text-sm font-semibold rounded-md border-2 transition-all ${
                          !sRequired
                            ? 'border-sky-500 bg-sky-50 text-sky-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >Optional</button>
                      <button
                        type="button"
                        onClick={() => setSRequired(true)}
                        className={`flex-1 h-9 text-sm font-semibold rounded-md border-2 transition-all ${
                          sRequired
                            ? 'border-rose-500 bg-rose-50 text-rose-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >Required</button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-600">Maximum selections</Label>
                    <Input type="number" value={sMax} onChange={(e) => setSMax(Number(e.target.value))} min={1} className="h-9 text-sm mt-0.5" />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {sMax === 1 ? 'Single choice (radio)' : `Customer may choose up to ${sMax} options`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <Button onClick={handleSaveSettings} disabled={!groupChanged || updateGroup.isPending} style={{ background: '#4f46e5' }} className="h-9 text-sm">
                    <Check className="h-4 w-4 mr-1" /> Save Settings
                  </Button>
                  <Button variant="outline" onClick={() => setDeleteTarget({ id: selectedGroup.id, name: selectedGroup.name })} className="h-9 text-sm text-rose-600 border-rose-200 hover:bg-rose-50">
                    <Trash2 className="h-4 w-4 mr-1" /> Delete Group
                  </Button>
                </div>
              </div>

              {/* ── Section 2: Options Table ── */}
              <div className="p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Options</h3>
                {selectedGroup.modifiers.length === 0 && !addOpen ? (
                  <div className="text-sm text-slate-400 italic">No options yet</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                          <th className="py-2 pr-2 w-8">#</th>
                          <th className="py-2 pr-2">Option Name</th>
                          <th className="py-2 pr-2 w-36">Kitchen Print</th>
                          <th className="py-2 pr-2 w-24 text-right">+ Price</th>
                          <th className="py-2 pr-2 w-16 text-center">Default</th>
                          <th className="py-2 w-20 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGroup.modifiers.map((m, i) => (
                          editOptId === m.id ? (
                            <tr key={m.id} className="border-b border-indigo-100 bg-indigo-50/60">
                              <td className="py-1.5 pr-2 text-slate-400 text-center">{i + 1}</td>
                              <td className="py-1.5 pr-2">
                                <Input value={eName} onChange={(e) => setEName(e.target.value)} className="h-8 text-sm" />
                              </td>
                              <td className="py-1.5 pr-2">
                                <Input value={eKitchen} onChange={(e) => setEKitchen(e.target.value)} placeholder="KOT text" className="h-8 text-sm" />
                              </td>
                              <td className="py-1.5 pr-2">
                                <Input type="number" value={ePrice} onChange={(e) => setEPrice(e.target.value)} className="h-8 text-sm text-right" />
                              </td>
                              <td className="py-1.5 pr-2 text-center">
                                <input type="checkbox" checked={eDefault} onChange={(e) => setEDefault(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                              </td>
                              <td className="py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => saveEditOption(m.id)} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Save"><Check className="h-3.5 w-3.5" /></button>
                                  <button onClick={() => setEditOptId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded" title="Cancel"><X className="h-3.5 w-3.5" /></button>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                              <td className="py-2 pr-2 text-slate-400 text-center">{i + 1}</td>
                              <td className="py-2 pr-2 font-semibold text-slate-700">{m.name}</td>
                              <td className="py-2 pr-2 text-slate-500 font-mono text-xs">{m.kitchenPrintName ?? '—'}</td>
                              <td className="py-2 pr-2 text-right font-mono text-slate-600">{m.priceDelta === 0 ? '—' : `+${fmt(m.priceDelta)}`}</td>
                              <td className="py-2 pr-2 text-center">{m.isDefault ? <span className="text-amber-500 text-xs font-bold">★</span> : null}</td>
                              <td className="py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => { setEditOptId(m.id); setEName(m.name); setEKitchen(m.kitchenPrintName ?? ''); setEPrice(String(m.priceDelta)); setEDefault(m.isDefault); }}
                                    className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                                    title="Edit option"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => removeOption(m.id)} className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors" title="Remove option">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {addOpen ? (
                  <div className="flex flex-wrap items-end gap-2 border border-indigo-200 rounded-lg bg-indigo-50/60 p-3">
                    <div className="flex-1 min-w-[140px]">
                      <Label className="text-xs font-medium text-slate-600">Name</Label>
                      <Input value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Option name" autoFocus className="h-9 text-sm mt-0.5" />
                    </div>
                    <div className="w-36">
                      <Label className="text-xs font-medium text-slate-600">Kitchen print</Label>
                      <Input value={aKitchen} onChange={(e) => setAKitchen(e.target.value)} placeholder="KOT text" className="h-9 text-sm mt-0.5" />
                    </div>
                    <div className="w-24">
                      <Label className="text-xs font-medium text-slate-600">+ Price</Label>
                      <Input type="number" value={aPrice} onChange={(e) => setAPrice(e.target.value)} placeholder="0" className="h-9 text-sm mt-0.5" />
                    </div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 h-9 cursor-pointer select-none">
                      <input type="checkbox" checked={aDefault} onChange={(e) => setADefault(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" /> Default
                    </label>
                    <Button onClick={submitOption} disabled={createModifier.isPending} style={{ background: '#16a34a' }} className="h-9 text-sm px-4">
                      <Check className="h-4 w-4 mr-1" /> Add
                    </Button>
                    <Button variant="ghost" onClick={() => { setAddOpen(false); setAName(''); setAKitchen(''); setAPrice(''); setADefault(false); }} className="h-9 text-sm">Cancel</Button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddOpen(true)} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1.5 py-1">
                    <Plus className="h-4 w-4" /> Add Option
                  </button>
                )}
              </div>

              {/* ── Section 3: Assigned Menu Items ── */}
              <div className="p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Assigned Menu Items</h3>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Search menu items…"
                      value={miSearch}
                      onChange={(e) => setMiSearch(e.target.value)}
                      className="h-9 pl-8 text-sm"
                    />
                  </div>
                  <span className="text-xs text-slate-500">
                    {assignedCount} of {groupMenuItems.length} items assigned
                  </span>
                </div>
                <div className="max-h-[260px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {filteredMenuItems.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      {miSearch ? 'No menu items match your search' : 'No menu items found'}
                    </div>
                  ) : (
                    filteredMenuItems.map((mi) => (
                      <label
                        key={mi.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={mi.isAssigned}
                          onChange={() => handleToggleAssignment(mi.id, mi.isAssigned)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={mi.isAssigned ? 'font-semibold text-slate-800' : 'text-slate-600'}>{mi.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── New Group Dialog ── */}
      <Dialog open={showNewGroup} onOpenChange={(o) => !o && setShowNewGroup(false)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>New modifier group</DialogTitle>
            <DialogDescription>e.g. Size, Milk type, Sugar level, Extras.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Group name</Label>
              <Input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="e.g. Size" autoFocus />
            </div>
            <div>
              <Label>Category (optional)</Label>
              <Input value={gCategory} onChange={(e) => setGCategory(e.target.value)} placeholder="e.g. Prep, Milk, Size" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input value={gDesc} onChange={(e) => setGDesc(e.target.value)} placeholder="Brief description" />
            </div>
            <div>
              <Label>Color (optional, hex)</Label>
              <div className="flex items-center gap-2">
                <Input value={gColor} onChange={(e) => setGColor(e.target.value)} placeholder="e.g. #4f46e5" className="flex-1" />
                {gColor ? <span className="w-8 h-8 rounded border border-slate-300" style={{ background: gColor }} /> : null}
              </div>
            </div>
            <div>
              <Label>Group type</Label>
              <Select value={gGroupType} onValueChange={(v) => setGGroupType(v as 'ADD_ON' | 'MODIFIER')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADD_ON">Add-on (product upsell)</SelectItem>
                  <SelectItem value="MODIFIER">Modifier (prep instruction)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Selection type</Label>
              <select className={selectCls} value={gType} onChange={(e) => setGType(e.target.value as 'single' | 'multi')}>
                <option value="single">Single choice (radio)</option>
                <option value="multi">Multiple choice (checkbox)</option>
              </select>
            </div>
            {gType === 'multi' ? (
              <div>
                <Label>Max selections</Label>
                <Input type="number" value={gMax} onChange={(e) => setGMax(Number(e.target.value))} min={1} />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={gRequired} onChange={(e) => setGRequired(e.target.checked)} />
              Required (customer must choose at least one)
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewGroup(false)}>Cancel</Button>
            <Button onClick={submitNewGroup} disabled={createGroupFn.isPending} style={{ background: '#4f46e5' }}>Create group</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" /> Delete group?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>"{deleteTarget?.name}"</strong> and all its options.
              {assignedCount > 0 ? (
                <span className="block mt-1 text-rose-600 font-semibold">
                  Currently assigned to {assignedCount} menu item{assignedCount !== 1 ? 's' : ''}.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroup} className="bg-rose-600 hover:bg-rose-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
