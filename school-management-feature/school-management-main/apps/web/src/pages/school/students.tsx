import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search, Upload } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAuthStore } from '@/stores/auth.store';
import {
  useBulkImportStudents,
  useCreateStudent,
  useStudents,
  type Student,
} from '@/features/school/api';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  admissionNo: z.string().min(1, 'Admission number is required'),
  enrollmentDate: z.string().min(1, 'Enrollment date is required'),
});
type FormValues = z.infer<typeof schema>;

/** Naive CSV parser — handles quoted values, embedded commas, \r\n or \n. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''));
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

export function StudentsPage() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.school.manageStudents);
  const canImport = hasPermission(PERMISSIONS.school.manageStudents);
  const { data, isLoading } = useStudents({ page: 1, pageSize: 50, search: search || undefined });
  const createStudent = useCreateStudent();
  const bulkImport = useBulkImportStudents();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', admissionNo: '', enrollmentDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await createStudent.mutateAsync(values as any);
    form.reset();
    setOpen(false);
  });

  const handleFile = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      setImportResult({ created: 0, skipped: 0 });
      return;
    }
    const result = await bulkImport.mutateAsync({ rows });
    setImportResult(result);
  };

  const downloadTemplate = async () => {
    const csv = 'admissionNo,name,enrollmentDate,dateOfBirth,gender,classCode,sectionCode,house,email,phone\nSTU-0001,Test Pupil,2026-01-15,2014-01-01,female,P.1 A,A,Red,parent@test.ug,+256700000000';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<Student>[] = [
    { key: 'admissionNo', header: 'Adm. No' },
    { key: 'class', header: 'Class', render: (s) => s.currentClass?.name ?? '-' },
    { key: 'enrollmentDate', header: 'Enrolled', render: (s) => new Date(s.enrollmentDate).toLocaleDateString() },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Students</h1>
        <div className="flex gap-2">
          {canImport && (
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Upload className="mr-2 h-4 w-4" /> Bulk Import (CSV)
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Bulk import students</DialogTitle>
                  <DialogDescription>
                    Upload a CSV with the columns: admissionNo, name, enrollmentDate,
                    dateOfBirth, gender, classCode, sectionCode, house, email, phone.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    className="block w-full text-sm"
                  />
                  <Button variant="link" className="p-0" onClick={downloadTemplate}>
                    Download CSV template
                  </Button>
                  {importResult && (
                    <div className="rounded border p-3 text-sm">
                      Imported <strong>{importResult.created}</strong> student(s).
                      {importResult.skipped > 0 && (
                        <> <strong>{importResult.skipped}</strong> row(s) skipped (see server logs).</>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={() => setImportOpen(false)}>Done</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> New Student</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Student</DialogTitle>
                </DialogHeader>
                <form onSubmit={onSubmit} className="space-y-3">
                  <Input placeholder="Full name" {...form.register('name')} />
                  <Input placeholder="Admission number" {...form.register('admissionNo')} />
                  <Input type="date" {...form.register('enrollmentDate')} />
                  <DialogFooter>
                    <Button type="submit" disabled={createStudent.isPending}>Create</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by admission number…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <DataTable<Student> columns={columns} data={data?.data ?? []} loading={isLoading} />
    </div>
  );
}