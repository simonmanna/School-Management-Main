import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useParentPortal, useStudentPortal, useTeacherPortal } from '@/features/school/api';

export function SchoolPortalsPage() {
  const [role, setRole] = useState<'parent' | 'student' | 'teacher'>('student');
  const [id, setId] = useState('');

  // We only fetch the relevant portal based on the picked role.
  const parent = useParentPortal(role === 'parent' ? (id ? id.split(',') : []) : []);
  const student = useStudentPortal(role === 'student' ? id : '');
  const teacher = useTeacherPortal(role === 'teacher' ? id : '');

  const data = role === 'parent' ? parent.data : role === 'student' ? student.data : teacher.data;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Portals</h1>
      <Card>
        <CardHeader>
          <CardTitle>Pick a portal</CardTitle>
          <CardDescription>Each portal composes existing services to give a role-specific view.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(['parent', 'student', 'teacher'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded border px-3 py-1 text-sm capitalize ${role === r ? 'bg-primary text-primary-foreground' : ''}`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            className="w-full rounded border p-2 text-sm"
            placeholder={role === 'parent' ? 'Comma-separated student profile IDs' : role === 'student' ? 'Student profile ID' : 'Teacher partner ID'}
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <pre className="rounded bg-muted p-3 text-xs">
            {JSON.stringify(data, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}