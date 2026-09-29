import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { statusMeta } from './_components/admission-status';

interface PortalView {
  applicationNumber: string;
  applicantName: string;
  status: string;
  academicYear: string | null;
  applyingForClass: string | null;
  feeStatus: string;
  documents: Array<{ id: string; type: string; required: boolean; verified: boolean; rejectionReason?: string | null }>;
  offer: { status: string; expiresAt?: string | null; body?: string | null } | null;
}

/**
 * Public applicant/parent portal tracking page (Phase 3). Authorized solely by
 * the magic-link token in the URL — no login. Shows status, documents and the
 * offer, and lets the applicant accept or decline their own offer.
 */
export function SchoolApplyTrackPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [docType, setDocType] = useState('birth_certificate');
  const [file, setFile] = useState<File | null>(null);

  const load = async () => {
    if (!token) { setError('This link is missing its access token.'); return; }
    try {
      const res = await api.get<PortalView>(`/school/admissions/portal/application`, { params: { token } });
      setView(res.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'This access link is invalid or has expired.');
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const respond = async (accept: boolean) => {
    setBusy(true);
    try {
      await api.post(`/school/admissions/portal/offer/${accept ? 'accept' : 'decline'}`, null, { params: { token } });
      notify.success(accept ? 'Offer accepted' : 'Offer declined');
      await load();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not record your response');
    } finally {
      setBusy(false);
    }
  };

  // Wave 16: the family adds documents here, by the same token.
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('type', docType);
      body.append('file', file);
      await api.post('/public/admissions/documents', body, { params: { token }, headers: { 'Content-Type': 'multipart/form-data' } });
      notify.success('Document uploaded — the school will check it');
      setFile(null);
      await load();
    } catch (e: any) {
      const m = e?.response?.data?.message;
      notify.error(Array.isArray(m) ? m.join(' · ') : m ?? 'Could not upload the document');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Card><CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent></Card>
      </div>
    );
  }

  if (!view) return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;

  const meta = statusMeta(view.status);
  const offerOpen = view.offer?.status === 'issued' || view.offer?.status === 'viewed';

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{view.applicantName}</h1>
        <p className="text-sm text-muted-foreground">Application {view.applicationNumber}</p>
        <div className="mt-2"><Badge className={meta.cls}>{meta.label}</Badge></div>
      </div>

      <Card><CardContent className="grid grid-cols-2 gap-4 p-5 text-sm">
        <Detail label="Academic year" value={view.academicYear ?? '—'} />
        <Detail label="Applying for" value={view.applyingForClass ?? '—'} />
        <Detail label="Application fee" value={view.feeStatus} />
      </CardContent></Card>

      {/* Documents checklist */}
      <Card><CardContent className="p-5">
        <h3 className="mb-3 text-sm font-semibold">Documents</h3>
        {view.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {view.documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <span className="capitalize">{d.type.replace(/_/g, ' ')}{d.required && <span className="text-rose-500"> *</span>}</span>
                {d.verified ? <Badge className="bg-emerald-100 text-emerald-700">Verified</Badge>
                  : d.rejectionReason ? <Badge className="bg-rose-100 text-rose-700">Rejected</Badge>
                  : <Badge className="bg-slate-100 text-slate-700">Pending</Badge>}
              </div>
            ))}
          </div>
        )}
        {!['enrolled', 'rejected', 'withdrawn', 'offer_declined', 'offer_expired'].includes(view.status) && (
          <div className="mt-4 space-y-2 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">Upload a document (PDF, JPG or PNG, up to 10 MB)</p>
            <div className="flex flex-wrap gap-2">
              <select className="rounded-md border bg-card px-3 py-2 text-sm" value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
                {['birth_certificate', 'passport_photo', 'previous_report', 'immunisation_card', 'transfer_letter', 'other'].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <input type="file" accept="application/pdf,image/jpeg,image/png" aria-label="File" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button size="sm" onClick={upload} disabled={!file || busy}>Upload</Button>
            </div>
          </div>
        )}
      </CardContent></Card>

      {/* Offer */}
      {view.offer && (
        <Card><CardContent className="p-5">
          <h3 className="mb-2 text-sm font-semibold">Your offer</h3>
          {view.offer.body && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{view.offer.body}</p>}
          {view.offer.expiresAt && <p className="mt-2 text-xs text-muted-foreground">Expires {new Date(view.offer.expiresAt).toLocaleDateString()}</p>}
          <div className="mt-3">
            <Badge className={view.offer.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : view.offer.status === 'declined' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}>
              Offer {view.offer.status}
            </Badge>
          </div>
          {offerOpen && (
            <div className="mt-4 flex gap-2">
              <Button onClick={() => respond(true)} disabled={busy}>Accept offer</Button>
              <Button variant="destructive" onClick={() => respond(false)} disabled={busy}>Decline</Button>
            </div>
          )}
        </CardContent></Card>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium capitalize">{value}</p></div>;
}
