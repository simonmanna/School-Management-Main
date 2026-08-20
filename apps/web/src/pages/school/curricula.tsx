import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  useCurricula,
  usePublishCurriculum,
  useArchiveCurriculum,
  useCloneCurriculum,
  useDeleteCurriculum,
} from '@/features/school/api';

/**
 * Curriculum (versioned). One Curriculum per (class, academic year); versions
 * chain draft → published → archived. This UI drives the lifecycle; subjects are
 * attached at creation time.
 */
export function SchoolCurriculaPage() {
  const { data: curricula } = useCurricula();
  const publish = usePublishCurriculum();
  const archive = useArchiveCurriculum();
  const clone = useCloneCurriculum();
  const del = useDeleteCurriculum();

  const { data: classes } = useQuery({
    queryKey: ['school', 'classes-min'],
    queryFn: async () => (await api.get('/school/classes', { params: { pageSize: 200 } })).data.data as any[],
  });
  const { data: years } = useQuery({
    queryKey: ['school', 'academic-years-min'],
    queryFn: async () => (await api.get('/school/academic-years', { params: { pageSize: 100 } })).data.data as any[],
  });

  const classOpts = (classes ?? []).map((c: any) => ({ value: c.id, label: c.name }));
  const yearOpts = (years ?? []).map((y: any) => ({ value: y.id, label: y.name }));


  const statusBadge = (s: string) =>
    s === 'published' ? 'bg-green-100 text-green-800' : s === 'archived' ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-800';

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Curriculum</h1>
        <p className="text-sm text-muted-foreground">
          Per-class, per-academic-year syllabus. Published versions are immutable; edit via Clone to start a new version.
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <SimpleCrud
          title="Curriculum"
          subtitle="Versioned syllabus per class & academic year"
          endpoint="curricula"
          queryKey="curricula"
          nameField="name"
          fields={[
            { name: 'classId', label: 'Class', type: 'select', required: true, options: classOpts },
            { name: 'academicYearId', label: 'Academic Year', type: 'select', required: true, options: yearOpts },
            { name: 'name', label: 'Name', required: true, placeholder: 'P5 Mathematics 2026' },
            { name: 'description', label: 'Description', type: 'textarea' },
          ]}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'classId', label: 'Class', render: (r: any) => classes?.find((c: any) => c.id === r.classId)?.name ?? '' },
            { key: 'academicYearId', label: 'Year', render: (r: any) => years?.find((y: any) => y.id === r.academicYearId)?.name ?? '' },
            {
              key: 'version',
              label: 'v',
              render: (r: any) => `v${r.version}`,
            },
            {
              key: 'status',
              label: 'Status',
              render: (r: any) => <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge(r.status)}`}>{r.status}</span>,
            },
          ]}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Versions & lifecycle</h2>
        <div className="space-y-2">
          {(curricula ?? []).map((c: any) => (
            <div key={c.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{c.name}</span>{' '}
                <span className="text-muted-foreground">v{c.version}</span>{' '}
                <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${statusBadge(c.status)}`}>{c.status}</span>
              </div>
              <div className="flex gap-1">
                {c.status === 'draft' && (
                  <Button size="sm" variant="outline" onClick={() => publish.mutate(c.id)}>
                    Publish
                  </Button>
                )}
                {c.status === 'published' && (
                  <Button size="sm" variant="outline" onClick={() => archive.mutate(c.id)}>
                    Archive
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => clone.mutate(c.id)}>
                  Clone v{c.version + 1}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => {
                    if (confirm(`Delete curriculum "${c.name}"?`)) del.mutate(c.id);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {(curricula ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No curricula yet. Use "Add" above to create one.</p>
          )}
        </div>
      </div>
    </div>
  );
}
