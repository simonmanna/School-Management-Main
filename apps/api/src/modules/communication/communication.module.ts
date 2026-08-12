import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { CommunicationController } from './communication.controller';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { ConversationAccessService } from './conversation-access.service';
import { CommunicationStreamService } from './communication-stream.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { ProviderBootstrapService } from './providers/provider-bootstrap.service';
import { InternalProvider } from './providers/internal/internal.provider';
import { MessageDispatchService } from './outbound/message-dispatch.service';
import { MessageDispatchWorker } from './outbound/message-dispatch.worker';
import { DeliveryStatusService } from './inbound/delivery-status.service';
import { InboundMessageService } from './inbound/inbound-message.service';
import { CommunicationSubscriber } from './communication.subscriber';
import { RuleEngineService } from './rules/rule-engine.service';
import { TemplateRenderService } from './rules/template-render.service';
import { RecipientResolverService } from './rules/recipient-resolver.service';
import { CommunicationConfigService } from './rules/communication-config.service';
import { ChannelService } from './channel.service';
import { CommSecretService } from './providers/whatsapp/comm-secret.service';
import { BaileysSessionManager } from './providers/whatsapp/baileys/baileys-session.manager';
import { BaileysSendPolicy } from './providers/whatsapp/baileys/baileys-send-policy';
import { BaileysProvider } from './providers/whatsapp/baileys/baileys.provider';
import { WhatsAppCloudProvider } from './providers/whatsapp/whatsapp-cloud.provider';
import { TelegramProvider } from './providers/telegram/telegram.provider';
import { TelegramWebhookController } from './providers/telegram/telegram-webhook.controller';

/**
 * Communication platform — transport-independent messaging + provider adapters.
 *
 * Ships dark: gated on `ENABLE_COMMUNICATION` in app.module.ts, so with the flag
 * off none of this (dispatch worker, SSE, subscribers) loads at all. All shared
 * spines (Prisma, tenancy, events/outbox, notifications) come from the global
 * KernelModule — this module owns only the communication domain.
 *
 * Phase 0/1: internal provider only. WhatsApp (Baileys/Cloud) and Telegram
 * register themselves into ProviderRegistry in later phases behind their own
 * inner flags — no change to conversations/messages/dispatcher.
 */
@Module({
  controllers: [CommunicationController, TelegramWebhookController],
  providers: [
    ConversationService,
    MessageService,
    ConversationAccessService,
    CommunicationStreamService,
    ProviderRegistryService,
    InternalProvider,
    MessageDispatchService,
    MessageDispatchWorker,
    DeliveryStatusService,
    // Phase 2 — event-driven messaging.
    CommunicationSubscriber,
    RuleEngineService,
    TemplateRenderService,
    RecipientResolverService,
    CommunicationConfigService,
    // Phase 3/4 — external providers (WhatsApp, Telegram).
    ChannelService,
    InboundMessageService,
    CommSecretService,
    ProviderBootstrapService,
    BaileysSessionManager,
    BaileysSendPolicy,
    BaileysProvider,
    WhatsAppCloudProvider,
    TelegramProvider,
  ],
  exports: [ConversationService, MessageService, ConversationAccessService],
})
export class CommunicationModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'communication',
      version: '1.0.0',
      dependencies: [],
      permissions: [...Object.values(PERMISSIONS.communication)],
    });
  }
}
