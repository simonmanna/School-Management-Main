import { useState } from 'react';
import { Plus, FileBadge, ShieldX, Globe, GraduationCap, Printer, LogOut } from 'lucide-react';
import {
  useStudents,
  useTranscript, useBuildTranscript,
  useExternalResults, useRecordExternalResult,
  useCertificates, useIssueCertificate, useRevokeCertificate,
  useIssueLeavingCertificate, downloadCertificatePdf,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { ConfirmButton } from './_components/confirm-button';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolCertificationPage() {
  const { data: students } = useStudents({ pageSize: 100 });
  const [studentId, setStudentId] = useState('');

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Certificates &amp; Transcripts</h1>
        <p className="text-sm text-muted-foreground">Transcripts, UNEB results, and issued certificates that anyone can verify by serial number.</p>
      </div>
      <div className="min-w-80 space-y-1">
        <Label className="text-xs">Student</Label>
        <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Select…</option>{(students?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
        </select>
      </div>
      {studentId && (
        <Tabs defaultValue="transcript">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="external">UNEB results</TabsTrigger>
            <TabsTrigger value="certs">Certificates</TabsTrigger>
            <TabsTrigger value="verify">Check a certificate</TabsTrigger>
          </TabsList>
          <TabsContent value="transcript" className="pt-4"><TranscriptTab studentId={studentId} /></TabsContent>
          <TabsContent value="external" className="pt-4"><ExternalTab studentId={studentId} /></TabsContent>
          <TabsContent value="certs" className="pt-4"><CertsTab studentId={studentId} /></TabsContent>
          <TabsContent value="verify" className="pt-4"><VerifyTab studentId={studentId} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function TranscriptTab({ studentId }: { studentId: string }) {
  const { data: t } = useTranscript(studentId);
  const build = useBuildTranscript();
  const canBuild = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.issueCertificates));
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cumulative transcript</CardTitle>
        {canBuild && (
          <Button
            size="sm"
            disabled={build.isPending}
            onClick={async () => {
              try { await build.mutateAsync(studentId); notify.success('Transcript built'); }
              catch (e: any) { notify.error('Could not build the transcript', { description: e?.response?.data?.message ?? 'Results must be released before a transcript can be built.' }); }
            }}
          >
            <GraduationCap className="h-4 w-4" /> Build / refresh
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {t ? <div className="text-sm">GPA (cumulative): <span className="font-semibold">{t.cumulativeGpa != null ? Number(t.cumulativeGpa) : '—'}</span> · built {new Date(t.builtAt).toLocaleDateString()}</div>
          : <p className="text-sm text-muted-foreground">No transcript yet. Release this pupil's term results (Results &amp; Reports › Term Results), then build it here.</p>}
      </CardContent>
    </Card>
  );
}

function ExternalTab({ studentId }: { studentId: string }) {
  const { data: ext } = useExternalResults(studentId);
  const record = useRecordExternalResult();
  const [level, setLevel] = useState('UCE');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [agg, setAgg] = useState('');
  const [subs, setSubs] = useState<Array<{ subject: string; grade: string }>>([{ subject: '', grade: '' }]);
  const canRecord = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.manageExams));
  const setSub = (i: number, k: 'subject' | 'grade', v: string) => setSubs((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const filled = subs.filter((r) => r.subject.trim() && r.grade.trim());
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">UNEB external exam results</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {(ext ?? []).map((e) => (
          <div key={e.id} className="rounded border p-2 text-sm">{e.level} {e.year} {e.division && <Badge>Division {e.division}</Badge>} {e.aggregate != null && <span className="text-muted-foreground">aggregate {e.aggregate}</span>} {e.verified ? <Badge variant="default">Verified</Badge> : <Badge variant="secondary">Not yet verified</Badge>}</div>
        ))}
        {(ext ?? []).length === 0 && <p className="text-sm text-muted-foreground">No UNEB results recorded for this pupil.</p>}
        {canRecord && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Record a UNEB result</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Level" className={sel + ' w-28'} value={level} onChange={(e) => setLevel(e.target.value)}><option>PLE</option><option>UCE</option><option>UACE</option></select>
              <Input aria-label="Year" type="number" placeholder="Year" className="w-24" value={year} onChange={(e) => setYear(e.target.value)} />
              <Input aria-label="Aggregate" placeholder="Aggregate" className="w-28" value={agg} onChange={(e) => setAgg(e.target.value)} />
            </div>
            <div className="space-y-1">
              {subs.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={`Subject ${i + 1}`} placeholder="Subject" value={r.subject} onChange={(e) => setSub(i, 'subject', e.target.value)} />
                  <Input aria-label={`Grade ${i + 1}`} placeholder="Grade" className="w-24" value={r.grade} onChange={(e) => setSub(i, 'grade', e.target.value)} />
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setSubs((rows) => [...rows, { subject: '', grade: '' }])}><Plus className="h-4 w-4" /> Add subject</Button>
            </div>
            <Button
              size="sm"
              disabled={record.isPending || filled.length === 0}
              onClick={async () => {
                try {
                  await record.mutateAsync({ studentProfileId: studentId, level, year: Number(year), aggregate: agg ? Number(agg) : undefined, subjects: filled });
                  setSubs([{ subject: '', grade: '' }]); setAgg('');
                  notify.success('UNEB result recorded');
                } catch (e: any) {
                  notify.error('Could not record the result', { description: e?.response?.data?.message ?? 'Try again.' });
                }
              }}
            >
              <Plus className="h-4 w-4" /> Record UNEB result
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CertsTab({ studentId }: { studentId: string }) {
  const { data: certs } = useCertificates(studentId);
  const issue = useIssueCertificate();
  const revoke = useRevokeCertificate();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('completion');
  const has = useAuthStore((s) => s.hasPermission);
  const canIssue = has(PERMISSIONS.school.issueCertificates);
  const canRevoke = has(PERMISSIONS.school.revokeCertificates);
  const doRevoke = async (id: string, reason: string, isVoid: boolean) => {
    try {
      await revoke.mutateAsync({ id, studentProfileId: studentId, reason, void: isVoid });
      notify.success(isVoid ? 'Certificate voided' : 'Certificate revoked', { description: 'A verification check will now report it as no longer valid.' });
    } catch (e: any) {
      notify.error('Could not change this certificate', { description: e?.response?.data?.message ?? 'Try again.' });
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Certificates</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {(certs ?? []).map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <div>
              <div>{c.title} <Badge>{CERT_TYPE[c.type] ?? c.type}</Badge></div>
              <div className="text-xs text-muted-foreground">Serial {c.serialNumber ?? '—'} · check code <span className="font-mono">{c.verificationCode ?? '—'}</span> · {CERT_STATUS[c.status] ?? c.status}</div>
            </div>
            <div className="flex gap-1">
              {canIssue && <Button size="sm" variant="ghost" onClick={() => printCertificate(c.id)}><Printer className="h-4 w-4" /> Print</Button>}
            {c.status === 'issued' && canRevoke && (
              <>
                <ConfirmButton
                  variant="ghost" destructive disabled={revoke.isPending}
                  title={`Revoke “${c.title}”?`}
                  description="Revoking withdraws a certificate that was correctly issued but is no longer valid (for example, after misconduct). It stays on the record and verification will report it as revoked."
                  reasonLabel="Why is it being revoked?"
                  confirmLabel="Revoke"
                  onConfirm={(reason) => doRevoke(c.id, reason, false)}
                >
                  <ShieldX className="h-4 w-4" /> Revoke
                </ConfirmButton>
                <ConfirmButton
                  variant="ghost" destructive disabled={revoke.isPending}
                  title={`Void “${c.title}”?`}
                  description="Voiding cancels a certificate issued in error (wrong pupil, wrong details). It stays on the record and verification will report it as void."
                  reasonLabel="What was wrong with it?"
                  confirmLabel="Void"
                  onConfirm={(reason) => doRevoke(c.id, reason, true)}
                >
                  Void
                </ConfirmButton>
              </>
            )}
            </div>
          </div>
        ))}
        {(certs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No certificates issued to this pupil yet.</p>}
        {canIssue && (
          <>
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Issue a certificate</p>
              <Input placeholder="Certificate title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <select aria-label="Certificate type" className={sel + ' w-44'} value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(CERT_TYPE).filter(([t]) => t !== 'leaving').map(([t, label]) => <option key={t} value={t}>{label}</option>)}
              </select>
              <Button
                size="sm"
                disabled={!title || issue.isPending}
                onClick={async () => {
                  try { await issue.mutateAsync({ studentProfileId: studentId, type, title }); setTitle(''); notify.success('Certificate issued'); }
                  catch (e: any) { notify.error('Could not issue the certificate', { description: e?.response?.data?.message ?? 'Try again.' }); }
                }}
              >
                <FileBadge className="h-4 w-4" /> Issue certificate
              </Button>
            </div>
            <LeavingCertificateForm studentId={studentId} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

async function printCertificate(id: string) {
  try {
    const url = URL.createObjectURL(await downloadCertificatePdf(id));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    notify.error('Could not produce the certificate PDF');
  }
}

/**
 * Wave 16: the leaving (transfer) certificate. Identity, dates, last class and
 * fee position come from the record; the office adds only the judgement calls.
 */
function LeavingCertificateForm({ studentId }: { studentId: string }) {
  const issue = useIssueLeavingCertificate();
  const [f, setF] = useState({ reasonForLeaving: '', leavingDate: '', conduct: '', destinationSchool: '', remarks: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      const cert = await issue.mutateAsync({
        studentProfileId: studentId,
        reasonForLeaving: f.reasonForLeaving,
        leavingDate: f.leavingDate || undefined,
        conduct: f.conduct || undefined,
        destinationSchool: f.destinationSchool || undefined,
        remarks: f.remarks || undefined,
      });
      notify.success(`Leaving certificate ${cert.serialNumber ?? ''} issued`);
      setF({ reasonForLeaving: '', leavingDate: '', conduct: '', destinationSchool: '', remarks: '' });
      printCertificate(cert.id);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not issue the leaving certificate');
    }
  };
  return (
    <div className="mt-4 space-y-2 rounded border p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><LogOut className="h-4 w-4" /> Leaving / transfer certificate</div>
      <p className="text-xs text-muted-foreground">Record the pupil as withdrawn, transferred or graduated first. Name, dates, last class and fee clearance are taken from the record.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label className="text-xs">Reason for leaving *</Label><Input value={f.reasonForLeaving} onChange={set('reasonForLeaving')} /></div>
        <div className="space-y-1"><Label className="text-xs">Date of leaving (default: date recorded)</Label><Input type="date" value={f.leavingDate} onChange={set('leavingDate')} /></div>
        <div className="space-y-1"><Label className="text-xs">Conduct</Label><Input value={f.conduct} onChange={set('conduct')} placeholder="e.g. Very good" /></div>
        <div className="space-y-1"><Label className="text-xs">School joining</Label><Input value={f.destinationSchool} onChange={set('destinationSchool')} /></div>
      </div>
      <div className="space-y-1"><Label className="text-xs">Remarks</Label><Input value={f.remarks} onChange={set('remarks')} /></div>
      <Button size="sm" disabled={!f.reasonForLeaving || issue.isPending} onClick={submit}><FileBadge className="h-4 w-4" /> Issue &amp; print</Button>
    </div>
  );
}

function VerifyTab({ studentId }: { studentId: string }) {
  const { data: certs } = useCertificates(studentId);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const verify = async (c: string) => {
    setLoading(true); setResult(null);
    try {
      const res = await (await import('@/lib/api')).api.get(`/verify/certificate/${c}`);
      setResult(res.data);
    } catch { setResult({ error: 'No record — invalid or revoked code' }); }
    finally { setLoading(false); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> Public verification</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Anyone holding a certificate's check code can confirm it is genuine. Only the holder's name, the certificate type and its status are shown.</p>
        <div className="flex gap-2">
          <Input placeholder="Check code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button size="sm" disabled={!code || loading} onClick={() => verify(code)}>Verify</Button>
        </div>
        {result && (result.error || !result.holderName ? (
          <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm">No certificate matches this code.</p>
        ) : (
          <div className={`rounded border p-2 text-sm ${result.valid ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
            <p className="font-medium">{result.valid ? 'Genuine and valid' : `Genuine, but ${CERT_STATUS[result.status] ?? result.status}`}</p>
            <p className="text-xs text-muted-foreground">
              {result.holderName} · {CERT_TYPE[result.type] ?? result.type} · serial {result.serialNumber ?? '—'}
              {result.issuedAt ? ` · issued ${new Date(result.issuedAt).toLocaleDateString()}` : ''}
            </p>
          </div>
        ))}
        {(certs ?? []).filter((c) => c.verificationCode).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(certs ?? []).filter((c) => c.verificationCode).map((c) => <Button key={c.id} size="sm" variant="outline" onClick={() => { setCode(c.verificationCode!); verify(c.verificationCode!); }}>Check {c.title}</Button>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CERT_TYPE: Record<string, string> = {
  completion: 'Completion',
  testimonial: 'Testimonial',
  merit: 'Merit',
  award: 'Award',
  leaving: 'Leaving / transfer',
};

const CERT_STATUS: Record<string, string> = {
  issued: 'Valid',
  revoked: 'revoked',
  void: 'void',
  superseded: 'replaced',
};
