import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';

const TYPE_OPTS = [
  { value: 'holiday', label: 'Holiday' },
  { value: 'working_day', label: 'Working Day' },
  { value: 'event', label: 'Event' },
  { value: 'exam', label: 'Exam' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'trip', label: 'Trip' },
  { value: 'sports', label: 'Sports' },
  { value: 'ceremony', label: 'Ceremony' },
];

export function SchoolCalendarPage() {
  return (
    <SimpleCrud
      title="School Calendar"
      subtitle="Holidays, working days, exams and events. Feeds attendance and fee due dates."
      endpoint="calendar-events"
      queryKey="calendar-events"
      nameField="title"
      fields={[
        { name: 'title', label: 'Title', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: TYPE_OPTS },
        {
          name: 'termId',
          label: 'Term',
          type: 'select',
          optionsLoader: async () =>
            (await api.get('/school/terms', { params: { pageSize: 100 } })).data.data.map((t: any) => ({ value: t.id, label: t.name })),
        },
        { name: 'startDate', label: 'Start', type: 'date', required: true },
        { name: 'endDate', label: 'End', type: 'date', required: true },
        { name: 'allDay', label: 'All day', type: 'boolean' },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
      columns={[
        { key: 'title', label: 'Title' },
        { key: 'type', label: 'Type', render: (r) => TYPE_OPTS.find((t) => t.value === r.type)?.label ?? r.type },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
      ]}
    />
  );
}
