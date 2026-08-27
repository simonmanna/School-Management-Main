import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileUpload, type LmsFileRef } from '../file-upload';
import { RichText } from '../rich-text';

/**
 * Per-activity settings forms (L4).
 *
 * One form per activity type, grouped by shape so this is five patterns rather
 * than eighteen bespoke builds. Each returns a plain DTO that goes straight to
 * `POST courses/:id/modules` or `PATCH modules/:id/instance`; the server sanitises
 * every rich-text field on write, so these never have to.
 */

export interface SettingsFormProps {
  /** Current values when editing; empty when adding. */
  value: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
}

export type SettingsForm = (props: SettingsFormProps) => JSX.Element;

// ── shared fields ────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NameAndIntro({ value, onChange }: SettingsFormProps) {
  return (
    <>
      <Field label="Name">
        <Input value={value.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} placeholder="Activity name" />
      </Field>
      <Field label="Description" hint="Shown under the title on the course page.">
        <RichText value={value.intro ?? ''} onChange={(intro) => onChange({ intro })} />
      </Field>
    </>
  );
}

function Num({ label, hint, field, value, onChange, min = 0 }: {
  label: string; hint?: string; field: string; value: Record<string, any>;
  onChange: (p: Record<string, any>) => void; min?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number" min={min}
        value={value[field] ?? ''}
        onChange={(e) => onChange({ [field]: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    </Field>
  );
}

function Check({ label, hint, field, value, onChange }: {
  label: string; hint?: string; field: string; value: Record<string, any>;
  onChange: (p: Record<string, any>) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox" className="mt-1"
        checked={Boolean(value[field])}
        onChange={(e) => onChange({ [field]: e.target.checked })}
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function Choice({ label, field, options, value, onChange }: {
  label: string; field: string; options: Array<[string, string]>;
  value: Record<string, any>; onChange: (p: Record<string, any>) => void;
}) {
  return (
    <Field label={label}>
      <select
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        value={value[field] ?? options[0][0]}
        onChange={(e) => onChange({ [field]: e.target.value })}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

/** Local datetime input that round-trips ISO strings. */
function When({ label, hint, field, value, onChange }: {
  label: string; hint?: string; field: string; value: Record<string, any>;
  onChange: (p: Record<string, any>) => void;
}) {
  const iso: string | undefined = value[field];
  const local = iso ? new Date(iso).toISOString().slice(0, 16) : '';
  return (
    <Field label={label} hint={hint}>
      <Input
        type="datetime-local" value={local}
        onChange={(e) => onChange({ [field]: e.target.value ? new Date(e.target.value).toISOString() : null })}
      />
    </Field>
  );
}

// ── the forms ────────────────────────────────────────────────────────────────

const PageForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Field label="Page content">
      <RichText value={p.value.content ?? ''} onChange={(content) => p.onChange({ content })} rows={10} />
    </Field>
  </div>
);

const LabelForm: SettingsForm = (p) => (
  <Field label="Text" hint="Appears inline on the course page — a label has no page of its own.">
    <RichText value={p.value.content ?? ''} onChange={(content) => p.onChange({ content })} />
  </Field>
);

const ResourceForm: SettingsForm = (p) => {
  const [file, setFile] = useState<LmsFileRef | null>(null);
  return (
    <div className="space-y-3">
      <NameAndIntro {...p} />
      <Field label="File">
        <FileUpload
          max={1} label={file ? 'Replace file' : 'Choose a file'}
          onUploaded={(files) => {
            const f = files[0] ?? null;
            setFile(f);
            p.onChange({ fileId: f?.id ?? null });
          }}
        />
      </Field>
      <Choice
        label="How it opens" field="displayMode" value={p.value} onChange={p.onChange}
        options={[['auto', 'Automatic'], ['embed', 'Embed in the page'], ['download', 'Force download']]}
      />
    </div>
  );
};

const UrlForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Field label="Link">
      <Input
        type="url" placeholder="https://…"
        value={p.value.externalUrl ?? ''}
        onChange={(e) => p.onChange({ externalUrl: e.target.value })}
      />
    </Field>
    <Choice
      label="Display" field="display" value={p.value} onChange={p.onChange}
      options={[['new_window', 'Open in a new tab'], ['same_window', 'Open in this tab'], ['embed', 'Embed']]}
    />
  </div>
);

const FolderForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Field label="Files">
      <FileUpload max={20} label="Add files" onUploaded={(files) => p.onChange({ fileIds: files.map((f) => f.id) })} />
    </Field>
  </div>
);

const AssignForm: SettingsForm = (p) => {
  const types: string[] = p.value.submissionTypes ?? ['online_text', 'file'];
  const toggle = (t: string) =>
    p.onChange({ submissionTypes: types.includes(t) ? types.filter((x) => x !== t) : [...types, t] });
  return (
    <div className="space-y-3">
      <NameAndIntro {...p} />
      <div className="grid gap-3 sm:grid-cols-2">
        <When label="Due date" field="dueDate" value={p.value} onChange={p.onChange}
          hint="Work is flagged late after this, but can still be handed in." />
        <When label="Cut-off date" field="cutoffDate" value={p.value} onChange={p.onChange}
          hint="Hard close — the server refuses submissions after this." />
        <Num label="Marked out of" field="maxScore" value={p.value} onChange={p.onChange} min={1} />
        <Num label="Attempts allowed" field="maxAttempts" value={p.value} onChange={p.onChange}
          hint="0 for unlimited." />
      </div>
      <Field label="Accepted submission types">
        <div className="flex gap-3">
          {(['online_text', 'file'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} />
              {t === 'online_text' ? 'Typed answer' : 'File upload'}
            </label>
          ))}
        </div>
      </Field>
      <Check label="Team submission" field="teamSubmission" value={p.value} onChange={p.onChange}
        hint="One submission per group." />
      <Check label="Blind marking" field="blindMarking" value={p.value} onChange={p.onChange}
        hint="Hides pupil names from the marker until the mark is entered." />
    </div>
  );
};

const QuizForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <div className="grid gap-3 sm:grid-cols-2">
      <When label="Opens" field="openAt" value={p.value} onChange={p.onChange} />
      <When label="Closes" field="closeAt" value={p.value} onChange={p.onChange} />
      <Num label="Marked out of" field="maxScore" value={p.value} onChange={p.onChange} min={1} />
      <Num label="Time limit (minutes)" field="timeLimitMinutes" value={p.value} onChange={p.onChange}
        hint="Leave blank for no limit." />
      <Num label="Attempts allowed" field="attemptsAllowed" value={p.value} onChange={p.onChange}
        hint="0 for unlimited." />
      <Choice
        label="Grading method" field="gradingMethod" value={p.value} onChange={p.onChange}
        options={[['highest', 'Highest grade'], ['average', 'Average'], ['first', 'First attempt'], ['last', 'Last attempt']]}
      />
      <Choice
        label="Question behaviour" field="behaviour" value={p.value} onChange={p.onChange}
        options={[['deferredfeedback', 'Feedback after submission'], ['immediatefeedback', 'Immediate feedback'], ['adaptive', 'Adaptive']]}
      />
      <Choice
        label="Navigation" field="navMethod" value={p.value} onChange={p.onChange}
        options={[['free', 'Free — any question, any order'], ['sequential', 'Sequential — forward only']]}
      />
    </div>
    <Check label="Shuffle questions" field="shuffleQuestions" value={p.value} onChange={p.onChange} />
    <Check label="Shuffle answers within a question" field="shuffleAnswers" value={p.value} onChange={p.onChange} />
    <p className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
      Add questions from the question bank once the quiz is created.
    </p>
  </div>
);

const ForumForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Choice
      label="Forum type" field="forumType" value={p.value} onChange={p.onChange}
      options={[
        ['general', 'Standard — anyone may start a discussion'],
        ['single', 'A single simple discussion'],
        ['eachuser', 'Each person posts one discussion'],
        ['qanda', 'Q&A — must answer before seeing others'],
      ]}
    />
    <Check label="Allow ratings" field="ratingScale" value={p.value} onChange={p.onChange} />
  </div>
);

const ChoiceForm: SettingsForm = (p) => {
  const options: any[] = p.value.options ?? [{ key: 'a', label: '' }];
  const set = (i: number, label: string) => {
    const next = options.map((o, n) => (n === i ? { ...o, label } : o));
    p.onChange({ options: next });
  };
  return (
    <div className="space-y-3">
      <NameAndIntro {...p} />
      <Field label="Options">
        <div className="space-y-2">
          {options.map((o, i) => (
            <Input key={i} value={o.label ?? ''} placeholder={`Option ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
          ))}
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => p.onChange({ options: [...options, { key: String.fromCharCode(97 + options.length), label: '' }] })}
          >
            + Add option
          </button>
        </div>
      </Field>
      <Check label="Allow more than one answer" field="allowMultiple" value={p.value} onChange={p.onChange} />
      <Check label="Allow changing the answer" field="allowUpdate" value={p.value} onChange={p.onChange} />
      <Choice
        label="Show results" field="showResults" value={p.value} onChange={p.onChange}
        options={[['after_answer', 'After answering'], ['after_close', 'After it closes'], ['always', 'Always'], ['never', 'Never']]}
      />
    </div>
  );
};

const FeedbackForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Check label="Anonymous responses" field="anonymous" value={p.value} onChange={p.onChange}
      hint="Responses are not linked to a pupil. Cannot be undone once answers exist." />
    <Check label="Allow multiple submissions" field="multipleSubmit" value={p.value} onChange={p.onChange} />
  </div>
);

const SimpleForm: SettingsForm = (p) => (
  <div className="space-y-3"><NameAndIntro {...p} /></div>
);

const WorkshopForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Num label="Reviewers per submission" field="numReviewers" value={p.value} onChange={p.onChange} min={1} />
      <Num label="Marked out of" field="maxScore" value={p.value} onChange={p.onChange} min={1} />
    </div>
  </div>
);

const ScormForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Field label="Package (.zip)">
      <FileUpload max={1} accept=".zip" label="Upload package"
        onUploaded={(f) => p.onChange({ packageFileId: f[0]?.id ?? null })} />
    </Field>
    <Choice label="SCORM version" field="scormVersion" value={p.value} onChange={p.onChange}
      options={[['1.2', 'SCORM 1.2'], ['2004', 'SCORM 2004']]} />
  </div>
);

const LtiForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Field label="Tool URL"><Input type="url" value={p.value.toolUrl ?? ''} onChange={(e) => p.onChange({ toolUrl: e.target.value })} /></Field>
    <Field label="Client ID"><Input value={p.value.clientId ?? ''} onChange={(e) => p.onChange({ clientId: e.target.value })} /></Field>
    <Field label="Deployment ID"><Input value={p.value.deploymentId ?? ''} onChange={(e) => p.onChange({ deploymentId: e.target.value })} /></Field>
    <Field label="Login URL"><Input type="url" value={p.value.loginUrl ?? ''} onChange={(e) => p.onChange({ loginUrl: e.target.value })} /></Field>
  </div>
);

const H5pForm: SettingsForm = (p) => (
  <div className="space-y-3">
    <NameAndIntro {...p} />
    <Field label="Library"><Input value={p.value.library ?? ''} placeholder="H5P.InteractiveVideo 1.22" onChange={(e) => p.onChange({ library: e.target.value })} /></Field>
    <Field label="Content JSON">
      <Textarea rows={5} className="font-mono text-xs" value={p.value.contentJson ?? ''} onChange={(e) => p.onChange({ contentJson: e.target.value })} />
    </Field>
  </div>
);

export const SETTINGS_FORMS: Record<string, SettingsForm> = {
  page: PageForm,
  label: LabelForm,
  resource: ResourceForm,
  url: UrlForm,
  folder: FolderForm,
  assign: AssignForm,
  quiz: QuizForm,
  forum: ForumForm,
  choice: ChoiceForm,
  feedback: FeedbackForm,
  glossary: SimpleForm,
  wiki: SimpleForm,
  lesson: SimpleForm,
  workshop: WorkshopForm,
  scorm: ScormForm,
  lti: LtiForm,
  h5p: H5pForm,
  attendance: SimpleForm,
};

export function settingsFormFor(type: string): SettingsForm {
  return SETTINGS_FORMS[type] ?? SimpleForm;
}
