import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MessagingProvider, ProviderId } from './messaging-provider.interface';
import { InternalProvider } from './internal/internal.provider';

/**
 * Resolves a `providerId` to its live adapter. WhatsApp resolution honours
 * `WHATSAPP_TRANSPORT` (`baileys` | `cloud`) so swapping the experimental
 * Baileys transport for the production Cloud API is a config flip, never a
 * call-site change. External providers register themselves here at boot when
 * their feature flag is on; when off, resolution throws and the dispatcher
 * marks the delivery failed with a clear reason.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger('ProviderRegistry');
  private readonly providers = new Map<ProviderId, MessagingProvider>();

  constructor(private readonly internal: InternalProvider) {
    this.register(internal);
  }

  register(provider: MessagingProvider): void {
    this.providers.set(provider.id, provider);
    this.logger.log(`registered provider '${provider.id}'`);
  }

  /** Throws NotFound if the provider is not registered (its flag is off). */
  for(providerId: string): MessagingProvider {
    const p = this.providers.get(providerId as ProviderId);
    if (!p) {
      throw new NotFoundException(
        `Communication provider '${providerId}' is not enabled on this server.`,
      );
    }
    return p;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId as ProviderId);
  }

  list(): MessagingProvider[] {
    return [...this.providers.values()];
  }
}
