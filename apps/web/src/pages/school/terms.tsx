import { SimpleCrud } from './_components/simple-crud';
import { useAcademicYears } from '@/features/school/api';

export function SchoolTermsPage() {
  const { data: years } = useAcademicYears();
  const yearOpts = (years?.data ?? []).map((y) => ({ value: y.id, label: y.name }));
  return (
    <SimpleCrud
      title="Terms / Semesters"
      subtitle="Terms within an academic year (e.g. Term 1, Term 2 or Semester 1)."
      endpoint="terms"
      queryKey="terms"
      nameField="name"
      fields={[
        {
          name: 'academicYearId',
          label: 'Academic Year',
          type: 'select',
          required: true,
          options: yearOpts,
        },
        { name: 'name', label: 'Name', placeholder: 'Term 1', required: true },
        { name: 'startDate', label: 'Start Date', type: 'date', required: true },
        { name: 'endDate', label: 'End Date', type: 'date', required: true },
        { name: 'isCurrent', label: 'Current term', type: 'boolean' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'academicYearId', label: 'Academic Year', render: (r) => years?.data?.find((y) => y.id === r.academicYearId)?.name ?? '' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        { key: 'isCurrent', label: 'Current', render: (r) => (r.isCurrent ? '✓' : '') },
      ]}
    />
  );
}
