import { Bell, MailCheck } from 'lucide-react';
import { useMyNotices, useMarkNoticeRead } from '@/lib/portal-api';
import { Card, CardContent, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';

/** Channel names a parent would recognise, not the ones the code uses. */
const CHANNEL_LABEL: Record<string, string> = {
  in_app: 'In the app',
  sms: 'SMS',
  email: 'Email',
  push: 'Phone alert',
};

const CATEGORY_LABEL: Record<string, string> = {
  fees: 'Fees',
  fee_reminder: 'Fees',
  academic_deadline: 'School work',
  results: 'Results',
  attendance: 'Attendance',
  general: 'School',
};

/**
 * Every message the school has sent this account.
 *
 * The reason this screen exists: a fee reminder or a results notice arrives by
 * SMS, the phone is shared or the message is deleted, and the family has no way
 * to look it up again. The school's own record is the only durable copy — so
 * the portal shows it, in the order it was sent, with what it said.
 *
 * Nothing here is scoped by a parameter. The server answers for whoever holds
 * the token, so there is no id in this screen for anyone to change.
 */
export default function PortalNotices() {
  const { data, isLoading } = useMyNotices(true);
  const markRead = useMarkNoticeRead();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const notices = data ?? [];
  const unread = notices.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <PageTitle sub={unread > 0 ? `${unread} not yet opened` : 'All caught up'}>Messages</PageTitle>

      {notices.length === 0 ? (
        <Empty
          icon={<Bell className="h-6 w-6" />}
          title="No messages yet"
          hint="Fee reminders, results notices and school announcements will appear here."
        />
      ) : (
        <div className="space-y-2">
          {notices.map((n) => (
            <Card key={n.id} className={n.readAt ? 'opacity-70' : undefined}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(n.sentAt ?? n.createdAt).toLocaleString()} · {CHANNEL_LABEL[n.channel] ?? n.channel}
                    </div>
                  </div>
                  <Badge variant={n.readAt ? 'outline' : 'secondary'}>{CATEGORY_LABEL[n.category] ?? n.category}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                {!n.readAt && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                    onClick={() => markRead.mutate(n.id)}
                  >
                    <MailCheck className="h-3 w-3" /> Mark as read
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
