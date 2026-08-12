import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useProfile, useCalendar, useCurrentTerm } from '@/features/school/api';

export function SchoolCalendarPage() {
  const { data: profile } = useProfile();
  const { data: calendar } = useCalendar();
  const { data: term } = useCurrentTerm();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Calendar</h1>
      {term && <Badge>Current term: {term.name}</Badge>}
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>{profile.name}</CardTitle>
            <CardDescription>{profile.motto} · {profile.country} · {profile.currencyCode} · {profile.gradingSystem}</CardDescription>
          </CardHeader>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Events</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(calendar ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="font-medium">{e.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.startDate).toLocaleDateString()} — {new Date(e.endDate).toLocaleDateString()}
                </div>
              </div>
              <Badge>{e.type}</Badge>
            </div>
          ))}
          {(calendar ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">No events yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}