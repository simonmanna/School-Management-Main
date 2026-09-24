import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Layers, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { useAcademicYears, useTerminology } from '@/features/school/api';
import {
  errorMessage,
  STAGE_LABEL,
  useClassCohorts,
  useGenerateCohorts,
  useGradeLevels,
  useProgrammes,
  useSeedUgandaProgrammes,
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
  const seed = useSeedUgandaProgrammes();

  const runSeed = async () => {
    try {
      const res = await seed.mutateAsync({ linkGradeLevels: true });
      notify.success(
        `Programmes ready: ${res.created.length} created, ${res.updated.length} updated.` +
          (res.unmatchedGrades.length ? ` No grade level found for ${res.unmatchedGrades.join(', ')}.` : ''),
      );
    } catch (err) {
      notify.error(errorMessage(err, 'Could not install the programme templates.'));
    }
  };

  const unlinked = useMemo(() => {
    if (!gradeLevels || !programmes) return [];
    const linked = new Set(programmes.flatMap((p) => (p.gradeLevels ?? []).map((g) => g.gradeLevelId)));
    return gradeLevels.filter((g) => !linked.has(g.id));
  }, [gradeLevels, programmes]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uganda programme templates</CardTitle>
          <CardDescription>
            Installs Lower Primary, Upper Primary, Lower Secondary and Advanced Secondary with their NCDC/UNEB defaults
            and links each to the matching grade levels (P1…S6). Safe to run more than once — it tops up rather than
            duplicating, and never overwrites a grouping choice you have already made.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runSeed} disabled={seed.isPending}>
            {seed.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            Install / refresh templates
          </Button>
        </CardContent>
      </Card>

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
                <TableHead>In use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell>
                </TableRow>
              )}
              {!isLoading && (programmes ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No programmes yet. Install the Uganda templates above to get started.
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
                    {(p.gradeLevels ?? []).length
                      ? (p.gradeLevels ?? [])
                          .map((g) => g.gradeLevel?.name)
                          .filter(Boolean)
                          .join(', ')
                      : <span className="text-muted-foreground">Not linked</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p._count ? `${p._count.cohorts} classes · ${p._count.enrollments} learners` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
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
