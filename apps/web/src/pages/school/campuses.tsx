import { useMemo, useState } from 'react';
import { Building2, Layers, MapPin } from 'lucide-react';
import { useCampuses, useClasses, useSections, type Campus, type SchoolClass, type Section } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function SchoolCampusesPage() {
  const { data: campuses } = useCampuses();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const [active, setActive] = useState<string | null>(null);

  const campusList = useMemo(() => campuses?.data ?? [], [campuses]);
  const classList = useMemo(() => classes?.data ?? [], [classes]);
  const sectionList = useMemo(() => sections?.data ?? [], [sections]);

  const classesByCampus = useMemo(
    () => Object.fromEntries(campusList.map((c) => [c.id, classList.filter((cl) => cl.campusId === c.id)])),
    [campusList, classList],
  );
  const sectionsByClass = useMemo(
    () => Object.fromEntries(classList.map((c) => [c.id, sectionList.filter((s) => s.classId === c.id)])),
    [classList, sectionList],
  );

  const shown = active ?? campusList[0]?.id ?? null;
  const shownClasses = shown ? classesByCampus[shown] ?? [] : [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Campuses, Classes &amp; Sections</h1>
        <p className="text-sm text-muted-foreground">
          {campusList.length} campuses · {classList.length} classes · {sectionList.length} sections.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-2 p-3">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Campuses</p>
            {campusList.map((c: Campus) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  c.id === shown ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted/50'
                }`}
              >
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> {c.name}</span>
                <Badge className="bg-slate-100 text-slate-600">{classesByCampus[c.id]?.length ?? 0}</Badge>
              </button>
            ))}
            {campusList.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">No campuses.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="p-4">
            {shownClasses.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No classes for this campus.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {shownClasses.map((cl: SchoolClass) => {
                  const secs = sectionsByClass[cl.id] ?? [];
                  return (
                    <div key={cl.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-medium"><Layers className="h-4 w-4 text-primary" /> {cl.name}</span>
                        <Badge className="bg-emerald-100 text-emerald-700">{secs.length} sections</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {secs.length === 0 && <span className="text-xs text-muted-foreground">No sections</span>}
                        {secs.map((s: Section) => (
                          <span key={s.id} className="rounded bg-muted px-2 py-0.5 text-xs">{s.name}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {shown && (
              <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /> {campusList.find((c) => c.id === shown)?.name} ·{' '}
                {campusList.find((c) => c.id === shown)?.phone ?? 'No phone'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
