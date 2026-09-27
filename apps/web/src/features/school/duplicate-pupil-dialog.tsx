import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface LikelyDuplicate {
  id: string;
  admissionNo: string;
  status: string;
  name?: string | null;
  dateOfBirth?: string | null;
}

/** The API's 409 for a likely duplicate pupil (ADR-032 P4, audit F07), or null. */
export function likelyDuplicatesFrom(error: unknown): LikelyDuplicate[] | null {
  const res = (error as any)?.response;
  if (res?.status !== 409) return null;
  const body = res.data ?? {};
  const list = body.duplicates ?? body.message?.duplicates;
  return Array.isArray(list) && list.length ? (list as LikelyDuplicate[]) : null;
}

/**
 * "This looks like a pupil you already have." The registrar either opens the
 * existing record, or states why this is a different child — which needs the
 * duplicate-override grant and is audited.
 */
export function DuplicatePupilDialog({
  matches,
  name,
  onCancel,
  onConfirmDifferent,
  pending,
}: {
  matches: LikelyDuplicate[] | null;
  name: string;
  onCancel: () => void;
  onConfirmDifferent: (reason: string) => void;
  pending?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={!!matches} onOpenChange={(o) => { if (!o) { setReason(''); onCancel(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name} may already be registered</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          These pupils have the same name{matches?.some((m) => m.dateOfBirth) ? ' and date of birth' : ' in this class'}. Registering the same
          child twice splits their fees, attendance and results across two records.
        </p>
        <ul className="space-y-1">
          {(matches ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
              <span>
                <span className="font-medium">{m.name ?? m.admissionNo}</span>
                <span className="text-muted-foreground"> · {m.admissionNo}{m.dateOfBirth ? ` · born ${m.dateOfBirth}` : ''} · {m.status}</span>
              </span>
              <Link className="text-primary hover:underline" to={`/school/students/${m.id}`} onClick={onCancel}>Open record</Link>
            </li>
          ))}
        </ul>
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">This is a different child</p>
          <Input placeholder="How do you know? e.g. different parents, twins" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-amber-900">Recorded with your name. Needs the duplicate-override permission.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setReason(''); onCancel(); }}>Cancel</Button>
          <Button disabled={!reason.trim() || pending} onClick={() => onConfirmDifferent(reason.trim())}>Register as a different child</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
