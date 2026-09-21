import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BookOpen, EyeOff, GraduationCap, LayoutGrid, List, Search, ShieldCheck, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useClasses, useLmsCourses, useLmsSeedRoles, useSubjects, useTerms } from '@/features/school/api';
import { notify } from '@/lib/notify';

const ANY = '__any__';

/**
 * Course catalog (ADR-014 §6) — the way into every course.
 *
 * Cards carry the composed course name the server builds, not the raw offering
 * row: this screen used to print "Course a1b2c3d4" on every tile because the
 * payload had ids and nothing else, which made a class of 30 courses unusable.
 *
 * Filtering is server-side (term/class/subject) plus a free-text `q` the server
 * applies over the composed name, so searching "Maths S2" matches a course whose
 * parts live in four different tables.
 */
export function SchoolLmsCoursesPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [termId, setTermId] = useState<string>(ANY);
  const [classId, setClassId] = useState<string>(ANY);
  const [subjectId, setSubjectId] = useState<string>(ANY);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const params = useMemo(
    () => ({
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(termId !== ANY ? { termId } : {}),
      ...(classId !== ANY ? { classId } : {}),
      ...(subjectId !== ANY ? { subjectId } : {}),
    }),
    [q, termId, classId, subjectId],
  );

  const { data: courses, isLoading } = useLmsCourses(params);
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const seed = useLmsSeedRoles();

  const filtered = courses ?? [];
  const anyFilter = q.trim() !== '' || termId !== ANY || classId !== ANY || subjectId !== ANY;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Courses</h1>
        <Badge variant="outline">{filtered.length}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            title={view === 'grid' ? 'List view' : 'Grid view'}
            onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}
          >
            {view === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={seed.isPending}
            onClick={async () => {
              try {
                const r = await seed.mutateAsync();
                notify.success(`Seeded ${(r as any)?.seeded ?? 8} LMS roles`);
              } catch (e: any) {
                notify.error(e?.response?.data?.message ?? e?.message ?? 'Seed failed');
              }
            }}
          >
            <ShieldCheck className="mr-1 h-4 w-4" />
            Seed roles
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by subject, class, term or teacher…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={termId} onValueChange={setTermId}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Term" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All terms</SelectItem>
              {terms?.data?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All classes</SelectItem>
              {classes?.data?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All subjects</SelectItem>
              {subjects?.data?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {anyFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setQ(''); setTermId(ANY); setClassId(ANY); setSubjectId(ANY); }}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {anyFilter
              ? 'No courses match those filters.'
              : 'No courses yet. Create a Course Offering first, then open it here to build sections and activities.'}
          </CardContent>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && view === 'grid' && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer transition hover:border-primary hover:shadow-sm"
              onClick={() => nav(`/school/lms/courses/${c.id}`)}
            >
              <CardContent className="space-y-2 py-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium leading-tight">{c.name}</span>
                  {!c.visible && (
                    <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
                      <EyeOff className="h-3 w-3" />Hidden
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.subject && <Badge variant="outline" className="text-[10px]">{c.subject}</Badge>}
                  {c.className && <Badge variant="outline" className="text-[10px]">{c.className}</Badge>}
                  {c.term && <Badge variant="outline" className="text-[10px]">{c.term}</Badge>}
                </div>
                {c.teachers.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">{c.teachers.join(', ')}</p>
                )}
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{c.counts.modules} activities</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.counts.enrolments} enrolled</span>
                </div>
                <div className="flex items-center text-xs text-primary">
                  Open course <ArrowRight className="ml-1 h-3 w-3" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && filtered.length > 0 && view === 'list' && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {filtered.map((c) => (
                <li
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-muted/50"
                  onClick={() => nav(`/school/lms/courses/${c.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.teachers.length > 0 && (
                      <p className="truncate text-xs text-muted-foreground">{c.teachers.join(', ')}</p>
                    )}
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{c.counts.modules} activities</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{c.counts.enrolments} enrolled</span>
                  {!c.visible && <Badge variant="secondary" className="text-[10px]">Hidden</Badge>}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
