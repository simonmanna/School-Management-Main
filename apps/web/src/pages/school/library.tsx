import { useState } from 'react';
import { BookOpen, Copy, ArrowLeftRight, Plus, Undo2 } from 'lucide-react';
import { notify } from '@/lib/notify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useBooks, useCreateBook, useBookCopies, useCreateBookCopy,
  useBorrowings, useBorrowBook, useReturnBook,
  useStudents,
  type Book, type BookCopy, type Borrowing,
} from '@/features/school/api';
import { useProducts } from '@/features/products/api';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const due = () => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); };

export function SchoolLibraryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Library Management</h1>
        <p className="text-sm text-muted-foreground">Catalogue books, track copies and manage borrowing.</p>
      </div>
      <Tabs defaultValue="books">
        <TabsList>
          <TabsTrigger value="books"><BookOpen className="mr-1.5 h-4 w-4" />Books</TabsTrigger>
          <TabsTrigger value="copies"><Copy className="mr-1.5 h-4 w-4" />Copies</TabsTrigger>
          <TabsTrigger value="borrowings"><ArrowLeftRight className="mr-1.5 h-4 w-4" />Borrowings</TabsTrigger>
        </TabsList>
        <TabsContent value="books" className="pt-4"><BooksTab /></TabsContent>
        <TabsContent value="copies" className="pt-4"><CopiesTab /></TabsContent>
        <TabsContent value="borrowings" className="pt-4"><BorrowingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function BooksTab() {
  const books = useBooks();
  const create = useCreateBook();
  const products = useProducts({ page: 1, pageSize: 100 });
  const [productId, setProductId] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [category, setCategory] = useState('textbook');
  const [shelf, setShelf] = useState('');
  const add = async () => {
    if (!productId) { notify.error('Select a product (stockable item) for the book'); return; }
    try {
      await create.mutateAsync({ productId, author: author || undefined, isbn: isbn || undefined, category, shelfLocation: shelf || undefined });
      notify.success('Book added'); setProductId(''); setAuthor(''); setIsbn(''); setShelf('');
    } catch { notify.error('Failed to add book'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Book Catalogue</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select className={sel + ' w-64'} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Product (stockable item)…</option>
            {(products.data?.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Input className="w-44" placeholder="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <Input className="w-36" placeholder="ISBN" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
          <select className={sel + ' w-40'} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="textbook">textbook</option>
            <option value="reference">reference</option>
            <option value="novel">novel</option>
            <option value="journal">journal</option>
            <option value="magazine">magazine</option>
          </select>
          <Input className="w-36" placeholder="Shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(books.data?.data ?? []).map((b: Book) => (
            <li key={b.id} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium">{b.author ?? 'Unknown'}</span>
              <span className="text-muted-foreground">{b.category} · {b.isbn ?? '—'} · shelf {b.shelfLocation ?? '—'} · {b.totalCopies} copies</span>
            </li>
          ))}
          {books.data && books.data.data.length === 0 && <li className="text-muted-foreground">No books yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function CopiesTab() {
  const copies = useBookCopies();
  const books = useBooks();
  const create = useCreateBookCopy();
  const [bookMetadataId, setBookMetadataId] = useState('');
  const [copyNumber, setCopyNumber] = useState('');
  const add = async () => {
    if (!bookMetadataId || !copyNumber) { notify.error('Book and copy number required'); return; }
    try { await create.mutateAsync({ bookMetadataId, copyNumber }); notify.success('Copy added'); setCopyNumber(''); }
    catch { notify.error('Failed to add copy'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Book Copies</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select className={sel + ' w-64'} value={bookMetadataId} onChange={(e) => setBookMetadataId(e.target.value)}>
            <option value="">Book…</option>
            {(books.data?.data ?? []).map((b: Book) => <option key={b.id} value={b.id}>{b.author ?? 'Unknown'}</option>)}
          </select>
          <Input className="w-40" placeholder="Copy number" value={copyNumber} onChange={(e) => setCopyNumber(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add copy</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(copies.data?.data ?? []).map((c: BookCopy) => (
            <li key={c.id} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium">{c.copyNumber}</span>
              <span className="text-muted-foreground">{c.status} · {c.condition}</span>
            </li>
          ))}
          {copies.data && copies.data.data.length === 0 && <li className="text-muted-foreground">No copies yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function BorrowingsTab() {
  const borrowings = useBorrowings();
  const copies = useBookCopies();
  const students = useStudents({ pageSize: 200 });
  const borrow = useBorrowBook();
  const ret = useReturnBook();
  const [bookCopyId, setBookCopyId] = useState('');
  const [studentProfileId, setStudentProfileId] = useState('');
  const [dueAt, setDueAt] = useState(due());
  const add = async () => {
    if (!bookCopyId || !studentProfileId) { notify.error('Copy and student required'); return; }
    try { await borrow.mutateAsync({ bookCopyId, studentProfileId, dueAt }); notify.success('Borrowed'); setBookCopyId(''); setStudentProfileId(''); }
    catch { notify.error('Failed to borrow'); }
  };
  const available = (copies.data?.data ?? []).filter((c: BookCopy) => c.status === 'available');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Borrowings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <select className={sel} value={bookCopyId} onChange={(e) => setBookCopyId(e.target.value)}>
            <option value="">Available copy…</option>
            {available.map((c: BookCopy) => <option key={c.id} value={c.id}>{c.copyNumber}</option>)}
          </select>
          <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
            <option value="">Student…</option>
            {(students.data?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.partner?.name ?? s.admissionNo}</option>)}
          </select>
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Borrow</Button>
        </div>
        <ul className="space-y-2 text-sm">
          {(borrowings.data?.data ?? []).map((b: Borrowing) => (
            <li key={b.id} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium">{b.bookCopy?.copyNumber ?? b.bookCopyId.slice(0, 8)}</span>
              <span className="flex items-center gap-3">
                <span className="text-muted-foreground">{b.status}{b.fineAmount ? ` · fine ${b.fineAmount}` : ''} · due {b.dueAt.slice(0, 10)}</span>
                {!b.returnedAt && (
                  <Button size="sm" variant="outline" onClick={() => ret.mutate(b.id)}><Undo2 className="mr-1 h-3.5 w-3.5" />Return</Button>
                )}
              </span>
            </li>
          ))}
          {borrowings.data && borrowings.data.data.length === 0 && <li className="text-muted-foreground">No borrowings yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
