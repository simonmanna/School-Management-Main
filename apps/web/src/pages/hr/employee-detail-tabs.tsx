import { useRef, useState } from 'react';
import { Plus, Trash2, Pencil, ShieldCheck, Upload, Download, FileText } from 'lucide-react';
import {
  useHrSkills,
  useHrEmployeeSkills,
  useAddHrEmployeeSkill,
  useUpdateHrEmployeeSkill,
  useVerifyHrEmployeeSkill,
  useRemoveHrEmployeeSkill,
  useHrExperience,
  useAddHrExperience,
  useUpdateHrExperience,
  useRemoveHrExperience,
  useHrDocuments,
  useUploadHrDocument,
  useVerifyHrDocument,
  useDeleteHrDocument,
  fetchHrDocumentDownloadUrl,
  useHrQualifications,
  useCreateHrQualification,
  useUpdateHrQualification,
  useDeleteHrQualification,
  useHrCertifications,
  useCreateHrCertification,
  useUpdateHrCertification,
  useDeleteHrCertification,
} from '@/features/hr/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';

const PROFICIENCY = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
const DOC_CATEGORIES = ['cv', 'id', 'contract', 'certificate', 'reference', 'medical', 'other'] as const;
const QUAL_TYPES = ['degree', 'diploma', 'certificate', 'teaching_qual', 'license', 'professional', 'other'] as const;

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const err = (e: any) => notify.error(e?.response?.data?.message ?? 'Something went wrong');

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      {action}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

// ── Skills tab ────────────────────────────────────────────────────────────────

export function SkillsTab({ employeeId }: { employeeId: string }) {
  const { data: links = [] } = useHrEmployeeSkills(employeeId);
  const { data: catalogue } = useHrSkills();
  const add = useAddHrEmployeeSkill();
  const update = useUpdateHrEmployeeSkill();
  const verify = useVerifyHrEmployeeSkill();
  const remove = useRemoveHrEmployeeSkill();
  const [open, setOpen] = useState(false);
  const [skillId, setSkillId] = useState('');
  const [proficiency, setProficiency] = useState<(typeof PROFICIENCY)[number]>('intermediate');
  const [years, setYears] = useState('');

  const skills = catalogue?.rows ?? [];
  const held = new Set(links.map((l: any) => l.skillId));
  const available = skills.filter((s: any) => !held.has(s.id));

  const submit = () => {
    if (!skillId) return;
    add.mutate(
      { employeeId, skillId, proficiency, yearsExperience: years ? Number(years) : undefined },
      { onSuccess: () => { setOpen(false); setSkillId(''); setYears(''); notify.success('Skill added'); }, onError: err },
    );
  };

  return (
    <div className="space-y-3">
      <SectionHeader
        title="Skills"
        action={<Button size="sm" onClick={() => setOpen(true)} disabled={available.length === 0}><Plus className="mr-1 h-4 w-4" />Add skill</Button>}
      />
      {links.length === 0 ? (
        <Empty text="No skills recorded yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Skill</TableHead><TableHead>Proficiency</TableHead><TableHead>Years</TableHead>
              <TableHead>Verified</TableHead><TableHead className="w-[1%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.skill?.name ?? l.skillId}{l.skill?.category ? <span className="ml-1 text-xs text-muted-foreground">· {l.skill.category}</span> : null}</TableCell>
                <TableCell>
                  <select
                    className="rounded border bg-background px-2 py-1 text-sm"
                    value={l.proficiency}
                    onChange={(e) => update.mutate({ id: l.id, dto: { proficiency: e.target.value } }, { onError: err })}
                  >
                    {PROFICIENCY.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </TableCell>
                <TableCell>{l.yearsExperience ?? '—'}</TableCell>
                <TableCell>
                  {l.verified
                    ? <Badge variant="outline" className="bg-emerald-100 text-emerald-800">Verified</Badge>
                    : <Button size="sm" variant="ghost" onClick={() => verify.mutate({ id: l.id, verified: true }, { onError: err })}><ShieldCheck className="h-4 w-4" /></Button>}
                </TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id, { onError: err })}><Trash2 className="h-4 w-4 text-rose-600" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add skill</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Skill</Label>
              <select className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                <option value="">Select a skill…</option>
                {available.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Proficiency</Label>
              <select className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm" value={proficiency} onChange={(e) => setProficiency(e.target.value as any)}>
                {PROFICIENCY.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <Label>Years of experience</Label>
              <Input type="number" min="0" value={years} onChange={(e) => setYears(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!skillId || add.isPending}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Experience tab ──────────────────────────────────────────────────────────

const emptyXp = { employer: '', title: '', startDate: '', endDate: '', description: '', referenceName: '', referenceContact: '' };

export function ExperienceTab({ employeeId }: { employeeId: string }) {
  const { data: rows = [] } = useHrExperience(employeeId);
  const add = useAddHrExperience();
  const update = useUpdateHrExperience();
  const remove = useRemoveHrExperience();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyXp);

  const openNew = () => { setEditId(null); setForm(emptyXp); setOpen(true); };
  const openEdit = (r: any) => {
    setEditId(r.id);
    setForm({ ...emptyXp, ...r, startDate: r.startDate?.slice(0, 10) ?? '', endDate: r.endDate?.slice(0, 10) ?? '' });
    setOpen(true);
  };
  const submit = () => {
    if (!form.employer) return;
    const dto = { ...form, employeeId };
    const opts = { onSuccess: () => { setOpen(false); notify.success('Saved'); }, onError: err };
    if (editId) update.mutate({ id: editId, dto }, opts);
    else add.mutate(dto, opts);
  };

  return (
    <div className="space-y-3">
      <SectionHeader title="Work experience" action={<Button size="sm" onClick={openNew}><Plus className="mr-1 h-4 w-4" />Add</Button>} />
      {rows.length === 0 ? (
        <Empty text="No prior employment recorded." />
      ) : (
        <div className="space-y-2">
          {rows.map((r: any) => (
            <div key={r.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{r.title ? `${r.title} · ` : ''}{r.employer}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : 'present'}</div>
                  {r.description && <p className="mt-1 text-sm">{r.description}</p>}
                  {r.referenceName && <p className="mt-1 text-xs text-muted-foreground">Ref: {r.referenceName}{r.referenceContact ? ` (${r.referenceContact})` : ''}</p>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id, { onError: err })}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit experience' : 'Add experience'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Employer *</Label><Input value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} /></div>
            <div className="col-span-2"><Label>Job title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Start</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><Label>End</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            <div className="col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>Reference name</Label><Input value={form.referenceName} onChange={(e) => setForm({ ...form, referenceName: e.target.value })} /></div>
            <div><Label>Reference contact</Label><Input value={form.referenceContact} onChange={(e) => setForm({ ...form, referenceContact: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.employer}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Documents tab ───────────────────────────────────────────────────────────

export function DocumentsTab({ employeeId }: { employeeId: string }) {
  const { data: rows = [] } = useHrDocuments(employeeId);
  const upload = useUploadHrDocument();
  const verify = useVerifyHrDocument();
  const del = useDeleteHrDocument();
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<any>({ category: 'cv', title: '', expiresAt: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { notify.error('Choose a file'); return; }
    upload.mutate(
      { file, meta: { employeeId, ...meta } },
      { onSuccess: () => { setOpen(false); setMeta({ category: 'cv', title: '', expiresAt: '' }); notify.success('Uploaded'); }, onError: err },
    );
  };
  const download = async (id: string) => {
    try { window.open(await fetchHrDocumentDownloadUrl(id), '_blank'); } catch (e) { err(e); }
  };

  return (
    <div className="space-y-3">
      <SectionHeader title="Documents" action={<Button size="sm" onClick={() => setOpen(true)}><Upload className="mr-1 h-4 w-4" />Upload</Button>} />
      {rows.length === 0 ? (
        <Empty text="No documents uploaded (CV, ID, contract copies…)." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>File</TableHead><TableHead>Expires</TableHead><TableHead>Verified</TableHead><TableHead className="w-[1%]" /></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d: any) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium"><FileText className="mr-1 inline h-4 w-4 text-muted-foreground" />{d.title}</TableCell>
                <TableCell><Badge variant="outline">{d.category}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.file?.filename}</TableCell>
                <TableCell className="text-sm">{fmtDate(d.expiresAt)}</TableCell>
                <TableCell>{d.verified ? <Badge variant="outline" className="bg-emerald-100 text-emerald-800">Verified</Badge> : <Button size="sm" variant="ghost" onClick={() => verify.mutate({ id: d.id, verified: true }, { onError: err })}><ShieldCheck className="h-4 w-4" /></Button>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => download(d.id)}><Download className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(d.id, { onError: err })}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>File *</Label><Input ref={fileRef} type="file" /></div>
            <div><Label>Title</Label><Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Defaults to the file name" /></div>
            <div>
              <Label>Category</Label>
              <select className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })}>
                {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><Label>Expires (optional)</Label><Input type="date" value={meta.expiresAt} onChange={(e) => setMeta({ ...meta, expiresAt: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={upload.isPending}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Qualifications tab ──────────────────────────────────────────────────────

const emptyQual = { type: 'degree', title: '', institution: '', graduatedAt: '', certificateNumber: '' };

export function QualificationsTab({ employeeId }: { employeeId: string }) {
  const { data } = useHrQualifications({ employeeId });
  const create = useCreateHrQualification();
  const update = useUpdateHrQualification();
  const remove = useDeleteHrQualification();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyQual);
  const rows = data?.rows ?? [];

  const openNew = () => { setEditId(null); setForm(emptyQual); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ ...emptyQual, ...r, graduatedAt: r.graduatedAt?.slice(0, 10) ?? '' }); setOpen(true); };
  const submit = () => {
    if (!form.title) return;
    const opts = { onSuccess: () => { setOpen(false); notify.success('Saved'); }, onError: err };
    if (editId) update.mutate({ id: editId, dto: form }, opts);
    else create.mutate({ ...form, employeeId }, opts);
  };

  return (
    <div className="space-y-3">
      <SectionHeader title="Qualifications" action={<Button size="sm" onClick={openNew}><Plus className="mr-1 h-4 w-4" />Add</Button>} />
      {rows.length === 0 ? <Empty text="No qualifications recorded." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Institution</TableHead><TableHead>Graduated</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                <TableCell>{r.institution ?? '—'}</TableCell>
                <TableCell>{fmtDate(r.graduatedAt)}</TableCell>
                <TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id, { onError: err })}><Trash2 className="h-4 w-4 text-rose-600" /></Button></div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit qualification' : 'Add qualification'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div>
              <Label>Type</Label>
              <select className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {QUAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><Label>Institution</Label><Input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></div>
            <div><Label>Graduated</Label><Input type="date" value={form.graduatedAt} onChange={(e) => setForm({ ...form, graduatedAt: e.target.value })} /></div>
            <div><Label>Certificate number</Label><Input value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.title}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Certifications tab ──────────────────────────────────────────────────────

const emptyCert = { name: '', issuer: '', issuedAt: '', expiryDate: '' };

export function CertificationsTab({ employeeId }: { employeeId: string }) {
  const { data } = useHrCertifications({ employeeId });
  const create = useCreateHrCertification();
  const update = useUpdateHrCertification();
  const remove = useDeleteHrCertification();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyCert);
  const rows = data?.rows ?? [];

  const openNew = () => { setEditId(null); setForm(emptyCert); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ ...emptyCert, ...r, issuedAt: r.issuedAt?.slice(0, 10) ?? '', expiryDate: r.expiryDate?.slice(0, 10) ?? '' }); setOpen(true); };
  const submit = () => {
    if (!form.name) return;
    const opts = { onSuccess: () => { setOpen(false); notify.success('Saved'); }, onError: err };
    if (editId) update.mutate({ id: editId, dto: form }, opts);
    else create.mutate({ ...form, employeeId }, opts);
  };

  return (
    <div className="space-y-3">
      <SectionHeader title="Certifications" action={<Button size="sm" onClick={openNew}><Plus className="mr-1 h-4 w-4" />Add</Button>} />
      {rows.length === 0 ? <Empty text="No certifications recorded." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Issuer</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.issuer ?? '—'}</TableCell>
                <TableCell>{fmtDate(r.expiryDate)}</TableCell>
                <TableCell><Badge variant="outline" className={r.status === 'expired' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}>{r.status}</Badge></TableCell>
                <TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id, { onError: err })}><Trash2 className="h-4 w-4 text-rose-600" /></Button></div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit certification' : 'Add certification'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Issuer</Label><Input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} /></div>
            <div><Label>Issued</Label><Input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} /></div>
            <div><Label>Expires</Label><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
