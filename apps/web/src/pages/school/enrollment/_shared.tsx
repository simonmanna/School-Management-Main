import { useMemo } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ENROLLMENT_STATUS_TONE,
  GROUPING_MODE_LABEL,
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

/** "P5 · A / Red" — one line describing where a learner sits. */
export function placementLabel(placement?: Placement | null): string {
  if (!placement) return 'No class';
  const cls = placement.classCohort?.schoolClass?.name ?? 'Unknown class';
  const parts = [placement.section?.name, placement.stream?.name].filter(Boolean);
  return parts.length ? `${cls} · ${parts.join(' / ')}` : cls;
}

/**
 * Section/stream pickers driven by the cohort's grouping mode (ADR-019).
 *
 * The options come from the server, scoped to the cohort's own class, so a user
 * is never offered a stream from another class — the rule is enforced in the
 * API too, but a form that can only express legal states is the point.
 */
export function GroupingPicker({
  cohortId,
  sectionId,
  streamId,
  onSectionChange,
  onStreamChange,
  disabled,
}: {
  cohortId?: string;
  sectionId?: string;
  streamId?: string;
  onSectionChange: (value: string | undefined) => void;
  onStreamChange: (value: string | undefined) => void;
  disabled?: boolean;
}) {
  const { data: options, isLoading } = useGroupingOptions(cohortId);

  const streams = useMemo(() => {
    if (!options) return [];
    if (options.groupingMode !== 'SECTION_AND_STREAM') return options.streams;
    // In combined mode a stream belongs to the chosen section.
    return options.streams.filter((s) => s.sectionId === sectionId);
  }, [options, sectionId]);

  if (!cohortId) return null;
  if (isLoading || !options) return <p className="text-sm text-muted-foreground">Loading class groups…</p>;
  if (options.groupingMode === 'NONE') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="h-4 w-4" /> This class is not divided into sections or streams.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(options.requiresSection || options.sections.length > 0) && options.groupingMode !== 'STREAM_ONLY' && (
        <div className="space-y-1.5">
          <Label>Section {options.requiresSection && <span className="text-destructive">*</span>}</Label>
          <Select
            value={sectionId ?? NONE}
            onValueChange={(v) => {
              onSectionChange(toId(v));
              if (options.groupingMode === 'SECTION_AND_STREAM') onStreamChange(undefined);
            }}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a section" />
            </SelectTrigger>
            <SelectContent>
              {!options.requiresSection && <SelectItem value={NONE}>No section</SelectItem>}
              {options.sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {options.groupingMode !== 'SECTION_ONLY' && (
        <div className="space-y-1.5">
          <Label>Stream {options.requiresStream && <span className="text-destructive">*</span>}</Label>
          <Select
            value={streamId ?? NONE}
            onValueChange={(v) => onStreamChange(toId(v))}
            disabled={disabled || (options.groupingMode === 'SECTION_AND_STREAM' && !sectionId)}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  options.groupingMode === 'SECTION_AND_STREAM' && !sectionId ? 'Choose a section first' : 'Choose a stream'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {!options.requiresStream && <SelectItem value={NONE}>No stream</SelectItem>}
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.groupingMode === 'SECTION_AND_STREAM' && sectionId && streams.length === 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No streams are attached to this section yet. Attach them under Programmes &amp; Cohorts.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A short line telling the user how this class is organised. */
export function GroupingModeNote({ options }: { options?: GroupingOptions }) {
  if (!options) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {options.className ?? 'This class'} is set up as <strong>{GROUPING_MODE_LABEL[options.groupingMode]}</strong>.
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
