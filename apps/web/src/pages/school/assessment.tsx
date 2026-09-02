import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Lock, Plus, ShieldCheck } from 'lucide-react';
import { ASSESSMENT_KINDS, KIND_LABEL, useTerms, useClasses, useSubjects, useAssessmentPolicies, useCreateAssessmentPolicy, useAssessmentComponents, useValidateComponents, useCreateAssessmentComponent } from '@/features/school/api';
import { usePolicyRevisionAction } from '@/features/school/assessment-phase4-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { api } from '@/lib/api';

const select = 'h-10 w-full rounded border bg-card px-3 text-sm';
export function SchoolAssessmentPage() {
  const { data: terms } = useTerms(); const { data: classes } = useClasses(); const { data: subjects } = useSubjects();
  const { data: policies } = useAssessmentPolicies(); const createPolicy = useCreateAssessmentPolicy();
  const [policyId, setPolicyId] = useState(''); const policy = policies?.data.find((p) => p.id === policyId);
  const components = useAssessmentComponents(policyId || undefined); const validate = useValidateComponents(policyId || undefined);
  const createComponent = useCreateAssessmentComponent(); const revision = usePolicyRevisionAction();
  const [name, setName] = useState(''); const [termId, setTermId] = useState(''); const [classId, setClassId] = useState(''); const [subjectId, setSubjectId] = useState('');
  const [componentName, setComponentName] = useState(''); const [kind, setKind] = useState('cat'); const [weight, setWeight] = useState(''); const [absentZero, setAbsentZero] = useState(false);
  async function addPolicy() {
    try { const p = await createPolicy.mutateAsync({ name: name.trim(), termId: termId || undefined, classId: classId || undefined, subjectId: subjectId || undefined }); setPolicyId(p.id); setName(''); notify.success('Draft policy created'); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not create policy'); }
  }
  async function addComponent() {
    try { await createComponent.mutateAsync({ policyId, name: componentName.trim(), kind, weight: Number(weight), countsAbsentAsZero: absentZero }); setComponentName(''); setWeight(''); notify.success('Component added'); void validate.refetch(); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not add component'); }
  }
  async function act(action: 'publish' | 'fork') {
    try { const p: any = await revision.mutateAsync({ id: policyId, action }); if (action === 'fork') setPolicyId(p.id); notify.success(action === 'publish' ? 'Policy revision published and frozen' : 'New draft revision created'); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not update policy revision'); }
  }
  async function changeWeight(id: string, weight: number) {
    try { await api.patch(`/school/assessment-components/${id}`, { weight }); await Promise.all([components.refetch(), validate.refetch()]); notify.success('Draft component updated'); }
    catch (e: any) { notify.error(e.response?.data?.message ?? 'Could not update component'); }
  }
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Assessment policies</h1><p className="text-sm text-muted-foreground">Versioned weighting rules. Published revisions and their components cannot be edited.</p></div><Link to="/school/assessments" className="text-sm underline">Open Assessment Board</Link></div>
    <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Policy revisions</CardTitle></CardHeader><CardContent className="space-y-4"><div className="max-h-64 space-y-2 overflow-auto">{(policies?.data ?? []).map((p) => <button key={p.id} onClick={() => setPolicyId(p.id)} className={`flex w-full items-center justify-between rounded border p-3 text-left text-sm ${policyId === p.id ? 'border-primary bg-primary/5' : ''}`}><span>{p.name}<span className="block text-xs text-muted-foreground">Revision {p.revision ?? 1} · {(terms?.data ?? []).find((t) => t.id === p.termId)?.name ?? 'All terms'}</span></span><Badge variant="outline">{p.publishedAt ? 'Published' : 'Draft'}</Badge></button>)}</div>
      <fieldset className="space-y-3 border-t pt-3"><legend className="px-1 text-sm font-medium">Create a draft policy</legend><Input aria-label="Policy name" placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} /><select aria-label="Policy term" className={select} value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">All terms</option>{terms?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="Policy class" className={select} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{classes?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Policy subject" className={select} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">All subjects</option>{subjects?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><Button disabled={!name.trim() || createPolicy.isPending} onClick={() => void addPolicy()}><Plus className="mr-2 h-4 w-4" />Create policy</Button></fieldset>
    </CardContent></Card><Card><CardHeader><CardTitle className="text-base">{policy ? `${policy.name} · revision ${policy.revision ?? 1}` : 'Select a policy'}</CardTitle></CardHeader><CardContent className="space-y-4">{policy ? <>
      {policy.publishedAt && <p className="flex items-center gap-2 rounded border bg-muted/20 p-3 text-sm"><Lock className="h-4 w-4" />This revision is immutable. Fork it to change the weighting rules.</p>}
      {(components.data ?? []).map((c) => <div key={c.id} className="flex items-center justify-between rounded border p-3 text-sm"><span>{c.name}<span className="block text-xs text-muted-foreground">{KIND_LABEL[c.kind] ?? c.kind} · {c.countsAbsentAsZero ? 'Absence counts as zero' : 'Absence excluded'}</span></span>{policy.publishedAt ? <Badge variant="secondary">{Number(c.weight)}%</Badge> : <ComponentWeight key={`${c.id}:${c.weight}`} value={Number(c.weight)} name={c.name} onSave={(w) => changeWeight(c.id, w)} />}</div>)}
      <p className={`text-sm ${validate.data?.valid ? 'text-emerald-700' : 'text-amber-700'}`}>Total weight: {validate.data?.totalWeight ?? 0}%{validate.data?.valid ? ' — ready to publish' : ' — must equal 100%'}</p>
      {!policy.publishedAt && <fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium">Add component</legend><Input aria-label="Component name" placeholder="Component name" value={componentName} onChange={(e) => setComponentName(e.target.value)} /><div className="grid grid-cols-2 gap-2"><select aria-label="Component kind" className={select} value={kind} onChange={(e) => setKind(e.target.value)}>{ASSESSMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select><Input aria-label="Weight percent" type="number" min="0" max="100" placeholder="Weight %" value={weight} onChange={(e) => setWeight(e.target.value)} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={absentZero} onChange={(e) => setAbsentZero(e.target.checked)} />Count absence as zero (explicit policy choice)</label><Button variant="outline" disabled={!componentName.trim() || weight === '' || Number(weight) < 0 || Number(weight) > 100 || createComponent.isPending} onClick={() => void addComponent()}>Add component</Button></fieldset>}
      <div className="border-t pt-3">{policy.publishedAt ? <Button variant="outline" disabled={revision.isPending} onClick={() => void act('fork')}><Copy className="mr-2 h-4 w-4" />Fork next revision</Button> : <Button disabled={!validate.data?.valid || revision.isPending} onClick={() => void act('publish')}><ShieldCheck className="mr-2 h-4 w-4" />Publish revision</Button>}</div>
    </> : <p className="text-sm text-muted-foreground">Select or create a policy, add its components, then publish it when the weights total 100%.</p>}</CardContent></Card></div>
  </div>;
}

function ComponentWeight({ value, name, onSave }: { value: number; name: string; onSave: (weight: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value)); const [busy, setBusy] = useState(false);
  return <div className="flex items-center gap-2"><Input aria-label={`Weight for ${name}`} className="w-20" type="number" min={0} max={100} value={draft} onChange={(e) => setDraft(e.target.value)} /><span>%</span><Button size="sm" variant="outline" disabled={busy || !draft || !Number.isFinite(Number(draft)) || Number(draft) < 0 || Number(draft) > 100 || Number(draft) === value} onClick={async () => { setBusy(true); try { await onSave(Number(draft)); } finally { setBusy(false); } }}>Save</Button></div>;
}
