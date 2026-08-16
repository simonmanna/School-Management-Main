import { SimpleCrud } from './_components/simple-crud';

export function SchoolDepartmentsPage() {
  return (
    <SimpleCrud
      title="Departments"
      subtitle="Academic / administrative departments."
      endpoint="departments"
      queryKey="departments"
      nameField="name"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
      ]}
    />
  );
}
