import { SimpleCrud } from './_components/simple-crud';

export function SchoolAcademicYearsPage() {
  return (
    <SimpleCrud
      title="Academic Years"
      subtitle="Define the school's academic years and set the current one."
      endpoint="academic-years"
      queryKey="academic-years"
      nameField="name"
      fields={[
        { name: 'name', label: 'Name', placeholder: '2025/2026', required: true },
        { name: 'startDate', label: 'Start Date', type: 'date', required: true },
        { name: 'endDate', label: 'End Date', type: 'date', required: true },
        { name: 'isCurrent', label: 'Current year', type: 'boolean' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        { key: 'isCurrent', label: 'Current', render: (r) => (r.isCurrent ? '✓' : '') },
      ]}
    />
  );
}
