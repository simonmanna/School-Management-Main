import { api } from '@/lib/api';

/**
 * SCORM run-time API (L8).
 *
 * A SCORM package is a self-contained web app that talks to the LMS by walking
 * `window.parent` until it finds an object named `API` (SCORM 1.2) or
 * `API_1484_11` (SCORM 2004). It calls synchronous methods on that object. This
 * installs one.
 *
 * Two consequences shape the design:
 *
 *  1. **The API must be synchronous.** The specification gives no way to await,
 *     so `LMSSetValue` writes to an in-memory CMI model and returns "true"
 *     immediately; the network write happens on `LMSCommit`/`LMSFinish`, which
 *     is exactly what those calls are for.
 *  2. **The client is not trusted with the grade.** The package reports
 *     `cmi.core.score.raw`, but which attempt counts is decided server-side by
 *     the package's grading method. A pupil editing the CMI in a console can
 *     claim a score for an attempt; they cannot choose how attempts combine, nor
 *     exceed the attempt ceiling.
 */

type Cmi = Record<string, string>;

const OK = 'true';
const FAIL = 'false';
const NO_ERROR = '0';

export interface ScormSession {
  /** Remove the API from `window` when the player unmounts. */
  detach: () => void;
}

export function attachScormApi(opts: {
  courseModuleId: string;
  attempt: number;
  version: '1.2' | '2004';
  /** Seed values from the pupil's previous attempt, so they resume where they left off. */
  initialCmi?: Cmi;
  onCommit?: (cmi: Cmi) => void;
  onError?: (message: string) => void;
}): ScormSession {
  const cmi: Cmi = { ...(opts.initialCmi ?? {}) };
  let lastError = NO_ERROR;
  let finished = false;

  const commit = (): void => {
    // Fire-and-forget: the spec's Commit is synchronous and cannot wait. A failure
    // surfaces through onError rather than being swallowed, because a pupil who
    // finishes an offline package deserves to be told the score did not save.
    void api
      .post(`/school/lms/modules/${opts.courseModuleId}/action/commit`, {
        scoIdentifier: cmi['cmi.core.student_id'] ? 'default' : 'default',
        attempt: opts.attempt,
        cmi,
      })
      .then(() => opts.onCommit?.({ ...cmi }))
      .catch((e: any) => {
        lastError = '101'; // general exception
        opts.onError?.(e?.response?.data?.message ?? 'Your progress could not be saved');
      });
  };

  const scorm12 = {
    LMSInitialize: () => { lastError = NO_ERROR; return OK; },
    LMSFinish: () => {
      if (finished) return OK;
      finished = true;
      commit();
      return OK;
    },
    LMSGetValue: (key: string) => {
      lastError = NO_ERROR;
      return cmi[key] ?? '';
    },
    LMSSetValue: (key: string, value: string) => {
      if (finished) { lastError = '101'; return FAIL; }
      cmi[key] = String(value);
      lastError = NO_ERROR;
      return OK;
    },
    LMSCommit: () => { commit(); return OK; },
    LMSGetLastError: () => lastError,
    LMSGetErrorString: (code: string) => (code === NO_ERROR ? 'No error' : 'General exception'),
    LMSGetDiagnostic: (code: string) => code,
  };

  // SCORM 2004 renames every method and drops the LMS prefix.
  const scorm2004 = {
    Initialize: scorm12.LMSInitialize,
    Terminate: scorm12.LMSFinish,
    GetValue: scorm12.LMSGetValue,
    SetValue: scorm12.LMSSetValue,
    Commit: scorm12.LMSCommit,
    GetLastError: scorm12.LMSGetLastError,
    GetErrorString: scorm12.LMSGetErrorString,
    GetDiagnostic: scorm12.LMSGetDiagnostic,
  };

  const w = window as any;
  if (opts.version === '2004') w.API_1484_11 = scorm2004;
  else w.API = scorm12;

  return {
    detach: () => {
      // A package that never called Finish still deserves its progress saved.
      if (!finished) { finished = true; commit(); }
      if (opts.version === '2004') delete w.API_1484_11;
      else delete w.API;
    },
  };
}

/**
 * xAPI capture for H5P (L8).
 *
 * H5P emits xAPI statements on the window. Only the ones that carry a result are
 * forwarded — H5P is chatty, and posting every `experienced` verb would fill the
 * event log without telling a teacher anything.
 */
export function attachH5pListener(opts: { courseModuleId: string; onScore?: (raw: number, max: number) => void }): () => void {
  const handler = (event: any) => {
    const statement = event?.data?.statement ?? event?.detail?.statement;
    const result = statement?.result;
    if (!result?.score || typeof result.score.raw !== 'number') return;
    void api
      .post(`/school/lms/modules/${opts.courseModuleId}/action/xapi`, {
        verb: statement.verb?.id ?? null,
        object: statement.object?.id ?? null,
        result,
        raw: result.score.raw,
        max: result.score.max ?? 100,
      })
      .then(() => opts.onScore?.(result.score.raw, result.score.max ?? 100))
      .catch(() => undefined);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
