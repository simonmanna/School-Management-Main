import { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, ShieldCheck, ShieldAlert, Paperclip } from 'lucide-react';
import {
  useAdmission,
  useAdmissionRequirements,
  useAddDocument,
  useVerifyDocument,
  uploadSchoolFile,
  fileUrl,
  type AdmissionDocument,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';

/**
 * Per-application supporting-document panel.
 *
 * - Lists the org's configured document requirements (AdmissionRequirement, kind='document')
 *   and shows, for each, whether it is attached + verified, attached but unverified, or missing.
 * - Lets a staff member upload a file (platform File service) and attach it to the application
 *   under a requirement code.
 * - Lets a reviewer verify / reject an attached document (rejection requires a reason).
 *
 * The backend enforces the same rules on submit/enroll (missingSubmitRequirements +
 * checkEligibility), so this is the operator-facing surface for a requirement that is
 * already enforced server-side.
 */
export function ApplicationDocuments({
  applicationId,
  admissionCycleId,
}: {
  applicationId: string;
  admissionCycleId?: string | null;
}) {
  const { data: app } = useAdmission(applicationId);
  const { data: reqs } = useAdmissionRequirements(admissionCycleId ?? undefined);
  const addDoc = useAddDocument(applicationId);
  const verifyDoc = useVerifyDocument('');

  const documents: AdmissionDocument[] = app?.documents ?? [];
  const docByType = new Map<string, AdmissionDocument>(documents.map((d) => [d.type, d]));

  const documentReqs = (reqs ?? []).filter((r) => r.kind === 'document');

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4" /> Supporting documents
        </h3>

        {documentReqs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No document requirements configured. Add them under Admissions Config → Requirements.
          </p>
        )}

        <ul className="space-y-2">
          {documentReqs.map((r) => {
            const doc = docByType.get(r.code);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{r.code}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!doc && <Badge className="bg-amber-100 text-amber-800">Missing</Badge>}
                  {doc && doc.verified && (
                    <Badge className="bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Verified
                    </Badge>
                  )}
                  {doc && !doc.verified && (
                    <Badge className="bg-slate-100 text-slate-700">
                      <FileText className="mr-1 h-3 w-3" /> Attached
                    </Badge>
                  )}
                  {doc && (
                    <a
                      href={fileUrl(doc.fileId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      View
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Attach a document */}
        <AttachDocument
          requirementCodes={documentReqs.map((r) => ({ code: r.code, label: r.label, required: r.required }))}
          existingTypes={documents.map((d) => d.type)}
          onAttach={async (code, required, file) => {
            const fileId = await uploadSchoolFile(file, 'admission_doc', applicationId);
            await addDoc.mutateAsync({ type: code, fileId, required });
          }}
          attaching={addDoc.isPending}
        />

        {/* Verify / reject attached docs */}
        {documents.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Review attached</p>
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.type}</p>
                  {d.rejectionReason && <p className="text-xs text-rose-600">Rejected: {d.rejectionReason}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {d.verified ? (
                    <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="mr-1 h-3 w-3" /> Verified</Badge>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={verifyDoc.isPending}
                        onClick={async () => {
                          try {
                            await verifyDoc.mutateAsync({ verified: true });
                            notify.success('Document verified');
                          } catch (e: any) {
                            notify.error(e?.response?.data?.message ?? 'Verify failed');
                          }
                        }}
                      >
                        <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verify
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={verifyDoc.isPending}
                        onClick={async () => {
                          const reason = window.prompt('Reason for rejecting this document?');
                          if (reason === null) return;
                          try {
                            await verifyDoc.mutateAsync({ verified: false, rejectionReason: reason || 'Rejected by reviewer' });
                            notify.success('Document rejected');
                          } catch (e: any) {
                            notify.error(e?.response?.data?.message ?? 'Reject failed');
                          }
                        }}
                      >
                        <ShieldAlert className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttachDocument({
  requirementCodes,
  existingTypes,
  onAttach,
  attaching,
}: {
  requirementCodes: { code: string; label: string; required?: boolean }[];
  existingTypes: string[];
  onAttach: (code: string, required: boolean, file: File) => Promise<void>;
  attaching: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // Default the select to the first missing requirement (if any).
  const missing = requirementCodes.filter((r) => !existingTypes.includes(r.code));
  const effectiveCode = code || missing[0]?.code || requirementCodes[0]?.code || '';

  const submit = async () => {
    if (!effectiveCode) { notify.error('Choose a document type'); return; }
    if (!file) { notify.error('Choose a file to upload'); return; }
    const req = requirementCodes.find((r) => r.code === effectiveCode);
    try {
      await onAttach(effectiveCode, !!req?.required, file);
      notify.success(`Attached ${req?.label ?? effectiveCode}`);
      setFile(null);
      setCode('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Upload failed');
    }
  };

  return (
    <div className="mt-4 space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">Attach a document</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs">Type</label>
          <select
            className="rounded-md border bg-card px-2 py-2 text-sm"
            value={effectiveCode}
            onChange={(e) => setCode(e.target.value)}
          >
            <option value="">— select —</option>
            {requirementCodes.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}{existingTypes.includes(r.code) ? ' (already attached)' : ''}{r.required ? ' *' : ''}
              </option>
            ))}
            {requirementCodes.length === 0 && <option value="">no requirements</option>}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs">File</label>
          <input ref={fileRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
        </div>
        <Button onClick={submit} disabled={attaching || !effectiveCode || !file}>
          <Upload className="mr-1 h-3.5 w-3.5" /> {attaching ? 'Uploading…' : 'Attach'}
        </Button>
      </div>
    </div>
  );
}
