import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Layers, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { useAcademicYears, useClasses, useSections, useStreams } from '@/features/school/api';
import {
  errorMessage,
  GROUPING_MODE_LABEL,
  STAGE_LABEL,
  useAttachStreamToSection,
  useClassCohorts,
  useGenerateCohorts,
  useGradeLevels,
  useProgrammes,
  useSeedUgandaProgrammes,
  useUpdateCohort,
  useUpdateProgramme,
  type GroupingMode,
} from '@/features/school/enrollment-api';
import { NONE, toId } from './_shared';

const MODES: GroupingMode[] = ['NONE', 'SECTION_ONLY', 'STREAM_ONLY', 'SECTION_AND_STREAM'];

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
          How this school is organised: which programme each grade belongs to, how each class is subdivided, and which
          classes exist in each academic year.
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
          <TabsTrigger value="grouping">
            <Wand2 className="mr-1.5 h-4 w-4" /> Sections &amp; streams
          </TabsTrigger>
        </TabsList>

        <TabsContent value="programmes" className="mt-4">
          <ProgrammesTab />
        </TabsContent>
        <TabsContent value="cohorts" className="mt-4">
          <CohortsTab />
        </TabsContent>
        <TabsContent value="grouping" className="mt-4">
          <GroupingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProgrammesTab() {
  const { data: programmes, isLoading } = useProgrammes(true);
  const { data: gradeLevels } = useGradeLevels();
  const seed = useSeedUgandaProgrammes();
  const update = useUpdateProgramme();

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
                <TableHead>Default subdivision</TableHead>
                <TableHead>In use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell>
                </TableRow>
              )}
              {!isLoading && (programmes ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
                  <TableCell>
                    <Select
                      value={p.groupingMode}
                      onValueChange={async (v) => {
                        try {
                          await update.mutateAsync({ id: p.id, groupingMode: v });
                          notify.success('Default subdivision updated.');
                        } catch (err) {
                          notify.error(errorMessage(err));
                        }
                      }}
                    >
                      <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODES.map((m) => (
                          <SelectItem key={m} value={m}>{GROUPING_MODE_LABEL[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
            Each class exists once per academic year. Sections and streams always belong to one of these, which is what
            stops a teacher choosing a stream from a different class.
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
                      value={c.groupingMode ?? NONE}
                      onValueChange={async (v) => {
                        try {
                          await update.mutateAsync({ id: c.id, groupingMode: toId(v) ?? null });
                          notify.success('Subdivision updated for this class.');
                        } catch (err) {
                          notify.error(errorMessage(err));
                        }
                      }}
                    >
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>
                          Follow the programme{c.programme ? ` (${GROUPING_MODE_LABEL[c.programme.groupingMode]})` : ''}
                        </SelectItem>
                        {MODES.map((m) => (
                          <SelectItem key={m} value={m}>{GROUPING_MODE_LABEL[m]}</SelectItem>
                        ))}
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

function GroupingTab() {
  const { data: classes } = useClasses();
  const [classId, setClassId] = useState('');
  const { data: sections } = useSections();
  const { data: streams } = useStreams(classId || undefined);
  const attach = useAttachStreamToSection();

  const classSections = (sections?.data ?? []).filter((s) => s.classId === classId);
  const classStreams = (streams?.data ?? []).filter((s) => s.classId === classId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attach streams to sections</CardTitle>
          <CardDescription>
            Only needed when a class runs <strong>sections with streams</strong> — e.g. P5 → Section A → Red / Blue. A
            stream may only sit under a section of its own class, and a stream already in use cannot be re-parented
            without moving those learners first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-64 space-y-1.5">
            <Label>Class</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {(classes?.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stream</TableHead>
                <TableHead>Belongs to section</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!classId && (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                    Choose a class to see its streams.
                  </TableCell>
                </TableRow>
              )}
              {classId && classStreams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                    This class has no streams.
                  </TableCell>
                </TableRow>
              )}
              {classStreams.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <Select
                      value={(s as { sectionId?: string | null }).sectionId ?? NONE}
                      onValueChange={async (v) => {
                        try {
                          await attach.mutateAsync({ streamId: s.id, sectionId: toId(v) ?? null });
                          notify.success('Stream updated.');
                        } catch (err) {
                          notify.error(errorMessage(err));
                        }
                      }}
                    >
                      <SelectTrigger className="w-56"><SelectValue placeholder="Not under a section" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not under a section</SelectItem>
                        {classSections.map((sec) => (
                          <SelectItem key={sec.id} value={sec.id}>{sec.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

export default SchoolProgrammesPage;
