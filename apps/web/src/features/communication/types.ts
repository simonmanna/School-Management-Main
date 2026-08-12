export interface ConversationSummary {
  id: string;
  kind: 'direct' | 'group' | 'channel';
  name: string | null;
  contextType: string | null;
  contextId: string | null;
  visibility: string;
  updatedAt: string;
  lastMessage: { id: string; body: string; occurredAt: string } | null;
  unread: number;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderType: string;
  senderUserId: string | null;
  contentType: string;
  body: string;
  replyToMessageId: string | null;
  status: string;
  occurredAt: string;
  editedAt: string | null;
  /** Sync cursor (BigInt as string). NOT for chronological ordering — use occurredAt. */
  syncSequence: string;
}

export interface CreateConversationInput {
  kind?: 'direct' | 'group' | 'channel';
  name?: string;
  participantUserIds?: string[];
  contextType?: string;
  contextId?: string;
  visibility?: 'private' | 'org' | 'role';
  visibleToPermissions?: string[];
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
  replyToMessageId?: string;
  targetConversationChannelIds?: string[];
}

/** SSE envelope pushed by CommunicationStreamService. */
export interface StreamEvent {
  type: 'message.created' | 'delivery.status' | 'channel.status' | string;
  conversationId?: string;
  messageId?: string;
  syncSequence?: string;
  message?: MessageView;
  status?: string;
}
