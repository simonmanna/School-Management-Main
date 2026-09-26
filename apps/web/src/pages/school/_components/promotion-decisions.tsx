import { useState } from 'react';
import { GraduationCap, ListChecks, PlayCircle } from 'lucide-react';
import {
  useApplyPromotions, useDecidePromotions, usePromotionBoard, useProposePromotions,
} from '@/features/school/results-phase5-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { currentTerminology } from '@/features/school/api';
import { Empty, apiMessage, num, selectClass } from './exam-ops-shared';

const OUTCOMES = [
  { value: 'promote', label: 'Promote' },
  { value: 'repeat', label: 'Repeat the year' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'review', label: 'Needs review' },
];

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Waiting for a decision',
  approved: 'Decided',
  rejected: 'Refused',
  applied: 'Applied — the learner has moved',
};

/**
 * Phase 5 — promotion as three separate acts.
 *
 * Proposing draws the list from the published results. Deciding is a human
 * judgement that may depart from the recommendation, with a reason. Applying is
 * what actually writes the next placement — nothing here moves a child on its
 * own, and the server enforces that in the same order.
 */
export function PromotionDecisionsPanel({
  resultSetId,
  published,
  terms,
}: {
  resultSetId: string;
  published: boolean;
  terms: Array<{ id: string; name: string }>;
}) {
  const { data: board } = usePromotionBoard(resultSetId || undefined);
  const propose = useProposePromotions();
  const decide = useDecidePromotions();
  const apply = useApplyPromotions();

  const [decisions, setDecisions] = useState<Record<string, { decision?: string; toClassId?: string; toSectionId?: string; toStreamId?: string; reason?: string }>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [toTermId, setToTermId] = useState('');

  if (!resultSetId) return <Empty>Pick a result version on the Result runs tab first.</Empty>;

  const rows = board?.rows ?? [];
  const pending = rows.filter((r) => r.status === 'proposed');
  const approved = rows.filter((r) => r.status === 'approved');

  const patch = (id: string, part: Partial<{ decision: string; toClassId: string; toSectionId: string; toStreamId: string; reason: string }>) =>
    setDecisions((d) => ({
      ...d,
      // Changing the class invalidates any subdivision chosen under the old one:
      // a section belongs to exactly one class, so carrying it over would send
      // the learner to a grouping that does not exist in their new class.
      [id]: { ...d[id], ...part, ...(part.toClassId ? { toSectionId: undefined, toStreamId: undefined } : {}) },
    }));

  const submitDecisions = async (status: 'approved' | 'rejected', ids: string[]) => {
    const payload = ids.map((id) => ({
      id,
      status,
      decision: decisions[id]?.decision,
      toClassId: decisions[id]?.toClassId,
      toSectionId: decisions[id]?.toSectionId,
      toStreamId: decisions[id]?.toStreamId,
      reason: decisions[id]?.reason,
    }));
    try {
      const out = await decide.mutateAsync({ rows: payload });
      setSelected([]);
      notify.success(`${out.decided} decision(s) recorded`, {
        description: status === 'approved' ? 'Apply them when the next term is ready.' : 'The refusal and its reason are on the record.',
      });
    } catch (e) {
      notify.error('Could not record those decisions', {
        description: apiMessage(e, 'A promotion needs the class the learner moves into, and a departure from the recommendation needs a reason.'),
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Promotion</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!published || propose.isPending}
              title={published ? undefined : 'Release the results first — a decision taken on a draft calculation can change under it'}
              onClick={async () => {
                try {
                  const out = await propose.mutateAsync({ resultSetId });
                  notify.success(`${out.proposed} proposal(s) drawn up`, {
                    description: `${out.refreshed} refreshed, ${out.untouched} already decided and left alone.`,
                  });
                } catch (e) {
                  notify.error('Could not draw up the promotion list', { description: apiMessage(e, 'Try again.') });
                }
              }}
            >
              <ListChecks className="h-4 w-4" /> Draw up from these results
            </Button>
            <select className={`${selectClass} w-48`} value={toTermId} onChange={(e) => setToTermId(e.target.value)}>
              <option value="">Move into term…</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button
              size="sm" variant="outline"
              disabled={!approved.length || !toTermId || apply.isPending}
              onClick={async () => {
                try {
                  const out = await apply.mutateAsync({ resultSetId, toTermId });
                  notify.success(`${out.applied} learner(s) moved`, {
                    description: out.skipped.length
                      ? `${out.skipped.length} could not be moved — ${out.skipped[0].reason}`
                      : 'Their placement history now shows the new class.',
                  });
                } catch (e) {
                  notify.error('Could not apply these promotions', { description: apiMessage(e, 'Try again.') });
                }
              }}
            >
              <PlayCircle className="h-4 w-4" /> Apply {approved.length} decision(s)
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!published && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              These results have not been released yet. Promotions are proposed from released results so the numbers a decision rests on cannot change afterwards.
            </p>
          )}
          {board && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(board.counts).map(([k, v]) => (
                <Badge key={k} variant="secondary">{STATUS_LABEL[k] ?? k}: {v}</Badge>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <Empty>Nothing drawn up yet for this result version.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={pending.length > 0 && selected.length === pending.length}
                        onChange={(e) => setSelected(e.target.checked ? pending.map((r) => r.id) : [])}
                      />
                    </TableHead>
                    <TableHead>Pupil</TableHead>
                    <TableHead>Their results</TableHead>
                    <TableHead>Recommended</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Moves into</TableHead>
                    <TableHead>{currentTerminology().section}</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const editable = r.status === 'proposed';
                    const basis = r.basis as { meanPercent?: number | null; aggregate?: number | null; division?: string | null; classRank?: number | null };
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            disabled={!editable}
                            checked={selected.includes(r.id)}
                            onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                          />
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.studentName ?? '—'}
                          <div className="text-xs text-muted-foreground">{r.fromClassName ?? r.admissionNo ?? ''}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {basis?.meanPercent != null ? `${num(basis.meanPercent)}% average` : 'no average'}
                          {basis?.aggregate != null ? ` · aggregate ${basis.aggregate}` : ''}
                          {basis?.division ? ` · division ${basis.division}` : ''}
                          {basis?.classRank != null ? ` · position ${basis.classRank}` : ''}
                        </TableCell>
                        <TableCell className="text-sm">
                          {OUTCOMES.find((o) => o.value === r.recommendation)?.label ?? r.recommendation}
                        </TableCell>
                        <TableCell>
                          <select
                            className={`${selectClass} w-36`}
                            disabled={!editable}
                            value={decisions[r.id]?.decision ?? r.decision ?? r.recommendation}
                            onChange={(e) => patch(r.id, { decision: e.target.value })}
                          >
                            {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </TableCell>
                        <TableCell>
                          <select
                            className={`${selectClass} w-36`}
                            disabled={!editable}
                            value={decisions[r.id]?.toClassId ?? r.toClassId ?? ''}
                            onChange={(e) => patch(r.id, { toClassId: e.target.value })}
                          >
                            <option value="">Class…</option>
                            {(board?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const targetClassId = decisions[r.id]?.toClassId ?? r.toClassId ?? '';
                            const sections = (board?.sections ?? []).filter((s) => s.classId === targetClassId);
                            const chosenSection = decisions[r.id]?.toSectionId ?? r.toSectionId ?? '';
                            const streams = (board?.streams ?? []).filter(
                              (s) => s.classId === targetClassId && (!s.sectionId || s.sectionId === chosenSection),
                            );
                            if (!targetClassId || (!sections.length && !streams.length)) {
                              return <span className="text-xs text-muted-foreground">—</span>;
                            }
                            return (
                              <div className="space-y-1">
                                {sections.length > 0 && (
                                  <select
                                    className={`${selectClass} w-32`}
                                    disabled={!editable}
                                    value={chosenSection}
                                    onChange={(e) => patch(r.id, { toSectionId: e.target.value })}
                                  >
                                    <option value="">Section…</option>
                                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                )}
                                {streams.length > 0 && (
                                  <select
                                    className={`${selectClass} w-32`}
                                    disabled={!editable}
                                    value={decisions[r.id]?.toStreamId ?? r.toStreamId ?? ''}
                                    onChange={(e) => patch(r.id, { toStreamId: e.target.value })}
                                  >
                                    <option value="">{currentTerminology().section}…</option>
                                    {streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-44"
                            disabled={!editable}
                            placeholder={r.reason ?? 'Only if different'}
                            value={decisions[r.id]?.reason ?? ''}
                            onChange={(e) => patch(r.id, { reason: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'applied' ? 'default' : 'secondary'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                          {r.toClassName && r.status === 'applied' && (
                            <div className="text-xs text-muted-foreground">
                              now in {r.toClassName}{r.toSectionName ? ` · ${r.toSectionName}` : ''}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button size="sm" disabled={decide.isPending} onClick={() => submitDecisions('approved', selected)}>
                Record {selected.length} decision(s)
              </Button>
              <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => submitDecisions('rejected', selected)}>
                Refuse {selected.length}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
