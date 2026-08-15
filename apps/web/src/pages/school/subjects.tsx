import { useMemo } from 'react';
import { BookOpen, Clock, CalendarRange, Hash } from 'lucide-react';
import {
  useSubjects,
  usePeriods,
  useAcademicYears,
  useTerms,
  type Subject,
  type Period,
  type AcademicYear,
  type Term,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function SchoolSubjectsPage() {
  const { data: subjects } = useSubjects();
  const { data: periods } = usePeriods();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();

  const subjectRows = useMemo(() => subjects?.data ?? [], [subjects]);
  const periodRows = useMemo(() => (periods?.data ?? []).sort((a: Period, b: Period) => a.order - b.order), [periods]);
  const yearRows = useMemo(() => years?.data ?? [], [years]);
  const termRows = useMemo(() => terms?.data ?? [], [terms]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Subjects, Periods &amp; Academic Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Curriculum foundation for the school.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4 text-primary" /> Periods ({periodRows.length})</p>
            <div className="space-y-1.5">
              {periodRows.map((p: Period) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.startTime}–{p.endTime}</span>
                </div>
              ))}
              {periodRows.length === 0 && <p className="text-sm text-muted-foreground">No periods.</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium"><BookOpen className="h-4 w-4 text-primary" /> Subjects ({subjectRows.length})</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {subjectRows.map((s: Subject) => (
                <div key={s.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{s.code}</span>
                  </span>
                  {s.isCore ? <Badge className="bg-emerald-100 text-emerald-700">Core</Badge> : <Badge className="bg-slate-100 text-slate-500">Elective</Badge>}
                </div>
              ))}
              {subjectRows.length === 0 && <p className="text-sm text-muted-foreground">No subjects.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium"><CalendarRange className="h-4 w-4 text-primary" /> Academic Years &amp; Terms</p>
          <div className="space-y-3">
            {yearRows.map((y: AcademicYear) => {
              const yTerms = termRows.filter((t: Term) => t.academicYearId === y.id);
              return (
                <div key={y.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium"><Hash className="h-4 w-4" /> {y.name}</span>
                    {y.isCurrent && <Badge className="bg-emerald-100 text-emerald-700">Current</Badge>}
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">{y.startDate?.slice(0, 10)} → {y.endDate?.slice(0, 10)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {yTerms.map((t: Term) => (
                      <span key={t.id} className="rounded bg-muted px-2 py-0.5 text-xs">
                        {t.name}{t.isCurrent ? ' ★' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {yearRows.length === 0 && <p className="text-sm text-muted-foreground">No academic years.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
