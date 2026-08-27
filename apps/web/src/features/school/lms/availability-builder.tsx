import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CourseModuleView } from './types';

/**
 * Availability ("restrict access") builder — L4.
 *
 * Emits exactly the tree `AvailabilityService` evaluates:
 *
 *   { op: '&' | '|' | '!&' | '!|', showc: boolean[], c: Condition[] }
 *
 * Shape parity matters: the server is the only place availability is decided, and
 * the evaluator was written before any UI existed, so this must speak its language
 * rather than invent a friendlier one and translate.
 */

export interface AvailabilityTree {
  op: '&' | '|' | '!&' | '!|';
  showc?: boolean[];
  c: Array<Record<string, any> & { type: string }>;
}

const CONDITION_TYPES: Array<[string, string]> = [
  ['date', 'Date'],
  ['completion', 'Completion of another activity'],
  ['grade', 'Grade'],
  ['group', 'Group membership'],
  ['profile', 'Pupil profile field'],
];

type Condition = Record<string, any> & { type: string };

function blank(type: string): Condition {
  switch (type) {
    case 'date': return { type: 'date', d: '>=', t: new Date().toISOString() };
    case 'completion': return { type: 'completion', cm: '', e: 1 };
    case 'grade': return { type: 'grade', assessmentId: '', min: 50 };
    case 'group': return { type: 'group', id: '' };
    case 'profile': return { type: 'profile', field: 'house', op: 'isequalto', v: '' };
    default: return { type };
  }
}

export function AvailabilityBuilder({
  value, onChange, siblings = [],
}: {
  value: AvailabilityTree | null;
  onChange: (tree: AvailabilityTree | null) => void;
  /** Other activities in this course, for the "completion of…" condition. */
  siblings?: CourseModuleView[];
}) {
  const tree: AvailabilityTree = value ?? { op: '&', showc: [], c: [] };

  const update = (patch: Partial<AvailabilityTree>) => onChange({ ...tree, ...patch });

  const setCondition = (i: number, patch: Record<string, any>) =>
    update({ c: tree.c.map((c, n) => (n === i ? { ...c, ...patch } : c)) });

  const remove = (i: number) => {
    const next = { ...tree, c: tree.c.filter((_, n) => n !== i), showc: (tree.showc ?? []).filter((_, n) => n !== i) };
    // An empty tree means "always available" — send null rather than an empty
    // object, which the evaluator would also accept but which reads as a rule.
    onChange(next.c.length === 0 ? null : next);
  };

  const add = (type: string) =>
    update({ c: [...tree.c, blank(type)], showc: [...(tree.showc ?? []), true] });

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm">
        <span>Available when</span>
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={tree.op}
          onChange={(e) => update({ op: e.target.value as AvailabilityTree['op'] })}
        >
          <option value="&">all of</option>
          <option value="|">any of</option>
          <option value="!&">not all of</option>
          <option value="!|">none of</option>
        </select>
        <span>these are met:</span>
      </div>

      {tree.c.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No restrictions — this activity is available to everyone who can see the course.
        </p>
      )}

      {tree.c.map((c, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border bg-background p-2">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">
                {CONDITION_TYPES.find(([t]) => t === c.type)?.[1] ?? c.type}
              </span>
            </div>

            {c.type === 'date' && (
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={c.d ?? '>='}
                  onChange={(e) => setCondition(i, { d: e.target.value })}
                >
                  <option value=">=">from</option>
                  <option value="<">until</option>
                </select>
                <Input
                  type="datetime-local"
                  className="h-8 w-56"
                  value={c.t ? new Date(c.t).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setCondition(i, { t: e.target.value ? new Date(e.target.value).toISOString() : null })}
                />
              </div>
            )}

            {c.type === 'completion' && (
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  value={c.cm ?? ''}
                  onChange={(e) => setCondition(i, { cm: e.target.value })}
                >
                  <option value="">Choose an activity…</option>
                  {siblings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={String(c.e ?? 1)}
                  onChange={(e) => setCondition(i, { e: Number(e.target.value) })}
                >
                  <option value="1">is complete</option>
                  <option value="0">is not complete</option>
                  <option value="2">is complete and passed</option>
                  <option value="3">is complete and failed</option>
                </select>
              </div>
            )}

            {c.type === 'grade' && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  value={c.assessmentId ?? ''}
                  onChange={(e) => setCondition(i, { assessmentId: e.target.value })}
                >
                  <option value="">Choose a graded activity…</option>
                  {siblings.filter((m) => m.gradable && m.grade).map((m) => (
                    <option key={m.id} value={m.grade!.assessmentId}>{m.name}</option>
                  ))}
                </select>
                <span className="text-xs">≥</span>
                <Input
                  type="number" className="h-8 w-20" value={c.min ?? ''}
                  onChange={(e) => setCondition(i, { min: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <span className="text-xs">%</span>
              </div>
            )}

            {c.type === 'group' && (
              <Input
                className="h-8" placeholder="Group id" value={c.id ?? ''}
                onChange={(e) => setCondition(i, { id: e.target.value })}
              />
            )}

            {c.type === 'profile' && (
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={c.field ?? 'house'}
                  onChange={(e) => setCondition(i, { field: e.target.value })}
                >
                  <option value="house">House</option>
                  <option value="residenceType">Day / boarder</option>
                  <option value="gender">Gender</option>
                  <option value="nationality">Nationality</option>
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={c.op ?? 'isequalto'}
                  onChange={(e) => setCondition(i, { op: e.target.value })}
                >
                  <option value="isequalto">is</option>
                  <option value="isnotequalto">is not</option>
                  <option value="contains">contains</option>
                </select>
                <Input className="h-8 w-40" value={c.v ?? ''} onChange={(e) => setCondition(i, { v: e.target.value })} />
              </div>
            )}

            {/* showc drives whether an unmet condition is EXPLAINED to the pupil
                or the activity simply vanishes. Both are legitimate; the default
                is to explain, because silent disappearance confuses learners. */}
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={(tree.showc ?? [])[i] ?? true}
                onChange={(e) => {
                  const showc = [...(tree.showc ?? tree.c.map(() => true))];
                  showc[i] = e.target.checked;
                  update({ showc });
                }}
              />
              Show this activity greyed with the reason (otherwise hide it entirely)
            </label>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap gap-1">
        <Label className="w-full text-[11px] text-muted-foreground">Add a restriction</Label>
        {CONDITION_TYPES.map(([type, label]) => (
          <Button key={type} variant="outline" size="sm" className="h-7 text-xs" onClick={() => add(type)}>
            <Plus className="mr-1 h-3 w-3" />{label}
          </Button>
        ))}
      </div>
    </div>
  );
}
