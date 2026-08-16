import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';
import { useCampuses } from '@/features/school/api';

export function SchoolClassesPage() {
  const { data: campuses } = useCampuses();
  const campusOpts = (campuses?.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  return (
    <SimpleCrud
      title="Classes / Grades"
      subtitle="Classes belong to a grade level and (optionally) a campus."
      endpoint="classes"
      queryKey="classes"
      nameField="name"
      fields={[
        { name: 'name', label: 'Name', placeholder: 'S1 Red', required: true },
        {
          name: 'gradeLevelId',
          label: 'Grade Level',
          type: 'select',
          required: true,
          optionsLoader: async () =>
            (await api.get('/school/grade-levels', { params: { pageSize: 100 } })).data.data.map((g: any) => ({ value: g.id, label: g.name })),
        },
        {
          name: 'campusId',
          label: 'Campus',
          type: 'select',
          options: campusOpts,
        },
        { name: 'capacity', label: 'Capacity', type: 'number' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'gradeLevelId', label: 'Grade Level', render: (r) => r.gradeLevel?.name ?? '' },
        { key: 'campusId', label: 'Campus', render: (r) => campuses?.data?.find((c) => c.id === r.campusId)?.name ?? '' },
        { key: 'capacity', label: 'Capacity' },
      ]}
    />
  );
}
