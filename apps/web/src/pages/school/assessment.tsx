import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Lock, Plus, ShieldCheck } from 'lucide-react';
import {
  ASSESSMENT_KINDS, KIND_LABEL, useTerms, useClasses, useSubjects, useExamTypes,
  useAssessmentPolicies, useCreateAssessmentPolicy, useAssessmentComponents, useValidateComponents, useCreateAssessmentComponent,
} from '@/features/school/api';
import { usePolicyRevisionAction } from '@/features/school/assessment-phase4-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { useProgrammes } from '@/features/school/enrollment-api';
import { api } from '@/lib/api';

const select = 'h-10 w-full rounded border bg-card px-3 text-sm';

/**
 * Assessment Weighting — how much each kind of work counts toward a term
 * result (e.g. continuous assessment 40%, end-of-term exam 60%).
 *
 * A weighting is versioned: once published it is locked, and a change is made
 * on a new draft copied from it. Exam components name the exam type they take,
 * so marks from "Mid-term" and "End of term" papers land in the right bucket.
 */
export function SchoolAssessmentPage() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const { data: examTypes } = useExamTypes();
  const { data: policies } = useAssessmentPolicies();
  const createPolicy = useCreateAssessmentPolicy();
  const [policyId, setPolicyId] = useState('');
  const policy = policies?.data.find((p) => p.id === policyId);
  const components = useAssessmentComponents(policyId || undefined);
  const validate = useValidateComponents(policyId || undefined);
  const createComponent = useCreateAssessmentComponent();
  const revision = usePolicyRevisionAction();

  const [name, setName] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  // ADR-031 D5: a programme-wide weighting, e.g. lower primary learning areas.
  const { data: programmes } = useProgrammes();
  const [programmeId, setProgrammeId] = useState('');

  const [componentName, setComponentName] = useState('');
  const [kind, setKind] = useState('cat');
  const [weight, setWeight] = useState('');
  const [absentZero, setAbsentZero] = useState(false);
  const [examTypeId, setExamTypeId] = useState('');

  const examTypeName = (id?: string | null) => (examTypes?.data ?? []).find((t) => t.id === id)?.name;

  // One-click starting points used by Ugandan primary schools (review A19). Each
  // creates a DRAFT whose exam parts name the exam type they take, ready to
  // check and publish. Exam types are matched by name (BOT/MOT/EOT).
  const findType = (re: RegExp) => (examTypes?.data ?? []).find((t) => re.test(t.name))?.id;
  const PRESETS: Array<{ name: string; parts: Array<{ name: string; kind: string; weight: number; type?: RegExp }> }> = [
    { name: 'End of term exam only', parts: [{ name: 'End of Term (EOT)', kind: 'exam', weight: 100, type: /\bEOT\b|end of term|final/i }] },
    { name: 'MOT 40% + EOT 60%', parts: [
      { name: 'Mid Term (MOT)', kind: 'exam', weight: 40, type: /\bMOT\b|mid/i },
      { name: 'End of Term (EOT)', kind: 'exam', weight: 60, type: /\bEOT\b|end of term|final/i },
    ] },
    { name: 'BOT 20% + MOT 30% + EOT 50%', parts: [
      { name: 'Beginning of Term (BOT)', kind: 'exam', weight: 20, type: /\bBOT\b|beginning/i },
      { name: 'Mid Term (MOT)', kind: 'exam', weight: 30, type: /\bMOT\b|mid/i },
      { name: 'End of Term (EOT)', kind: 'exam', weight: 50, type: /\bEOT\b|end of term|final/i },
    ] },
    { name: 'Continuous assessment 40% + EOT 60%', parts: [
      { name: 'Continuous assessment', kind: 'cat', weight: 40 },
      { name: 'End of Term (EOT)', kind: 'exam', weight: 60, type: /\bEOT\b|end of term|final/i },
    ] },
  ];
  const [presetBusy, setPresetBusy] = useState(false);
  async function addPreset(preset: (typeof PRESETS)[number]) {
    const missing = preset.parts.filter((p) => p.type && !findType(p.type));
    if (missing.length) {
      notify.error('Add the exam types first', { description: `No exam type matches ${missing.map((m) => m.name).join(', ')}. Create them under Exams & Papers.` });
      return;
    }
    setPresetBusy(true);
    try {
      const p = await createPolicy.mutateAsync({ name: preset.name });
      for (const part of preset.parts) {
        await createComponent.mutateAsync({
          policyId: p.id, name: part.name, kind: part.kind, weight: part.weight, countsAbsentAsZero: false,
          examTypeId: part.type ? findType(part.type) : undefined,
        });
      }
      setPolicyId(p.id);
      void validate.refetch();
      notify.success(`Draft "${preset.name}" created`, { description: 'Check the parts, then publish it so results can be worked out.' });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not create the weighting');
    } finally {
      setPresetBusy(false);
    }
  }

  async function addPolicy() {
    try {
      const p = await createPolicy.mutateAsync({ name: name.trim(), termId: termId || undefined, classId: classId || undefined, subjectId: subjectId || undefined, programmeId: programmeId || undefined });
      setPolicyId(p.id);
      setName('');
      notify.success('Draft weighting created', { description: 'Add its parts, then publish it when they total 100%.' });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not create the weighting');
    }
  }

  async function addComponent() {
    try {
      await createComponent.mutateAsync({
        policyId, name: componentName.trim(), kind, weight: Number(weight), countsAbsentAsZero: absentZero,
        examTypeId: kind === 'exam' && examTypeId ? examTypeId : undefined,
      });
      setComponentName('');
      setWeight('');
      setExamTypeId('');
      notify.success('Part added');
      void validate.refetch();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not add this part');
    }
  }

  async function act(action: 'publish' | 'fork') {
    try {
      const p: any = await revision.mutateAsync({ id: policyId, action });
      if (action === 'fork') setPolicyId(p.id);
      notify.success(action === 'publish' ? 'Weighting published and locked' : 'New draft created from it');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not update the weighting');
    }
  }

  async function patchComponent(id: string, body: { weight?: number; examTypeId?: string | null }) {
    try {
      await api.patch(`/school/assessment-components/${id}`, body);
      await Promise.all([components.refetch(), validate.refetch()]);
      notify.success('Part updated');
    } catch (e: any) {
      notify.error(e.response?.data?.message ?? 'Could not update this part');
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Assessment Weighting</h1>
          <p className="text-sm text-muted-foreground">
            How much each kind of work counts toward a term result. Published weightings are locked; to change one, make a new draft from it.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link to="/school/grading-scales" className="underline">Grading Scales</Link>
          <Link to="/school/assessments" className="underline">Assessments</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Weightings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-64 space-y-2 overflow-auto">
              {(policies?.data ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPolicyId(p.id)}
                  className={`flex w-full items-center justify-between rounded border p-3 text-left text-sm ${policyId === p.id ? 'border-primary bg-primary/5' : ''}`}
                >
                  <span>
                    {p.name}
                    <span className="block text-xs text-muted-foreground">
                      Version {p.revision ?? 1} · {(terms?.data ?? []).find((t) => t.id === p.termId)?.name ?? 'All terms'}
                    </span>
                  </span>
                  <Badge variant="outline">{p.publishedAt ? 'Published' : 'Draft'}</Badge>
                </button>
              ))}
              {(policies?.data ?? []).length === 0 && (
                <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                  No weightings yet. Results can't be worked out until at least one is published — start with a school-wide one below
                  (leave term, class and subject on “All”).
                </p>
              )}
            </div>

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Start from a common pattern</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <Button key={preset.name} size="sm" variant="outline" disabled={presetBusy} onClick={() => void addPreset(preset)}>
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>

            <fieldset className="space-y-3 border-t pt-3">
              <legend className="px-1 text-sm font-medium">New draft weighting</legend>
              <Input aria-label="Weighting name" placeholder="Name, e.g. Primary 40/60" value={name} onChange={(e) => setName(e.target.value)} />
              <select aria-label="Term" className={select} value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">All terms</option>
                {terms?.data.map((t) => <option key={t.id} value={t.id}>{t.label ?? t.name}</option>)}
              </select>
              <select aria-label="Class" className={select} value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">All classes</option>
                {classes?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select aria-label="Subject" className={select} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">All subjects</option>
                {subjects?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select aria-label="Programme" className={select} value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
                <option value="">All programmes</option>
                {(programmes ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">When several weightings could apply, the most specific wins: subject, then class, grade, programme, term.</p>
              <Button disabled={!name.trim() || createPolicy.isPending} onClick={() => void addPolicy()}>
                <Plus className="mr-2 h-4 w-4" />Create draft
              </Button>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{policy ? `${policy.name} · version ${policy.revision ?? 1}` : 'Choose a weighting'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {policy ? (
              <>
                {policy.publishedAt && (
                  <p className="flex items-center gap-2 rounded border bg-muted/20 p-3 text-sm">
                    <Lock className="h-4 w-4" />Published and locked. Make a new draft from it to change the weights.
                  </p>
                )}
                {(components.data ?? []).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                    <span>
                      {c.name}
                      <span className="block text-xs text-muted-foreground">
                        {KIND_LABEL[c.kind] ?? c.kind}
                        {c.kind === 'exam' && ` · takes ${examTypeName(c.examTypeId) ?? 'any exam (only safe with one exam part)'}`}
                        {' · '}{c.countsAbsentAsZero ? 'Absence counts as zero' : 'Absence not counted'}
                      </span>
                    </span>
                    {policy.publishedAt ? (
                      <Badge variant="secondary">{Number(c.weight)}%</Badge>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {c.kind === 'exam' && (
                          <select
                            aria-label={`Exam type for ${c.name}`}
                            className="h-9 rounded border bg-card px-2 text-xs"
                            value={c.examTypeId ?? ''}
                            onChange={(e) => void patchComponent(c.id, { examTypeId: e.target.value || null })}
                          >
                            <option value="">Any exam</option>
                            {(examTypes?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                        <ComponentWeight key={`${c.id}:${c.weight}`} value={Number(c.weight)} name={c.name} onSave={(w) => patchComponent(c.id, { weight: w })} />
                      </div>
                    )}
                  </div>
                ))}
                <p className={`text-sm ${validate.data?.valid ? 'text-emerald-700' : 'text-amber-700'}`}>
                  Total: {validate.data?.totalWeight ?? 0}%{validate.data?.valid ? ' — ready to publish' : ' — must add up to 100%'}
                </p>
                {!policy.publishedAt && multipleUnlinkedExams(components.data ?? []) && (
                  <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    There is more than one exam part. Choose which exam type each one takes, or exam marks won't count toward either.
                  </p>
                )}

                {!policy.publishedAt && (
                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-medium">Add a part</legend>
                    <Input aria-label="Part name" placeholder="Name, e.g. End of term exam" value={componentName} onChange={(e) => setComponentName(e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <select aria-label="Kind of work" className={select} value={kind} onChange={(e) => setKind(e.target.value)}>
                        {ASSESSMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                      <Input aria-label="Weight percent" type="number" min="0" max="100" placeholder="Weight %" value={weight} onChange={(e) => setWeight(e.target.value)} />
                    </div>
                    {kind === 'exam' && (
                      <div className="space-y-1">
                        <select aria-label="Exam type" className={select} value={examTypeId} onChange={(e) => setExamTypeId(e.target.value)}>
                          <option value="">Any exam</option>
                          {(examTypes?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          Which exam's marks go into this part. Exam types are created under Exams › Exams &amp; Papers.
                        </p>
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={absentZero} onChange={(e) => setAbsentZero(e.target.checked)} />
                      Count absence as zero
                    </label>
                    <Button
                      variant="outline"
                      disabled={!componentName.trim() || weight === '' || Number(weight) < 0 || Number(weight) > 100 || createComponent.isPending}
                      onClick={() => void addComponent()}
                    >
                      Add part
                    </Button>
                  </fieldset>
                )}

                <div className="border-t pt-3">
                  {policy.publishedAt ? (
                    <Button variant="outline" disabled={revision.isPending} onClick={() => void act('fork')}>
                      <Copy className="mr-2 h-4 w-4" />Make a new draft from this
                    </Button>
                  ) : (
                    <Button disabled={!validate.data?.valid || revision.isPending} onClick={() => void act('publish')}>
                      <ShieldCheck className="mr-2 h-4 w-4" />Publish
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Choose or create a weighting, add its parts, then publish it when they add up to 100%.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Two or more exam parts, at least one not tied to an exam type. */
function multipleUnlinkedExams(components: Array<{ kind: string; examTypeId?: string | null }>) {
  const exams = components.filter((c) => c.kind === 'exam');
  return exams.length > 1 && exams.some((c) => !c.examTypeId);
}

function ComponentWeight({ value, name, onSave }: { value: number; name: string; onSave: (weight: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const invalid = !draft || !Number.isFinite(Number(draft)) || Number(draft) < 0 || Number(draft) > 100;
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={`Weight for ${name}`} className="w-20" type="number" min={0} max={100} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <span>%</span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || invalid || Number(draft) === value}
        onClick={async () => { setBusy(true); try { await onSave(Number(draft)); } finally { setBusy(false); } }}
      >
        Save
      </Button>
    </div>
  );
}
