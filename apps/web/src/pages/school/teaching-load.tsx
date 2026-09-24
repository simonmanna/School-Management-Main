import { useMemo, useState } from 'react';
import { Plus, Search, BookOpen, Trash2, Pencil, Loader2 } from 'lucide-react';
import { notify } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  useStaff, useClasses, useSubjects, useTeacherAssignments,
  useCreateTeacherAssignment, useUpdateTeacherAssignment, useDeleteTeacherAssignment, currentTerminology } from '@/features/school/api';

interface TeacherAssignment {
  id: string;
  teacherPartnerId: string;
  subjectId: string;
  classId: string;
  sectionId?: string | null;
  periodsPerWeek?: number | null;
  subject?: { name: string } | null;
  schoolClass?: { name: string } | null;
  section?: { name: string } | null;
}

/**
 * Teaching Load — staff-centric roster (matches the reference screen):
 * a list of teaching staff with a live "Teaching Load" summary, an
 * "Add Teaching Load" modal (Staff + Class + Subject), and per-teacher
 * expandable assignments that can be edited or removed.
 *
 * Data model: each row is a TeacherAssignment (teacher → subject → class/section).
 * The LMS derives per-term CourseOfferings (the canonical timetable spine) from
 * these via its "from teacher assignment" action.
 */
export function SchoolTeachingLoadPage() {
  const { data: staffResp } = useStaff({ pageSize: 500 });
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const { data: assignments, isLoading } = useTeacherAssignments();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeacherAssignment | null>(null);

  const createMut = useCreateTeacherAssignment();
  const updateMut = useUpdateTeacherAssignment();
  const deleteMut = useDeleteTeacherAssignment();

  const staff = useMemo(() => (staffResp?.data ?? []).map((s: any) => ({
    id: s.id,
    name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.employeeNo || s.id,
  })), [staffResp]);

  const classOpts = useMemo(() => (classes?.data ?? []).map((c: any) => ({ value: c.id, label: c.name })), [classes]);
  const subjectOpts = useMemo(() => (subjects?.data ?? []).map((s: any) => ({ value: s.id, label: s.name })), [subjects]);
  const sectionOpts = useMemo(
    () => (classes?.data ?? []).flatMap((c: any) =>
      (c.sections ?? []).map((s: any) => ({ value: s.id, label: `${c.name} — ${s.name}` })),
    ),
    [classes],
  );

  const byTeacher = useMemo(() => {
    const map: Record<string, TeacherAssignment[]> = {};
    for (const a of (assignments ?? []) as TeacherAssignment[]) {
      (map[a.teacherPartnerId] ??= []).push(a);
    }
    return map;
  }, [assignments]);

  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? 'Unknown';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => s.name.toLowerCase().includes(q));
  }, [staff, query]);

  const groupedAssignments = byTeacher[expanded ?? ''] ?? [];

  const [form, setForm] = useState({
    teacherPartnerId: '', classId: '', subjectId: '', sectionId: '', periodsPerWeek: '',
  });

  const resetForm = () => setForm({ teacherPartnerId: '', classId: '', subjectId: '', sectionId: '', periodsPerWeek: '' });

  const openAdd = (teacherId?: string) => {
    resetForm();
    if (teacherId) setForm((f) => ({ ...f, teacherPartnerId: teacherId }));
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (a: TeacherAssignment) => {
    setForm({
      teacherPartnerId: a.teacherPartnerId,
      classId: a.classId,
      subjectId: a.subjectId,
      sectionId: a.sectionId ?? '',
      periodsPerWeek: a.periodsPerWeek ? String(a.periodsPerWeek) : '',
    });
    setEditing(a);
    setOpen(true);
  };

  const submit = async () => {
    if (!form.teacherPartnerId || !form.classId || !form.subjectId) {
      notify.error('Staff, Class and Subject are required.');
      return;
    }
    const dto = {
      teacherPartnerId: form.teacherPartnerId,
      classId: form.classId,
      subjectId: form.subjectId,
      sectionId: form.sectionId || undefined,
      periodsPerWeek: form.periodsPerWeek ? Number(form.periodsPerWeek) : undefined,
    };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...dto });
        notify.success('Teaching load updated.');
      } else {
        await createMut.mutateAsync(dto);
        notify.success('Teaching load assigned.');
      }
      setOpen(false);
      resetForm();
      setEditing(null);
    } catch (e: any) {
      notify.error(e?.message ?? 'Failed to save teaching load.');
    }
  };

  const remove = async (a: TeacherAssignment) => {
    if (!confirm(`Remove ${staffName(a.teacherPartnerId)} → ${a.subject?.name ?? 'subject'} (${a.schoolClass?.name ?? ''})?`)) return;
    try {
      await deleteMut.mutateAsync(a.id);
      notify.success('Assignment removed.');
    } catch (e: any) {
      notify.error(e?.message ?? 'Failed to remove.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Teaching Load</h1>
          <p className="text-sm text-muted-foreground">A list of teaching staff with their teaching loads.</p>
        </div>
        <Button onClick={() => openAdd()} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="mr-2 h-4 w-4" /> Add Teaching Load
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search for staff"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Teaching Load</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">No staff found.</TableCell></TableRow>
            )}
            {!isLoading && filtered.map((s, i) => {
              const loads = byTeacher[s.id] ?? [];
              const isOpen = expanded === s.id;
              return (
                <>
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                  >
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {loads.length === 0 ? (
                        <span className="inline-flex items-center gap-2 text-muted-foreground">
                          <span className="h-2 w-2 rounded-full bg-gray-300" /> No teaching load assigned
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="secondary">{loads.length} {loads.length === 1 ? 'class' : 'classes'}</Badge>
                          {loads.slice(0, 3).map((l) => (
                            <Badge key={l.id} variant="outline" className="gap-1">
                              <BookOpen className="h-3 w-3" />
                              {l.subject?.name ?? 'Subject'} · {l.schoolClass?.name ?? ''}
                            </Badge>
                          ))}
                          {loads.length > 3 && <Badge variant="outline">+{loads.length - 3}</Badge>}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={`${s.id}-detail`} className="bg-muted/20">
                      <TableCell colSpan={3}>
                        <div className="space-y-2 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Assignments for {s.name}</span>
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openAdd(s.id); }}>
                              <Plus className="mr-1 h-3 w-3" /> Add for this teacher
                            </Button>
                          </div>
                          {groupedAssignments.length === 0 && (
                            <p className="text-sm text-muted-foreground">No teaching load assigned.</p>
                          )}
                          {groupedAssignments.map((a) => (
                            <div key={a.id} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                              <div className="text-sm">
                                <span className="font-medium">{a.subject?.name ?? 'Subject'}</span>
                                <span className="text-muted-foreground"> → {a.schoolClass?.name ?? 'Class'}{a.section?.name ? ` (${a.section.name})` : ''}</span>
                                {a.periodsPerWeek ? <span className="ml-2 text-muted-foreground">· {a.periodsPerWeek}/wk</span> : null}
                              </div>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(a); }}><Pencil className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" className="text-red-600" onClick={(e) => { e.stopPropagation(); remove(a); }}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Teaching Load' : 'Assign Teaching Load'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Staff<span className="text-red-500">*</span></Label>
              <Select value={form.teacherPartnerId} onValueChange={(v) => setForm((f) => ({ ...f, teacherPartnerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose a staff" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Class<span className="text-red-500">*</span></Label>
              <Select value={form.classId} onValueChange={(v) => setForm((f) => ({ ...f, classId: v, sectionId: '' }))}>
                <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
                <SelectContent>
                  {classOpts.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject<span className="text-red-500">*</span></Label>
              <Select value={form.subjectId} onValueChange={(v) => setForm((f) => ({ ...f, subjectId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose a subject" /></SelectTrigger>
                <SelectContent>
                  {subjectOpts.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{currentTerminology().section}</Label>
                <Select value={form.sectionId} onValueChange={(v) => setForm((f) => ({ ...f, sectionId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {sectionOpts.filter((s) => !form.classId || s.label.startsWith(classOpts.find((c) => c.value === form.classId)?.label ?? '')).map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Periods / week</Label>
                <Input type="number" min={1} value={form.periodsPerWeek} onChange={(e) => setForm((f) => ({ ...f, periodsPerWeek: e.target.value }))} placeholder="e.g. 5" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={submit} disabled={createMut.isPending || updateMut.isPending} className="bg-indigo-600 hover:bg-indigo-700">
              {editing ? 'Save changes' : 'Assign Teaching Load'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
