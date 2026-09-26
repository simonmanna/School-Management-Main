import { Link } from 'react-router-dom';
import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';

export function SchoolSubjectsAdminPage() {
  return (
    <div>
      {/*
        There used to be two Subjects entries in the sidebar: this editor and a
        read-only overview of subjects, periods and the calendar. The overview is
        no longer a competing menu destination, so this is how it is reached.
      */}
      <div className="px-6 pt-6 text-sm text-muted-foreground">
        Looking for periods and the academic calendar alongside these subjects?{' '}
        <Link className="underline" to="/school/subjects">Open the subjects &amp; calendar overview</Link>.
      </div>
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
    </div>
  );
}
