import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRightLeft,
  CalendarClock,
  ClipboardCheck,
  History,
  Loader2,
  LogOut,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  Search,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import { useAcademicYears, useTerms, useStudents } from '@/features/school/api';
import {
  errorMessage,
  MOVEMENT_REASON_LABEL,
  useBulkPlacement,
  useChangeEnrollmentStatus,
  useClassCohorts,
  useCreateEnrollment,
  useEnrollmentAction,
  useGroupingOptions,
  useLateAdmission,
  useMovePlacement,
  usePlacementHistory,
  usePreviewPlacement,
  usePromoteEnrollment,
  useProgrammes,
  useRepeatGrade,
  useRoster,
  useStudentEnrollment,
  useStudentEnrollments,
  useTermRollover,
  type BulkPlacementResult,
  type EnrollmentStatus,
  type MovementReason,
  type PlacementPreview,
  type StudentEnrollmentRow,
} from '@/features/school/enrollment-api';
import {
  formatDate,
  GroupingModeNote,
  GroupingPicker,
  NONE,
  placementLabel,
  StatusBadge,
  toId,
  ValidationNotes,
} from './_shared';

/**
 * Enrollment workspace — the Phase 1 admin surface (ADR-018 / ADR-019).
 *
 * The whole screen is built on one idea: **a learner's class membership is a
 * history, not a field.** Nothing here edits "current class". Every action
 * appends a dated movement with a reason, and the history tab shows the trail
 * that results — which is what makes an old assessment roster still correct
 * after a mid-term move, a transfer or a withdrawal.
 */

const STATUS_FILTERS: Array<{ value: EnrollmentStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'TRANSFERRED', label: 'Transferred' },
  { value: 'COMPLETED', label: 'Completed' },
];

const MOVE_REASONS: MovementReason[] = ['SECTION_CHANGE', 'STREAM_CHANGE', 'CLASS_CHANGE', 'CORRECTION'];

type DialogKind = 'move' | 'status' | 'reinstate' | 'repeat' | 'promote' | 'history' | null;

export function SchoolEnrollmentWorkspacePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'enrollments';
  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  const { data: years } = useAcademicYears();
  const currentYearId = useMemo(
    () => years?.data?.find((y) => y.isCurrent)?.id ?? years?.data?.[0]?.id ?? '',
    [years],
  );

  const [yearId, setYearId] = useState('');
  useEffect(() => {
    if (!yearId && currentYearId) setYearId(currentYearId);
  }, [currentYearId, yearId]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Enrollment</h1>
          <p className="text-sm text-muted-foreground">
            Who is enrolled, which class they sit in, and every move they have made — kept as history, not overwritten.
          </p>
        </div>
        <div className="w-56 space-y-1.5">
          <Label>Academic year</Label>
          <Select value={yearId} onValueChange={setYearId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a year" />
            </SelectTrigger>
            <SelectContent>
              {(years?.data ?? []).map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? ' (current)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="enrollments">
            <Users className="mr-1.5 h-4 w-4" /> Enrollments
          </TabsTrigger>
          <TabsTrigger value="roster">
            <ClipboardCheck className="mr-1.5 h-4 w-4" /> Class list
          </TabsTrigger>
          <TabsTrigger value="bulk">
            <ArrowRightLeft className="mr-1.5 h-4 w-4" /> Bulk placement
          </TabsTrigger>
          <TabsTrigger value="rollover">
            <CalendarClock className="mr-1.5 h-4 w-4" /> Term rollover
          </TabsTrigger>
        </TabsList>

        <TabsContent value="enrollments" className="mt-4">
          <EnrollmentsTab yearId={yearId} />
        </TabsContent>
        <TabsContent value="roster" className="mt-4">
          <RosterTab yearId={yearId} />
        </TabsContent>
        <TabsContent value="bulk" className="mt-4">
          <BulkPlacementTab yearId={yearId} />
        </TabsContent>
        <TabsContent value="rollover" className="mt-4">
          <RolloverTab yearId={yearId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ═══════════════════════════ Enrollments tab ═══════════════════════════ */

function EnrollmentsTab({ yearId }: { yearId: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EnrollmentStatus | 'ALL'>('ACTIVE');
  const [programmeId, setProgrammeId] = useState<string>(NONE);
  const [cohortId, setCohortId] = useState<string>(NONE);
  const [page, setPage] = useState(1);

  const { data: programmes } = useProgrammes();
  const { data: cohorts } = useClassCohorts({ academicYearId: yearId || undefined });

  const { data, isLoading, refetch, isFetching } = useStudentEnrollments(
    {
      academicYearId: yearId || undefined,
      status: status === 'ALL' ? undefined : status,
      programmeId: toId(programmeId),
      classCohortId: toId(cohortId),
      search: search.trim() || undefined,
      page,
      pageSize: 50,
    },
    !!yearId,
  );

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [target, setTarget] = useState<StudentEnrollmentRow | null>(null);
  const [statusIntent, setStatusIntent] = useState<'withdraw' | 'transfer-out' | 'suspend' | 'complete'>('withdraw');
  const [enrolOpen, setEnrolOpen] = useState(false);

  const open = (kind: DialogKind, row: StudentEnrollmentRow) => {
    setTarget(row);
    setDialog(kind);
  };

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label>Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Name or admission number"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="w-44 space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => { setStatus(v as EnrollmentStatus | 'ALL'); setPage(1); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52 space-y-1.5">
          <Label>Programme</Label>
          <Select value={programmeId} onValueChange={(v) => { setProgrammeId(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="All programmes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>All programmes</SelectItem>
              {(programmes ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52 space-y-1.5">
          <Label>Class</Label>
          <Select value={cohortId} onValueChange={(v) => { setCohortId(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>All classes</SelectItem>
              {(cohorts ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={isFetching ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} /> Refresh
        </Button>
        <Button onClick={() => setEnrolOpen(true)} disabled={!yearId}>
          <UserPlus className="mr-1.5 h-4 w-4" /> Enrol a learner
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Learner</TableHead>
                <TableHead>Admission no.</TableHead>
                <TableHead>Programme / grade</TableHead>
                <TableHead>Current class</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In this class since</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No enrollments match these filters. Enrol a learner, or run the migration if this school's records
                    are still in the old format.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.student?.partner?.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{row.student?.admissionNo ?? '—'}</TableCell>
                  <TableCell>
                    <div className="text-sm">{row.programme?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{row.gradeLevel?.name ?? ''}</div>
                  </TableCell>
                  <TableCell>{placementLabel(row.currentPlacement)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={row.status} />
                      {row.enrollmentType === 'REPEAT' && <Badge variant="outline">Repeating</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.currentPlacement?.effectiveFrom)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => open('history', row)}>
                          <History className="mr-2 h-4 w-4" /> Placement history
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {(row.status === 'ACTIVE' || row.status === 'SUSPENDED' || row.status === 'PENDING') && (
                          <>
                            <DropdownMenuItem onClick={() => open('move', row)}>
                              <ArrowRightLeft className="mr-2 h-4 w-4" /> Move to another class or section
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => open('promote', row)}>
                              <TrendingUp className="mr-2 h-4 w-4" /> Promote to next year
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => open('repeat', row)}>
                              <RefreshCcw className="mr-2 h-4 w-4" /> Repeat the class next year
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {row.status !== 'SUSPENDED' && (
                              <DropdownMenuItem
                                onClick={() => { setStatusIntent('suspend'); open('status', row); }}
                              >
                                <PauseCircle className="mr-2 h-4 w-4" /> Suspend
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => { setStatusIntent('transfer-out'); open('status', row); }}
                            >
                              <LogOut className="mr-2 h-4 w-4" /> Transfer out
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => { setStatusIntent('withdraw'); open('status', row); }}
                            >
                              <LogOut className="mr-2 h-4 w-4" /> Withdraw
                            </DropdownMenuItem>
                          </>
                        )}
                        {(row.status === 'WITHDRAWN' || row.status === 'TRANSFERRED' || row.status === 'SUSPENDED') && (
                          <DropdownMenuItem onClick={() => open('reinstate', row)}>
                            <PlayCircle className="mr-2 h-4 w-4" /> Bring the learner back
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} learners
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {target && dialog === 'move' && <MoveDialog row={target} onClose={() => setDialog(null)} />}
      {target && dialog === 'status' && (
        <StatusDialog row={target} intent={statusIntent} onClose={() => setDialog(null)} />
      )}
      {target && dialog === 'reinstate' && <ReinstateDialog row={target} onClose={() => setDialog(null)} />}
      {target && dialog === 'repeat' && <RepeatDialog row={target} onClose={() => setDialog(null)} />}
      {target && dialog === 'promote' && <PromoteDialog row={target} onClose={() => setDialog(null)} />}
      {target && dialog === 'history' && <HistoryDialog row={target} onClose={() => setDialog(null)} />}
      {enrolOpen && <EnrolDialog yearId={yearId} onClose={() => setEnrolOpen(false)} />}
    </div>
  );
}

/* ═══════════════════════════════ Dialogs ═══════════════════════════════ */

function MoveDialog({ row, onClose }: { row: StudentEnrollmentRow; onClose: () => void }) {
  const { data: cohorts } = useClassCohorts({ academicYearId: row.academicYearId });
  const [cohortId, setCohortId] = useState(row.currentPlacement?.classCohortId ?? '');
  const [sectionId, setSectionId] = useState<string | undefined>(row.currentPlacement?.sectionId ?? undefined);
  const [streamId, setStreamId] = useState<string | undefined>(row.currentPlacement?.streamId ?? undefined);
  const [reason, setReason] = useState('');
  const [movementReason, setMovementReason] = useState<MovementReason>('SECTION_CHANGE');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<PlacementPreview | null>(null);

  const { data: options } = useGroupingOptions(cohortId || undefined);
  const previewMut = usePreviewPlacement();
  const moveMut = useMovePlacement();

  const payload = {
    enrollmentId: row.id,
    classCohortId: cohortId || undefined,
    sectionId: sectionId ?? null,
    streamId: streamId ?? null,
    effectiveFrom: new Date(effectiveFrom).toISOString(),
    movementReason,
    reason,
  };

  // Re-validate whenever the target changes, so the "stream belongs to another
  // section" message arrives while the form is open rather than on submit.
  useEffect(() => {
    if (!cohortId) return;
    let cancelled = false;
    previewMut
      .mutateAsync(payload)
      .then((r) => { if (!cancelled) setPreview(r); })
      .catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortId, sectionId, streamId, effectiveFrom]);

  const submit = async () => {
    try {
      await moveMut.mutateAsync(payload);
      notify.success('Learner moved. The previous placement was end-dated, not overwritten.');
      onClose();
    } catch (err) {
      notify.error(errorMessage(err, 'Could not move this learner.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {row.student?.partner?.name ?? 'learner'}</DialogTitle>
          <DialogDescription>
            Currently in {placementLabel(row.currentPlacement)}. The old placement is kept and end-dated, so earlier
            class lists and results stay correct.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Class</Label>
            <Select
              value={cohortId}
              onValueChange={(v) => { setCohortId(v); setSectionId(undefined); setStreamId(undefined); }}
            >
              <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {(cohorts ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <GroupingModeNote options={options} />
          </div>

          <GroupingPicker
            cohortId={cohortId || undefined}
            sectionId={sectionId}
            streamId={streamId}
            onSectionChange={setSectionId}
            onStreamChange={setStreamId}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Effective from</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Kind of move</Label>
              <Select value={movementReason} onValueChange={(v) => setMovementReason(v as MovementReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOVE_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{MOVEMENT_REASON_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Why is the learner moving? <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              placeholder="e.g. Parent request; balancing section sizes"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <ValidationNotes errors={preview?.errors} warnings={preview?.warnings} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!reason.trim() || !cohortId || moveMut.isPending || preview?.ok === false}>
            {moveMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Move learner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_COPY: Record<'withdraw' | 'transfer-out' | 'suspend' | 'complete', { title: string; blurb: string; cta: string }> = {
  withdraw: {
    title: 'Withdraw learner',
    blurb: 'The class seat is released from this date. The learner stays in every class list and result that already covered them.',
    cta: 'Withdraw',
  },
  'transfer-out': {
    title: 'Transfer learner out',
    blurb: 'Records that the learner left for another school. Their history here is kept intact.',
    cta: 'Transfer out',
  },
  suspend: {
    title: 'Suspend learner',
    blurb: 'The learner keeps their class seat but is marked suspended. Reinstating them needs no new placement.',
    cta: 'Suspend',
  },
  complete: {
    title: 'Mark the year complete',
    blurb: 'Closes this year’s membership. Next year needs a new enrollment (promote or repeat).',
    cta: 'Mark complete',
  },
};

function StatusDialog({
  row,
  intent,
  onClose,
}: {
  row: StudentEnrollmentRow;
  intent: 'withdraw' | 'transfer-out' | 'suspend' | 'complete';
  onClose: () => void;
}) {
  const copy = STATUS_COPY[intent];
  const [reason, setReason] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 10));
  const mut = useEnrollmentAction(intent);

  const submit = async () => {
    try {
      await mut.mutateAsync({ id: row.id, reason, effectiveAt: new Date(effectiveAt).toISOString() });
      notify.success(`${copy.cta} recorded.`);
      onClose();
    } catch (err) {
      notify.error(errorMessage(err, 'Could not update this enrollment.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.blurb}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Effective date</Label>
            <Input type="date" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={intent === 'withdraw' ? 'destructive' : 'default'} onClick={submit} disabled={!reason.trim() || mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} {copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReinstateDialog({ row, onClose }: { row: StudentEnrollmentRow; onClose: () => void }) {
  const needsPlacement = row.status !== 'SUSPENDED';
  const { data: cohorts } = useClassCohorts({ academicYearId: row.academicYearId });
  const { data: terms } = useTerms();
  const yearTerms = (terms?.data ?? []).filter((t) => t.academicYearId === row.academicYearId);

  const [termId, setTermId] = useState(yearTerms.find((t) => t.isCurrent)?.id ?? '');
  const [cohortId, setCohortId] = useState('');
  const [sectionId, setSectionId] = useState<string | undefined>();
  const [streamId, setStreamId] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 10));
  const mut = useChangeEnrollmentStatus();

  useEffect(() => {
    if (!termId && yearTerms.length) setTermId(yearTerms.find((t) => t.isCurrent)?.id ?? yearTerms[0].id);
  }, [termId, yearTerms]);

  const submit = async () => {
    try {
      await mut.mutateAsync({
        id: row.id,
        toStatus: 'ACTIVE',
        reason,
        effectiveAt: new Date(effectiveAt).toISOString(),
        placement: needsPlacement
          ? {
              termId,
              classCohortId: cohortId,
              sectionId: sectionId ?? null,
              streamId: streamId ?? null,
              effectiveFrom: new Date(effectiveAt).toISOString(),
              movementReason: 'RE_ENTRY',
            }
          : undefined,
      });
      notify.success('Learner is active again.');
      onClose();
    } catch (err) {
      notify.error(errorMessage(err, 'Could not bring this learner back.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bring {row.student?.partner?.name ?? 'learner'} back</DialogTitle>
          <DialogDescription>
            {needsPlacement
              ? 'They lost their class seat when they left, so say where they are coming back to. The gap stays visible in their history.'
              : 'Lifting a suspension restores the learner without changing their class seat.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Effective date</Label>
            <Input type="date" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
          </div>

          {needsPlacement && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Term</Label>
                  <Select value={termId} onValueChange={setTermId}>
                    <SelectTrigger><SelectValue placeholder="Choose a term" /></SelectTrigger>
                    <SelectContent>
                      {yearTerms.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Select value={cohortId} onValueChange={(v) => { setCohortId(v); setSectionId(undefined); setStreamId(undefined); }}>
                    <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
                    <SelectContent>
                      {(cohorts ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <GroupingPicker
                cohortId={cohortId || undefined}
                sectionId={sectionId}
                streamId={streamId}
                onSectionChange={setSectionId}
                onStreamChange={setStreamId}
              />
            </>
          )}

          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!reason.trim() || mut.isPending || (needsPlacement && (!termId || !cohortId))}
          >
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Reinstate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared "next academic year + term + class" picker used by promote and repeat. */
function NextYearFields({
  currentYearId,
  yearId,
  termId,
  onYearChange,
  onTermChange,
}: {
  currentYearId: string;
  yearId: string;
  termId: string;
  onYearChange: (v: string) => void;
  onTermChange: (v: string) => void;
}) {
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const candidates = (years?.data ?? []).filter((y) => y.id !== currentYearId);
  const yearTerms = (terms?.data ?? []).filter((t) => t.academicYearId === yearId);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Next academic year <span className="text-destructive">*</span></Label>
        <Select value={yearId} onValueChange={(v) => { onYearChange(v); onTermChange(''); }}>
          <SelectTrigger><SelectValue placeholder="Choose a year" /></SelectTrigger>
          <SelectContent>
            {candidates.map((y) => (
              <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Starting term <span className="text-destructive">*</span></Label>
        <Select value={termId} onValueChange={onTermChange} disabled={!yearId}>
          <SelectTrigger><SelectValue placeholder={yearId ? 'Choose a term' : 'Choose a year first'} /></SelectTrigger>
          <SelectContent>
            {yearTerms.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function RepeatDialog({ row, onClose }: { row: StudentEnrollmentRow; onClose: () => void }) {
  const [toYearId, setToYearId] = useState('');
  const [toTermId, setToTermId] = useState('');
  const [reason, setReason] = useState('');
  const mut = useRepeatGrade();

  const submit = async () => {
    try {
      await mut.mutateAsync({ id: row.id, toAcademicYearId: toYearId, toTermId, reason });
      notify.success('Learner will repeat the class next year. Both years stay separately reportable.');
      onClose();
    } catch (err) {
      notify.error(errorMessage(err, 'Could not record the repeat.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Repeat {row.gradeLevel?.name ?? 'the class'}</DialogTitle>
          <DialogDescription>
            This year’s enrollment is closed and a new one is opened for next year at the same grade, marked as a
            repeat — so the two years never blur together.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <NextYearFields
            currentYearId={row.academicYearId}
            yearId={toYearId}
            termId={toTermId}
            onYearChange={setToYearId}
            onTermChange={setToTermId}
          />
          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!toYearId || !toTermId || !reason.trim() || mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Repeat the class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromoteDialog({ row, onClose }: { row: StudentEnrollmentRow; onClose: () => void }) {
  const [toYearId, setToYearId] = useState('');
  const [toTermId, setToTermId] = useState('');
  const [toClassId, setToClassId] = useState<string>(NONE);
  const [reason, setReason] = useState('');
  const { data: cohorts } = useClassCohorts({ academicYearId: toYearId || undefined });
  const mut = usePromoteEnrollment();

  const submit = async () => {
    try {
      const result = await mut.mutateAsync({
        id: row.id,
        toAcademicYearId: toYearId,
        toTermId,
        toClassId: toId(toClassId) ? cohorts?.find((c) => c.id === toClassId)?.classId : undefined,
        reason: reason.trim() || undefined,
      });
      notify.success(
        (result as { graduated?: boolean })?.graduated
          ? 'Learner was at the top grade, so the year was marked complete instead.'
          : 'Learner promoted into the next class.',
      );
      onClose();
    } catch (err) {
      notify.error(errorMessage(err, 'Could not promote this learner.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote {row.student?.partner?.name ?? 'learner'}</DialogTitle>
          <DialogDescription>
            Leave the class blank to follow the grade ladder. A learner already at the top grade is marked complete
            rather than promoted into nothing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <NextYearFields
            currentYearId={row.academicYearId}
            yearId={toYearId}
            termId={toTermId}
            onYearChange={setToYearId}
            onTermChange={setToTermId}
          />
          <div className="space-y-1.5">
            <Label>Class (optional)</Label>
            <Select value={toClassId} onValueChange={setToClassId} disabled={!toYearId}>
              <SelectTrigger><SelectValue placeholder="Next class on the ladder" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Next class on the ladder</SelectItem>
                {(cohorts ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!toYearId || !toTermId || mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Promote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: StudentEnrollmentRow; onClose: () => void }) {
  const { data: placements, isLoading } = usePlacementHistory(row.id);
  const { data: detail } = useStudentEnrollment(row.id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{row.student?.partner?.name ?? 'Learner'} — placement history</DialogTitle>
          <DialogDescription>
            Every class this learner has held in {row.academicYear?.name ?? 'this year'}, in order. Nothing here is
            ever edited; a move adds a row and closes the previous one.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}

        <div className="max-h-[45vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(placements ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{formatDate(p.effectiveFrom)}</TableCell>
                  <TableCell>{p.effectiveTo ? formatDate(p.effectiveTo) : <Badge variant="outline">Current</Badge>}</TableCell>
                  <TableCell>{placementLabel(p)}</TableCell>
                  <TableCell className="text-muted-foreground">{p.term?.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {MOVEMENT_REASON_LABEL[p.movementReason] ?? p.movementReason}
                    {p.notes ? ` — ${p.notes}` : ''}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (placements ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No placements recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {!!detail?.events?.length && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Membership changes</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {detail.events.map((e) => (
                <li key={e.id}>
                  {formatDate(e.changedAt)} — {e.fromStatus ? `${e.fromStatus} → ` : ''}
                  {e.toStatus}
                  {e.reason ? `: ${e.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnrolDialog({ yearId, onClose }: { yearId: string; onClose: () => void }) {
  const [studentSearch, setStudentSearch] = useState('');
  const [studentProfileId, setStudentProfileId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [sectionId, setSectionId] = useState<string | undefined>();
  const [streamId, setStreamId] = useState<string | undefined>();
  const [termId, setTermId] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [admissionDate, setAdmissionDate] = useState(new Date().toISOString().slice(0, 10));
  const [late, setLate] = useState(false);

  const { data: students } = useStudents({ search: studentSearch || undefined, page: 1, pageSize: 25 });
  const { data: cohorts } = useClassCohorts({ academicYearId: yearId || undefined });
  const { data: terms } = useTerms();
  const yearTerms = (terms?.data ?? []).filter((t) => t.academicYearId === yearId);

  const createMut = useCreateEnrollment();
  const lateMut = useLateAdmission();
  const pending = createMut.isPending || lateMut.isPending;

  useEffect(() => {
    if (!termId && yearTerms.length) setTermId(yearTerms.find((t) => t.isCurrent)?.id ?? yearTerms[0].id);
  }, [termId, yearTerms]);

  const submit = async () => {
    const placement = {
      termId,
      classCohortId: cohortId,
      sectionId: sectionId ?? null,
      streamId: streamId ?? null,
      rollNumber: rollNumber.trim() || undefined,
      effectiveFrom: new Date(admissionDate).toISOString(),
    };
    try {
      if (late) {
        await lateMut.mutateAsync({
          studentProfileId,
          academicYearId: yearId,
          admissionDate: new Date(admissionDate).toISOString(),
          placement,
        });
      } else {
        await createMut.mutateAsync({
          studentProfileId,
          academicYearId: yearId,
          admissionDate: new Date(admissionDate).toISOString(),
          placement,
        });
      }
      notify.success('Learner enrolled.');
      onClose();
    } catch (err) {
      notify.error(errorMessage(err, 'Could not enrol this learner.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enrol a learner</DialogTitle>
          <DialogDescription>
            Gives an existing pupil their membership for this academic year and their first class placement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Find the learner <span className="text-destructive">*</span></Label>
            <Input
              placeholder="Type a name or admission number"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
            />
            <Select value={studentProfileId} onValueChange={setStudentProfileId}>
              <SelectTrigger><SelectValue placeholder="Choose from the matches" /></SelectTrigger>
              <SelectContent>
                {(students?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.partner?.name ?? 'Unnamed'} — {s.admissionNo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Term <span className="text-destructive">*</span></Label>
              <Select value={termId} onValueChange={setTermId}>
                <SelectTrigger><SelectValue placeholder="Choose a term" /></SelectTrigger>
                <SelectContent>
                  {yearTerms.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Class <span className="text-destructive">*</span></Label>
              <Select value={cohortId} onValueChange={(v) => { setCohortId(v); setSectionId(undefined); setStreamId(undefined); }}>
                <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
                <SelectContent>
                  {(cohorts ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <GroupingPicker
            cohortId={cohortId || undefined}
            sectionId={sectionId}
            streamId={streamId}
            onSectionChange={setSectionId}
            onStreamChange={setStreamId}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date they joined</Label>
              <Input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Roll number (optional)</Label>
              <Input value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={late} onChange={(e) => setLate(e.target.checked)} />
            <span>
              <span className="font-medium">This is a late admission.</span>{' '}
              <span className="text-muted-foreground">
                The placement is dated from the day they actually joined, so class lists and assessment rosters taken
                before that date stay unchanged.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!studentProfileId || !cohortId || !termId || pending}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Enrol
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════ Roster tab ═════════════════════════════ */

function RosterTab({ yearId }: { yearId: string }) {
  const { data: cohorts } = useClassCohorts({ academicYearId: yearId || undefined });
  const [cohortId, setCohortId] = useState('');
  const [at, setAt] = useState(new Date().toISOString().slice(0, 10));
  const { data: roster, isLoading } = useRoster(cohortId || undefined, { at: new Date(at).toISOString() });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Class list on a date</CardTitle>
          <CardDescription>
            Reconstructed from placement history. Pick a past date to see the class exactly as it stood then — including
            learners who have since left, which is what makes an old result reproducible.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-64 space-y-1.5">
            <Label>Class</Label>
            <Select value={cohortId} onValueChange={setCohortId}>
              <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {(cohorts ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48 space-y-1.5">
            <Label>As at</Label>
            <Input type="date" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
          {!!roster?.length && <Badge variant="outline">{roster.length} learners</Badge>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll</TableHead>
                <TableHead>Learner</TableHead>
                <TableHead>Admission no.</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Stream</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In class since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell>
                </TableRow>
              )}
              {!isLoading && (roster ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {cohortId ? 'Nobody was placed in this class on that date.' : 'Choose a class to see its list.'}
                  </TableCell>
                </TableRow>
              )}
              {(roster ?? []).map((r) => (
                <TableRow key={r.placementId}>
                  <TableCell className="text-muted-foreground">{r.rollNumber ?? '—'}</TableCell>
                  <TableCell className="font-medium">{r.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.admissionNo ?? '—'}</TableCell>
                  <TableCell>{r.sectionName ?? '—'}</TableCell>
                  <TableCell>{r.streamName ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={r.enrollmentStatus} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.effectiveFrom)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════════ Bulk placement tab ═════════════════════════ */

function BulkPlacementTab({ yearId }: { yearId: string }) {
  const { data: cohorts } = useClassCohorts({ academicYearId: yearId || undefined });
  const { data: terms } = useTerms();
  const yearTerms = (terms?.data ?? []).filter((t) => t.academicYearId === yearId);

  const [sourceCohortId, setSourceCohortId] = useState('');
  const [targetCohortId, setTargetCohortId] = useState('');
  const [termId, setTermId] = useState('');
  const [sectionId, setSectionId] = useState<string | undefined>();
  const [streamId, setStreamId] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<BulkPlacementResult | null>(null);

  const { data: list, isLoading } = useStudentEnrollments(
    { academicYearId: yearId || undefined, classCohortId: sourceCohortId || undefined, status: 'ACTIVE', pageSize: 500 },
    !!sourceCohortId,
  );
  const mut = useBulkPlacement();

  useEffect(() => {
    if (!termId && yearTerms.length) setTermId(yearTerms.find((t) => t.isCurrent)?.id ?? yearTerms[0].id);
  }, [termId, yearTerms]);

  const rows = list?.data ?? [];
  const chosen = rows.filter((r) => selected[r.id]);

  const run = async (dryRun: boolean) => {
    try {
      const res = await mut.mutateAsync({
        termId,
        movementReason: targetCohortId && targetCohortId !== sourceCohortId ? 'CLASS_CHANGE' : 'SECTION_CHANGE',
        reason,
        dryRun,
        rows: chosen.map((r) => ({
          enrollmentId: r.id,
          classCohortId: targetCohortId || undefined,
          sectionId: sectionId ?? null,
          streamId: streamId ?? null,
        })),
      });
      setResult(res);
      notify.success(dryRun ? `Checked ${res.total} learners — ${res.ok} ready, ${res.failed} with problems.` : `Moved ${res.ok} learners.`);
      if (!dryRun) setSelected({});
    } catch (err) {
      notify.error(errorMessage(err, 'Bulk placement failed. Nothing was saved.'));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Move several learners at once</CardTitle>
          <CardDescription>
            Check the placement first — a batch with any invalid row is refused whole, because a half-applied class
            reshuffle is worse than a rejected one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>From class</Label>
              <Select value={sourceCohortId} onValueChange={(v) => { setSourceCohortId(v); setSelected({}); setResult(null); }}>
                <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
                <SelectContent>
                  {(cohorts ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>To class</Label>
              <Select value={targetCohortId} onValueChange={(v) => { setTargetCohortId(v); setSectionId(undefined); setStreamId(undefined); }}>
                <SelectTrigger><SelectValue placeholder="Same class" /></SelectTrigger>
                <SelectContent>
                  {(cohorts ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Term</Label>
              <Select value={termId} onValueChange={setTermId}>
                <SelectTrigger><SelectValue placeholder="Choose a term" /></SelectTrigger>
                <SelectContent>
                  {yearTerms.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <GroupingPicker
            cohortId={targetCohortId || sourceCohortId || undefined}
            sectionId={sectionId}
            streamId={streamId}
            onSectionChange={setSectionId}
            onStreamChange={setStreamId}
          />

          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. Balancing section sizes for Term 2" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => run(true)} disabled={!chosen.length || !reason.trim() || !termId || mut.isPending}>
              {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Check {chosen.length || ''} placement{chosen.length === 1 ? '' : 's'}
            </Button>
            <Button onClick={() => run(false)} disabled={!chosen.length || !reason.trim() || !termId || mut.isPending}>
              Apply to {chosen.length} learner{chosen.length === 1 ? '' : 's'}
            </Button>
          </div>

          {result && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p className="font-medium">
                {result.dryRun ? 'Check' : 'Applied'}: {result.ok} ready, {result.failed} with problems, {result.total} total.
              </p>
              {result.rows
                .filter((r) => !r.ok || r.warnings.length)
                .slice(0, 20)
                .map((r) => (
                  <div key={r.enrollmentId}>
                    <span className="text-muted-foreground">
                      {rows.find((x) => x.id === r.enrollmentId)?.student?.partner?.name ?? r.enrollmentId}:
                    </span>{' '}
                    <ValidationNotes errors={r.errors} warnings={r.warnings} />
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.length > 0 && chosen.length === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? Object.fromEntries(rows.map((r) => [r.id, true])) : {})
                    }
                  />
                </TableHead>
                <TableHead>Learner</TableHead>
                <TableHead>Admission no.</TableHead>
                <TableHead>Current placement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    {sourceCohortId ? 'No active learners in this class.' : 'Choose a class to list its learners.'}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.student?.partner?.name ?? 'learner'}`}
                      checked={!!selected[r.id]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{r.student?.partner?.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.student?.admissionNo ?? '—'}</TableCell>
                  <TableCell>{placementLabel(r.currentPlacement)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ═════════════════════════════ Rollover tab ════════════════════════════ */

function RolloverTab({ yearId }: { yearId: string }) {
  const { data: terms } = useTerms();
  const { data: cohorts } = useClassCohorts({ academicYearId: yearId || undefined });
  const yearTerms = (terms?.data ?? []).filter((t) => t.academicYearId === yearId);

  const [fromTermId, setFromTermId] = useState('');
  const [toTermId, setToTermId] = useState('');
  const [cohortId, setCohortId] = useState<string>(NONE);
  const [plan, setPlan] = useState<{ total: number; eligible: number; skipped: number; committed: boolean } | null>(null);
  const mut = useTermRollover();

  const run = async (dryRun: boolean) => {
    try {
      const res = await mut.mutateAsync({ fromTermId, toTermId, classCohortId: toId(cohortId), dryRun });
      setPlan(res);
      notify.success(
        dryRun
          ? `${res.eligible} of ${res.total} placements would roll over.`
          : `Rolled ${res.eligible} placements into the next term.`,
      );
    } catch (err) {
      notify.error(errorMessage(err, 'Rollover failed.'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Roll placements into the next term</CardTitle>
        <CardDescription>
          Carries every open placement forward with the same class, section and stream. Terms must belong to the same
          academic year — crossing years is promotion or repeating, not a rollover.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>From term</Label>
            <Select value={fromTermId} onValueChange={setFromTermId}>
              <SelectTrigger><SelectValue placeholder="Choose a term" /></SelectTrigger>
              <SelectContent>
                {yearTerms.map((t) => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>To term</Label>
            <Select value={toTermId} onValueChange={setToTermId}>
              <SelectTrigger><SelectValue placeholder="Choose a term" /></SelectTrigger>
              <SelectContent>
                {yearTerms.filter((t) => t.id !== fromTermId).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Class (optional)</Label>
            <Select value={cohortId} onValueChange={setCohortId}>
              <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All classes</SelectItem>
                {(cohorts ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.schoolClass?.name ?? c.classId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => run(true)} disabled={!fromTermId || !toTermId || mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Preview
          </Button>
          <Button onClick={() => run(false)} disabled={!fromTermId || !toTermId || mut.isPending}>
            Roll over
          </Button>
        </div>

        {plan && (
          <p className="rounded-md border p-3 text-sm">
            {plan.committed ? 'Rolled over' : 'Would roll over'} <strong>{plan.eligible}</strong> of {plan.total}{' '}
            placements. {plan.skipped > 0 && `${plan.skipped} skipped (the learner no longer holds a class seat).`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default SchoolEnrollmentWorkspacePage;
