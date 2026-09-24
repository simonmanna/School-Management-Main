import { AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/features/school/api';
import {
  ENROLLMENT_STATUS_TONE,
  MOVEMENT_REASON_LABEL,
  useGroupingOptions,
  type EnrollmentStatus,
  type GroupingOptions,
  type MovementReason,
  type Placement,
} from '@/features/school/enrollment-api';

/** Sentinel for "no selection" — Radix Select cannot hold an empty string value. */
export const NONE = '__none__';
export const toId = (v: string | undefined) => (v && v !== NONE ? v : undefined);

export function StatusBadge({ status }: { status: EnrollmentStatus }) {
  return (
    <Badge variant="outline" className={cn('border-transparent font-medium', ENROLLMENT_STATUS_TONE[status])}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function ReasonBadge({ reason }: { reason: MovementReason }) {
  return (
    <span className="text-xs text-muted-foreground">{MOVEMENT_REASON_LABEL[reason] ?? reason}</span>
  );
}

export const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : '—';

/** "P5 · North" — one line describing where a learner sits. */
export function placementLabel(placement?: Placement | null): string {
  if (!placement) return 'No class';
  const cls = placement.classCohort?.schoolClass?.name ?? 'Unknown class';
  return placement.section?.name ? `${cls} · ${placement.section.name}` : cls;
}

/**
 * Section picker driven by the cohort's grouping options (ADR-029: a class's
 * subdivisions are its Sections, labelled "Stream" by default).
 *
 * The options come from the server, scoped to the cohort's own class, so a user
 * is never offered a section from another class — the rule is enforced in the
 * API too, but a form that can only express legal states is the point. This
 * used to read `groupingMode`/`streams`/`requiresStream`, which the API stopped
 * returning, and crashed on `options.streams.filter` (E2E audit E1).
 */
export function GroupingPicker({
  cohortId,
  sectionId,
  onSectionChange,
  disabled,
}: {
  cohortId?: string;
  sectionId?: string;
  onSectionChange: (value: string | undefined) => void;
  disabled?: boolean;
}) {
  const { data: options, isLoading } = useGroupingOptions(cohortId);
  const labels = useTerminology();

  if (!cohortId) return null;
  if (isLoading || !options) return <p className="text-sm text-muted-foreground">Loading class groups…</p>;
  if (!options.allowsSubdivision || options.sections.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="h-4 w-4" /> This {labels.class.toLowerCase()} is not divided into{' '}
        {labels.sectionPlural.toLowerCase()}.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>
        {labels.section} {options.requiresSection && <span className="text-destructive">*</span>}
      </Label>
      <Select value={sectionId ?? NONE} onValueChange={(v) => onSectionChange(toId(v))} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={`Choose a ${labels.section.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {!options.requiresSection && <SelectItem value={NONE}>No {labels.section.toLowerCase()}</SelectItem>}
          {options.sections.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.requiresSection && !sectionId && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This {labels.class.toLowerCase()} is divided — pick a {labels.section.toLowerCase()}.
        </p>
      )}
    </div>
  );
}

/** A short line telling the user how this class is organised. */
export function GroupingModeNote({ options }: { options?: GroupingOptions }) {
  const labels = useTerminology();
  if (!options) return null;
  const divided = options.allowsSubdivision && options.sections.length > 0;
  return (
    <p className="text-xs text-muted-foreground">
      {options.className ?? `This ${labels.class.toLowerCase()}`}{' '}
      {divided ? (
        <>
          is divided into <strong>{options.sections.length}</strong> {labels.sectionPlural.toLowerCase()}.
        </>
      ) : (
        <>is not divided.</>
      )}
    </p>
  );
}

/** Errors and warnings returned by a placement preview or a failed command. */
export function ValidationNotes({ errors, warnings }: { errors?: string[]; warnings?: string[] }) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <div className="space-y-1.5">
      {errors?.map((e, i) => (
        <p key={`e${i}`} className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {e}
        </p>
      ))}
      {warnings?.map((w, i) => (
        <p
          key={`w${i}`}
          className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}
