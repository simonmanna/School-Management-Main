import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ArrowLeft, Edit, BookText, FileText, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { date } from '@/lib/format';
import { formatCurrency } from '@/lib/utils';
import { useJournal, useAccounts } from '@/features/accounting/api';
import { useJournalEntries, type JournalEntryRow } from '@/features/accounting/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  draft: 'secondary',
  reversed: 'destructive',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4">
      <dt className="w-36 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  general: 'General',
  sales: 'Sales',
  purchase: 'Purchase',
  cash: 'Cash',
  bank: 'Bank',
  adjustment: 'Adjustment',
  opening: 'Opening',
  closing: 'Closing',
};

const TYPE_COLORS: Record<string, string> = {
  general: 'bg-slate-100 text-slate-700',
  sales: 'bg-emerald-100 text-emerald-700',
  purchase: 'bg-blue-100 text-blue-700',
  cash: 'bg-amber-100 text-amber-700',
  bank: 'bg-purple-100 text-purple-700',
  adjustment: 'bg-red-100 text-red-700',
  opening: 'bg-indigo-100 text-indigo-700',
  closing: 'bg-rose-100 text-rose-700',
};

export function JournalDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: journal, isLoading } = useJournal(id);
  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.data ?? [];
  const [activeTab, setActiveTab] = useState('entries');
  const [entriesPage] = useState(1);
  const { data: entriesData } = useJournalEntries({ page: entriesPage, pageSize: 15 });

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const journalEntries = (entriesData?.data ?? []).filter((e: JournalEntryRow) => e.journalId === id || e.journal?.code === journal?.code);

  const getAccountLabel = (accountId: string | null | undefined): string => {
    if (!accountId) return '—';
    const a = accountMap.get(accountId);
    return a ? `${a.code} — ${a.name}` : accountId;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!journal) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <BookText className="h-12 w-12 opacity-30 mx-auto mb-2" />
          <p className="font-semibold">Journal not found</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'entries', label: 'Entries', icon: FileText, count: journal._count?.entries },
    { id: 'config', label: 'Configuration', icon: Activity, count: null },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + Header */}
      <div className="px-6 py-4 border-b bg-white shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <button onClick={() => navigate('/journals')} className="hover:text-primary transition-colors font-medium">Journals</button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold">{journal.name}</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/journals')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
              <BookText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{journal.name}</h1>
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground font-semibold">{journal.code}</code>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[journal.journalType] ?? 'bg-gray-50 text-gray-700'}`}>
                  {TYPE_LABELS[journal.journalType] ?? journal.journalType}
                </span>
                <Badge variant={journal.isActive ? 'default' : 'secondary'} className="text-xs">
                  {journal.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {journal._count?.entries ?? 0} journal entries
                {journal.sequencePrefix ? ` · Prefix: ${journal.sequencePrefix}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10 font-semibold" onClick={() => navigate(`/journals/${id}/edit`)}>
              <Edit className="h-4 w-4 mr-1.5" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/journal-entries/new?journalCode=${journal.code}`)}>
              <FileText className="h-4 w-4 mr-1.5" /> New Entry
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg sticky top-0 z-10 mx-2 mt-1 rounded-xl border border-white/10">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-transparent p-0 h-auto gap-2 rounded-none w-full justify-start border-none">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}
                  className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
                >
                  <span className="flex items-center gap-2">
                    <tab.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{tab.label}</span>
                    {tab.count !== null && tab.count !== undefined && tab.count > 0 && (
                      <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tighter ${tab.id === activeTab ? 'bg-indigo-100 text-indigo-700' : 'bg-white/20 text-white'}`}>
                        {tab.count}
                      </span>
                    )}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Entries Tab */}
            <TabsContent value="entries" className="mt-0 outline-none space-y-4">
              {journalEntries.length === 0 ? (
                <Card>
                  <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
                    <FileText className="h-10 w-10 opacity-30" />
                    <p className="font-semibold">No entries in this journal</p>
                    <p className="text-xs">Post an invoice, payment, or manual entry to see it here</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate(`/journal-entries/new?journalCode=${journal.code}`)}>
                      <FileText className="h-4 w-4 mr-1" /> New Entry
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-5 flex-row items-center justify-between bg-muted/30 border-b rounded-t-lg">
                    <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Journal Entries</CardTitle>
                    <p className="text-xs text-muted-foreground font-medium">{journalEntries.length} entries</p>
                  </CardHeader>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs font-bold text-muted-foreground uppercase">Entry #</TableHead>
                        <TableHead className="text-xs font-bold text-muted-foreground uppercase">Date</TableHead>
                        <TableHead className="text-xs font-bold text-muted-foreground uppercase">Description</TableHead>
                        <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Debit</TableHead>
                        <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Credit</TableHead>
                        <TableHead className="text-xs font-bold text-muted-foreground uppercase">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {journalEntries.map((e: any) => {
                        return (
                          <TableRow key={e.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => navigate(`/journal-entries/${e.id}`)}>
                            <TableCell>
                              <Link to={`/journal-entries/${e.id}`} className="font-medium text-primary hover:underline text-sm">
                                {e.entryNumber}
                              </Link>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{date(e.postingDate)}</TableCell>
                            <TableCell className="text-sm max-w-[300px] truncate">{e.description ?? '—'}</TableCell>
                            <TableCell className="text-right font-semibold text-sm text-emerald-600">{e.lines ? formatCurrency(e.lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0)) : '—'}</TableCell>
                            <TableCell className="text-right font-semibold text-sm">{e.lines ? formatCurrency(e.lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0)) : '—'}</TableCell>
                            <TableCell><Badge variant={statusVariant[e.status] ?? 'secondary'} className="text-xs">{e.status}</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </TabsContent>

            {/* Configuration Tab */}
            <TabsContent value="config" className="mt-0 outline-none space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                    <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Journal Details</CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4">
                    <dl className="divide-y">
                      <InfoRow label="Code" value={<code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">{journal.code}</code>} />
                      <InfoRow label="Name" value={<span className="font-semibold">{journal.name}</span>} />
                      <InfoRow label="Type" value={
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[journal.journalType] ?? 'bg-gray-50 text-gray-700'}`}>
                          {TYPE_LABELS[journal.journalType] ?? journal.journalType}
                        </span>
                      } />
                      <InfoRow label="Status" value={
                        journal.isActive
                          ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Active</Badge>
                          : <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      } />
                      <InfoRow label="Entries" value={<span className="font-semibold text-sm">{journal._count?.entries ?? 0}</span>} />
                    </dl>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                    <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Accounting Setup</CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4">
                    <dl className="divide-y">
                      <InfoRow label="Default Debit" value={<span className="text-sm font-mono">{getAccountLabel(journal.defaultDebitAccountId)}</span>} />
                      <InfoRow label="Default Credit" value={<span className="text-sm font-mono">{getAccountLabel(journal.defaultCreditAccountId)}</span>} />
                      <InfoRow label="Sequence Prefix" value={journal.sequencePrefix ? <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{journal.sequencePrefix}</code> : <span className="text-muted-foreground">—</span>} />
                    </dl>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
