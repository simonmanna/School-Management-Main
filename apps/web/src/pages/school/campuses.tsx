import { useMemo, useState } from 'react';
import { Building2, Layers, MapPin, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCampuses, useClasses, useSections, type Campus, type SchoolClass, type Section } from '@/features/school/api';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

type CampusRow = Campus & { isMain?: boolean };

export function SchoolCampusesPage() {
  const qc = useQueryClient();
  const { data: campuses, isLoading } = useCampuses();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<CampusRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  const campusList = useMemo(() => (campuses?.data ?? []) as CampusRow[], [campuses]);
  const classList = useMemo(() => classes?.data ?? [], [classes]);
  const sectionList = useMemo(() => sections?.data ?? [], [sections]);

  const classesByCampus = useMemo(
    () => Object.fromEntries(campusList.map((c) => [c.id, classList.filter((cl) => cl.campusId === c.id)])),
    [campusList, classList],
  );
  const sectionsByClass = useMemo(
    () => Object.fromEntries(classList.map((c) => [c.id, sectionList.filter((s) => s.classId === c.id)])),
    [classList, sectionList],
  );

  const shown = active ?? campusList[0]?.id ?? null;
  const shownClasses = shown ? classesByCampus[shown] ?? [] : [];
  const shownCampus = campusList.find((c) => c.id === shown);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['school', 'campuses'] });

  const save = async () => {
    try {
      const payload: Record<string, any> = {
        code: form.code,
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        isMain: !!form.isMain,
      };
      if (editing) {
        await api.patch(`/school/campuses/${editing.id}`, payload);
        notify.success('Campus updated');
      } else {
        await api.post('/school/campuses', payload);
        notify.success('Campus created');
      }
      invalidate();
      setEditing(null);
      setCreating(false);
      setForm({});
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Save failed');
    }
  };

  const remove = async (row: CampusRow) => {
    if (!confirm(`Delete campus "${row.name}"? This also removes its classes.`)) return;
    try {
      await api.delete(`/school/campuses/${row.id}`);
      notify.success('Campus deleted');
      invalidate();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Delete failed');
    }
  };

  const openCreate = () => { setForm({ code: '', name: '', phone: '', email: '', isMain: false }); setCreating(true); };
  const openEdit = (row: CampusRow) => { setForm({ code: row.code, name: row.name, phone: row.phone ?? '', email: row.email ?? '', isMain: !!row.isMain }); setEditing(row); };

  const dialogOpen = creating || !!editing;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Campuses, Classes &amp; Sections</h1>
          <p className="text-sm text-muted-foreground">
            {campusList.length} campuses · {classList.length} classes · {sectionList.length} sections.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1"><Plus className="h-4 w-4" /> Add campus</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-2 p-3">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Campuses (branches)</p>
            {isLoading && <p className="px-1 py-2 text-sm text-muted-foreground">Loading…</p>}
            {campusList.map((c: CampusRow) => (
              <div
                key={c.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${c.id === shown ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted/50'}`}
              >
                <button className="flex items-center gap-2 text-left" onClick={() => setActive(c.id)}>
                  <Building2 className="h-4 w-4" /> {c.name}
                </button>
                <span className="flex items-center gap-1.5">
                  {c.isMain && <Badge className="bg-amber-100 text-amber-700">Main</Badge>}
                  <Badge className="bg-slate-100 text-slate-600">{classesByCampus[c.id]?.length ?? 0}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(c)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                </span>
              </div>
            ))}
            {campusList.length === 0 && !isLoading && <p className="px-1 py-2 text-sm text-muted-foreground">No campuses yet.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="p-4">
            {!shown && (
              <p className="py-8 text-center text-sm text-muted-foreground">Select or add a campus to see its classes.</p>
            )}
            {shown && shownClasses.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No classes for this campus.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {shownClasses.map((cl: SchoolClass) => {
                  const secs = sectionsByClass[cl.id] ?? [];
                  return (
                    <div key={cl.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-medium"><Layers className="h-4 w-4 text-primary" /> {cl.name}</span>
                        <Badge className="bg-emerald-100 text-emerald-700">{secs.length} sections</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {secs.length === 0 && <span className="text-xs text-muted-foreground">No sections</span>}
                        {secs.map((s: Section) => (
                          <span key={s.id} className="rounded bg-muted px-2 py-0.5 text-xs">{s.name}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {shownCampus && (
              <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /> {shownCampus.name} · {shownCampus.phone ?? 'No phone'}
                {shownCampus.email ? ` · ${shownCampus.email}` : ''}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && (setEditing(null), setCreating(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit campus' : 'New campus'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1"><Label>Code *</Label>
              <Input value={form.code ?? ''} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} placeholder="MAIN" />
            </div>
            <div className="space-y-1"><Label>Name *</Label>
              <Input value={form.name ?? ''} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Main Campus" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Phone</Label>
                <Input value={form.phone ?? ''} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} placeholder="+256…" />
              </div>
              <div className="space-y-1"><Label>Email</Label>
                <Input value={form.email ?? ''} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="campus@school.ed.ug" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isMain} onChange={(e) => setForm((s) => ({ ...s, isMain: e.target.checked }))} /> Mark as main campus
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => (setEditing(null), setCreating(false))}>Cancel</Button>
            <Button onClick={save} disabled={!form.code || !form.name} className="gap-1">
              <Loader2 className={dialogOpen ? 'h-4 w-4 animate-spin' : 'hidden'} /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
