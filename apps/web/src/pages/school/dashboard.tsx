import { Link } from 'react-router-dom';
import { GraduationCap, Users, Building2, BookOpen, CalendarDays, Layers } from 'lucide-react';
import { useSchoolOverview } from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const tiles = [
  { key: 'students', label: 'Students', icon: GraduationCap, to: '/school/students' },
  { key: 'staff', label: 'Staff', icon: Users, to: '/school/students' },
  { key: 'campuses', label: 'Campuses', icon: Building2, to: '/school' },
  { key: 'classes', label: 'Classes', icon: BookOpen, to: '/school' },
  { key: 'terms', label: 'Current terms', icon: CalendarDays, to: '/school' },
  { key: 'sections', label: 'Sections', icon: Layers, to: '/school' },
] as const;

export function SchoolDashboardPage() {
  const { data, isLoading } = useSchoolOverview();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">School</h1>
        <p className="text-sm text-muted-foreground">Enrolment, people and fees at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const Icon = t.icon;
          const value = data ? (data as unknown as Record<string, number>)[t.key] ?? 0 : undefined;
          return (
            <Link key={t.key} to={t.to}>
              <Card className="transition-colors hover:border-primary/40">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{value ?? 0}</div>}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Link className="text-primary hover:underline" to="/school/students">Students &amp; guardians</Link>
          <span className="text-muted-foreground">·</span>
          <Link className="text-primary hover:underline" to="/school/fees">Fees &amp; billing</Link>
        </CardContent>
      </Card>
    </div>
  );
}
