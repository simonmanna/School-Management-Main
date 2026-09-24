import { SimpleCrud } from './_components/simple-crud';
import { api } from '@/lib/api';

const STAGES = [
  { value: 'PRE_PRIMARY', label: 'Pre-primary (Nursery)' },
  { value: 'PRIMARY_LOWER', label: 'Lower primary (P1–P3)' },
  { value: 'PRIMARY_UPPER', label: 'Upper primary (P4–P7)' },
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'LOWER_SECONDARY', label: 'Lower secondary (S1–S4)' },
  { value: 'ADVANCED_SECONDARY', label: 'Advanced secondary (S5–S6)' },
  { value: 'OTHER', label: 'Other' },
];

const gradeOptions = async () =>
  (await api.get('/school/grade-levels', { params: { pageSize: 200 } })).data.data.map((g: any) => ({
    value: g.id,
    label: g.name,
  }));
const levelOptions = async () =>
  (await api.get('/school/academic-levels', { params: { pageSize: 200 } })).data.data.map((l: any) => ({
    value: l.id,
    label: l.name,
  }));
const programmeOptions = async () =>
  (await api.get('/school/programmes')).data.map((p: any) => ({ value: p.id, label: p.name }));

/**
 * Grades and the ladder between them (E2E audit L2).
 *
 * Year-end promotion follows `GradeLevel.nextGradeLevelId` and stops at a grade
 * marked terminal; enrolment finds a grade's programme through its academic
 * level. The API supported all three but no screen set them, so rollover
 * refused every learner ("progression … is not configured") and bare grades
 * could not be enrolled into.
 */
export function SchoolGradesLevelsPage() {
  return (
    <div className="space-y-2">
      <SimpleCrud
        title="Grades"
        subtitle="Set where each grade promotes to next year. Mark the last grade (e.g. P7) as the end of the ladder."
        endpoint="grade-levels"
        queryKey="grade-levels"
        nameField="name"
        columns={[
          { key: 'order', label: 'Order' },
          { key: 'name', label: 'Grade' },
          { key: 'academicLevel', label: 'Level', render: (r) => r.academicLevel?.name ?? '—' },
          {
            key: 'nextGradeLevel',
            label: 'Promotes to',
            render: (r) => (r.isTerminal ? 'Leaves school (end of ladder)' : r.nextGradeLevel?.name ?? 'Not set'),
          },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'P4' },
          { name: 'order', label: 'Order', type: 'number', required: true },
          { name: 'code', label: 'Code', placeholder: 'Auto from name' },
          { name: 'academicLevelId', label: 'Academic level', type: 'select', optionsLoader: levelOptions },
          { name: 'nextGradeLevelId', label: 'Promotes to', type: 'select', optionsLoader: gradeOptions },
          { name: 'isTerminal', label: 'End of the ladder (learners graduate)', type: 'boolean' },
          { name: 'isActive', label: 'Active', type: 'boolean' },
        ]}
      />
      <SimpleCrud
        title="Academic levels"
        subtitle="Bands of grades (Nursery, Lower Primary, …). A grade enrols into its level's default programme."
        endpoint="academic-levels"
        queryKey="academic-levels"
        nameField="name"
        columns={[
          { key: 'displayOrder', label: 'Order' },
          { key: 'name', label: 'Level' },
          { key: 'stage', label: 'Stage' },
          { key: 'defaultProgramme', label: 'Default programme', render: (r) => r.defaultProgramme?.name ?? '—' },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'Upper Primary' },
          { name: 'code', label: 'Code', placeholder: 'Auto from name' },
          { name: 'stage', label: 'Stage', type: 'select', options: STAGES },
          { name: 'defaultProgrammeId', label: 'Default programme', type: 'select', optionsLoader: programmeOptions },
          { name: 'displayOrder', label: 'Order', type: 'number' },
          { name: 'isActive', label: 'Active', type: 'boolean' },
        ]}
      />
    </div>
  );
}
