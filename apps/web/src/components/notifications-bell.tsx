import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  title: string;
  body: string;
  category: string;
  status: string;
  createdAt: string;
  readAt: string | null;
}

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const res = await api.get<{ data: Notification[]; unread: number }>('/notifications?pageSize=10');
      setItems(res.data.data ?? []);
      setUnread(res.data.unread ?? 0);
    } catch {
      // Silent — bell is decorative if endpoint unavailable.
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setItems((prev) => prev.map((n) => ({ ...n, status: 'read', readAt: new Date().toISOString() })));
      setUnread(0);
      notify.success('Marked all as read');
    } catch {
      notify.error('Could not mark all as read');
    }
  };

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, status: 'read', readAt: new Date().toISOString() } : n)));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications (${unread} unread)`}
        className="relative"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
            aria-hidden
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[90vw] rounded-md border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b p-3">
              <h3 className="font-semibold">Notifications</h3>
              {unread > 0 && (
                <Button variant="ghost" size="sm" onClick={markAllRead}>
                  <Check className="mr-1 h-3 w-3" />
                  Mark all
                </Button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet</div>
              )}
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead(n.id);
                    // Notifications may carry a payload.href — fall back to /notifications list.
                    const payload = n as any;
                    if (payload?.payload?.href) {
                      navigate(payload.payload.href);
                      setOpen(false);
                    }
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 border-b p-3 text-left text-sm last:border-b-0 hover:bg-accent',
                    n.status !== 'read' && 'bg-accent/30',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.status === 'read' ? 'bg-muted' : 'bg-primary',
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{n.title}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                    <div className="mt-1 text-[10px] uppercase text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
