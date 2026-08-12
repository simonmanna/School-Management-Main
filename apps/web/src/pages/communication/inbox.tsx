import { useEffect, useMemo, useRef, useState } from 'react';
import { MessagesSquare, Plus, Send, X, Hash, User as UserIcon, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useUsers } from '@/features/staff/api';
import {
  useConversations,
  useCreateConversation,
  useMarkRead,
  useMessages,
  useSendMessage,
} from '@/features/communication/api';
import { useCommunicationStream } from '@/features/communication/sse';
import type { ConversationSummary } from '@/features/communication/types';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function conversationTitle(c: ConversationSummary): string {
  if (c.name) return c.name;
  if (c.contextType) return `${c.contextType} ${c.contextId ?? ''}`.trim();
  return c.kind === 'direct' ? 'Direct message' : 'Conversation';
}

const KIND_ICON = { channel: Hash, group: Users, direct: UserIcon } as const;

export default function CommunicationInboxPage() {
  const me = useAuthStore((s) => s.user);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [showNew, setShowNew] = useState(false);

  const { data: conversations = [], isLoading } = useConversations();
  const { data: messages = [] } = useMessages(activeId);
  const send = useSendMessage();
  const markRead = useMarkRead();
  useCommunicationStream(activeId);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-select the first conversation.
  useEffect(() => {
    if (!activeId && conversations.length > 0) setActiveId(conversations[0].id);
  }, [conversations, activeId]);

  // Mark read + scroll to bottom when the active conversation's messages change.
  useEffect(() => {
    if (activeId) markRead.mutate({ conversationId: activeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activeId]);

  const active = useMemo(() => conversations.find((c) => c.id === activeId), [conversations, activeId]);

  const submit = () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setDraft('');
    send.mutate({ conversationId: activeId, body });
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left rail */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 font-semibold">
            <MessagesSquare className="h-4 w-4" /> Inbox
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && conversations.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No conversations yet. Start one with “New”.</div>
          )}
          {conversations.map((c) => {
            const Icon = KIND_ICON[c.kind] ?? UserIcon;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left hover:bg-accent ${
                  c.id === activeId ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    {conversationTitle(c)}
                  </span>
                  {c.unread > 0 && (
                    <span className="ml-2 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                      {c.unread}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {c.lastMessage?.body ?? 'No messages'}
                  </span>
                  {c.lastMessage && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(c.lastMessage.occurredAt)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Thread pane */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        ) : (
          <>
            <header className="border-b border-border px-5 py-3 font-semibold">{conversationTitle(active)}</header>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.map((m) => {
                const mine = m.senderUserId === me?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                        mine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`mt-1 text-[10px] ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {relativeTime(m.occurredAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && (
                <div className="pt-8 text-center text-sm text-muted-foreground">No messages yet — say hello.</div>
              )}
            </div>
            <div className="flex items-end gap-2 border-t border-border p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
                className="max-h-32 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={submit}
                disabled={!draft.trim() || send.isPending}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </section>

      {showNew && <NewConversationModal onClose={() => setShowNew(false)} onCreated={(id) => setActiveId(id)} />}
    </div>
  );
}

function NewConversationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const me = useAuthStore((s) => s.user);
  const [kind, setKind] = useState<'group' | 'channel' | 'direct'>('group');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: users } = useUsers({ page: 1, pageSize: 100 });
  const create = useCreateConversation();

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const submit = async () => {
    const res = await create.mutateAsync({
      kind,
      name: name.trim() || undefined,
      participantUserIds: [...selected],
      // A named channel is org-readable; group/direct default to participants-only.
      visibility: kind === 'channel' ? 'org' : 'private',
    });
    onCreated(res.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">New conversation</h2>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-3 flex gap-2">
          {(['group', 'channel', 'direct'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-xs capitalize ${
                kind === k ? 'border-primary bg-primary/10' : 'border-border'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'channel' ? 'Channel name (e.g. Kitchen)' : 'Name (optional)'}
          className="mb-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="mb-1 text-xs font-medium text-muted-foreground">Participants</div>
        <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-border">
          {(users?.data ?? [])
            .filter((u) => u.id !== me?.id)
            .map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-accent">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                <span>{u.firstName} {u.lastName ?? ''}</span>
                <span className="ml-auto text-xs text-muted-foreground">{u.email}</span>
              </label>
            ))}
        </div>

        <button
          onClick={submit}
          disabled={create.isPending || (kind === 'channel' && !name.trim())}
          className="w-full rounded-lg bg-primary py-2 text-sm text-primary-foreground disabled:opacity-40"
        >
          {create.isPending ? 'Creating…' : 'Create conversation'}
        </button>
      </div>
    </div>
  );
}
