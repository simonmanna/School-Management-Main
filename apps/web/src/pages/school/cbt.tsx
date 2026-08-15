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

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolCbtPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Computer-Based Testing</h1>
        <p className="text-sm text-muted-foreground">A5: versioned question bank, papers (fixed / random blueprint), server-authoritative attempts with offline-sync & auto-marking.</p>
      </div>
      <Tabs defaultValue="bank">
        <TabsList>
          <TabsTrigger value="bank">Question bank</TabsTrigger>
          <TabsTrigger value="papers">Papers</TabsTrigger>
          <TabsTrigger value="take">Take / proctor</TabsTrigger>
        </TabsList>
        <TabsContent value="bank" className="pt-4"><BankTab/></TabsContent>
        <TabsContent value="papers" className="pt-4"><PapersTab/></TabsContent>
        <TabsContent value="take" className="pt-4"><TakeTab/></TabsContent>
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
  const [optJson, setOptJson] = useState('[ { "label": "Option A", "isCorrect": true }, { "label": "Option B", "isCorrect": false } ]');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Banks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(banks?.data ?? []).map((b) => <button key={b.id} className="block w-full rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setBankId(b.id)}>{b.name}</button>)}
          <Input placeholder="Bank name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!name || createBank.isPending} onClick={async () => { await createBank.mutateAsync({ name }); setName(''); notify.success('Bank created'); }}> <Plus className="h-4 w-4" /> Create bank</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Questions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(questions ?? []).map((q) => <div key={q.id} className="rounded border p-2 text-sm">{q.prompt.slice(0,80)} <Badge variant="secondary">{q.type}</Badge> {q.marks != null && <span className="text-muted-foreground">· {q.marks}m</span>}</div>)}
          {bankId && (
            <>
              <Input placeholder="Prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <div className="flex gap-2">
                <select className={sel + ' w-40'} value={type} onChange={(e) => setType(e.target.value)}>
                  {['mcq_single','mcq_multi','true_false','short_answer','numeric','essay'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Input type="number" placeholder="marks" className="w-20" value={marks} onChange={(e) => setMarks(e.target.value)} />
              </div>
              <textarea className={sel + ' h-24 font-mono text-xs'} value={optJson} onChange={(e) => setOptJson(e.target.value)} />
              <Button size="sm" disabled={!prompt || createQ.isPending} onClick={async () => {
                let options; try { options = JSON.parse(optJson); } catch { options = undefined; }
                await createQ.mutateAsync({ bankId, type, prompt, marks: Number(marks), options }); setPrompt(''); notify.success('Question added');
              }}><Plus className="h-4 w-4" /> Add question</Button>
            </>
          )}
          {!bankId && <p className="text-sm text-muted-foreground">Select a bank.</p>}
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Papers</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(papers?.data ?? []).map((p) => <button key={p.id} className="block w-full rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setPaperId(p.id)}>{p.name} {p.isRandom ? <Badge>random</Badge> : <Badge variant="secondary">fixed</Badge>}</button>)}
          <Input placeholder="Paper name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!name || createPaper.isPending} onClick={async () => { const p = await createPaper.mutateAsync({ name }); setPaperId(p.id); setName(''); notify.success('Paper created'); }}> <Plus className="h-4 w-4" /> Create paper</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Compose</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(paper?.questions ?? []).map((q) => <div key={q.id} className="rounded border p-2 text-sm">{q.order}. {q.prompt?.slice(0,70)} <span className="text-muted-foreground">· {q.marks}m</span></div>)}
          {paperId && (
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
          {!paperId && <p className="text-sm text-muted-foreground">Select a paper.</p>}
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
