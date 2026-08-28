import { Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useTeacherDashboard } from '@/lib/portal-api';
import { Card, CardContent, Skeleton, Empty, PageTitle } from '@/components/ui';

/** The classes this teacher is assigned to. */
export default function TeacherClasses() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const { data, isLoading } = useTeacherDashboard(teacher?.staffProfileId);

  if (!teacher) return <Empty title="No teaching record linked" />;
  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const classes = data?.classes ?? [];

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
          {classes.map((c, i) => (
            <Card key={c.id ?? c.classId ?? i}>
              <CardContent className="font-medium">{c.name ?? 'Class'}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
