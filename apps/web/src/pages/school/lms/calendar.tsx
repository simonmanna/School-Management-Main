import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, GraduationCap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLmsCalendar } from '@/features/school/api';
import { activityUi } from '@/features/school/lms/activities/registry';

/**
 * LMS calendar (L5.2).
 *
 * Reads a date range from the server, which merges activity deadlines with
 * timetabled lessons. Scope is decided there — a pupil sees their courses, staff
 * see theirs — so this page never filters by role itself.
 */
export function SchoolLmsCalendarPage() {
  const nav = useNavigate();
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const monthEnd = useMemo(
    () => new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59),
    [monthStart],
  );
  const { data, isLoading } = useLmsCalendar(monthStart.toISOString(), monthEnd.toISOString());
  const events: any[] = (data as any[]) ?? [];

  // Group by day so the list reads as a diary rather than a flat feed.
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of events) {
      const key = new Date(e.at).toDateString();
      m.set(key, [...(m.get(key) ?? []), e]);
    }
    return m;
  }, [events]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = 1; d <= monthEnd.getDate(); d++) {
      out.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
    }
    return out;
  }, [monthStart, monthEnd]);

  const today = new Date().toDateString();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-6 w-6" />
        <h1 className="flex-1 text-xl font-semibold">
          {monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h1>
        <Button variant="outline" size="icon"
          onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => {
          const d = new Date();
          setMonthStart(new Date(d.getFullYear(), d.getMonth(), 1));
        }}>Today</Button>
        <Button variant="outline" size="icon"
          onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && events.length === 0 && (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nothing scheduled this month.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {days.filter((d) => byDay.has(d.toDateString())).map((d) => {
          const key = d.toDateString();
          const isToday = key === today;
          return (
            <Card key={key} className={isToday ? 'border-primary' : undefined}>
              <CardContent className="py-3">
                <p className={`mb-2 text-sm font-medium ${isToday ? 'text-primary' : ''}`}>
                  {d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                  {isToday && <Badge variant="secondary" className="ml-2 text-[10px]">Today</Badge>}
                </p>
                <div className="space-y-1">
                  {(byDay.get(key) ?? []).map((e) => {
                    const Icon = e.activityType ? activityUi(e.activityType).icon : GraduationCap;
                    return (
                      <button
                        key={e.id}
                        onClick={() => e.href && nav(e.href)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{e.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{e.courseName}</span>
                        </span>
                        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {e.kind === 'lesson' ? 'Lesson' : e.kind === 'quiz_close' ? 'Quiz closes' : 'Due'}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
