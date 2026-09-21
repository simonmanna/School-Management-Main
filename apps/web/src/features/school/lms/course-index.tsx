import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Lock } from 'lucide-react';
import { activityUi } from './activities/registry';
import type { CourseSectionView } from './types';

/**
 * The course index — Moodle 4's left-hand jump list.
 *
 * A term's course is 14 sections deep; without an index the only way to reach
 * week 11 is to scroll past ten weeks of activities. Each row scrolls its section
 * into view rather than navigating, so the page keeps its edit state.
 *
 * Completion ticks are shown from the same envelope the rows use, so the index
 * and the page can never disagree about what a pupil has finished.
 */
export function CourseIndex({
  sections,
  activeSectionId,
  onJump,
}: {
  sections: CourseSectionView[];
  activeSectionId?: string | null;
  onJump: (sectionId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (sections.length === 0) return null;

  return (
    <nav aria-label="Course index" className="space-y-0.5 text-sm">
      <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Course index
      </p>
      {sections.map((sec) => {
        const open = expanded.has(sec.id);
        const title = sec.name ?? (sec.sectionNo === 0 ? 'General' : `Section ${sec.sectionNo}`);
        const tracked = sec.modules.filter((m) => m.completion);
        const done = tracked.filter((m) => m.completion!.state !== 'incomplete').length;
        const blocked = sec.availability && !sec.availability.available;

        return (
          <div key={sec.id}>
            <div
              className={`flex items-center gap-1 rounded px-1 ${
                activeSectionId === sec.id ? 'bg-primary/10' : 'hover:bg-muted/60'
              }`}
            >
              <button
                type="button"
                aria-label={open ? 'Collapse section' : 'Expand section'}
                onClick={() => toggle(sec.id)}
                className="shrink-0 p-1 text-muted-foreground"
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => onJump(sec.id)}
                className="min-w-0 flex-1 py-1.5 text-left"
              >
                <span className={`block truncate ${blocked ? 'text-muted-foreground' : ''}`}>
                  {title}
                  {blocked && <Lock className="ml-1 inline h-3 w-3 text-amber-600" />}
                </span>
                {tracked.length > 0 && (
                  <span className="block text-[11px] tabular-nums text-muted-foreground">
                    {done}/{tracked.length} done
                  </span>
                )}
              </button>
            </div>

            {open && (
              <ul className="ml-6 space-y-0.5 border-l pl-2">
                {sec.modules.length === 0 && (
                  <li className="py-1 text-xs text-muted-foreground">No activities</li>
                )}
                {sec.modules.map((m) => {
                  const Icon = activityUi(m.activityType).icon;
                  const complete = m.completion && m.completion.state !== 'incomplete';
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onJump(sec.id)}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs hover:bg-muted/60"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        {m.completion && (
                          complete
                            ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                            : <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
