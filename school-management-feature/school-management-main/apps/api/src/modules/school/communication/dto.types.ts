/** DTOs for Communication sprint. */

export interface CreateNotificationTemplateDto {
  channel: 'sms' | 'email' | 'push' | 'in_app';
  code: string;
  subject?: string;
  body: string;
  variables?: string[];
  isActive?: boolean;
}
export type UpdateNotificationTemplateDto = Partial<CreateNotificationTemplateDto>;

export interface EnqueueNotificationDto {
  recipientType: 'partner' | 'contact' | 'user';
  recipientId: string;
  channel: 'sms' | 'email' | 'push' | 'in_app';
  templateCode?: string;
  payload?: Record<string, unknown>;
}

export interface CreateMessageThreadDto {
  subject?: string;
  participantIds: Array<{ type: 'user' | 'contact' | 'partner'; id: string }>;
  initialMessage: string;
}

export interface PostMessageDto {
  threadId: string;
  body: string;
  attachments?: Array<{ name: string; url: string }>;
}