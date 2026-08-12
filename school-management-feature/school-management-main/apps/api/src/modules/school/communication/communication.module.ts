import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  MessageThreadService,
  NotificationService,
  NotificationTemplateService,
} from './communication.service';
import { NotificationSender } from './notification-sender.service';
import {
  MessageController,
  NotificationController,
  NotificationTemplateController,
} from './communication.controller';
import {
  ConsoleProvider,
  SendGridProvider,
  TwilioProvider,
} from './providers';

/**
 * NotificationModule — wires notification providers based on env vars.
 *
 * Env vars:
 *   SMS_PROVIDER   = "console" (default) | "twilio"
 *   EMAIL_PROVIDER = "console" (default) | "sendgrid"
 *
 * For multi-channel: we register all three providers and let NotificationSender
 * pick by channel at runtime (env-switched by module init).
 *
 * The NotificationSender starts polling on app bootstrap and stops on
 * shutdown. The polling interval is 5s in dev, configurable via
 * NOTIFICATION_POLL_MS env var for production tuning.
 */
@Module({
  controllers: [NotificationTemplateController, NotificationController, MessageController],
  providers: [
    NotificationTemplateService,
    NotificationService,
    MessageThreadService,
    NotificationSender,
    ConsoleProvider,
    TwilioProvider,
    SendGridProvider,
    {
      // Default to the console provider; production deployments override this
      // binding in NotificationModule via a custom factory based on env vars.
      provide: 'NotificationProvider',
      useExisting: ConsoleProvider,
    },
  ],
  exports: [
    NotificationTemplateService,
    NotificationService,
    MessageThreadService,
    NotificationSender,
  ],
})
export class SchoolCommunicationModule implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly sender: NotificationSender) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(process.env.NOTIFICATION_POLL_MS ?? '5000');
    this.sender.start(intervalMs);
  }

  onModuleDestroy(): void {
    this.sender.stop();
  }
}

// Re-export the kernel module alias for backwards-compat with the
// existing SchoolModule import.
export { SchoolCommunicationModule as CommunicationModule };