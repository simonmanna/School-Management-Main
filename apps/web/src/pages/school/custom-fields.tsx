import { SimpleCrud } from './_components/simple-crud';

const ENTITY_OPTS = [
  { value: 'student', label: 'Student' },
  { value: 'staff', label: 'Staff' },
  { value: 'class', label: 'Class' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'fee', label: 'Fee' },
  { value: 'subject', label: 'Subject' },
];
const TYPE_OPTS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'textarea', label: 'Textarea' },
];

export function SchoolCustomFieldsPage() {
  return (
    <SimpleCrud
      title="Custom Fields"
      subtitle="Reusable metadata definitions attached to school entities."
      endpoint="custom-fields"
      queryKey="custom-fields"
      nameField="label"
      fields={[
        { name: 'entityType', label: 'Entity', type: 'select', required: true, options: ENTITY_OPTS },
        { name: 'name', label: 'Field Name', placeholder: 'emergencyContact', required: true },
        { name: 'label', label: 'Label', placeholder: 'Emergency Contact', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: TYPE_OPTS },
        { name: 'options', label: 'Options (comma-sep, for select)', type: 'text' },
        { name: 'required', label: 'Required', type: 'boolean' },
        { name: 'active', label: 'Active', type: 'boolean' },
        { name: 'order', label: 'Display Order', type: 'number' },
      ]}
      columns={[
        { key: 'label', label: 'Label' },
        { key: 'entityType', label: 'Entity', render: (r) => ENTITY_OPTS.find((e) => e.value === r.entityType)?.label ?? r.entityType },
        { key: 'type', label: 'Type' },
        { key: 'required', label: 'Required', render: (r) => (r.required ? '✓' : '') },
      ]}
    />
  );
}
