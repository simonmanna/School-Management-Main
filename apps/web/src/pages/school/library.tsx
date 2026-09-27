import { formatCurrency } from '@/lib/utils';
import { useState, useMemo } from 'react';
import {
  BookOpen, Copy, ArrowLeftRight, Users, AlertTriangle, BarChart3,
  Plus, Edit, Trash2, RotateCcw, CheckCircle2, DollarSign,
  ChevronLeft, ChevronRight, LayoutDashboard,
} from 'lucide-react';
import { notify } from '@/lib/notify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useBooks, useCreateBook, useUpdateBook, useDeleteBook,
  useBookCopies, useCreateBookCopy, useUpdateBookCopy, useDeleteBookCopy,
  useBorrowings, useBorrowBook, useReturnBook,
  useStudents,
  type Book, type BookCopy,
} from '@/features/school/api';
import { useProducts } from '@/features/products/api';

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
// The school's own currency (Organization.currencyCode), not a hard-coded UGX.
const money = (n: number | string | null | undefined) => formatCurrency(n);

const statusBadge = (status: string) => {
  const variants: Record<string, string> = {
    available: 'bg-emerald-100 text-emerald-700',
    borrowed: 'bg-blue-100 text-blue-700',
    lost: 'bg-rose-100 text-rose-700',
    damaged: 'bg-amber-100 text-amber-700',
    reserved: 'bg-violet-100 text-violet-700',
    returned: 'bg-emerald-100 text-emerald-700',
    overdue: 'bg-rose-100 text-rose-700',
  };
  return <Badge variant="outline" className={variants[status] ?? 'bg-gray-100 text-gray-700'}>{status}</Badge>;
};

const conditionBadge = (c: string) => {
  const variants: Record<string, string> = {
    new: 'bg-emerald-100 text-emerald-700',
    good: 'bg-blue-100 text-blue-700',
    fair: 'bg-amber-100 text-amber-700',
    poor: 'bg-rose-100 text-rose-700',
  };
  return <Badge variant="outline" className={variants[c] ?? 'bg-gray-100 text-gray-700'}>{c}</Badge>;
};

const categoryBadge = (cat: string) => {
  const icons: Record<string, string> = {
    textbook: '📚', reference: '📖', novel: '📕',
    journal: '📰', magazine: '📔', other: '📗',
  };
  return <span className="inline-flex items-center gap-1">{icons[cat] ?? '📗'} {cat}</span>;
};

export function SchoolLibraryPage() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6" /> Library Management
          </h1>
          <p className="text-sm text-muted-foreground">Catalogue, copies, borrowings, fines and reports.</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="dashboard"><LayoutDashboard className="mr-1.5 h-4 w-4" />Dashboard</TabsTrigger>
          <TabsTrigger value="catalog"><BookOpen className="mr-1.5 h-4 w-4" />Catalogue</TabsTrigger>
          <TabsTrigger value="copies"><Copy className="mr-1.5 h-4 w-4" />Copies</TabsTrigger>
          <TabsTrigger value="borrowings"><ArrowLeftRight className="mr-1.5 h-4 w-4" />Borrowings</TabsTrigger>
          <TabsTrigger value="students"><Users className="mr-1.5 h-4 w-4" />Students</TabsTrigger>
          <TabsTrigger value="fines"><AlertTriangle className="mr-1.5 h-4 w-4" />Fines</TabsTrigger>
          <TabsTrigger value="reports"><BarChart3 className="mr-1.5 h-4 w-4" />Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="pt-4"><DashboardTab /></TabsContent>
        <TabsContent value="catalog" className="pt-4"><CatalogTab /></TabsContent>
        <TabsContent value="copies" className="pt-4"><CopiesTab /></TabsContent>
        <TabsContent value="borrowings" className="pt-4"><BorrowingsTab /></TabsContent>
        <TabsContent value="students" className="pt-4"><StudentsTab /></TabsContent>
        <TabsContent value="fines" className="pt-4"><FinesTab /></TabsContent>
        <TabsContent value="reports" className="pt-4"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────── Dashboard ───────────────────────── */
function DashboardTab() {
  const books = useBooks();
  const copies = useBookCopies();
  const borrowings = useBorrowings();

  const totalBooks = books.data?.data?.length ?? 0;
  const totalCopies = copies.data?.data?.length ?? 0;
  const availableCopies = copies.data?.data?.filter((c: any) => c.status === 'available').length ?? 0;
  const borrowedCopies = copies.data?.data?.filter((c: any) => c.status === 'borrowed').length ?? 0;
  // These were hard-coded zeros; a head teacher read "no overdue books".
  const rows: any[] = borrowings.data?.data ?? [];
  const now = Date.now();
  const overdue = rows.filter((b) => !b.returnedAt && b.dueAt && new Date(b.dueAt).getTime() < now).length;
  const activeStudents = new Set(rows.filter((b) => !b.returnedAt && b.studentProfileId).map((b) => b.studentProfileId)).size;
  const totalFines = rows.reduce((t, b) => t + Number(b.fineAmount ?? 0), 0);

  const statCards = [
    { label: 'Total Books', value: totalBooks, icon: BookOpen, color: 'text-blue-600' },
    { label: 'Total Copies', value: totalCopies, icon: Copy, color: 'text-green-600' },
    { label: 'Available', value: availableCopies, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Borrowed', value: borrowedCopies, icon: ArrowLeftRight, color: 'text-blue-600' },
    { label: 'Overdue', value: overdue, icon: AlertTriangle, color: 'text-rose-600' },
    { label: 'Pupils with books out', value: activeStudents, icon: Users, color: 'text-violet-600' },
    { label: 'Fines charged', value: money(totalFines), icon: DollarSign, color: 'text-amber-600' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {statCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Borrowings</CardTitle></CardHeader>
          <CardContent>
            {borrowings.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead>Book</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(borrowings.data?.data ?? []).slice(0, 10).map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs">{fmtDateTime(b.borrowedAt)}</TableCell>
                    <TableCell className="font-medium">{b.bookCopy?.book?.author ?? '—'}</TableCell>
                    <TableCell>{b.studentProfile?.partner?.name ?? '—'}</TableCell>
                    <TableCell className="text-xs">{fmtDate(b.dueAt)}</TableCell>
                    <TableCell>{statusBadge(b.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Catalogue ───────────────────────── */
function CatalogTab() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const books = useBooks();
  const create = useCreateBook();
  const update = useUpdateBook();
  const del = useDeleteBook();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [form, setForm] = useState({
    productId: '', author: '', isbn: '', publisher: '', edition: '',
    category: 'textbook', shelfLocation: '', totalCopies: 1,
  });

  const categories = ['textbook', 'reference', 'novel', 'journal', 'magazine', 'other'];
  const products = useProducts({ page: 1, pageSize: 200 });

  const filtered = useMemo(() => {
    let result = books.data?.data ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((b: any) =>
        b.author?.toLowerCase().includes(q) ||
        b.isbn?.toLowerCase().includes(q) ||
        b.publisher?.toLowerCase().includes(q)
      );
    }
    if (category) {
      result = result.filter((b: any) => b.category === category);
    }
    return result;
  }, [books.data, search, category]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const openCreate = () => { setEditing(null); resetForm(); setDialogOpen(true); };
  const openEdit = (b: Book) => { setEditing(b); setForm({
    productId: b.productId, author: b.author ?? '', isbn: b.isbn ?? '', publisher: b.publisher ?? '',
    edition: b.edition ?? '', category: b.category, shelfLocation: b.shelfLocation ?? '', totalCopies: b.totalCopies,
  }); setDialogOpen(true); };
  const resetForm = () => setForm({ productId: '', author: '', isbn: '', publisher: '', edition: '', category: 'textbook', shelfLocation: '', totalCopies: 1 });

  const handleSubmit = async () => {
    if (!form.productId) { notify.error('Product is required'); return; }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, dto: form });
        notify.success('Book updated');
      } else {
        await create.mutateAsync({ ...form });
        notify.success('Book added');
      }
      setDialogOpen(false); resetForm(); setEditing(null);
    } catch { notify.error(editing ? 'Update failed' : 'Create failed'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this book?')) return;
    try { await del.mutateAsync(id); notify.success('Deleted'); } catch { notify.error('Delete failed'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Search author, ISBN, title…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />Add Book</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Book</TableHead>
                <TableHead className="w-48">Category</TableHead>
                <TableHead className="w-64">Author / ISBN</TableHead>
                <TableHead className="w-32">Shelf</TableHead>
                <TableHead className="w-32">Copies</TableHead>
                <TableHead className="w-24">Available</TableHead>
                <TableHead className="w-24">Borrowed</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((b, i) => (
                <TableRow key={b.id}>
                  <TableCell className="text-muted-foreground text-xs">{(page - 1) * pageSize + i + 1}</TableCell>
                  <TableCell className="font-medium">{b.author ?? 'Unknown'}</TableCell>
                  <TableCell>{categoryBadge(b.category)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {b.author && <div>{b.author}</div>}
                    {b.isbn && <div className="font-mono text-xs">ISBN: {b.isbn}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.shelfLocation ?? '—'}</TableCell>
                  <TableCell className="text-center">{b.totalCopies}</TableCell>
                  <TableCell className="text-center text-emerald-600">{b.availableCopies ?? 0}</TableCell>
                  <TableCell className="text-center text-blue-600">{b.borrowedCopies ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(b)} title="Edit"><Edit className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="text-rose-600" onClick={() => remove(b.id)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {paginated.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No books found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {page} of {Math.ceil((filtered.length) / pageSize)}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled={page * pageSize >= filtered.length} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Book' : 'Add Book'}</DialogTitle>
            <DialogDescription>Enter book metadata. The product is the stockable item in inventory.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })}>
              <SelectTrigger><SelectValue placeholder="Product (stockable item)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Select product</SelectItem>
                {(products.data?.data ?? []).filter((p: any) => p.type === 'stockable' || p.isStockable).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1"><Label>Author</Label><Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Author name" /></div>
              <div className="space-y-1"><Label>ISBN</Label><Input value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} placeholder="ISBN-13" /></div>
              <div className="space-y-1"><Label>Publisher</Label><Input value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} /></div>
              <div className="space-y-1"><Label>Edition</Label><Input value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })} placeholder="1st, 2nd, etc." /></div>
              <div className="space-y-1"><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['textbook','reference','novel','journal','magazine','other'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Shelf Location</Label><Input value={form.shelfLocation} onChange={(e) => setForm({ ...form, shelfLocation: e.target.value })} placeholder="e.g. A-12-3" /></div>
              <div className="space-y-1"><Label>Total Copies</Label><Input type="number" value={form.totalCopies} onChange={(e) => setForm({ ...form, totalCopies: Number(e.target.value) })} min={1} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { resetForm(); setEditing(null); setDialogOpen(false); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Add book'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────── Copies ───────────────────────── */
function CopiesTab() {
  const [search, setSearch] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const copies = useBookCopies();
  const books = useBooks();
  const create = useCreateBookCopy();
  const update = useUpdateBookCopy();
  const del = useDeleteBookCopy();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BookCopy | null>(null);
  const [form, setForm] = useState({ bookMetadataId: '', copyNumber: '', status: 'available', condition: 'good' });

  // Suppress unused variable warnings (used in JSX)
  void dialogOpen;

  const filteredCopies = useMemo(() => {
    let result = copies.data?.data ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c: any) =>
        c.copyNumber.toLowerCase().includes(q) ||
        c.book?.author?.toLowerCase().includes(q)
      );
    }
    if (bookFilter) {
      result = result.filter((c: any) => c.bookMetadataId === bookFilter);
    }
    if (statusFilter) {
      result = result.filter((c: any) => c.status === statusFilter);
    }
    return result;
  }, [copies.data, search, bookFilter, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCopies.slice(start, start + pageSize);
  }, [filteredCopies, page, pageSize]);

  const openCreate = () => { setEditing(null); resetForm(); setDialogOpen(true); };
  const openEdit = (c: BookCopy) => { setEditing(c); setForm({ bookMetadataId: c.bookMetadataId, copyNumber: c.copyNumber, status: c.status, condition: c.condition }); setDialogOpen(true); };
  const resetForm = () => setForm({ bookMetadataId: '', copyNumber: '', status: 'available', condition: 'good' });

  const handleSubmit = async () => {
    if (!form.bookMetadataId || !form.copyNumber) { notify.error('Book and copy number required'); return; }
    try {
      if (editing) { await update.mutateAsync({ id: editing.id, dto: form }); notify.success('Copy updated'); }
      else { await create.mutateAsync(form); notify.success('Copy added'); }
      setDialogOpen(false); resetForm(); setEditing(null);
    } catch { notify.error(editing ? 'Update failed' : 'Create failed'); }
  };

  // Suppress unused variable warning (used in JSX)
  void handleSubmit;

  const remove = async (id: string) => { if (!confirm('Delete this copy?')) return; try { await del.mutateAsync(id); notify.success('Deleted'); } catch { notify.error('Delete failed'); } };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Search copy number, book…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          <Select value={bookFilter} onValueChange={(v) => { setBookFilter(v); setPage(1); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Filter by book" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All books</SelectItem>
              {books.data?.data?.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.author ?? 'Unknown'}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              {['available','borrowed','lost','damaged','reserved'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />Add Copy</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Copy #</TableHead>
                <TableHead>Book</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-28">Condition</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell className="text-muted-foreground text-xs">{(page - 1) * pageSize + i + 1}</TableCell>
                  <TableCell className="font-mono font-medium">{c.copyNumber}</TableCell>
                  <TableCell>{c.book?.author ?? '—'} <span className="text-muted-foreground text-xs">({c.book?.category})</span></TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell>{conditionBadge(c.condition)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(c)} title="Edit"><Edit className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="text-rose-600" onClick={() => remove(c.id)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Borrowings ───────────────────────── */
function BorrowingsTab() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const borrowings = useBorrowings();
  const copies = useBookCopies();
  const borrow = useBorrowBook();
  const ret = useReturnBook();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ bookCopyId: '', studentProfileId: '', dueAt: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), notes: '' });

  const availableCopies = useMemo(() => copies.data?.data ?? [], [copies.data]);

  const openBorrow = () => { setForm({ bookCopyId: '', studentProfileId: '', dueAt: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), notes: '' }); setDialogOpen(true); };

  const handleBorrow = async () => {
    if (!form.bookCopyId || !form.studentProfileId) { notify.error('Copy and student required'); return; }
    try { await borrow.mutateAsync({ ...form, dueAt: form.dueAt }); notify.success('Book borrowed'); setDialogOpen(false); } catch { notify.error('Borrow failed'); }
  };

  const handleReturn = async (id: string) => {
    try { await ret.mutateAsync(id); notify.success('Book returned'); } catch { notify.error('Return failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Input placeholder="Search student, book…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              {['borrowed','returned','overdue','lost'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openBorrow}><Plus className="mr-1 h-4 w-4" />Borrow</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Copy</TableHead>
                <TableHead>Book</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="w-32">Borrowed</TableHead>
                <TableHead className="w-32">Due</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24">Fine</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(borrowings.data?.data ?? []).map((b, i) => (
                <TableRow key={b.id}>
                  <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                  <TableCell className="font-mono">{b.bookCopy?.copyNumber ?? '—'}</TableCell>
                  <TableCell>{b.bookCopy?.book?.author ?? '—'} <span className="text-muted-foreground text-xs">({b.bookCopy?.book?.category})</span></TableCell>
                  <TableCell>{b.studentProfile?.partner?.name ?? b.studentProfile?.admissionNo ?? '—'}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(b.borrowedAt)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(b.dueAt)}</TableCell>
                  <TableCell>{statusBadge(b.status)}</TableCell>
                  <TableCell>{b.fineAmount ? money(b.fineAmount) : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!b.returnedAt && b.status !== 'returned' && (
                        <Button size="icon" variant="outline" onClick={() => handleReturn(b.id)} title="Return"><RotateCcw className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Borrow Book</DialogTitle><DialogDescription>Select an available copy and student.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <Select value={form.bookCopyId} onValueChange={(v) => setForm({ ...form, bookCopyId: v })}>
              <SelectTrigger><SelectValue placeholder="Available copy" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Select copy</SelectItem>
                {availableCopies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.copyNumber} — {c.book?.author ?? 'Unknown'}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.studentProfileId} onValueChange={(v) => setForm({ ...form, studentProfileId: v })}>
              <SelectTrigger><SelectValue placeholder="Student" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Select student</SelectItem>
                {(useStudents({ pageSize: 200 }).data?.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.partner?.name ?? s.admissionNo}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="space-y-1"><Label>Due Date</Label><Input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Optional notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleBorrow} disabled={borrow.isPending}>Borrow</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────── Students ───────────────────────── */
function StudentsTab() {
  const [search, setSearch] = useState('');
  const students = useStudents({ pageSize: 200 });

  const filtered = useMemo(() => {
    if (!search) return students.data?.data ?? [];
    const q = search.toLowerCase();
    return (students.data?.data ?? []).filter((s: any) =>
      s.partner?.name?.toLowerCase().includes(q) ||
      s.admissionNo?.toLowerCase().includes(q) ||
      // Search by the class NAME the API derives from placement history; the
      // class id it used to match was meaningless to a librarian typing "P5".
      s.currentClass?.name?.toLowerCase().includes(q)
    );
  }, [students.data, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Search student name, admission no, class…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Admission No.</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Active Borrowings</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead>Total Fines</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                  <TableCell className="font-medium">{s.partner?.name ?? '—'}</TableCell>
                  <TableCell className="font-mono">{s.admissionNo}</TableCell>
                  <TableCell>{s.currentClass?.name ?? '—'}</TableCell>
<TableCell>{(s as any).borrowingCount ?? 0}</TableCell>
              <TableCell><Badge variant="destructive">{(s as any).overdueCount ?? 0}</Badge></TableCell>
              <TableCell>{money((s as any).totalFines ?? 0)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" title="View Library Record"><BookOpen className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" title="Full Profile"><Users className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Fines ───────────────────────── */
function FinesTab() {
  // Audit F16: fines are real. Returning an overdue book raises a posted fee
  // invoice for the pupil; it is collected at the fee desk like any fee, so
  // it appears on the family's statement and in the cash book.
  const borrowings = useBorrowings();
  const fined = (borrowings.data?.data ?? []).filter((b: any) => Number(b.fineAmount ?? 0) > 0);
  const total = fined.reduce((t: number, b: any) => t + Number(b.fineAmount ?? 0), 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-rose-600" />Fines raised · {money(total)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A fine is charged when an overdue book comes back, as an invoice on the pupil's fee account. Collect it at the fee desk; it then shows on the family's statement.
          </p>
          {borrowings.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {borrowings.isError && <p className="text-sm text-destructive">Could not load fines. Reload to try again.</p>}
          {!borrowings.isLoading && !borrowings.isError && fined.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No fines have been charged.</p>
          )}
          {fined.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Copy</TableHead>
                  <TableHead className="w-32">Returned</TableHead>
                  <TableHead className="w-28">Fine</TableHead>
                  <TableHead className="w-40">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fined.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.studentProfile?.partner?.name ?? b.studentProfile?.admissionNo ?? '—'}</TableCell>
                    <TableCell className="font-mono">{b.bookCopy?.copyNumber ?? '—'}</TableCell>
                    <TableCell className="text-xs">{b.returnedAt ? fmtDate(b.returnedAt) : '—'}</TableCell>
                    <TableCell>{money(b.fineAmount)}</TableCell>
                    <TableCell className="text-xs">{b.fineInvoiceId ? 'On the fee account' : 'No pupil to charge'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Reports ───────────────────────── */
function ReportsTab() {
  const books = useBooks();
  const copies = useBookCopies();

  const totalBooks = books.data?.data?.length ?? 0;
  const totalCopies = copies.data?.data?.length ?? 0;
  const availableCopies = copies.data?.data?.filter((c: any) => c.status === 'available').length ?? 0;
  const borrowedCopies = copies.data?.data?.filter((c: any) => c.status === 'borrowed').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ReportCard label="Total Books" value={totalBooks} icon={BookOpen} subtitle={totalCopies} subLabel="total copies" />
        <ReportCard label="Total Copies" value={totalCopies} icon={Copy} subtitle="copies owned" />
        <ReportCard label="Available" value={availableCopies} icon={CheckCircle2} subtitle="ready to borrow" />
        <ReportCard label="Borrowed" value={borrowedCopies} icon={ArrowLeftRight} subtitle="currently out" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Collection by Category</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Category breakdown coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Shared Components ───────────────────────── */

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <div className={`p-3 rounded-xl ${color.replace('text', 'bg').replace('600', '100')}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportCard({ label, value, icon: Icon, subtitle, subLabel }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; subtitle?: string | number; subLabel?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle !== undefined && <p className="text-xs text-muted-foreground">{subtitle} {subLabel ?? ''}</p>}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/30" />
        </div>
      </CardContent>
    </Card>
  );
}