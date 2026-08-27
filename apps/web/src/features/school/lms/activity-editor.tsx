import { useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { settingsFormFor } from './activities/settings-forms';
import { activityUi } from './activities/registry';
import { AvailabilityBuilder, type AvailabilityTree } from './availability-builder';
import type { CourseModuleView } from './types';
import { notify } from '@/lib/notify';

/**
 * Add or edit one activity (L4).
 *
 * Three panels, matching what the spine and the plugin each own:
 *  - the plugin's own settings (`settings-forms.tsx`)
 *  - spine fields the plugin never sees: visibility, dates, completion
 *  - availability, which is evaluated only on the server
 *
 * A DTO from here goes to `POST courses/:id/modules` on create, and is split
 * across `PATCH modules/:id` (spine) and `PATCH modules/:id/instance` (plugin) on
 * edit — the API keeps those separate so a plugin can never write spine fields.
 */
export function ActivityEditor({
  activityType, existing, siblings, onSave, onClose,
}: {
  activityType: string;
  existing?: CourseModuleView;
  siblings: CourseModuleView[];
  onSave: (dto: { instance: Record<string, any>; spine: Record<string, any> }) => Promise<void>;
  onClose: () => void;
}) {
  const ui = activityUi(activityType);
  const Form = settingsFormFor(activityType);
  const Icon = ui.icon;

  const [instance, setInstance] = useState<Record<string, any>>({
    name: existing?.name ?? '',
    intro: existing?.intro ?? '',
  });
  const [spine, setSpine] = useState<Record<string, any>>({
    visible: existing?.visible ?? true,
    completionMode: existing?.completion?.mode ?? 'manual',
    completionRules: existing?.completion?.rules ?? {},
    dueAt: existing?.dueAt ?? null,
    openAt: existing?.openAt ?? null,
    cutoffAt: existing?.cutoffAt ?? null,
  });
  const [availability, setAvailability] = useState<AvailabilityTree | null>(null);
  const [busy, setBusy] = useState(false);

  const rules: Record<string, any> = spine.completionRules ?? {};
  const ruleKeys = completionRuleKeysFor(activityType);

  const save = async () => {
    if (!instance.name?.trim() && activityType !== 'label') {
      notify.error('Give the activity a name');
      return;
    }
    setBusy(true);
    try {
      await onSave({ instance, spine: { ...spine, availability } });
      onClose();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <Card className="my-8 w-full max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4" />
            {existing ? `Edit ${ui.label.toLowerCase()}` : `Add ${ui.label.toLowerCase()}`}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </CardHeader>

        <CardContent className="space-y-6 py-4">
          <Form value={instance} onChange={(patch) => setInstance((v) => ({ ...v, ...patch }))} />

          <section className="space-y-3">
            <h3 className="text-sm font-medium">Common settings</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={spine.visible !== false}
                onChange={(e) => setSpine((v) => ({ ...v, visible: e.target.checked }))}
              />
              Visible to pupils
            </label>

            <div className="space-y-1">
              <Label className="text-xs">Completion tracking</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={spine.completionMode ?? 'manual'}
                onChange={(e) => setSpine((v) => ({ ...v, completionMode: e.target.value }))}
              >
                <option value="none">Not tracked</option>
                <option value="manual">Pupils mark it done themselves</option>
                <option value="automatic">Complete when conditions are met</option>
              </select>
            </div>

            {spine.completionMode === 'automatic' && ruleKeys.length > 0 && (
              <div className="space-y-1.5 rounded-md border bg-muted/20 p-3">
                <Label className="text-[11px] text-muted-foreground">Counts as complete when…</Label>
                {ruleKeys.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" checked={Boolean(rules[key])}
                      onChange={(e) =>
                        setSpine((v) => ({ ...v, completionRules: { ...rules, [key]: e.target.checked || undefined } }))
                      }
                    />
                    {RULE_LABELS[key] ?? key}
                  </label>
                ))}
                {rules.minGrade !== undefined || ruleKeys.includes('minGrade') ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">Pass mark</span>
                    <input
                      type="number" className="h-8 w-20 rounded-md border bg-background px-2 text-sm"
                      value={rules.minGrade ?? ''}
                      onChange={(e) =>
                        setSpine((v) => ({
                          ...v,
                          completionRules: { ...rules, minGrade: e.target.value === '' ? undefined : Number(e.target.value) },
                        }))
                      }
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Restrict access</h3>
            <AvailabilityBuilder
              value={availability}
              onChange={setAvailability}
              siblings={siblings.filter((s) => s.id !== existing?.id)}
            />
          </section>
        </CardContent>

        <div className="flex justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {existing ? 'Save changes' : 'Add activity'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

const RULE_LABELS: Record<string, string> = {
  view: 'The pupil opens it',
  submit: 'The pupil submits work',
  requireGrade: 'The pupil receives a grade',
  minGrade: 'The pupil reaches the pass mark',
};

/** Mirrors each backend plugin's `features.completionRuleKeys`. */
function completionRuleKeysFor(type: string): string[] {
  switch (type) {
    case 'assign': return ['view', 'submit', 'requireGrade', 'minGrade'];
    case 'quiz': return ['view', 'requireGrade', 'minGrade'];
    case 'forum': return ['view', 'submit'];
    case 'label': return [];
    default: return ['view'];
  }
}
