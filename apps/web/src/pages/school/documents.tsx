import { useRef, useState } from 'react';
import {
  FileText, Upload, ShieldCheck, ShieldAlert, PenLine, History, Trash2, Eye,
  BadgeCheck, Clock, Lock, AlertTriangle,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { notify } from '@/lib/notify';
import {
  useSchoolDocs, useCreateSchoolDoc, useVerifySchoolDoc, useSignSchoolDoc,
  useDeleteSchoolDoc, useSchoolDocVersions,
  uploadSchoolFile, openStoredFile, type SchoolDocRow,
} from '@/features/school/api';

const CATEGORIES = [
  { value: 'student_doc', label: 'Student document' },
  { value: 'staff_doc', label: 'Staff document' },
  { value: 'admission_doc', label: 'Admission document' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'report_card', label: 'Report card' },
  { value: 'contract', label: 'Contract' },
  { value: 'medical', label: 'Medical document' },
  { value: 'id_doc', label: 'ID document' },
  { value: 'other', label: 'Other' },
];
const OWNER_TYPES = [
  { value: 'student', label: 'Student' },
  { value: 'staff', label: 'Staff' },
  { value: 'admission', label: 'Admission' },
  { value: 'general', label: 'General' },
];

function isExpired(d?: string | null) {
  return !!d && new Date(d).getTime() < Date.now();
}
function expirySoon(d?: string | null, days = 30) {
  if (!d) return false;
  const t = new Date(d).getTime();
  if (t < Date.now()) return false;
  return t < Date.now() + days * 864e5;
}

export default function DocumentManagementPage() {
  const [category, setCategory] = useState<string>('');
  const [ownerType, setOwnerType] = useState<string>('');
  const [expiry, setExpiry] = useState<string>('');
  const [verified, setVerified] = useState<string>('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionsFor, setVersionsFor] = useState<SchoolDocRow | null>(null);

  const filters = {
    category: category || undefined,
    ownerType: ownerType || undefined,
    expiry: (expiry as any) || undefined,
    verified: verified === '' ? undefined : verified === 'true',
  };
  const { data: docs = [], isLoading } = useSchoolDocs(filters);
  const verifyMut = useVerifySchoolDoc();
  const signMut = useSignSchoolDoc();
  const delMut = useDeleteSchoolDoc();

  const expiredCount = docs.filter((d) => isExpired(d.expiresAt)).length;
  const expiringCount = docs.filter((d) => expirySoon(d.expiresAt) && !isExpired(d.expiresAt)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileText className="h-6 w-6" /> Document Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Student, staff &amp; admission documents — versions, signatures, expiry &amp; secure access.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Upload document
        </Button>
      </div>

      {(expiredCount > 0 || expiringCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {expiredCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {expiredCount} expired
            </Badge>
          )}
          {expiringCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3.5 w-3.5" /> {expiringCount} expiring soon
            </Badge>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-end gap-3 space-y-0">
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Owner type</Label>
            <Select value={ownerType} onValueChange={setOwnerType}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                {OWNER_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Expiry</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="expiring">Expiring (30d)</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Verification</Label>
            <Select value={verified} onValueChange={setVerified}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="true">Verified</SelectItem>
                <SelectItem value="false">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents match the filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => {
                  const cat = CATEGORIES.find((c) => c.value === d.category)?.label ?? d.category;
                  const own = OWNER_TYPES.find((o) => o.value === d.ownerType)?.label ?? d.ownerType;
                  const expired = isExpired(d.expiresAt);
                  const expiring = expirySoon(d.expiresAt) && !expired;
                  const secure = (d.accessRoles ?? []).length > 0;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          onClick={() => openStoredFile(d.fileId).catch((e: any) => notify.error(e?.response?.data?.message ?? 'Could not open the file'))}
                          className="hover:underline flex items-center gap-1 text-left"
                        >
                          <Eye className="h-3.5 w-3.5" /> {d.title}
                        </button>
                        {d.file?.filename && <div className="text-xs text-muted-foreground">{d.file.filename}</div>}
                      </TableCell>
                      <TableCell>{cat}</TableCell>
                      <TableCell className="text-muted-foreground">{d.type}</TableCell>
                      <TableCell>{own}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {d.verified ? <Badge variant="default" className="gap-1"><BadgeCheck className="h-3.5 w-3.5" /> Verified</Badge>
                            : <Badge variant="secondary">Pending</Badge>}
                          {d.signedAt && <Badge variant="outline" className="gap-1"><PenLine className="h-3.5 w-3.5" /> Signed</Badge>}
                          {expired && <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Expired</Badge>}
                          {expiring && <Badge variant="secondary" className="gap-1"><Clock className="h-3.5 w-3.5" /> Soon</Badge>}
                          <Badge variant="outline">v{d.version}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{d.expiresAt ? new Date(d.expiresAt).toLocaleDateString() : '—'}</TableCell>
                      <TableCell>
                        {secure ? <Badge variant="outline" className="gap-1"><Lock className="h-3.5 w-3.5" /> Restricted</Badge>
                          : <Badge variant="outline" className="gap-1 text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Org-wide</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Verify" onClick={() => verify(d)}>
                            <BadgeCheck className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Sign" onClick={() => sign(d)}>
                            <PenLine className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Version history" onClick={() => setVersionsFor(d)}>
                            <History className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Delete" onClick={() => del(d)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
      {versionsFor && <VersionsDialog doc={versionsFor} onClose={() => setVersionsFor(null)} />}
    </div>
  );

  function verify(d: SchoolDocRow) {
    const target = !d.verified;
    verifyMut.mutate({ id: d.id, verified: target });
  }
  function sign(d: SchoolDocRow) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const id = await uploadSchoolFile(f, 'school_doc_signature', d.id);
        signMut.mutate({ id: d.id, signatureFileId: id });
      } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Upload failed'); }
    };
    input.click();
  }
  function del(d: SchoolDocRow) {
    if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    delMut.mutate(d.id);
  }
}

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ownerType, setOwnerType] = useState('student');
  const [ownerId, setOwnerId] = useState('');
  const [category, setCategory] = useState('student_doc');
  const [type, setType] = useState('');
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [accessRoles, setAccessRoles] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useCreateSchoolDoc();

  async function submit() {
    if (!file) return notify.error('Choose a file');
    if (!title.trim()) return notify.error('Title required');
    try {
      const fileId = await uploadSchoolFile(file, 'school_doc', ownerId || 'school');
      const roles = accessRoles.split(',').map((r) => r.trim()).filter(Boolean);
      await create.mutateAsync({
        ownerType, ownerId: ownerId || 'school', category, type: type || category,
        title: title.trim(), fileId,
        expiresAt: expiresAt || undefined,
        accessRoles: roles,
        notes: notes || undefined,
      });
      notify.success('Saved');
      onClose();
      reset();
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
  }
  function reset() {
    setOwnerId(''); setType(''); setTitle(''); setExpiresAt(''); setNotes(''); setAccessRoles(''); setFile(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>Files are stored in the secure platform file service.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Owner type</Label>
              <Select value={ownerType} onValueChange={setOwnerType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OWNER_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Owner ID (student/staff/admission)</Label>
              <Input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. birth_cert" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Expiry date</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Secure access (comma-separated permission keys)</Label>
              <Input value={accessRoles} onChange={(e) => setAccessRoles(e.target.value)} placeholder="leave empty = org-wide" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> {file ? file.name : 'Choose file'}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>Save document</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({ doc, onClose }: { doc: SchoolDocRow; onClose: () => void }) {
  const { data: versions = [] } = useSchoolDocVersions(doc.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history — {doc.title}</DialogTitle>
          <DialogDescription>Immutable snapshots captured on every edit.</DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Change note</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground">No prior versions.</TableCell></TableRow>
            ) : versions.map((v) => (
              <TableRow key={v.id}>
                <TableCell>v{v.versionNo}</TableCell>
                <TableCell>{v.snapshot?.title ?? doc.title}</TableCell>
                <TableCell className="text-muted-foreground">{v.changeNote ?? '—'}</TableCell>
                <TableCell>{new Date(v.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
