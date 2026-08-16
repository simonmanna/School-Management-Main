import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';

export function SchoolSubjectsAdminPage() {
  return (
    <SimpleCrud
      title="Subjects"
      subtitle="Subjects offered, optionally grouped by department."
      endpoint="subjects"
      queryKey="subjects-admin"
      nameField="name"
      fields={[
        { name: 'code', label: 'Code', placeholder: 'MAT', required: true },
        { name: 'name', label: 'Name', placeholder: 'Mathematics', required: true },
        {
          name: 'departmentId',
          label: 'Department',
          type: 'select',
          optionsLoader: async () =>
            (await api.get('/school/departments', { params: { pageSize: 100 } })).data.data.map((d: any) => ({ value: d.id, label: d.name })),
        },
        { name: 'isCore', label: 'Core subject', type: 'boolean' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'departmentId', label: 'Department', render: (r) => r.department?.name ?? '' },
        { key: 'isCore', label: 'Core', render: (r) => (r.isCore ? '✓' : '') },
      ]}
    />
  );
}
