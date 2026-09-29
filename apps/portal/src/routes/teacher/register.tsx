import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Save } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import {
  teacherClasses, useTeacherDashboard, useAttendanceStatuses, useClassRoster, useRegister, useMarkRegister,
} from '@/lib/portal-api';
import { apiErrorMessage } from '@/lib/api';
import { notify } from '@/lib/notify';
import { Button, Card, CardContent, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Taking the register, from home.
 *
 * The write is gated on `school:attendance:own` and re-checked server-side
 * against `TeacherAssignment` and the timetable, so this screen can offer only
 * the classes the caller teaches and the API refuses anything else regardless.
 *
 * Everything is marked present by default, because that is what a register
 * usually says and typing forty "present" taps on a phone is how a teacher stops
 * bothering. Absences are the exception the teacher actively records.
 */
export default function TeacherRegister() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const [params, setParams] = useSearchParams();
  const { data: dashboard, isLoading: loadingClasses } = useTeacherDashboard(teacher?.staffProfileId);

  const classes = useMemo(
    // The register is per class: several subjects in one class are one register.
    () => [...new Map(teacherClasses(dashboard).map((c) => [c.id, { id: c.id, name: c.name }])).values()],
    [dashboard],
  );

  const today = new Date().toISOString().slice(0, 10);
  const classId = params.get('classId') ?? classes[0]?.id ?? '';
  const date = params.get('date') ?? today;

  const { data: statuses } = useAttendanceStatuses(!!teacher);
  const { data: roster, isLoading: loadingRoster } = useClassRoster(classId || undefined);
  const { data: existing } = useRegister(classId || undefined, date);
  const save = useMarkRegister();

  const [marks, setMarks] = useState<Record<string, string>>({});

  const presentCode = useMemo(() => {
    const codes = statuses ?? [];
    return codes.find((s) => s.category === 'present')?.code ?? codes[0]?.code ?? 'present';
  }, [statuses]);

  // Seed from what is already recorded, so re-opening the register shows what
  // was marked rather than silently resetting everyone to present.
  useEffect(() => {
    if (!roster) return;
    const seeded: Record<string, string> = {};
    for (const pupil of roster) {
      const already = existing?.find((r) => r.studentProfileId === pupil.id);
      seeded[pupil.id] = already?.status ?? presentCode;
    }
    setMarks(seeded);
  }, [roster, existing, presentCode]);

  if (!teacher) return <Empty title="No teaching record linked" />;
  if (loadingClasses) return <Skeleton className="h-40 w-full" />;
  if (classes.length === 0) {
    return <Empty title="No classes assigned" hint="Teaching assignments are set up by the timetabler." />;
  }

  const options = (statuses ?? []).filter((s) => s.active !== false);
  const alreadyTaken = (existing?.length ?? 0) > 0;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const submit = async () => {
    try {
      await save.mutateAsync({
        classId,
        date,
        entries: Object.entries(marks).map(([studentProfileId, status]) => ({ studentProfileId, status })),
      });
      notify.success('Register saved');
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Could not save the register.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle sub={teacher.name}>Take the register</PageTitle>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Class</span>
          <select
            className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
            value={classId}
            onChange={(e) => setParam('classId', e.target.value)}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Date</span>
          <input
            type="date"
            className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
            value={date}
            // No future registers: you cannot record who turned up tomorrow.
            max={today}
            onChange={(e) => setParam('date', e.target.value)}
          />
        </label>
      </div>

      {alreadyTaken && (
        <div className="flex items-center gap-2 rounded-lg border bg-secondary/40 p-3 text-sm">
          <Check className="h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
          This register has already been taken. Saving again updates it.
        </div>
      )}

      {loadingRoster ? (
        <Skeleton className="h-64 w-full" />
      ) : (roster ?? []).length === 0 ? (
        <Empty title="No pupils in this class" />
      ) : (
        <Card>
          <CardContent className="space-y-2">
            {(roster ?? []).map((pupil) => (
              <div key={pupil.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{pupil.partner?.name ?? pupil.admissionNo}</div>
                    <div className="text-xs text-muted-foreground">{pupil.admissionNo}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((opt) => {
                    const selected = marks[pupil.id] === opt.code;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setMarks((m) => ({ ...m, [pupil.id]: opt.code }))}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-muted-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(roster ?? []).length > 0 && (
        <div className="sticky bottom-safe-b z-10 space-y-2">
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => (
              <Badge key={opt.id} variant="outline">
                {opt.label}: {Object.values(marks).filter((v) => v === opt.code).length}
              </Badge>
            ))}
          </div>
          <Button size="lg" className="w-full shadow-lg" disabled={save.isPending} onClick={submit}>
            <Save className="h-5 w-5" /> {save.isPending ? 'Saving…' : 'Save register'}
          </Button>
        </div>
      )}
    </div>
  );
}
