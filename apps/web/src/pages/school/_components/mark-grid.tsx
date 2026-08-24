import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Lock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import { selectClass } from './exam-workflow';

/**
 * The marking grid, once.
 *
 * There used to be three of these — the exam marksheet, the gradebook and the
 * single-assessment marksheet — each with its own copy of the same fiddly
 * behaviour, and each slightly different about the parts that matter: which
 * outcomes count as "entered", when a cell saves, whether the input keeps focus.
 * A teacher who learned one did not know the others.
 *
 * The behaviour kept here is the behaviour that was right:
 *   - a row per student from the ROSTER, marked or not, so nobody is invisible;
 *   - saving on blur and on Enter, with no Save button to forget;
 *   - Enter and the arrow keys walk the column, because marking is a rhythm;
 *   - pasting a column from a spreadsheet fills down;
 *   - the save is deliberately NOT invalidated by the caller — re-fetching the
 *     sheet would remount the input the teacher is still typing in.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Outcomes that mean "resolved, but no numeric mark". */
export const NON_SCORING = ['absent', 'exempt', 'excused', 'malpractice'];

export interface MarkGridStudent {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  marks: number | null;
  participation: string;
  grade?: string | null;
}

export interface MarkGridProps {
  students: MarkGridStudent[];
  maxScore: number;
  locked?: boolean;
  /** Persist one cell. Returning a grade updates the letter column in place. */
  onSave: (
    student: MarkGridStudent,
    payload: { marks: number | null; participation: string },
  ) => Promise<{ grade?: string | null } | void>;
  /** Shown under the table — typically the submit-for-approval bar. */
  footer?: React.ReactNode;
  showGrade?: boolean;
}

/** How many students have a resolved outcome, numeric or not. */
export function countEntered(
  students: MarkGridStudent[],
  values: Record<string, string>,
  participation: Record<string, string>,
): number {
  return students.filter((s) => {
    const v = values[s.studentProfileId];
    return (v !== undefined && v !== '') || NON_SCORING.includes(participation[s.studentProfileId] ?? 'present');
  }).length;
}

export function MarkGrid({ students, maxScore, locked = false, onSave, footer, showGrade = true }: MarkGridProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [participation, setParticipation] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState('');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Reseed whenever the sheet changes — never carry one paper's marks into another.
  useEffect(() => {
    const v: Record<string, string> = {};
    const p: Record<string, string> = {};
    const g: Record<string, string | null> = {};
    for (const s of students) {
      v[s.studentProfileId] = s.marks != null ? String(s.marks) : '';
      p[s.studentProfileId] = s.participation ?? 'present';
      g[s.studentProfileId] = s.grade ?? null;
    }
    setValues(v);
    setParticipation(p);
    setGrades(g);
    setStates({});
  }, [students]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q),
    );
  }, [students, search]);

  const entered = countEntered(students, values, participation);

  async function commit(s: MarkGridStudent, raw: string, part?: string) {
    if (locked) return;
    const id = s.studentProfileId;
    const trimmed = raw.trim();
    const isClear = trimmed === '';
    const num = Number(trimmed);

    if (!isClear && (Number.isNaN(num) || num < 0 || num > maxScore)) {
      setStates((st) => ({ ...st, [id]: 'error' }));
      notify.error(`${s.name}: mark must be between 0 and ${maxScore}`);
      return;
    }

    setStates((st) => ({ ...st, [id]: 'saving' }));
    try {
      const res = await onSave(s, {
        marks: isClear ? null : num,
        participation: part ?? participation[id] ?? 'present',
      });
      if (res && 'grade' in res) setGrades((g) => ({ ...g, [id]: res.grade ?? null }));
      setStates((st) => ({ ...st, [id]: 'saved' }));
      setTimeout(() => setStates((st) => (st[id] === 'saved' ? { ...st, [id]: 'idle' } : st)), 1200);
    } catch (e: any) {
      setStates((st) => ({ ...st, [id]: 'error' }));
      notify.error(e?.response?.data?.message ?? `Could not save ${s.name}'s mark`);
    }
  }

  function focusAt(index: number) {
    const target = visible[index];
    if (target) inputs.current[target.studentProfileId]?.focus();
  }

  /** Paste a whole column from a spreadsheet — one value per student, in order. */
  function onPaste(e: React.ClipboardEvent, startIndex: number) {
    const text = e.clipboardData.getData('text');
    const parts = text.split(/[\s,;\t\r\n]+/).map((t) => t.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();

    const patch: Record<string, string> = {};
    const targets: Array<{ student: MarkGridStudent; raw: string }> = [];
    parts.forEach((raw, i) => {
      const student = visible[startIndex + i];
      if (!student) return;
      patch[student.studentProfileId] = raw;
      targets.push({ student, raw });
    });
    setValues((v) => ({ ...v, ...patch }));
    void (async () => {
      for (const t of targets) await commit(t.student, t.raw);
    })();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Find a student…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
          {entered}/{students.length} marked
        </span>
        {locked && (
          <span className="flex items-center gap-1 whitespace-nowrap text-sm text-amber-600">
            <Lock className="h-3.5 w-3.5" /> Locked
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-10 px-2 py-2 text-left font-medium text-muted-foreground">#</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Student</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Adm. no</th>
              <th className="w-28 px-2 py-2 text-left font-medium text-muted-foreground">Mark / {maxScore}</th>
              {showGrade && <th className="w-16 px-2 py-2 text-left font-medium text-muted-foreground">Grade</th>}
              <th className="w-40 px-2 py-2 text-left font-medium text-muted-foreground">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => {
              const id = s.studentProfileId;
              const part = participation[id] ?? 'present';
              const state = states[id] ?? 'idle';
              return (
                <tr key={id} className="border-t">
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">{s.name}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{s.admissionNo}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={(el) => { inputs.current[id] = el; }}
                        className={[
                          'h-8 w-16 rounded-md border bg-card px-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
                          state === 'error' ? 'border-destructive' : '',
                        ].join(' ')}
                        disabled={locked || NON_SCORING.includes(part)}
                        inputMode="numeric"
                        value={values[id] ?? ''}
                        placeholder={NON_SCORING.includes(part) ? part.slice(0, 3).toUpperCase() : '—'}
                        onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                        onPaste={(e) => onPaste(e, i)}
                        onBlur={(e) => {
                          const original = s.marks != null ? String(s.marks) : '';
                          if (e.target.value.trim() !== original) void commit(s, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            void commit(s, (e.target as HTMLInputElement).value);
                            focusAt(i + 1);
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            focusAt(i - 1);
                          }
                        }}
                      />
                      {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                    </div>
                  </td>
                  {showGrade && (
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{grades[id] ?? '—'}</td>
                  )}
                  <td className="px-2 py-1.5">
                    <select
                      className={selectClass}
                      disabled={locked}
                      value={part}
                      onChange={(e) => {
                        const next = e.target.value;
                        setParticipation((p) => ({ ...p, [id]: next }));
                        // A non-scoring outcome REPLACES the mark: leaving the
                        // number behind is how a stale score survives an absence.
                        if (NON_SCORING.includes(next)) {
                          setValues((v) => ({ ...v, [id]: '' }));
                          void commit(s, '', next);
                        } else {
                          void commit(s, values[id] ?? '', next);
                        }
                      }}
                    >
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="exempt">Exempt</option>
                      <option value="excused">Excused</option>
                      <option value="malpractice">Malpractice</option>
                    </select>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={showGrade ? 6 : 5} className="px-3 py-8 text-center text-muted-foreground">
                  No students match “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {footer}
    </div>
  );
}
