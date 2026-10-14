import { useState } from 'react';
import { Plus, Play, Send, FileCheck2, Database } from 'lucide-react';
import {
  useStudents,
  useQuestionBanks, useCreateQuestionBank, useBankQuestions, useCreateQuestion,
  usePapers, usePaper, useCreatePaper, useAddPaperQuestion,
  useStartAttempt, useAttempt, useSaveResponse, useSubmitAttempt,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolCbtPage() {
  // Sitting a quiz is a pupil's grant (`cbt:take`); staff never had it, so the
  // tab only produced "Start failed". Show it to whoever can actually sit one.
  const canTake = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.takeCbt));
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Quizzes (CBT)</h1>
        <p className="text-sm text-muted-foreground">Build a question bank, assemble quiz papers from it, and have pupils sit them on screen — marked automatically.</p>
      </div>
      <Tabs defaultValue="bank">
        <TabsList>
          <TabsTrigger value="bank">Question bank</TabsTrigger>
          <TabsTrigger value="papers">Quiz papers</TabsTrigger>
          {canTake && <TabsTrigger value="take">Sit a quiz</TabsTrigger>}
        </TabsList>
        <TabsContent value="bank" className="pt-4"><BankTab/></TabsContent>
        <TabsContent value="papers" className="pt-4"><PapersTab/></TabsContent>
        {canTake && <TabsContent value="take" className="pt-4"><TakeTab/></TabsContent>}
      </Tabs>
    </div>
  );
}

function BankTab() {
  const { data: banks } = useQuestionBanks();
  const createBank = useCreateQuestionBank();
  const [name, setName] = useState('');
  const [bankId, setBankId] = useState('');
  const { data: questions } = useBankQuestions(bankId || undefined);
  const createQ = useCreateQuestion();
  const [prompt, setPrompt] = useState('');
  const [type, setType] = useState('mcq_single');
  const [marks, setMarks] = useState('1');
  const [opts, setOpts] = useState<Array<{ label: string; isCorrect: boolean }>>(blankOptions('mcq_single'));
  const canEdit = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.manageQuestionBank));
  const hasOptions = OPTION_TYPES.includes(type);
  const setOpt = (i: number, patch: Partial<{ label: string; isCorrect: boolean }>) =>
    setOpts((rows) => rows.map((r, j) => {
      if (j === i) return { ...r, ...patch };
      // Single-answer types: ticking one answer clears the others.
      if (patch.isCorrect && type !== 'mcq_multi') return { ...r, isCorrect: false };
      return r;
    }));
  const optionsReady = !hasOptions || (opts.filter((o) => o.label.trim()).length >= 2 && opts.some((o) => o.isCorrect && o.label.trim()));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Banks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(banks?.data ?? []).map((b) => <button key={b.id} className={`block w-full rounded border p-2 text-sm text-left hover:bg-accent ${bankId === b.id ? 'border-primary bg-primary/5' : ''}`} onClick={() => setBankId(b.id)}>{b.name}</button>)}
          {(banks?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No question banks yet.</p>}
          {canEdit && (
            <>
              <Input placeholder="Bank name, e.g. P5 Mathematics" value={name} onChange={(e) => setName(e.target.value)} />
              <Button size="sm" disabled={!name || createBank.isPending} onClick={async () => {
                try { await createBank.mutateAsync({ name }); setName(''); notify.success('Bank created'); }
                catch (e: any) { notify.error('Could not create the bank', { description: e?.response?.data?.message ?? 'Try again.' }); }
              }}> <Plus className="h-4 w-4" /> Create bank</Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Questions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(questions ?? []).map((q) => <div key={q.id} className="rounded border p-2 text-sm">{q.prompt.slice(0,80)} <Badge variant="secondary">{QUESTION_TYPE[q.type] ?? q.type}</Badge> {q.marks != null && <span className="text-muted-foreground">· {q.marks} mark(s)</span>}</div>)}
          {bankId && canEdit && (
            <>
              <Input placeholder="Question" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <div className="flex gap-2">
                <select aria-label="Question type" className={sel + ' w-48'} value={type} onChange={(e) => { setType(e.target.value); setOpts(blankOptions(e.target.value)); }}>
                  {Object.entries(QUESTION_TYPE).map(([t, label]) => <option key={t} value={t}>{label}</option>)}
                </select>
                <Input aria-label="Marks" type="number" placeholder="Marks" className="w-20" value={marks} onChange={(e) => setMarks(e.target.value)} />
              </div>
              {hasOptions && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Answers — tick the correct {type === 'mcq_multi' ? 'ones' : 'one'}.</p>
                  {opts.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type={type === 'mcq_multi' ? 'checkbox' : 'radio'}
                        name="cbt-correct"
                        aria-label={`Answer ${i + 1} is correct`}
                        checked={o.isCorrect}
                        onChange={(e) => setOpt(i, { isCorrect: e.target.checked })}
                      />
                      <Input
                        aria-label={`Answer ${i + 1}`}
                        placeholder={`Answer ${i + 1}`}
                        value={o.label}
                        disabled={type === 'true_false'}
                        onChange={(e) => setOpt(i, { label: e.target.value })}
                      />
                    </div>
                  ))}
                  {type !== 'true_false' && (
                    <Button size="sm" variant="ghost" onClick={() => setOpts((rows) => [...rows, { label: '', isCorrect: false }])}><Plus className="h-4 w-4" /> Add answer</Button>
                  )}
                </div>
              )}
              <Button size="sm" disabled={!prompt || !optionsReady || createQ.isPending} onClick={async () => {
                const options = hasOptions ? opts.filter((o) => o.label.trim()) : undefined;
                try {
                  await createQ.mutateAsync({ bankId, type, prompt, marks: Number(marks), options });
                  setPrompt(''); setOpts(blankOptions(type)); notify.success('Question added');
                } catch (e: any) {
                  notify.error('Could not add the question', { description: e?.response?.data?.message ?? 'Try again.' });
                }
              }}><Plus className="h-4 w-4" /> Add question</Button>
            </>
          )}
          {!bankId && <p className="text-sm text-muted-foreground">Choose a bank on the left to see and add its questions.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function PapersTab() {
  const { data: papers } = usePapers();
  const createPaper = useCreatePaper();
  const [name, setName] = useState('');
  const [paperId, setPaperId] = useState('');
  const { data: paper } = usePaper(paperId || undefined);
  const addQ = useAddPaperQuestion();
  const { data: banks } = useQuestionBanks();
  const [bankId, setBankId] = useState('');
  const { data: questions } = useBankQuestions(bankId || undefined);
  const [qId, setQId] = useState('');
  const canAuthor = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.authorCbt));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Papers</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(papers?.data ?? []).map((p) => <button key={p.id} className="block w-full rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setPaperId(p.id)}>{p.name} {p.isRandom ? <Badge>Random questions</Badge> : <Badge variant="secondary">Fixed questions</Badge>}</button>)}
          {(papers?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No quiz papers yet.</p>}
          {canAuthor && (
            <>
              <Input placeholder="Paper name" value={name} onChange={(e) => setName(e.target.value)} />
              <Button size="sm" disabled={!name || createPaper.isPending} onClick={async () => {
                try { const p = await createPaper.mutateAsync({ name }); setPaperId(p.id); setName(''); notify.success('Paper created'); }
                catch (e: any) { notify.error('Could not create the paper', { description: e?.response?.data?.message ?? 'Try again.' }); }
              }}> <Plus className="h-4 w-4" /> Create paper</Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Compose</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(paper?.questions ?? []).map((q) => <div key={q.id} className="rounded border p-2 text-sm">{q.order}. {q.prompt?.slice(0,70)} <span className="text-muted-foreground">· {q.marks} mark(s)</span></div>)}
          {paperId && canAuthor && (
            <div className="flex gap-2">
              <select className={sel + ' w-44'} value={bankId} onChange={(e) => { setBankId(e.target.value); setQId(''); }}>
                <option value="">Bank…</option>{(banks?.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className={sel + ' flex-1'} value={qId} onChange={(e) => setQId(e.target.value)}>
                <option value="">Question…</option>{(questions ?? []).map((q) => <option key={q.id} value={q.id}>{q.prompt.slice(0,50)}</option>)}
              </select>
              <Button size="sm" disabled={!qId} onClick={async () => { await addQ.mutateAsync({ paperId, questionId: qId }); setQId(''); notify.success('Added to paper'); }}>Add</Button>
            </div>
          )}
          {!paperId && <p className="text-sm text-muted-foreground">Choose a paper on the left to add questions to it.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Student-facing take view (server-authoritative; keys stripped) ── */
function TakeTab() {
  const { data: papers } = usePapers();
  const { data: students } = useStudents({ pageSize: 50 });
  const [paperId, setPaperId] = useState('');
  const [studentId, setStudentId] = useState('');
  const start = useStartAttempt();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const { data: attempt } = useAttempt(attemptId || undefined);
  const save = useSaveResponse();
  const submit = useSubmitAttempt();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [seq, setSeq] = useState(0);

  const qs = attempt?.studentView?.questions ?? [];

  const onAnswer = (qid: string, response: unknown) => {
    const next = { ...answers, [qid]: response };
    setAnswers(next);
    const s = seq + 1;
    setSeq(s);
    if (attemptId) save.mutate({ attemptId, questionId: qid, clientEventId: `${qid}-${s}`, sequenceNumber: s, response: response as Record<string, unknown> });
  };

  const doSubmit = async () => {
    if (!attemptId) return;
    try { const a = await submit.mutateAsync({ attemptId }); setAttemptId(null); notify.success(`Submitted · auto-marked ${a.autoMarked ? '✓' : 'pending'} · ${a.score ?? '?'} / ${a.totalMarks ?? '?'}`); }
    catch { notify.error('Submit failed'); }
  };

  return (
    <div className="space-y-3">
      {!attemptId ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Start an attempt</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <select className={sel + ' w-56'} value={paperId} onChange={(e) => setPaperId(e.target.value)}><option value="">Paper…</option>{(papers?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className={sel + ' w-56'} value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">Student…</option>{(students?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}</select>
            <Button size="sm" disabled={!paperId || !studentId || start.isPending} onClick={async () => { try { const a = await start.mutateAsync({ paperId, studentProfileId: studentId }); setAttemptId(a.id); setAnswers({}); notify.success('Attempt started'); } catch { notify.error('Start failed'); } }}><Play className="h-4 w-4" /> Start</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> Attempt <span className="font-mono text-xs">{attemptId.slice(0,8)}</span> {attempt?.status === 'submitted' && <Badge>submitted</Badge>}</CardTitle>
            {attempt?.status !== 'submitted' && <Button size="sm" onClick={doSubmit} disabled={submit.isPending}><Send className="h-4 w-4" /> Submit</Button>}
          </CardHeader>
          <CardContent className="space-y-3">
            {qs.map((q, i) => (
              <div key={q.id} className="rounded border p-3">
                <p className="mb-2 text-sm font-medium">{i + 1}. {q.prompt}</p>
                {(q.options ?? []).length > 0 ? (
                  <div className="space-y-1">
                    {(q.options ?? []).map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-sm">
                        <input type="radio" name={q.id} onChange={() => onAnswer(q.id, { optionId: o.id })} /> {o.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <Input placeholder="Answer" onChange={(e) => onAnswer(q.id, { text: e.target.value })} />
                )}
              </div>
            ))}
            {qs.length === 0 && <p className="text-sm text-muted-foreground">Loading questions…</p>}
            {attempt?.status === 'submitted' && (
              <div className="flex items-center gap-2 rounded bg-muted p-2 text-sm">
                <FileCheck2 className="h-4 w-4" /> Score: <span className="font-semibold">{attempt.score ?? '—'} / {attempt.totalMarks ?? '—'}</span> {attempt.autoMarked && <Badge>auto-marked</Badge>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const QUESTION_TYPE: Record<string, string> = {
  mcq_single: 'Multiple choice (one answer)',
  mcq_multi: 'Multiple choice (several answers)',
  true_false: 'True / false',
  short_answer: 'Short answer',
  numeric: 'Number',
  essay: 'Essay',
};

const OPTION_TYPES = ['mcq_single', 'mcq_multi', 'true_false'];

function blankOptions(type: string): Array<{ label: string; isCorrect: boolean }> {
  if (type === 'true_false') return [{ label: 'True', isCorrect: true }, { label: 'False', isCorrect: false }];
  return [{ label: '', isCorrect: false }, { label: '', isCorrect: false }, { label: '', isCorrect: false }, { label: '', isCorrect: false }];
}
