import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, Send, Upload } from 'lucide-react';
import { ORG_CODE } from '@/lib/api';
import { Panel, SectionHeading } from '@/site/components';
import { Button, Input } from '@/components/ui';
import {
  fetchApplyOptions, submitApplication, submissionErrorMessage, uploadApplicationDocument,
  type ApplicationReceipt, type ApplicationSubmission,
} from '@/site/public-api';

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const EMPTY: ApplicationSubmission = {
  admissionCycleId: '',
  applyingForClassId: '',
  applicantFirstName: '',
  applicantLastName: '',
  applicantDob: '',
  applicantGender: 'female',
  previousSchool: '',
  address: '',
  guardian: { firstName: '', lastName: '', relationship: 'mother', phone: '', email: '' },
  website: '',
};

/**
 * Wave 16 — apply online.
 *
 * The form submits into the same admissions pipeline the office uses, then the
 * school emails the guardian a private link to follow the application and add
 * documents. The page never tells a visitor whether some other child has
 * applied; a duplicate is reported only as "contact the school".
 */
export function OnlineApplication() {
  const options = useQuery({ queryKey: ['apply-options', ORG_CODE], queryFn: () => fetchApplyOptions(ORG_CODE), retry: 1 });
  const [f, setF] = useState<ApplicationSubmission>(EMPTY);
  const [receipt, setReceipt] = useState<ApplicationReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      submitApplication(ORG_CODE, {
        ...f,
        applyingForClassId: f.applyingForClassId || undefined,
        previousSchool: f.previousSchool || undefined,
        address: f.address || undefined,
      }),
    onSuccess: (r) => {
      setError(null);
      setReceipt(r);
    },
    onError: (e) => setError(submissionErrorMessage(e)),
  });

  const set = (k: keyof ApplicationSubmission) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const setG = (k: keyof ApplicationSubmission['guardian']) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, guardian: { ...f.guardian, [k]: e.target.value } });

  const cycles = options.data?.cycles ?? [];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16" id="apply">
      <div>
        <SectionHeading
          eyebrow="Apply online"
          title="Start an application"
          lede="It takes about five minutes. We email you a private link to follow the application and upload the child's documents — no account needed."
        />
        <ul className="space-y-2 pt-6 text-sm text-muted-foreground">
          <li>• Use an email address you check: the tracking link goes there.</li>
          <li>• Have the birth certificate ready to upload once you get the link.</li>
          <li>• Applying for two children? Submit one form for each.</li>
        </ul>
      </div>

      <Panel className="p-6 sm:p-8">
        {receipt ? (
          <div className="space-y-3" role="status">
            <p className="flex items-center gap-2 font-display text-xl font-bold">
              <CheckCircle2 className="h-5 w-5 text-primary" /> Application received
            </p>
            {receipt.applicationNumber && (
              <p className="text-sm">
                Your application number is <span className="font-mono font-semibold">{receipt.applicationNumber}</span>.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {receipt.trackingLinkSentTo
                ? `We have emailed a private tracking link to ${receipt.trackingLinkSentTo}. Use it to upload documents and follow each stage.`
                : 'We will be in touch using the details you gave.'}
            </p>
            <Button variant="outline" onClick={() => { setReceipt(null); setF(EMPTY); }}>Apply for another child</Button>
          </div>
        ) : options.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : cycles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Online applications are not open at the moment. Please contact the admissions office.
          </p>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="pb-2 text-sm font-semibold">The child</legend>
              <Labelled label="First name" htmlFor="a-first"><Input id="a-first" required value={f.applicantFirstName} onChange={set('applicantFirstName')} /></Labelled>
              <Labelled label="Surname" htmlFor="a-last"><Input id="a-last" required value={f.applicantLastName} onChange={set('applicantLastName')} /></Labelled>
              <Labelled label="Date of birth" htmlFor="a-dob"><Input id="a-dob" type="date" required value={f.applicantDob} onChange={set('applicantDob')} /></Labelled>
              <Labelled label="Sex" htmlFor="a-sex">
                <select id="a-sex" className={selectClass} value={f.applicantGender} onChange={set('applicantGender')}>
                  <option value="female">Girl</option>
                  <option value="male">Boy</option>
                </select>
              </Labelled>
              <Labelled label="Intake" htmlFor="a-cycle">
                <select id="a-cycle" className={selectClass} required value={f.admissionCycleId} onChange={set('admissionCycleId')}>
                  <option value="">Choose…</option>
                  {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}{c.academicYear ? ` (${c.academicYear})` : ''}</option>)}
                </select>
              </Labelled>
              <Labelled label="Class applying for" htmlFor="a-class">
                <select id="a-class" className={selectClass} value={f.applyingForClassId} onChange={set('applyingForClassId')}>
                  <option value="">Not sure yet</option>
                  {(options.data?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Labelled>
              <Labelled label="Previous school (if any)" htmlFor="a-prev" className="sm:col-span-2"><Input id="a-prev" value={f.previousSchool} onChange={set('previousSchool')} /></Labelled>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="pb-2 text-sm font-semibold">Parent or guardian</legend>
              <Labelled label="First name" htmlFor="g-first"><Input id="g-first" required value={f.guardian.firstName} onChange={setG('firstName')} /></Labelled>
              <Labelled label="Surname" htmlFor="g-last"><Input id="g-last" required value={f.guardian.lastName} onChange={setG('lastName')} /></Labelled>
              <Labelled label="Relationship" htmlFor="g-rel">
                <select id="g-rel" className={selectClass} value={f.guardian.relationship} onChange={setG('relationship')}>
                  {['mother', 'father', 'guardian', 'grandparent', 'other'].map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                </select>
              </Labelled>
              <Labelled label="Mobile number" htmlFor="g-phone"><Input id="g-phone" type="tel" required placeholder="0772 123456" value={f.guardian.phone} onChange={setG('phone')} /></Labelled>
              <Labelled label="Email (the tracking link is sent here)" htmlFor="g-email" className="sm:col-span-2"><Input id="g-email" type="email" required value={f.guardian.email} onChange={setG('email')} /></Labelled>
              <Labelled label="Home address" htmlFor="g-addr" className="sm:col-span-2"><Input id="g-addr" value={f.address} onChange={set('address')} /></Labelled>
            </fieldset>

            {/* Honeypot: off-screen for people, irresistible to form bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={submit.isPending}>
              {submit.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Send className="h-4 w-4" /> Submit application</>}
            </Button>
          </form>
        )}
      </Panel>
    </div>
  );
}

/** Upload one document against the application a tracking token names. */
export function DocumentUpload({ token, onUploaded }: { token: string; onUploaded?: () => void }) {
  const options = useQuery({ queryKey: ['apply-options', ORG_CODE], queryFn: () => fetchApplyOptions(ORG_CODE), retry: 1 });
  const [type, setType] = useState('birth_certificate');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const upload = useMutation({
    mutationFn: () => uploadApplicationDocument(token, type, file!),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Uploaded. The office will check it.' });
      setFile(null);
      onUploaded?.();
    },
    onError: (e) => setMsg({ ok: false, text: submissionErrorMessage(e) }),
  });
  const types = options.data?.documentTypes ?? ['birth_certificate', 'passport_photo', 'previous_report', 'immunisation_card', 'transfer_letter', 'other'];
  return (
    <div className="space-y-2 rounded-xl border p-4">
      <p className="text-sm font-semibold">Upload a document</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)} aria-label="Document type">
          {types.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</option>)}
        </select>
        <Input type="file" accept="application/pdf,image/jpeg,image/png" aria-label="File" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button type="button" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">PDF, JPG or PNG, up to 10 MB.</p>
      {msg && <p className={`text-sm ${msg.ok ? 'text-primary' : 'text-destructive'}`} role="status">{msg.text}</p>}
    </div>
  );
}

function Labelled({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
