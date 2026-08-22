import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardList, FileSpreadsheet, Plus, Settings2, Users } from 'lucide-react';
import {
  useAcademicYears, useTerms, useExamTypes, useCreateExamType, useCreateExam,
  useWorkspaceExams, type WorkspaceExam,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import {
  EmptyState, Picker, Progress, WorkflowSteps, fmtDate, selectClass, useDefaulted, useStickyState,
} from './_components/exam-workflow';

/**
 * Step 1 — every exam in a term, with its progress, and one button to start a
 * new one. This is the front door of the whole assessment area: from here you
 * only ever move forwards.
 */
export function SchoolExamWorkspacePage() {
  const navigate = useNavigate();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [, setExamId] = useStickyState('examId');
  const [creating, setCreating] = useState(false);

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );

  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const { data: exams, isLoading } = useWorkspaceExams(termId ? { termId } : {});

  function go(exam: WorkspaceExam, to: string) {
    setExamId(exam.id);
    navigate(to);
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Exams &amp; Marks</h1>
          <p className="text-sm text-muted-foreground">
            Create an exam, choose which classes sit it, enter the marks, then read the results.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New exam
        </Button>
      </div>

      <WorkflowSteps current={1} />

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker
            label="Academic year"
            value={yearId}
            onChange={(v) => { setYearId(v); setTermId(''); }}
            options={yearList.map((y) => ({ value: y.id, label: y.name + (y.isCurrent ? ' (current)' : '') }))}
            className="min-w-[180px]"
          />
          <Picker
            label="Term"
            value={termId}
            onChange={setTermId}
            options={termList.map((t) => ({ value: t.id, label: t.name + (t.isCurrent ? ' (current)' : '') }))}
            className="min-w-[180px]"
          />
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading exams…</p>}

      {!isLoading && (exams ?? []).length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" />}
          title="No exams in this term yet"
          hint="An exam is one round of assessment — Mid-Term, End of Term, a CAT. Create one, then choose which classes sit it."
          action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create the first exam</Button>}
        />
      )}

      {(exams ?? []).length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">Exam</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Classes</th>
                  <th className="px-4 py-3">Marks entered</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Next step</th>
                </tr>
              </thead>
              <tbody>
                {(exams ?? []).map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.examTypeName ?? 'Exam'}
                        {e.weight != null && <> · counts {e.weight}%</>}
                        {e.isFinal && <> · final</>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {fmtDate(e.startDate)} – {fmtDate(e.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      {e.classCount === 0
                        ? <span className="text-amber-600">Not set up</span>
                        : <span>{e.classCount} class{e.classCount === 1 ? '' : 'es'} · {e.paperCount} papers</span>}
                    </td>
                    <td className="px-4 py-3"><Progress done={e.marksEntered} total={e.marksExpected} /></td>
                    <td className="px-4 py-3">
                      {e.lockedPaperCount > 0 && e.lockedPaperCount === e.paperCount
                        ? <Badge variant="secondary">Locked</Badge>
                        : e.marksExpected > 0 && e.marksEntered >= e.marksExpected
                          ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Complete</Badge>
                          : e.marksEntered > 0
                            ? <Badge variant="outline">In progress</Badge>
                            : <Badge variant="secondary">Not started</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant={e.classCount === 0 ? 'default' : 'ghost'}
                          onClick={() => go(e, '/school/exam-workspace/classes')}>
                          <Settings2 className="h-4 w-4" /> Classes
                        </Button>
                        <Button size="sm" variant={e.classCount > 0 && e.marksEntered < e.marksExpected ? 'default' : 'ghost'}
                          disabled={e.classCount === 0}
                          onClick={() => go(e, '/school/enter-marks')}>
                          <ClipboardList className="h-4 w-4" /> Marks
                        </Button>
                        <Button size="sm" variant="ghost" disabled={e.marksEntered === 0}
                          onClick={() => go(e, '/school/exam-results')}>
                          <FileSpreadsheet className="h-4 w-4" /> Results
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <NewExamDialog
        open={creating}
        termId={termId}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setExamId(id); setCreating(false); navigate('/school/exam-workspace/classes'); }}
      />
    </div>
  );
}

/**
 * Creating an exam needs a type ("Mid-Term", weighted 30%). Rather than send the
 * user to a different page to make one first, the type can be created inline.
 */
function NewExamDialog({
  open, termId, onClose, onCreated,
}: { open: boolean; termId: string; onClose: () => void; onCreated: (examId: string) => void }) {
  const { data: terms } = useTerms();
  const { data: examTypes } = useExamTypes();
  const createExam = useCreateExam();
  const createType = useCreateExamType();

  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [examTypeId, setExamTypeId] = useState('');
  const [term, setTerm] = useState(termId);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [newType, setNewType] = useState('');
  const [newWeight, setNewWeight] = useState('30');
  const [addingType, setAddingType] = useState(false);

  const types = examTypes?.data ?? [];
  const effectiveTerm = term || termId;

  async function addType() {
    if (!newType.trim()) return;
    try {
      const created = await createType.mutateAsync({ name: newType.trim(), weight: Number(newWeight) || 0 });
      setExamTypeId(created.id);
      setAddingType(false);
      setNewType('');
      notify.success(`Exam type "${created.name}" added`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not add exam type');
    }
  }

  async function submit() {
    if (!name.trim() || !examTypeId || !effectiveTerm) return;
    try {
      const created = await createExam.mutateAsync({
        termId: effectiveTerm,
        examTypeId,
        name: name.trim(),
        startDate,
        endDate,
        classes: [],
      });
      notify.success(`"${created.name}" created — now choose which classes sit it`);
      setName('');
      onCreated(created.id);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not create the exam');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New exam</DialogTitle>
          <DialogDescription>
            One round of assessment for a term. You will choose the classes on the next screen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Exam name</label>
            <Input placeholder="e.g. Mid-Term Exam" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Exam type</label>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAddingType((v) => !v)}>
                {addingType ? 'Cancel' : '+ New type'}
              </button>
            </div>
            {addingType ? (
              <div className="flex gap-2">
                <Input placeholder="Type name (e.g. CAT 1)" value={newType} onChange={(e) => setNewType(e.target.value)} />
                <Input type="number" className="w-24" placeholder="Weight" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} />
                <Button size="sm" onClick={addType} disabled={!newType.trim() || createType.isPending}>Add</Button>
              </div>
            ) : (
              <select className={selectClass} value={examTypeId} onChange={(e) => setExamTypeId(e.target.value)}>
                <option value="">Select a type…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — counts {Number(t.weight)}%</option>
                ))}
              </select>
            )}
            {!addingType && types.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No exam types yet — add one with “+ New type”.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Term</label>
            <select className={selectClass} value={effectiveTerm} onChange={(e) => setTerm(e.target.value)}>
              <option value="">Select a term…</option>
              {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Starts</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Ends</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || !examTypeId || !effectiveTerm || createExam.isPending}>
            <Users className="h-4 w-4" /> Create &amp; choose classes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
