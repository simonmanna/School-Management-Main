import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProviderRegistryService } from './provider-registry.service';
import { BaileysProvider } from './whatsapp/baileys/baileys.provider';
import { WhatsAppCloudProvider } from './whatsapp/whatsapp-cloud.provider';
import { TelegramProvider } from './telegram/telegram.provider';

/**
 * Registers the external providers into the ProviderRegistry at boot, honouring
 * the inner feature flags. When a flag is off the provider is NOT registered, so
 * `registry.for(id)` throws and the dispatcher marks the delivery
 * `provider_disabled` with a clear reason — never a silent drop.
 *
 * WhatsApp resolves to Baileys (experimental) or Cloud (production) by
 * WHATSAPP_TRANSPORT, so switching transports is a config flip. Providers are
 * pulled from the DI container lazily via ModuleRef so the unselected transport's
 * singleton is only instantiated if actually chosen.
 */
@Injectable()
export class ProviderBootstrapService implements OnModuleInit {
  private readonly logger = new Logger('ProviderBootstrap');

  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    if (process.env.ENABLE_COMMUNICATION_WHATSAPP === 'true') {
      const transport = process.env.WHATSAPP_TRANSPORT ?? 'cloud';
      const provider =
        transport === 'baileys'
          ? this.moduleRef.get(BaileysProvider, { strict: false })
          : this.moduleRef.get(WhatsAppCloudProvider, { strict: false });
      this.registry.register(provider);
      this.logger.log(`WhatsApp provider registered (transport=${transport})`);
    }

    if (process.env.ENABLE_COMMUNICATION_TELEGRAM === 'true') {
      this.registry.register(this.moduleRef.get(TelegramProvider, { strict: false }));
      this.logger.log('Telegram provider registered');
    }
  }
}
