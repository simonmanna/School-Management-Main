import { useTerminology } from '@/features/school/api';
import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';

export function SchoolSectionsPage() {
  const labels = useTerminology();
  return (
    <SimpleCrud
      title={labels.sectionPlural}
      subtitle={`The ${labels.sectionPlural.toLowerCase()} within a ${labels.class.toLowerCase()} — e.g. North, South. Attendance, class teachers and mark sheets all hang off these.`}
      endpoint="sections"
      queryKey="sections"
      nameField="name"
      fields={[
        {
          name: 'classId',
          label: 'Class',
          type: 'select',
          required: true,
          optionsLoader: async () =>
            (await api.get('/school/classes', { params: { pageSize: 300 } })).data.data.map((c: any) => ({ value: c.id, label: c.name })),
        },
        { name: 'name', label: 'Name', placeholder: 'A', required: true },
        { name: 'capacity', label: 'Capacity', type: 'number' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'classId', label: 'Class', render: (r) => r.schoolClass?.name ?? r.class?.name ?? '' },
        { key: 'capacity', label: 'Capacity' },
      ]}
    />
  );
}
