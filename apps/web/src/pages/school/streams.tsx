import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';

export function SchoolStreamsPage() {
  return (
    <SimpleCrud
      title="Streams (legacy)"
      subtitle="An older second subdivision, kept so existing data still works. New streams belong under Streams (P4 West) — those reach attendance and class teachers, these do not."
      endpoint="streams"
      queryKey="streams"
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
        { name: 'name', label: 'Name', placeholder: 'Science', required: true },
        { name: 'capacity', label: 'Capacity', type: 'number' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'classId', label: 'Class', render: (r) => r.class?.name ?? '' },
        { key: 'capacity', label: 'Capacity' },
      ]}
    />
  );
}
