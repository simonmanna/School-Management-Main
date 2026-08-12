import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { MessageThread, Notification, NotificationTemplate } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateMessageThreadDto,
  CreateNotificationTemplateDto,
  EnqueueNotificationDto,
  PostMessageDto,
  UpdateNotificationTemplateDto,
} from './dto.types';

/**
 * Communication sprint — notifications + in-app messaging.
 *
 * The NotificationService listens to school.* events and enqueues
 * notifications when templates exist. The actual SMS/email send is
 * delegated to pluggable providers (console in dev, Twilio/SendGrid/FCM in prod).
 */
@Injectable()
export class NotificationTemplateService extends BaseCrudService<NotificationTemplate, CreateNotificationTemplateDto, UpdateNotificationTemplateDto> {
  protected readonly entityName = 'NotificationTemplate';
  protected readonly searchFields = ['code', 'subject', 'body'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.notificationTemplate as unknown as CrudDelegate);
  }

  async findByCode(channel: string, code: string) {
    return this.prisma.client.notificationTemplate.findFirst({ where: { channel: channel as any, code } });
  }
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  async enqueue(dto: EnqueueNotificationDto): Promise<Notification> {
    const row = await this.prisma.client.notification.create({
      data: {
        organizationId: this.tenant.organizationId,
        recipientType: dto.recipientType,
        recipientId: dto.recipientId,
        channel: dto.channel,
        templateCode: dto.templateCode ?? null,
        payload: (dto.payload as any) ?? {},
        status: 'queued',
      },
    });
    this.events.publish(EVENTS.NotificationSent, {
      organizationId: this.tenant.organizationId,
      notificationId: row.id,
      channel: dto.channel,
      recipientType: dto.recipientType,
      recipientId: dto.recipientId,
    });
    return row;
  }

  /** List by recipient — for the in-app inbox. */
  async inbox(recipientType: string, recipientId: string) {
    return this.prisma.client.notification.findMany({
      where: { recipientType, recipientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Mark a batch sent (called by the provider worker after successful send). */
  async markSent(ids: string[], providerMessageId?: string) {
    if (ids.length === 0) return;
    await this.prisma.client.notification.updateMany({
      where: { id: { in: ids }, status: 'queued' },
      data: { status: 'sent', sentAt: new Date(), providerMessageId: providerMessageId ?? null },
    });
  }

  async markFailed(ids: string[], error: string) {
    if (ids.length === 0) return;
    await this.prisma.client.notification.updateMany({
      where: { id: { in: ids } },
      data: { status: 'failed', error, attempts: { increment: 1 } },
    });
  }
}

@Injectable()
export class MessageThreadService extends BaseCrudService<MessageThread, CreateMessageThreadDto, never> {
  protected readonly entityName = 'MessageThread';
  protected readonly searchFields = ['subject'];
  protected readonly defaultInclude = { messages: { include: { sender: true } } };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.messageThread as unknown as CrudDelegate);
  }

  async createThread(dto: CreateMessageThreadDto): Promise<MessageThread> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const thread = await tx.messageThread.create({
        data: {
          organizationId,
          subject: dto.subject ?? null,
          participantIds: dto.participantIds as any,
          lastMessageAt: new Date(),
        },
      });
      await tx.message.create({
        data: {
          organizationId,
          threadId: thread.id,
          senderId: this.tenant.userId ?? '',
          body: dto.initialMessage,
        },
      });
      return thread;
    });
  }

  async postMessage(dto: PostMessageDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const thread = await tx.messageThread.findFirst({ where: { id: dto.threadId } });
      if (!thread) throw new NotFoundException(`Thread ${dto.threadId} not found`);
      const message = await tx.message.create({
        data: {
          organizationId,
          threadId: dto.threadId,
          senderId: this.tenant.userId ?? '',
          body: dto.body,
          attachments: (dto.attachments as any) ?? [],
        },
      });
      await tx.messageThread.updateMany({
        where: { id: dto.threadId },
        data: { lastMessageAt: new Date() },
      });
      this.events.publish(EVENTS.MessageSent, {
        organizationId,
        threadId: dto.threadId,
        messageId: message.id,
        senderId: message.senderId,
      });
      return message;
    });
  }

  async forParticipant(participantId: string) {
    // Return threads where the participantIds array contains {id: participantId}.
    const all = await this.prisma.client.messageThread.findMany({
      orderBy: { lastMessageAt: 'desc' },
    });
    return all.filter((t) => Array.isArray(t.participantIds) && (t.participantIds as any[]).some((p) => p.id === participantId));
  }
}