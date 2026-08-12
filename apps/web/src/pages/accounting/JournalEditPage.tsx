import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ArrowLeft, Save, BookText, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import {
  useCreateJournal, useDeleteJournal, useJournal, useJournals, useUpdateJournal,
  useAccounts,
} from '@/features/accounting/api';

const JOURNAL_TYPES = [
  'general', 'sales', 'purchase', 'cash', 'bank', 'adjustment', 'opening', 'closing',
] as const;

export function JournalEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const { data: listData } = useJournals();
  const existingJournal = !isNew ? listData?.data?.find((j) => j.id === id) : null;
  const { data: journalDetail } = useJournal(id);

  const createJournal = useCreateJournal();
  const updateJournal = useUpdateJournal();
  const deleteJournal = useDeleteJournal();
  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.data ?? [];
  const activeAccounts = accounts.filter((a) => a.isActive !== false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [journalType, setJournalType] = useState('general');
  const [defaultDebitAccountId, setDefaultDebitAccountId] = useState('');
  const [defaultCreditAccountId, setDefaultCreditAccountId] = useState('');
  const [sequencePrefix, setSequencePrefix] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Load existing journal data for edit mode
  useEffect(() => {
    if (!isNew && journalDetail) {
      setCode(journalDetail.code ?? '');
      setName(journalDetail.name ?? '');
      setJournalType(journalDetail.journalType ?? 'general');
      setDefaultDebitAccountId(journalDetail.defaultDebitAccountId ?? '');
      setDefaultCreditAccountId(journalDetail.defaultCreditAccountId ?? '');
      setSequencePrefix(journalDetail.sequencePrefix ?? '');
      setIsActive(journalDetail.isActive ?? true);
    }
  }, [isNew, journalDetail]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!code.trim()) e.code = 'Code is required';
    if (!name.trim()) e.name = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        journalType,
        defaultDebitAccountId: defaultDebitAccountId || undefined,
        defaultCreditAccountId: defaultCreditAccountId || undefined,
        sequencePrefix: sequencePrefix.trim() || undefined,
        isActive,
      };
      if (isNew) {
        await createJournal.mutateAsync(payload);
        notify.success('Journal created');
      } else {
        await updateJournal.mutateAsync({ id: id!, ...payload });
        notify.success('Journal updated');
      }
      navigate('/journals');
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteJournal.mutateAsync(id);
      notify.success('Journal deleted');
      navigate('/journals');
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Delete failed');
    } finally {
      setDeleteConfirm(false);
    }
  };

  if (!isNew && !journalDetail && !existingJournal) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const title = isNew ? 'New Journal' : journalDetail?.name ?? 'Edit Journal';
  const subtitle = isNew
    ? 'Create a new book of original entry'
    : 'Configure journal settings';

  const accountSelectOptions = activeAccounts.map((a) => (
    <SelectItem key={a.id} value={a.id}>
      <span className="font-mono">{a.code}</span> — {a.name}
    </SelectItem>
  ));

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="px-6 py-4 border-b bg-white shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <button onClick={() => navigate('/journals')} className="hover:text-primary transition-colors font-medium">Journals</button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold">{isNew ? 'New Journal' : journalDetail?.name}</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/journals')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0"><BookText className="h-5 w-5 text-primary" /></div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{title}</h1>
                {!isNew && (
                  <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
                    {isActive ? 'Active' : 'Inactive'}
                  </Badge>
                )}
                {!isNew && journalDetail?.code && (
                  <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground font-semibold">{journalDetail.code}</code>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!isNew && (
              <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate('/journals')}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save Journal'}
            </Button>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Journal Information</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="code" className="text-sm font-medium">Code *</Label>
                  <Input
                    id="code"
                    placeholder="e.g. SJ, PJ, GEN"
                    value={code}
                    onChange={(e) => { setCode(e.target.value); if (errors.code) setErrors((prev) => ({ ...prev, code: '' })); }}
                  />
                  {errors.code && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{errors.code}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Type</Label>
                  <Select value={journalType} onValueChange={setJournalType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JOURNAL_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm font-medium">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g. Sales Journal"
                  value={name}
                  onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((prev) => ({ ...prev, name: '' })); }}
                />
                {errors.name && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" />{errors.name}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Default Accounts */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Default Accounts</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4 space-y-4">
              <p className="text-[11px] text-muted-foreground">
                Optional default accounts used when auto-posting entries to this journal.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Default Debit Account</Label>
                  <Select value={defaultDebitAccountId} onValueChange={setDefaultDebitAccountId}>
                    <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="">None</SelectItem>
                      {accountSelectOptions}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Default Credit Account</Label>
                  <Select value={defaultCreditAccountId} onValueChange={setDefaultCreditAccountId}>
                    <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="">None</SelectItem>
                      {accountSelectOptions}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sequencing */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Sequence &amp; Status</CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Sequence Prefix</Label>
                  <Input
                    placeholder="e.g. SJ- (auto-numbers: SJ-0001)"
                    value={sequencePrefix}
                    onChange={(e) => setSequencePrefix(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">Leave empty to use a system-generated number</p>
                </div>
                <div className="space-y-1.5 flex flex-col justify-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer pt-6">
                    <input type="checkbox" className="rounded" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    Active — entries can be posted to this journal
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bottom actions */}
          <div className="flex items-center justify-between pb-8">
            <Button type="button" variant="outline" onClick={() => navigate('/journals')}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save Journal'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Journal?</AlertDialogTitle>
            <AlertDialogDescription>
              {journalDetail?.name} ({journalDetail?.code}) will be permanently deleted. This action cannot be undone.
              {journalDetail?._count?.entries && journalDetail._count.entries > 0 && (
                <span className="block mt-2 text-amber-600 font-semibold">
                  This journal has {journalDetail._count.entries} entries. Delete all entries first or deactivate the journal instead.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
