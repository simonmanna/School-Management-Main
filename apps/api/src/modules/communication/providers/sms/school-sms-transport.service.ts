import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../kernel/prisma/prisma.service';
import { NotificationsService, type SmsTransport } from '../../../../kernel/notifications/notifications.service';
import { HttpSmsProvider } from './http-sms.provider';

/**
 * Lends the school's configured SMS gateway to kernel notifications.
 *
 * Fee, attendance and admissions alerts go through `NotificationsService`,
 * which only knew a deployment-wide Twilio account. A school that configured
 * its own gateway (Communication → Channels, e.g. a Ugandan bulk-SMS provider)
 * still had every automatic alert logged and marked "sent" without leaving the
 * server (re-audit P1-2). This registers that gateway as the first SMS route.
 */
@Injectable()
export class SchoolSmsTransport implements SmsTransport, OnModuleInit {
  private readonly logger = new Logger('SchoolSmsTransport');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly sms: HttpSmsProvider,
  ) {}

  onModuleInit(): void {
    this.notifications.registerSmsTransport(this);
  }

  async send(input: { organizationId: string; to: string; body: string; reference: string }): Promise<'sent' | 'not_configured'> {
    const channels = await this.prisma.raw.communicationChannel.findMany({
      where: { organizationId: input.organizationId, providerId: 'sms', disabledAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    for (const c of channels) {
      if (!(await this.sms.isReady(c.id))) continue;
      await this.sms.send({
        organizationId: input.organizationId,
        channelId: c.id,
        conversationId: input.reference,
        messageId: input.reference,
        providerRequestId: input.reference,
        toAddress: input.to,
        body: input.body,
        contentType: 'text',
      });
      return 'sent';
    }
    this.logger.debug(`org ${input.organizationId}: no ready SMS channel`);
    return 'not_configured';
  }
}
