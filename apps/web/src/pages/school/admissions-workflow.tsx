import { useEffect, useMemo, useState } from 'react';
import { Check, Info, Lock, Plus, RotateCcw, Save, Workflow } from 'lucide-react';
import {
  useAdmissionWorkflows,
  useAdmissionWorkflowSchema,
  useAdmissionCycles,
  useCreateAdmissionWorkflow,
  useUpdateAdmissionWorkflow,
  useApplyAdmissionWorkflowPreset,
  useArchiveAdmissionWorkflow,
  useAssignCycleWorkflow,
  type AdmissionStageConfig,
  type AdmissionStageKey,
  type AdmissionStageMode,
  type AdmissionWorkflow,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';

/**
 * Settings → School → Admissions Workflow.
 *
 * Renders itself from `GET /school/admissions/workflows/schema`, so adding a stage or
 * a mode on the server needs no change here. The page configures *which business
 * stages a school requires* — never the eligibility conditions (verified documents,
 * application fee, capacity), which are not negotiable and are enforced regardless.
 */
export function SchoolAdmissionsWorkflowPage() {
  const { data: schema, isLoading: schemaLoading } = useAdmissionWorkflowSchema();
  const { data: workflows, isLoading: listLoading } = useAdmissionWorkflows();
  const create = useCreateAdmissionWorkflow();
  const update = useUpdateAdmissionWorkflow();
  const applyPreset = useApplyAdmissionWorkflowPreset();
  const archive = useArchiveAdmissionWorkflow();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdmissionStageConfig[] | null>(null);
  const [name, setName] = useState('');

  const selected: AdmissionWorkflow | undefined = useMemo(
    () => workflows?.find((w) => w.id === selectedId) ?? workflows?.[0],
    [workflows, selectedId],
  );

  // Reset the draft whenever the selection changes or the server sends new stages.
  useEffect(() => {
    if (!selected) return;
    setDraft(selected.stages);
    setName(selected.name);
  }, [selected?.id, selected?.updatedAt]);

  const dirty = useMemo(() => {
    if (!selected || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(selected.stages) || name !== selected.name;
  }, [draft, name, selected]);

  // Guard against losing a half-configured workflow to a stray navigation.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (schemaLoading || listLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading admission workflows…</div>;
  }
  if (!schema) return <div className="p-6 text-sm text-destructive">Could not load the workflow schema.</div>;

  const setStageMode = (stage: AdmissionStageKey, mode: AdmissionStageMode) => {
    setDraft((prev) =>
      (prev ?? []).map((s) =>
        s.stage === stage
          ? {
              ...s,
              mode,
              // A skipped stage has no activities; mirror the server's normalisation
              // so the form never shows a state the server would reject.
              ...(s.steps && mode === 'skip'
                ? { steps: { screening: 'skip' as const, interview: 'skip' as const, exam: 'skip' as const } }
                : {}),
            }
          : s,
      ),
    );
  };

  const setStepMode = (stage: AdmissionStageKey, step: string, mode: AdmissionStageMode) => {
    setDraft((prev) =>
      (prev ?? []).map((s) => (s.stage === stage && s.steps ? { ...s, steps: { ...s.steps, [step]: mode } } : s)),
    );
  };

  const save = async () => {
    if (!selected || !draft) return;
    try {
      await update.mutateAsync({ id: selected.id, name, stages: draft });
      notify.success('Workflow saved', 'Applies to applications created from now on.');
    } catch (err: any) {
      notify.error('Could not save workflow', err?.response?.data?.message ?? String(err));
    }
  };

  const startFromPreset = async (presetKey: string) => {
    if (!selected) return;
    try {
      const updated = await applyPreset.mutateAsync({ id: selected.id, presetKey });
      setDraft(updated.stages);
      notify.success(`Applied the ${presetKey} preset`);
    } catch (err: any) {
      notify.error('Could not apply preset', err?.response?.data?.message ?? String(err));
    }
  };

  const addWorkflow = async () => {
    const label = window.prompt('Name for the new admission workflow');
    if (!label?.trim()) return;
    try {
      const created = await create.mutateAsync({ name: label.trim(), presetKey: 'standard' });
      setSelectedId(created.id);
      notify.success('Workflow created', 'Started from the Standard preset.');
    } catch (err: any) {
      notify.error('Could not create workflow', err?.response?.data?.message ?? String(err));
    }
  };

  const archiveWorkflow = async () => {
    if (!selected) return;
    if (!window.confirm(`Archive "${selected.name}"? It stays readable but cannot be assigned to new cycles.`)) return;
    try {
      await archive.mutateAsync(selected.id);
      setSelectedId(null);
      notify.success('Workflow archived');
    } catch (err: any) {
      notify.error('Could not archive workflow', err?.response?.data?.message ?? String(err));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Workflow className="h-5 w-5" /> Admission workflow
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose which stages your school requires between application and enrolment.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addWorkflow}>
            <Plus className="mr-1 h-4 w-4" /> New workflow
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
            <Save className="mr-1 h-4 w-4" /> {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* The single most important thing an administrator must understand here. */}
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>Workflow changes apply to new applications only.</strong> Applications that already
          exist keep the workflow they were created with, so nobody's process changes underneath them.
        </p>
      </div>

      {!workflows?.length ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No workflows yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit">
            <CardContent className="space-y-1 p-2">
              {workflows.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                    selected?.id === w.id ? 'bg-indigo-50 font-medium dark:bg-indigo-950/40' : 'hover:bg-muted'
                  } ${w.active ? '' : 'opacity-50'}`}
                >
                  <span className="truncate">{w.name}</span>
                  {w.isDefault && <Badge variant="secondary" className="ml-1 shrink-0">Default</Badge>}
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px] flex-1">
                    <Label htmlFor="wf-name">Workflow name</Label>
                    <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  {selected?.presetKey ? (
                    <Badge variant="outline" className="mb-2">Preset: {selected.presetKey}</Badge>
                  ) : (
                    <Badge variant="outline" className="mb-2">Custom</Badge>
                  )}
                  {selected && !selected.isDefault && (
                    <Button variant="ghost" size="sm" className="mb-1" onClick={archiveWorkflow}>
                      Archive
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-sm text-muted-foreground">Start from a preset:</span>
                  {schema.presets.map((p) => (
                    <Button
                      key={p.key}
                      variant="outline"
                      size="sm"
                      title={p.description}
                      onClick={() => startFromPreset(p.key)}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> {p.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="divide-y p-0">
                {(draft ?? []).map((stageCfg) => {
                  const def = schema.stages.find((s) => s.stage === stageCfg.stage);
                  if (!def) return null;
                  return (
                    <div key={stageCfg.stage} className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            {def.label}
                            {def.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <p className="text-xs text-muted-foreground">{def.help}</p>
                        </div>
                        <ModePicker
                          value={stageCfg.mode}
                          modes={schema.modes}
                          // Application and Enrolment are not a matter of school policy.
                          disabled={def.locked}
                          onChange={(m) => setStageMode(stageCfg.stage, m)}
                        />
                      </div>

                      {stageCfg.steps && stageCfg.mode !== 'skip' && (
                        <div className="space-y-2 rounded-md bg-muted/40 p-3">
                          {schema.evaluationSteps.map((step) => (
                            <div key={step.key} className="flex items-center justify-between gap-3">
                              <span className="text-sm">{step.label}</span>
                              <ModePicker
                                value={(stageCfg.steps as any)[step.key]}
                                modes={schema.modes}
                                onChange={(m) => setStepMode(stageCfg.stage, step.key, m)}
                              />
                            </div>
                          ))}
                          {stageCfg.mode === 'required' &&
                            !Object.values(stageCfg.steps).includes('required') && (
                              <p className="text-xs text-destructive">
                                A required Evaluation needs at least one required activity, otherwise
                                nothing can ever complete it. Set one to Required, or make Evaluation
                                Optional.
                              </p>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <CycleAssignment />
          </div>
        </div>
      )}
    </div>
  );
}

function ModePicker({
  value,
  modes,
  disabled,
  onChange,
}: {
  value: AdmissionStageMode;
  modes: Array<{ value: AdmissionStageMode; label: string; help: string }>;
  disabled?: boolean;
  onChange: (mode: AdmissionStageMode) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border">
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          disabled={disabled}
          title={m.help}
          onClick={() => onChange(m.value)}
          className={`px-2.5 py-1 text-xs ${
            value === m.value ? 'bg-indigo-600 text-white' : 'bg-background hover:bg-muted'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {value === m.value && <Check className="mr-1 inline h-3 w-3" />}
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Which workflow each admission cycle uses. The assignment governs applications
 * created from now on; existing ones keep their own snapshot.
 */
function CycleAssignment() {
  const { data: cycles } = useAdmissionCycles();
  const { data: workflows } = useAdmissionWorkflows();
  const assign = useAssignCycleWorkflow();

  if (!cycles?.length) return null;

  const onAssign = async (cycleId: string, workflowId: string) => {
    try {
      await assign.mutateAsync({ cycleId, workflowId: workflowId || null });
      notify.success('Cycle updated', 'New applications in this cycle will use the selected workflow.');
    } catch (err: any) {
      notify.error('Could not assign workflow', err?.response?.data?.message ?? String(err));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="font-medium">Admission cycles</h2>
          <p className="text-xs text-muted-foreground">
            Each cycle uses one workflow. Changing it affects new applications only.
          </p>
        </div>
        <div className="space-y-2">
          {cycles.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
              <span className="text-sm">{c.name}</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={c.workflowId ?? ''}
                onChange={(e) => onAssign(c.id, e.target.value)}
              >
                <option value="">Organisation default</option>
                {(workflows ?? [])
                  .filter((w) => w.active || w.id === c.workflowId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.active ? '' : ' (archived)'}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default SchoolAdmissionsWorkflowPage;
