import { SimpleCrud } from './_components/simple-crud';

export function SchoolPoliciesPage() {
  return (
    <SimpleCrud
      title="School Policies"
      subtitle="Generic policy store (attendance, grading, late-fee, uniform, etc.)."
      endpoint="policies"
      queryKey="policies"
      nameField="name"
      fields={[
        { name: 'key', label: 'Key', placeholder: 'attendance.graceMinutes', required: true },
        { name: 'name', label: 'Name', placeholder: 'Attendance grace (min)', required: true },
        { name: 'category', label: 'Category', placeholder: 'attendance' },
        { name: 'value', label: 'Value (JSON)', type: 'textarea', placeholder: '5  or  {"scale":"A-E"}', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'isActive', label: 'Active', type: 'boolean' },
      ]}
      columns={[
        { key: 'key', label: 'Key' },
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'value', label: 'Value', render: (r) => JSON.stringify(r.value) },
        { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? '✓' : '') },
      ]}
    />
  );
}
