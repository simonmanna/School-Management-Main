import { useNavigate } from 'react-router-dom';
import { GraduationCap, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLmsCourses, useLmsSeedRoles } from '@/features/school/api';
import { notify } from '@/lib/notify';

/**
 * Course browser (ADR-014 §6). Lists Moodle-shaped course offerings; opening one
 * lands on the course page. The one-shot "Seed roles" primes the 8 archetype roles
 * + capabilities for the org (P0).
 */
export function SchoolLmsCoursesPage() {
  const nav = useNavigate();
  const { data: courses, isLoading } = useLmsCourses();
  const seed = useLmsSeedRoles();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Courses</h1>
        <Badge variant="outline">{courses?.length ?? 0}</Badge>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={seed.isPending}
            onClick={async () => {
              try {
                const r = await seed.mutateAsync();
                notify.success(`Seeded ${(r as any)?.seeded ?? 8} LMS roles`);
              } catch (e: any) {
                notify.error(e?.message ?? 'Seed failed');
              }
            }}
          >
            <ShieldCheck className="mr-1 h-4 w-4" />
            Seed roles
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading courses…</p>}
      {!isLoading && (courses?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No courses yet. Create a Course Offering first, then open it here to build sections and activities.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {courses?.map((c) => (
          <Card key={c.id} className="cursor-pointer transition hover:border-primary" onClick={() => nav(`/school/lms/courses/${c.id}`)}>
            <CardContent className="space-y-2 py-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Course {c.id.slice(0, 8)}</span>
                <Badge variant={c.visible ? 'default' : 'secondary'}>{c.format}</Badge>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{c._count?.modules ?? 0} activities</span>
                <span>{c._count?.enrolments ?? 0} enrolled</span>
                <span>{c.numSections} sections</span>
              </div>
              <div className="flex items-center text-xs text-primary">
                Open course <ArrowRight className="ml-1 h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
