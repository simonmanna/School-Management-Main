import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, AlertTriangle, Send, Save } from 'lucide-react';
import {
  useMarksByAssessment, useRecordMark, useSetParticipation, useSubmitMarks, useClassRoster,
  type MarkRow, type RosterStudent,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';

// Participation states where a student has NO numeric score but IS resolved.
const NON_SCORING = new Set(['absent', 'exempt', 'excused', 'malpractice', 'special_consideration']);

// A student is "resolved" when they have a valid score OR an explicit non-scoring status.
function isResolved(r: MarkRow): boolean {
  if (r.effectiveScore != null || r.originalScore != null) return true;
  return NON_SCORING.has(r.participation);
}

export function SchoolMarksheetPage() {
  const { assessmentId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: rows, isLoading } = useMarksByAssessment(assessmentId || undefined);
  const classId = rows?.[0]?.classId ?? undefined;
  const { data: roster } = useClassRoster(classId);
  const recordMark = useRecordMark();
  const setParticipation = useSetParticipation();
  const submitMarks = useSubmitMarks();

  const [values, setValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [maxScore, setMaxScore] = useState<number | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Map studentProfileId -> display name from the class roster (partner.name ?? admissionNo).
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (roster ?? []) as RosterStudent[]) m.set(s.id, s.partner?.name ?? s.admissionNo ?? s.id);
    return m;
  }, [roster]);

  // Seed editable values from loaded rows; capture maxScore for validation.
  useEffect(() => {
    if (!rows) return;
    const v: Record<string, string> = {};
    let mx: number | null = null;
    for (const r of rows) {
      const cur = r.effectiveScore ?? r.originalScore;
      v[r.id] = cur != null ? String(cur) : '';
      if (r.maxScore != null) mx = Number(r.maxScore);
    }
    setValues(v);
    setMaxScore(mx);
  }, [rows]);

  const resolved = useMemo(() => (rows ?? []).filter(isResolved).length, [rows]);
  const total = rows?.length ?? 0;

  async function commit(r: MarkRow) {
    const raw = values[r.id] ?? '';
    if (raw === '' && NON_SCORING.has(r.participation)) { setSaved(true); return; }
    const num = Number(raw);
    if (raw !== '' && (isNaN(num) || num < 0 || (maxScore != null && num > maxScore))) {
      notify.error(`Mark must be between 0 and ${maxScore ?? 'max'}`);
      return;
    }
    setSavingId(r.id);
    try {
      await recordMark.mutateAsync({ studentAssessmentId: r.id, score: num });
      qc.invalidateQueries({ queryKey: ['school', 'marking', assessmentId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Failed to save mark');
    } finally {
      setSavingId(null);
    }
  }

  function onParticipation(r: MarkRow, participation: string) {
    setParticipation.mutateAsync({ assessmentId, studentProfileId: r.studentProfileId, participation })
      .catch((e: any) => notify.error(e?.response?.data?.message ?? 'Failed to set status'));
  }

  function onPaste(e: React.ClipboardEvent, startIndex: number) {
    const text = e.clipboardData.getData('text');
    const lines = text.split(/[\s,;\t\r\n]+/).map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) return; // single value → normal cell paste
    e.preventDefault();
    const list = rows ?? [];
    let applied = 0;
    lines.forEach((line, i) => {
      const target = list[startIndex + i];
      if (!target) return;
      const num = Number(line);
      if (!isNaN(num) && (maxScore == null || num <= maxScore) && num >= 0) {
        setValues((v) => ({ ...v, [target.id]: line }));
        applied++;
      }
    });
    if (applied > 0) notify.success(`Pasted ${applied} values — review, then it auto-saves on blur`);
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading marksheet…</div>;
  if (!rows) return <div className="p-6 text-sm text-muted-foreground">No marksheet found.</div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/school/my-marking')}>
          <ArrowLeft className="h-4 w-4" /> Back to My Marking
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Marksheet</CardTitle>
            <p className="text-sm text-muted-foreground">
              {total} students
              {maxScore != null && <> · Maximum: <strong>{maxScore}</strong></>}
              {' · '}
              <span className={resolved === total ? 'text-emerald-600' : ''}>{resolved}/{total} resolved</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>}
            {savingId && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Save className="h-3.5 w-3.5" /> Saving…</span>}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Marks are automatically saved as you type. Press Enter to move to the next student.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="w-10 py-2">#</th>
                <th className="py-2">Student</th>
                <th className="w-32 py-2">Mark</th>
                <th className="w-44 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-2">{r.studentName ?? nameMap.get(r.studentProfileId) ?? '—'}</td>
                  <td className="py-2">
                    <Input
                      ref={(el) => (inputRefs.current[r.id] = el)}
                      type="number"
                      className="h-8 w-24"
                      value={values[r.id] ?? ''}
                      placeholder={NON_SCORING.has(r.participation) ? r.participation.slice(0, 3).toUpperCase() : '0'}
                      onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                      onBlur={() => commit(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const next = rows[i + 1];
                          if (next) inputRefs.current[next.id]?.focus();
                        }
                      }}
                      onPaste={(e) => onPaste(e, i)}
                    />
                  </td>
                  <td className="py-2">
                    <select
                      className="w-full rounded-md border bg-card px-2 py-1 text-xs"
                      value={r.participation}
                      onChange={(e) => onParticipation(r, e.target.value)}
                    >
                      {['present', 'absent', 'exempt', 'excused', 'malpractice', 'special_consideration'].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setShowReview(true)}>Review</Button>
        <Button onClick={() => submitMarks.mutateAsync(assessmentId).then(() => { notify.success('Marks submitted for approval'); navigate('/school/my-marking'); }).catch((e: any) => notify.error(e?.response?.data?.message ?? 'Submit failed'))}>
          <Send className="h-4 w-4" /> Submit Marks
        </Button>
      </div>

      {showReview && (
        <ReviewPanel rows={rows} resolved={resolved} total={total} onClose={() => setShowReview(false)} />
      )}
    </div>
  );
}

function ReviewPanel({ rows, resolved, total, onClose }: { rows: MarkRow[]; resolved: number; total: number; onClose: () => void }) {
  const missing = total - resolved;
  const statuses = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.participation] = (acc[r.participation] ?? 0) + 1; return acc;
  }, {});
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Ready to submit?</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{total} students</p>
        <ul className="space-y-1 text-sm">
          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {resolved} resolved</li>
          {Object.entries(statuses).map(([k, n]) => (
            <li key={k} className="text-muted-foreground">{n} × {k}</li>
          ))}
          <li className={missing === 0 ? 'flex items-center gap-2 text-emerald-600' : 'flex items-center gap-2 text-destructive'}>
            {missing === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {missing} missing
          </li>
        </ul>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Continue Editing</Button>
        </div>
      </CardContent>
    </Card>
  );
}
