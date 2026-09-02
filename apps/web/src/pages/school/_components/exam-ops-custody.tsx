import { useState } from 'react';
import { FileLock2, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  useCustodyBoard, useCustodyChain, useRecordCustody,
  type CustodyAction,
} from '@/features/school/exam-operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { Empty, apiMessage, fmtDate, fmtDateTime, selectClass } from './exam-ops-shared';

const ACTIONS: Array<{ value: CustodyAction; label: string }> = [
  { value: 'authored', label: 'Written' },
  { value: 'moderated', label: 'Moderated' },
  { value: 'approved', label: 'Approved' },
  { value: 'printed', label: 'Printed' },
  { value: 'sealed', label: 'Sealed' },
  { value: 'stored', label: 'Put in the safe' },
  { value: 'dispatched', label: 'Sent out' },
  { value: 'received', label: 'Received' },
  { value: 'opened', label: 'Opened' },
  { value: 'distributed', label: 'Given out in the hall' },
  { value: 'collected', label: 'Collected in' },
  { value: 'returned', label: 'Returned' },
  { value: 'archived', label: 'Archived' },
  { value: 'destroyed', label: 'Destroyed' },
  { value: 'incident', label: 'Incident' },
];

const label = (a: CustodyAction | null) => (a ? ACTIONS.find((x) => x.value === a)?.label ?? a : '—');

/**
 * Step 8 — question-paper custody.
 *
 * The log is append-only and hash-chained on the server. A correction is a new
 * event, never an edit, and a broken chain is shown rather than hidden.
 */
export function ExamCustodyPanel({ examId }: { examId: string }) {
  const { data: board } = useCustodyBoard(examId);
  const [selected, setSelected] = useState('');
  const { data: chain } = useCustodyChain(selected || undefined);
  const record = useRecordCustody();

  const [action, setAction] = useState<CustodyAction>('sealed');
  const [custodian, setCustodian] = useState('');
  const [seal, setSeal] = useState('');
  const [copies, setCopies] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

  const submit = async () => {
    if (!selected) return;
    try {
      await record.mutateAsync({
        questionPaperId: selected,
        action,
        custodianName: custodian || undefined,
        sealNumber: seal || undefined,
        copies: copies ? Number(copies) : undefined,
        location: location || undefined,
        note: note || undefined,
      });
      setSeal(''); setCopies(''); setNote('');
      notify.success(`Recorded: ${label(action).toLowerCase()}`);
    } catch (e) {
      notify.error('Could not record that movement', { description: apiMessage(e, 'Check the order of events.') });
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileLock2 className="h-4 w-4" /> Question papers</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!board?.length ? (
            <Empty>No question papers recorded for this examination yet. Add them in <strong>Exam Operations → Question papers</strong>.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paper</TableHead><TableHead>Sitting</TableHead>
                  <TableHead>Where it is</TableHead><TableHead>Held by</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.map((row) => (
                  <TableRow key={row.questionPaperId} className={selected === row.questionPaperId ? 'bg-accent' : undefined}>
                    <TableCell className="text-sm">
                      {row.title}
                      <div className="text-xs text-muted-foreground">{row.subjectName ?? ''} {row.className ? `· ${row.className}` : ''}</div>
                    </TableCell>
                    <TableCell className="text-xs">{fmtDate(row.date)} {row.startTime}</TableCell>
                    <TableCell className="text-sm">
                      {label(row.lastAction)}
                      <div className="text-xs text-muted-foreground">{row.events} event(s)</div>
                    </TableCell>
                    <TableCell className="text-sm">{row.currentCustodian ?? '—'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(row.questionPaperId)}>Open log</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {chain ? chain.questionPaper.title : 'Custody log'}
          </CardTitle>
          {chain && (
            <Badge variant={chain.chainIntact ? 'secondary' : 'destructive'}>
              {chain.chainIntact
                ? <><ShieldCheck className="mr-1 h-3 w-3" /> Chain verified</>
                : <><ShieldAlert className="mr-1 h-3 w-3" /> Chain broken</>}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!selected && <Empty>Pick a question paper to see and add to its custody log.</Empty>}

          {chain && (
            <>
              <ol className="space-y-2">
                {chain.events.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
                {chain.events.map((e) => (
                  <li key={e.id} className="rounded border p-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{label(e.action)}</span>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(e.occurredAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[
                        e.custodianName ? `held by ${e.custodianName}` : null,
                        e.sealNumber ? `seal ${e.sealNumber}` : null,
                        e.copies != null ? `${e.copies} copies` : null,
                        e.location ?? null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </p>
                    {e.note && <p className="mt-1 text-xs">{e.note}</p>}
                    {!e.chainVerified && (
                      <p className="mt-1 text-xs text-destructive">This entry does not match the chain — the log has been altered.</p>
                    )}
                  </li>
                ))}
              </ol>

              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Record the next movement</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select className={selectClass} value={action} onChange={(e) => setAction(e.target.value as CustodyAction)}>
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  <Input placeholder="Who holds them now?" value={custodian} onChange={(e) => setCustodian(e.target.value)} />
                  <Input placeholder="Seal number" value={seal} onChange={(e) => setSeal(e.target.value)} />
                  <Input type="number" min={0} placeholder="Copies" value={copies} onChange={(e) => setCopies(e.target.value)} />
                  <Input placeholder="Where" value={location} onChange={(e) => setLocation(e.target.value)} />
                  <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <Button size="sm" disabled={record.isPending} onClick={submit}>Record</Button>
                <p className="text-xs text-muted-foreground">
                  Entries cannot be edited or deleted — a mistake is corrected by recording an incident and the correct movement after it.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
