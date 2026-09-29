import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2, Search } from 'lucide-react';
import { Container, Panel, Section } from '@/site/components';
import { Button, Input } from '@/components/ui';
import { usePageTitle } from '@/site/site-shell';
import { fetchApplication, publicErrorMessage, type ApplicationView } from '@/site/public-api';
import { DocumentUpload, OnlineApplication } from '@/site/pages/_apply-form';

/**
 * Wave 16 — the online application on its own page.
 *
 * Like /verify, this works whether or not the school has written its website
 * copy: the form reads only live data (open intakes, classes) from the API, so
 * nothing on it can publish sample content under a real school's name. The
 * marketing /admissions page embeds the same form once the site is live.
 *
 * `?token=` (from the emailed link) opens straight onto the family's own
 * application, where documents are uploaded.
 */
export default function ApplyPage() {
  usePageTitle('Apply online');
  const [params] = useSearchParams();
  const linked = params.get('token')?.trim() ?? '';
  return (
    <>
      <Section>
        <Container>
          <OnlineApplication />
        </Container>
      </Section>
      <Section tone="muted">
        <Container>
          <TrackApplication initialToken={linked} />
        </Container>
      </Section>
    </>
  );
}

function TrackApplication({ initialToken }: { initialToken: string }) {
  const [raw, setRaw] = useState(initialToken);
  const [error, setError] = useState<string | null>(null);
  const [app, setApp] = useState<ApplicationView | null>(null);
  const token = extractToken(raw);
  const check = useMutation({
    mutationFn: () => fetchApplication(token),
    onSuccess: (d) => { setError(null); setApp(d); },
    onError: (e) => { setApp(null); setError(publicErrorMessage(e, 'That link has expired or is not recognised. Ask the school to send a fresh one.')); },
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="font-display text-2xl font-bold tracking-tight">Already applied?</h2>
      <p className="text-sm text-muted-foreground">Paste the link we emailed you to see where your application is and to upload documents.</p>
      <Panel className="space-y-3 p-6">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (token) check.mutate(); }}>
          <Input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="The link from your email, or the code at its end" aria-label="Application link or code" autoCapitalize="none" spellCheck={false} />
          <Button type="submit" disabled={!token || check.isPending}>
            {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Check
          </Button>
        </form>
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        {app && (
          <div className="space-y-3 border-t pt-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{app.applicantName}</div>
                <div className="text-xs text-muted-foreground">Application {app.applicationNumber}{app.applyingForClass ? ` · ${app.applyingForClass}` : ''}</div>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{humanise(app.status)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Documents: {app.documents.length === 0 ? 'none yet' : app.documents.map((d) => `${humanise(d.type)} (${d.verified ? 'verified' : d.rejectionReason ? 'needs replacing' : 'being checked'})`).join(', ')}
            </div>
            <DocumentUpload token={token} onUploaded={() => check.mutate()} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function extractToken(input: string): string {
  const value = input.trim();
  if (!value) return '';
  try {
    return new URL(value).searchParams.get('token')?.trim() ?? value;
  } catch {
    const m = value.match(/[?&]token=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : value;
  }
}

function humanise(v: string): string {
  const s = v.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
