import { useEffect, useMemo, useState } from 'react';
import { Eye, GraduationCap, Layers, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { useAcademicYears, useSubjects, useTerminology } from '@/features/school/api';
import { ProgrammeReportingDialog, reportingSummary } from './programme-reporting';
import {
  errorMessage,
  STAGE_LABEL,
  type Programme,
  type ProgrammeStage,
  useClassCohorts,
  useCreateProgramme,
  useDeleteProgramme,
  useGenerateCohorts,
  useAcademicLevels,
  useGradeLevels,
  useProgrammes,
  useUpdateCohort,
} from '@/features/school/enrollment-api';
import { NONE } from './_shared';

/**
 * Per-year subdivision override on a ClassCohort (ADR-029). `null` follows the
 * class's own `allowsStreams`. The API dropped programme/cohort `groupingMode`
 * and the separate Stream model; a class is divided into its Sections or not.
 */
const SUBDIVISION_VALUE = { follow: NONE, on: 'on', off: 'off' } as const;
const toSubdivision = (v: string): boolean | null => (v === 'on' ? true : v === 'off' ? false : null);
const fromSubdivision = (v: boolean | null | undefined): string =>
  v === true ? SUBDIVISION_VALUE.on : v === false ? SUBDIVISION_VALUE.off : SUBDIVISION_VALUE.follow;

/**
 * Programmes & Cohorts — the configuration behind every academic rule.
 *
 * Uganda's stage requirements (P1–P3 observation, P4–P7 subjects, S1–S4
 * Activities of Integration, S5–S6 combinations) live here as programme
 * configuration attached to grade levels. Nothing downstream is allowed to ask
 * "is the class called P2?"; it asks which programme the learner is under.
 */
export function SchoolProgrammesPage() {
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Programmes &amp; classes</h1>
        <p className="text-sm text-muted-foreground">
          How this school is organised: which programme each grade belongs to, which classes exist in each academic
          year, and whether each class is divided this year.
        </p>
      </header>

      <Tabs defaultValue="programmes">
        <TabsList>
          <TabsTrigger value="programmes">
            <GraduationCap className="mr-1.5 h-4 w-4" /> Programmes
          </TabsTrigger>
          <TabsTrigger value="cohorts">
            <Layers className="mr-1.5 h-4 w-4" /> Classes by year
          </TabsTrigger>
        </TabsList>

        <TabsContent value="programmes" className="mt-4">
          <ProgrammesTab />
        </TabsContent>
        <TabsContent value="cohorts" className="mt-4">
          <CohortsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProgrammesTab() {
  const { data: programmes, isLoading } = useProgrammes(true);
  const { data: gradeLevels } = useGradeLevels();
  const remove = useDeleteProgramme();
  const [viewing, setViewing] = useState<Programme | null>(null);
  const [deleting, setDeleting] = useState<Programme | null>(null);
  const [creating, setCreating] = useState(false);
  const [grading, setGrading] = useState<Programme | null>(null);
  const { data: subjects } = useSubjects();
  const subjectCode = (id: string) => (subjects?.data ?? []).find((s: any) => s.id === id)?.code ?? '?';

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify.success(`${deleting.name} deleted.`);
      setDeleting(null);
    } catch (err) {
      notify.error(errorMessage(err, 'Could not delete this programme.'));
    }
  };

  // A grade reaches its programme through its academic level (ADR-028):
  // gradeLevel → academicLevel → defaultProgramme. The API returns each
  // programme's `defaultForLevels`; the level list carries the grades.
  const { data: academicLevels } = useAcademicLevels();
  const gradesByProgramme = useMemo(() => {
    const gradesByLevel = new Map((academicLevels ?? []).map((l) => [l.id, l.gradeLevels ?? []]));
    return new Map(
      (programmes ?? []).map((p) => [
        p.id,
        (p.defaultForLevels ?? [])
          .flatMap((l) => gradesByLevel.get(l.id) ?? [])
          .sort((a, b) => a.order - b.order),
      ]),
    );
  }, [academicLevels, programmes]);
  const gradesOf = (p: Programme) => (gradesByProgramme.get(p.id) ?? []).map((g) => g.name);

  const unlinked = useMemo(() => {
    if (!gradeLevels || !programmes || !academicLevels) return [];
    const linked = new Set([...gradesByProgramme.values()].flat().map((g) => g.id));
    return gradeLevels.filter((g) => !linked.has(g.id));
  }, [gradeLevels, programmes, academicLevels, gradesByProgramme]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New programme
        </Button>
      </div>
      <CreateProgrammeDialog open={creating} onOpenChange={setCreating} />
      <ProgrammeReportingDialog programme={grading} onOpenChange={(open) => !open && setGrading(null)} />

      {unlinked.length > 0 && (
        <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          These grade levels belong to no programme yet, so learners cannot be enrolled into them:{' '}
          <strong>{unlinked.map((g) => g.name).join(', ')}</strong>.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Programme</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Authority</TableHead>
                <TableHead>Grades</TableHead>
                <TableHead>Graded as</TableHead>
                <TableHead>In use</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell>
                </TableRow>
              )}
              {!isLoading && (programmes ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No programmes yet.
                  </TableCell>
                </TableRow>
              )}
              {(programmes ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  </TableCell>
                  <TableCell>{STAGE_LABEL[p.stage]}</TableCell>
                  <TableCell className="text-muted-foreground">{p.curriculumAuthority ?? '—'}</TableCell>
                  <TableCell>
                    {gradesOf(p).length
                      ? gradesOf(p).join(', ')
                      : <span className="text-muted-foreground">Not linked</span>}
                  </TableCell>
                  <TableCell className="text-sm">{reportingSummary(p, subjectCode)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p._count ? `${p._count.cohorts} classes · ${p._count.enrollments} learners` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setGrading(p)}>
                        <SlidersHorizontal className="mr-1 h-4 w-4" /> Grading
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setViewing(p)}>
                        <Eye className="mr-1 h-4 w-4" /> View
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(p)}>
                        <Trash2 className="mr-1 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            {viewing?.description && <DialogDescription>{viewing.description}</DialogDescription>}
          </DialogHeader>
          {viewing && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Code</dt><dd>{viewing.code}</dd>
              <dt className="text-muted-foreground">Stage</dt><dd>{STAGE_LABEL[viewing.stage]}</dd>
              <dt className="text-muted-foreground">Authority</dt><dd>{viewing.curriculumAuthority ?? '—'}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd><Badge variant={viewing.isActive ? 'secondary' : 'outline'}>{viewing.isActive ? 'Active' : 'Inactive'}</Badge></dd>
              <dt className="text-muted-foreground">Effective</dt>
              <dd>
                {new Date(viewing.effectiveFrom).toLocaleDateString()}
                {' → '}
                {viewing.effectiveTo ? new Date(viewing.effectiveTo).toLocaleDateString() : 'open'}
              </dd>
              <dt className="text-muted-foreground">Grades</dt>
              <dd>{gradesOf(viewing).join(', ') || '—'}</dd>
              <dt className="text-muted-foreground">Default for</dt>
              <dd>{(viewing.defaultForLevels ?? []).map((l) => l.name).join(', ') || '—'}</dd>
              <dt className="text-muted-foreground">In use</dt>
              <dd>{viewing._count ? `${viewing._count.cohorts} classes · ${viewing._count.enrollments} learners` : '—'}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete programme</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <span className="font-medium">{deleting?.name}</span>? This cannot be undone. A programme that
              already has classes or learners cannot be deleted — deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const EMPTY_PROGRAMME = {
  code: '',
  name: '',
  stage: 'OTHER' as ProgrammeStage,
  curriculumAuthority: '',
  description: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
};

/**
 * New programme. Grades are not picked here: a grade reaches its programme
 * through its academic level's default programme (ADR-028), set on the level.
 */
function CreateProgrammeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateProgramme();
  const [form, setForm] = useState(EMPTY_PROGRAMME);
  const set = <K extends keyof typeof EMPTY_PROGRAMME>(key: K, value: (typeof EMPTY_PROGRAMME)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) setForm(EMPTY_PROGRAMME);
  }, [open]);

  const canSave = form.code.trim() !== '' && form.name.trim() !== '' && !create.isPending;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    try {
      await create.mutateAsync({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        stage: form.stage,
        curriculumAuthority: form.curriculumAuthority.trim() || undefined,
        description: form.description.trim() || undefined,
        effectiveFrom: form.effectiveFrom || undefined,
      });
      notify.success(`${form.name.trim()} created.`);
      onOpenChange(false);
    } catch (err) {
      notify.error(errorMessage(err, 'Could not create the programme.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New programme</DialogTitle>
          <DialogDescription>
            Link it to grades afterwards by making it the default programme of an academic level.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="programme-code">Code *</Label>
              <Input id="programme-code" value={form.code} placeholder="e.g. LOWER_PRIMARY"
                onChange={(e) => set('code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="programme-name">Name *</Label>
              <Input id="programme-name" value={form.name} placeholder="e.g. Lower Primary (P1–P3)"
                onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => set('stage', v as ProgrammeStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STAGE_LABEL) as ProgrammeStage[]).map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="programme-authority">Curriculum authority</Label>
              <Input id="programme-authority" value={form.curriculumAuthority} placeholder="e.g. NCDC"
                onChange={(e) => set('curriculumAuthority', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="programme-from">Effective from</Label>
              <Input id="programme-from" type="date" value={form.effectiveFrom}
                onChange={(e) => set('effectiveFrom', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="programme-description">Description</Label>
            <Textarea id="programme-description" rows={3} value={form.description}
              onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>
              {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Create programme
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CohortsTab() {
  const { data: years } = useAcademicYears();
  const [yearId, setYearId] = useState('');
  useEffect(() => {
    const rows = years?.data ?? [];
    if (!yearId && rows.length) setYearId(rows.find((y) => y.isCurrent)?.id ?? rows[0].id);
  }, [years, yearId]);

  const { data: cohorts, isLoading } = useClassCohorts({ academicYearId: yearId || undefined });
  const generate = useGenerateCohorts();
  const update = useUpdateCohort();
  const labels = useTerminology();

  const run = async () => {
    try {
      const res = await generate.mutateAsync({ academicYearId: yearId });
      notify.success(`${res.created.length} class(es) created for this year; ${res.skipped.length} already existed.`);
    } catch (err) {
      notify.error(errorMessage(err, 'Could not create the classes for this year.'));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classes for an academic year</CardTitle>
          <CardDescription>
            Each class exists once per academic year. Its {labels.sectionPlural.toLowerCase()} always belong to one of
            these, which is what stops a teacher choosing a {labels.section.toLowerCase()} from a different class.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-56 space-y-1.5">
            <Label>Academic year</Label>
            <Select value={yearId} onValueChange={setYearId}>
              <SelectTrigger><SelectValue placeholder="Choose a year" /></SelectTrigger>
              <SelectContent>
                {(years?.data ?? []).map((y) => (
                  <SelectItem key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={!yearId || generate.isPending}>
            {generate.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Create missing classes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Subdivision</TableHead>
                <TableHead>Learners placed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell>
                </TableRow>
              )}
              {!isLoading && (cohorts ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No classes set up for this year yet.
                  </TableCell>
                </TableRow>
              )}
              {(cohorts ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.schoolClass?.name ?? c.classId}</TableCell>
                  <TableCell className="text-muted-foreground">{c.schoolClass?.gradeLevel?.name ?? '—'}</TableCell>
                  <TableCell>{c.programme?.name ?? <span className="text-amber-600 dark:text-amber-400">Not mapped</span>}</TableCell>
                  <TableCell>
                    <Select
                      value={fromSubdivision(c.allowsSubdivision)}
                      onValueChange={async (v) => {
                        try {
                          await update.mutateAsync({ id: c.id, allowsSubdivision: toSubdivision(v) });
                          notify.success('Subdivision updated for this class.');
                        } catch (err) {
                          notify.error(errorMessage(err));
                        }
                      }}
                    >
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SUBDIVISION_VALUE.follow}>
                          Follow the class ({c.schoolClass?.allowsStreams === false ? 'not divided' : `divided into ${labels.sectionPlural.toLowerCase()}`})
                        </SelectItem>
                        <SelectItem value={SUBDIVISION_VALUE.on}>Divided into {labels.sectionPlural.toLowerCase()} this year</SelectItem>
                        <SelectItem value={SUBDIVISION_VALUE.off}>Not divided this year</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c._count?.placements ?? 0}</TableCell>
                  <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default SchoolProgrammesPage;
