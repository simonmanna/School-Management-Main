import { Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { teacherClasses, useTeacherDashboard } from '@/lib/portal-api';
import { Card, CardContent, Skeleton, Empty, PageTitle } from '@/components/ui';

/** The classes this teacher is assigned to. */
export default function TeacherClasses() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const { data, isLoading } = useTeacherDashboard(teacher?.staffProfileId);

  if (!teacher) return <Empty title="No teaching record linked" />;
  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const classes = teacherClasses(data);

  return (
    <div className="space-y-4">
      <PageTitle sub={teacher.name}>My classes</PageTitle>
      {classes.length === 0 ? (
        <Empty
          icon={<Users className="h-8 w-8" />}
          title="No classes assigned"
          hint="Teaching assignments are set up by the timetabler."
        />
      ) : (
        <div className="space-y-2">
          {classes.map((c) => (
            <Card key={`${c.id}:${c.sectionId ?? ''}`}>
              <CardContent className="space-y-0.5 py-3">
                <div className="font-medium">{c.name}</div>
                {c.subjects.length > 0 && <div className="text-xs text-muted-foreground">{c.subjects.join(', ')}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
