import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { useResultsSmsPreview, useSendResultsSms, type ResultGrid } from '@/features/school/api';

/**
 * "Text results to parents" for one exam and class (review A17, decision 5).
 * Shows exactly what will go — a sample message, how many pupils and guardians
 * — and refuses until every paper is locked, so no family is told a mark that
 * is still being corrected. Guardians who switched results off are skipped.
 */
export function ResultsSmsButton({ examId, classId, sectionId }: { examId: string; classId: string; sectionId?: string }) {
  const [open, setOpen] = useState(false);
  const { data: preview, isLoading, isError } = useResultsSmsPreview({ examId, classId, sectionId }, open);
  const send = useSendResultsSms();

  const doSend = async () => {
    try {
      const res = await send.mutateAsync({ examId, classId, sectionId });
      notify.success(`Results sent for ${res.pupils} pupil${res.pupils === 1 ? '' : 's'}`, {
        description: `${res.delivered} message${res.delivered === 1 ? '' : 's'} delivered (SMS, portal or email). Sending again never repeats a message.`,
      });
      setOpen(false);
    } catch (e: any) {
      notify.error('Could not send the results', { description: e?.response?.data?.message ?? 'Try again.' });
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessageSquare className="h-4 w-4" /> Text results to parents
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Text these results to parents?</DialogTitle>
            <DialogDescription>
              Each family gets one message with their child’s marks, grades and position. Guardians who chose not to
              receive results are skipped.
            </DialogDescription>
          </DialogHeader>
          {isLoading && <p className="text-sm text-muted-foreground">Preparing the messages…</p>}
          {isError && <p className="text-sm text-destructive">Couldn’t prepare the messages for this class.</p>}
          {preview && (
            <div className="space-y-3 text-sm">
              {!preview.locked && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  {preview.lockedPaperCount} of {preview.paperCount} papers are locked. Lock every paper first, so families only
                  receive final marks.
                </p>
              )}
              <p>
                <strong>{preview.pupils}</strong> pupils · <strong>{preview.guardians}</strong> guardians
                {preview.pupilsWithoutGuardian > 0 && <> · {preview.pupilsWithoutGuardian} with no guardian to reach</>}
              </p>
              {preview.sample && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="mb-1 text-xs text-muted-foreground">Example message</p>
                  <p>{preview.sample}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!preview?.locked || !preview.guardians || send.isPending} onClick={() => void doSend()}>
              {send.isPending ? 'Sending…' : 'Send to parents'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One slip per pupil for the exam — the sheet a class teacher hands each child
 * to take home after BOT/MOT: every paper with its mark and grade, the
 * aggregate and division where the class has one, and the position. Printed
 * from the merit list, so it can never disagree with it.
 */
export function PupilSlips({ grid, schoolName, className }: { grid: ResultGrid; schoolName: string; className: string }) {
  const ranked = grid.students.filter((s) => s.position != null).length;
  const pupils = grid.students.filter((s) => s.subjectsMarked > 0);
  const agg = !!grid.reporting?.hasAggregate;
  return (
    <div className="hidden print:block">
      {pupils.map((s) => (
        <section key={s.studentProfileId} className="mb-6 break-inside-avoid border p-4 text-sm" style={{ pageBreakInside: 'avoid' }}>
          <div className="flex items-baseline justify-between border-b pb-1">
            <strong>{schoolName}</strong>
            <span>{grid.exam.name}{grid.exam.termName ? ` · ${grid.exam.termName}` : ''}</span>
          </div>
          <p className="mt-2"><strong>{s.name}</strong> · {s.admissionNo} · {className}{s.streamName ? ` ${s.streamName}` : ''}</p>
          <table className="mt-2 w-full border-collapse">
            <thead><tr className="border-b text-left"><th className="py-1">Subject</th><th className="py-1 text-right">Mark</th><th className="py-1 text-right">Out of</th><th className="py-1 text-center">Grade</th></tr></thead>
            <tbody>
              {grid.subjects.map((sub) => {
                const c = s.cells[sub.subjectId];
                return (
                  <tr key={sub.subjectId} className="border-b">
                    <td className="py-1">{sub.name}</td>
                    <td className="py-1 text-right">{c?.marks ?? (c && c.participation !== 'present' ? c.participation : '—')}</td>
                    <td className="py-1 text-right">{sub.maxMarks}</td>
                    <td className="py-1 text-center">{c?.grade ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2">
            Total {s.total ?? '—'} · Average {s.average ?? '—'}
            {agg ? <> · Aggregate {s.aggregate ?? '—'} · Division {s.division ?? '—'}</> : s.grade ? <> · Grade {s.grade}</> : null}
            {s.position != null ? <> · Position {s.position} of {ranked}</> : null}
          </p>
          <p className="mt-4 text-xs">Class teacher: ____________________ &nbsp; Parent’s signature: ____________________</p>
        </section>
      ))}
    </div>
  );
}
