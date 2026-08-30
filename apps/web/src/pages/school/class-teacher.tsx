import { useState, useMemo } from 'react';
import { Users, Edit } from 'lucide-react';
import { useSections, useUpdateSection, useStaff, useClasses, type Section } from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

export function SchoolClassTeacherPage() {
  const { data: classes } = useClasses();
  const { data: sections, isLoading, refetch } = useSections();
  const { data: staff } = useStaff({ pageSize: 200 });
  const updateSection = useUpdateSection();
  
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);

  const classOptions = useMemo(() => classes?.data ?? [], [classes?.data]);

  const filteredSections = useMemo(() => {
    let result = sections?.data ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s: any) =>
        s.name?.toLowerCase().includes(q) ||
        s.schoolClass?.name?.toLowerCase().includes(q) ||
        s.classTeacher?.name?.toLowerCase().includes(q)
      );
    }
    if (classFilter) {
      result = result.filter((s: any) => s.classId === classFilter);
    }
    return result;
  }, [sections?.data, search, classFilter]);

  const openEdit = (section: Section) => {
    setEditing(section);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!editing) return;
    try {
      await updateSection.mutateAsync({
        id: editing.id,
        classTeacherId: editing.classTeacherId || undefined
      });
      notify.success('Class teacher updated');
      setDialogOpen(false);
      setEditing(null);
      refetch();
    } catch {
      notify.error('Update failed');
    }
  };

  const staffOptionsList = useMemo(() => [
    { value: '', label: 'Unassign' },
    ...(staff?.data?.map((s: any) => ({ value: s.id, label: `${s.name || s.partner?.name || 'Unknown'} (${s.employeeNo})` })) ?? [])
  ], [staff?.data]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading sections…</div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6" /> Class Teachers
          </h1>
          <p className="text-sm text-muted-foreground">Assign and manage homeroom teachers for each section.</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Search section, class, teacher…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); }}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Filter by class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All classes</SelectItem>
              {classOptions.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Sections Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Sections ({filteredSections.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Class Teacher</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSections.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.schoolClass?.name || s.classId?.slice(0, 8)}</TableCell>
                  <TableCell>
                    {s.classTeacherId ? (
                      <span className="text-emerald-600 font-medium">{s.classTeacher?.name || 'Assigned'}</span>
                    ) : (
                      <Badge variant="secondary">Unassigned</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(s)} title="Assign/Change teacher">
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredSections.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No sections found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Class Teacher</DialogTitle>
            <DialogDescription>Select a teacher for {editing?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label className="text-xs">Section</Label>
              <p className="font-medium">{editing?.name}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Class</Label>
              <p className="text-sm text-muted-foreground">{editing?.schoolClass?.name || editing?.classId?.slice(0, 8)}</p>
            </div>
            <Select value={editing?.classTeacherId || ''} onValueChange={(v) => setEditing({ ...editing!, classTeacherId: v || undefined })}>
              <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
              <SelectContent>
                {staffOptionsList.map((s: any) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDialogOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={updateSection.isPending}>{updateSection.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}