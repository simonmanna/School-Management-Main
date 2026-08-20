import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useStaff } from '@/features/school/api';

/**
 * Teacher Assignments — which teacher teaches which subject to which class/section.
 * This is the HR-facing roster; the LMS derives per-term CourseOfferings from these
 * via the "from teacher assignment" action (the canonical teaching-instance spine).
 */
export function SchoolTeacherAssignmentsPage() {
  const { data: staff } = useStaff({ pageSize: 500 });
  const { data: classes } = useQuery({
    queryKey: ['school', 'classes-ta'],
    queryFn: async () => (await api.get('/school/classes', { params: { pageSize: 200 } })).data.data as any[],
  });
  const { data: subjects } = useQuery({
    queryKey: ['school', 'subjects-ta'],
    queryFn: async () => (await api.get('/school/subjects', { params: { pageSize: 300 } })).data.data as any[],
  });

  const teacherOpts = (staff?.data ?? []).map((s: any) => ({
    value: s.id,
    label: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.employeeNo || s.id,
  }));
  const classOpts = (classes ?? []).map((c: any) => ({ value: c.id, label: c.name }));
  const subjectOpts = (subjects ?? []).map((s: any) => ({ value: s.id, label: s.name }));

  return (
    <SimpleCrud
      title="Teacher Assignments"
      subtitle="Which teacher teaches which subject to which class / section."
      endpoint="teacher-assignments"
      queryKey="teacher-assignments"
      nameField="subjectId"
      fields={[
        { name: 'teacherPartnerId', label: 'Teacher', type: 'select', required: true, options: teacherOpts },
        { name: 'subjectId', label: 'Subject', type: 'select', required: true, options: subjectOpts },
        { name: 'classId', label: 'Class', type: 'select', required: true, options: classOpts },
        {
          name: 'sectionId',
          label: 'Section',
          type: 'select',
          optionsLoader: async () =>
            (await api.get('/school/sections', { params: { pageSize: 300 } })).data.data.map((s: any) => ({ value: s.id, label: s.name })),
        },
        { name: 'periodsPerWeek', label: 'Periods / week', type: 'number' },
      ]}
      columns={[
        { key: 'teacherPartnerId', label: 'Teacher', render: (r: any) => teacherOpts.find((o) => o.value === r.teacherPartnerId)?.label ?? '' },
        { key: 'subjectId', label: 'Subject', render: (r: any) => r.subject?.name ?? subjects?.find((s: any) => s.id === r.subjectId)?.name ?? '' },
        { key: 'classId', label: 'Class', render: (r: any) => r.schoolClass?.name ?? classes?.find((c: any) => c.id === r.classId)?.name ?? '' },
        { key: 'sectionId', label: 'Section', render: (r: any) => r.section?.name ?? '' },
        { key: 'periodsPerWeek', label: 'Periods/wk' },
      ]}
    />
  );
}
