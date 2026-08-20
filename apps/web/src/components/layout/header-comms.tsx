import { useNavigate } from 'react-router-dom';
import { Bell, MessagesSquare } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useConversations } from '@/features/communication/api';

export function HeaderComms() {
  const navigate = useNavigate();
  const { data: conversations } = useConversations();
  const list = conversations ?? [];
  const unread = list.reduce((s, c) => s + (c.unread ?? 0), 0);

  const BellBadge = ({
    count,
    label,
    icon: Icon,
    to,
  }: {
    count: number;
    label: string;
    icon: typeof Bell;
    to: string;
  }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Icon className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[10px] font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{label}</span>
          {count > 0 && <span className="text-xs font-normal text-muted-foreground">{count} unread</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">No messages</div>
        ) : (
          <div className="max-h-80 overflow-auto">
            {list.slice(0, 12).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(to)}
                className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60"
              >
                <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{c.name ?? 'Conversation'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.unread > 0 ? `${c.unread} unread · ` : ''}
                    {c.lastMessage?.body ?? 'No messages yet'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(to)} className="cursor-pointer justify-center text-sm text-primary">
          Open {label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <BellBadge count={0} label="Notifications" icon={Bell} to="/communication" />
      <BellBadge count={unread} label="Messages" icon={MessagesSquare} to="/communication" />
    </>
  );
}
