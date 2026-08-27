import type { ActivityUiPlugin } from './shared';
import { iconFor } from './shared';
import { CONTENT_PLUGINS } from './content';
import { SUBMISSION_PLUGINS } from './assign';
import { QUIZ_PLUGINS } from './quiz';
import { INTERACTIVE_PLUGINS } from './interactive';
import { UnknownActivity } from './unknown';

/**
 * The activity UI registry (ADR-014 §6) — the client half of the plugin contract.
 *
 * The course page and the activity page look a type up here and render whatever
 * comes back. Neither switches on `activityType` itself, so adding an activity is
 * a new entry in this map and nothing else.
 *
 * This replaced `guessType(view)`, which duck-typed the response body to infer
 * the type and printed raw JSON for the 14 of 18 types it could not place.
 */
const ALL: ActivityUiPlugin[] = [
  ...CONTENT_PLUGINS,
  ...SUBMISSION_PLUGINS,
  ...QUIZ_PLUGINS,
  ...INTERACTIVE_PLUGINS,
];

const REGISTRY = new Map<string, ActivityUiPlugin>(ALL.map((p) => [p.type, p]));

/**
 * Never returns undefined. An unregistered type gets an explicit "this activity
 * type has no viewer" card — a stated gap the user can report, rather than a
 * blank screen or a dump of internal JSON.
 */
export function activityUi(type: string): ActivityUiPlugin {
  return (
    REGISTRY.get(type) ?? {
      type,
      label: type,
      icon: iconFor(type),
      StudentView: UnknownActivity,
      TeacherView: UnknownActivity,
    }
  );
}

export function registeredActivityTypes(): ActivityUiPlugin[] {
  return ALL;
}

export type { ActivityUiPlugin };
