import { schoolTodayNow } from '@/lib/format';
import { useMemo, useState } from 'react';
import { CalendarX2, UserCheck } from 'lucide-react';
import { useStaff, useAffectedLessons, useAssignSubstitute } from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { notify } from '@/lib/notify';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const err = (e: any) => notify.error(e?.response?.data?.message ?? 'Something went wrong');
const today = () => schoolTodayNow();

/**
 * Teacher cover — what an absence breaks, and who picks it up.
 *
 * Cover is recorded as a DATED override, never by editing the base timetable:
 * the grid is a recurring weekly pattern with no dates, so editing it would
 * make a one-day absence permanent.
 */
export function SchoolTeacherCoverPage() {
  const { data: staff } = useStaff();
  const teachers = useMemo(
    () => (staff?.data ?? []).filter((s) => s.staffCategory !== 'non_teaching'),
    [staff],
  );

  const [teacherId, setTeacherId] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());

  const { data: lessons = [], isFetching } = useAffectedLessons(teacherId || undefined, from, to);
  const assign = useAssignSubstitute();

  const [slot, setSlot] = useState<any | null>(null);
  const [substituteId, setSubstituteId] = useState('');

  const nameOf = (id: string) =>
    teachers.find((t) => t.id === id)?.partner?.name ?? id;

  const submit = () => {
    if (!slot || !substituteId) return;
    assign.mutate(
      {
        timetableSlotId: slot.id,
        substituteTeacherId: substituteId,
        effectiveFrom: from,
        effectiveTo: to,
        reason: `Cover for ${nameOf(teacherId)}`,
      },
      {
        onSuccess: () => { setSlot(null); setSubstituteId(''); notify.success('Substitute booked'); },
        onError: err,
      },
    );
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Teacher cover</h1>
        <p className="text-sm text-muted-foreground">
          Pick an absent teacher and a date range to see which lessons need cover.
          Booking a substitute creates a dated override — the normal timetable
          resumes by itself afterwards.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label>Absent teacher</Label>
            <select
              className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              <option value="">Select a teacher…</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.partner?.name ?? t.employeeNo}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarX2 className="h-4 w-4" />
            Lessons needing cover {lessons.length > 0 && <Badge variant="outline">{lessons.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!teacherId && (
            <p className="p-6 text-center text-sm text-muted-foreground">Select a teacher to begin.</p>
          )}
          {teacherId && isFetching && (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {teacherId && !isFetching && lessons.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No timetabled lessons fall in this range — nothing to cover.
            </p>
          )}
          {lessons.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead><TableHead>Period</TableHead>
                  <TableHead>Class</TableHead><TableHead>Subject</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lessons.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell>{DAYS[l.dayOfWeek] ?? l.dayOfWeek}</TableCell>
                    <TableCell>
                      {l.period?.name ?? '—'}
                      {l.period?.startTime && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {l.period.startTime}–{l.period.endTime}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{l.schoolClass?.name ?? '—'}{l.section?.name ? ` · ${l.section.name}` : ''}</TableCell>
                    <TableCell>{l.subject?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => { setSlot(l); setSubstituteId(''); }}>
                        <UserCheck className="mr-1 h-4 w-4" />Assign cover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!slot} onOpenChange={(o) => !o && setSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Assign cover — {slot?.schoolClass?.name} {slot?.subject?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {DAYS[slot?.dayOfWeek] ?? ''} {slot?.period?.name}, for {from} → {to}.
            </p>
            <div>
              <Label>Substitute</Label>
              <select
                className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm"
                value={substituteId}
                onChange={(e) => setSubstituteId(e.target.value)}
              >
                <option value="">Select a teacher…</option>
                {teachers
                  .filter((t) => t.id !== teacherId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.partner?.name ?? t.employeeNo}</option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                A teacher already teaching or covering in this period is rejected.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlot(null)}>Cancel</Button>
            <Button onClick={submit} disabled={!substituteId || assign.isPending}>Book cover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
