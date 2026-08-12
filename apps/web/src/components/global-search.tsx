import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, User, Package, Receipt, HandCoins, BookOpen, ScrollText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface Hit {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const ICONS: Record<string, typeof Search> = {
  partner: User,
  product: Package,
  invoice: Receipt,
  credit_note: FileText,
  payment: HandCoins,
  expense: FileText,
  account: BookOpen,
  journal_entry: ScrollText,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setQ('');
      setHits([]);
      setSelected(0);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!q || q.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ data: Hit[] }>(`/search?q=${encodeURIComponent(q)}`);
        setHits(res.data.data ?? []);
        setSelected(0);
      } catch (err) {
        notify.error('Search failed');
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (hit: Hit) => {
    onOpenChange(false);
    navigate(hit.href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="sr-only">Global search</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-4 pb-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter' && hits[selected]) {
                go(hits[selected]);
              } else if (e.key === 'Escape') {
                onOpenChange(false);
              }
            }}
            placeholder="Search partners, products, invoices…"
            className="border-0 focus-visible:ring-0"
          />
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {loading && <div className="p-4 text-sm text-muted-foreground">Searching…</div>}
          {!loading && q.length >= 2 && hits.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No matches for "{q}"</div>
          )}
          {!loading && q.length < 2 && (
            <div className="p-4 text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </div>
          )}
          {hits.map((hit, idx) => {
            const Icon = ICONS[hit.type] ?? Search;
            return (
              <button
                key={`${hit.type}:${hit.id}`}
                onClick={() => go(hit)}
                onMouseEnter={() => setSelected(idx)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                  idx === selected ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{hit.title}</div>
                  {hit.subtitle && (
                    <div className="truncate text-xs text-muted-foreground">{hit.subtitle}</div>
                  )}
                </div>
                <div className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase">{hit.type.replace('_', ' ')}</div>
              </button>
            );
          })}
        </div>
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          ↑↓ to navigate · ↵ to open · Esc to close
        </div>
      </DialogContent>
    </Dialog>
  );
}
