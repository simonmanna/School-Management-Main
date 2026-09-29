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

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolCertificationPage() {
  const { data: students } = useStudents({ pageSize: 100 });
  const [studentId, setStudentId] = useState('');

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Certification & Credentials</h1>
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
            <TabsTrigger value="verify">Public verify</TabsTrigger>
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
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cumulative transcript</CardTitle>
        <Button size="sm" disabled={build.isPending} onClick={async () => { await build.mutateAsync(studentId); notify.success('Transcript built'); }}> <GraduationCap className="h-4 w-4" /> Build / refresh</Button>
      </CardHeader>
      <CardContent>
        {t ? <div className="text-sm">GPA (cumulative): <span className="font-semibold">{t.cumulativeGpa != null ? Number(t.cumulativeGpa) : '—'}</span> · built {new Date(t.builtAt).toLocaleDateString()}</div>
          : <p className="text-sm text-muted-foreground">No transcript yet — publish a result set first, then build.</p>}
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
  const [subs, setSubs] = useState('[ { "subject": "Math", "grade": "1" }, { "subject": "English", "grade": "2" } ]');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">UNEB external exam results</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {(ext ?? []).map((e) => (
          <div key={e.id} className="rounded border p-2 text-sm">{e.level} {e.year} {e.division && <Badge>div {e.division}</Badge>} {e.aggregate != null && <span className="text-muted-foreground">agg {e.aggregate}</span>} {e.verified ? <Badge variant="default">verified</Badge> : <Badge variant="secondary">unverified</Badge>}</div>
        ))}
        <div className="flex gap-2">
          <select className={sel + ' w-28'} value={level} onChange={(e) => setLevel(e.target.value)}><option>PLE</option><option>UCE</option><option>UACE</option></select>
          <Input type="number" placeholder="year" className="w-24" value={year} onChange={(e) => setYear(e.target.value)} />
          <Input placeholder="aggregate" className="w-24" value={agg} onChange={(e) => setAgg(e.target.value)} />
        </div>
        <textarea className={sel + ' h-20 font-mono text-xs'} value={subs} onChange={(e) => setSubs(e.target.value)} />
        <Button size="sm" disabled={record.isPending} onClick={async () => { try { const subjects = JSON.parse(subs); await record.mutateAsync({ studentProfileId: studentId, level, year: Number(year), aggregate: agg?Number(agg):undefined, subjects }); notify.success('Recorded'); } catch { notify.error('Subjects JSON invalid'); } }}><Plus className="h-4 w-4" /> Record UNEB result</Button>
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
  const [reason] = useState('');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Certificates</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {(certs ?? []).map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <div>
              <div>{c.title} <Badge>{c.type}</Badge></div>
              <div className="text-xs text-muted-foreground">serial {c.serialNumber ?? '—'} · code <span className="font-mono">{c.verificationCode ?? '—'}</span> · {c.status}</div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => printCertificate(c.id)}><Printer className="h-4 w-4" /> Print</Button>
            {c.status === 'issued' && (
              <>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: c.id, studentProfileId: studentId, reason: reason || 'error', void: false })}><ShieldX className="h-4 w-4" /> Revoke</Button>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: c.id, studentProfileId: studentId, reason: reason || 'error', void: true })}>Void</Button>
              </>
            )}
            </div>
          </div>
        ))}
        <Input placeholder="Certificate title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className={sel + ' w-44'} value={type} onChange={(e) => setType(e.target.value)}>
          {['completion','testimonial','merit','award'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size="sm" disabled={!title || issue.isPending} onClick={async () => { await issue.mutateAsync({ studentProfileId: studentId, type, title }); setTitle(''); notify.success('Issued'); }}><FileBadge className="h-4 w-4" /> Issue certificate</Button>
        <LeavingCertificateForm studentId={studentId} />
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
        <p className="text-xs text-muted-foreground">Anyone can verify a code — only holder name, type and status are returned (no tenant data).</p>
        <div className="flex gap-2">
          <Input placeholder="certificate code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button size="sm" disabled={!code || loading} onClick={() => verify(code)}>Verify</Button>
        </div>
        {result && (
          <pre className="rounded bg-muted p-2 text-xs">{JSON.stringify(result, null, 2)}</pre>
        )}
        {(certs ?? []).filter((c) => c.verificationCode).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(certs ?? []).filter((c) => c.verificationCode).map((c) => <Button key={c.id} size="sm" variant="outline" onClick={() => { setCode(c.verificationCode!); verify(c.verificationCode!); }}>verify {c.verificationCode!.slice(0,9)}…</Button>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
