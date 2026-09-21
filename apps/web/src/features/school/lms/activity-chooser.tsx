import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { registeredActivityTypes } from './activities/registry';
import { blurbFor, groupFor } from './activities/shared';

const GROUP_ORDER = ['Content', 'Activities', 'Collaboration', 'External', 'Other'];

/**
 * The activity chooser (Moodle's "Add an activity or resource").
 *
 * Replaces an inline row of 18 unlabelled chips: a teacher picking between
 * "Lesson", "Workshop" and "H5P" needs to read what each one does, and needs to
 * find it by typing rather than by scanning. Tiles are grouped and searchable;
 * the registry is still the only source of what exists, so a new activity type
 * appears here with no change to this file.
 */
export function ActivityChooser({
  open, onPick, onClose,
}: {
  open: boolean;
  onPick: (activityType: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = registeredActivityTypes().filter((a) => {
      if (!needle) return true;
      return (
        a.label.toLowerCase().includes(needle) ||
        a.type.toLowerCase().includes(needle) ||
        (blurbFor(a.type) ?? '').toLowerCase().includes(needle)
      );
    });
    const byGroup = new Map<string, typeof matches>();
    for (const a of matches) {
      const g = groupFor(a.type);
      byGroup.set(g, [...(byGroup.get(g) ?? []), a]);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [q]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setQ(''); onClose(); } }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add an activity or resource</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          {/* autoFocus: the fastest path is to type the first letters of a type. */}
          <Input
            autoFocus
            className="pl-8"
            placeholder="Search activity types…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {groups.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing matches “{q}”.
          </p>
        )}

        <div className="space-y-5">
          {groups.map(({ group, items }) => (
            <div key={group} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.type}
                      type="button"
                      onClick={() => { setQ(''); onPick(a.type); }}
                      className="flex items-start gap-3 rounded-md border bg-card p-3 text-left transition hover:border-primary hover:bg-primary/5"
                    >
                      <span className="mt-0.5 rounded bg-muted p-1.5">
                        <Icon className="h-4 w-4 text-foreground" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{a.label}</span>
                        <span className="block text-xs leading-snug text-muted-foreground">
                          {blurbFor(a.type) ?? a.type}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
