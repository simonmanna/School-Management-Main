import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { PosModule } from '../pos/pos.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ProductModule } from '../core/product/product.module';
import { SyncController } from './sync.controller';
import { SyncDevicesService } from './sync-devices.service';
import { SyncPullService } from './sync-pull.service';
import { SyncPushService } from './sync-push.service';
import { SyncDeadLetterService } from './sync-dead-letter.service';
import { DeviceTokenGuard } from './device-token.guard';

/**
 * P1 offline sync — device registry + pull/push data plane for offline-first
 * clients (Kotlin Android app, offline web POS). See docs/sync-protocol.md.
 */
@Module({
  imports: [PosModule, AccountingModule, ProductModule],
  controllers: [SyncController],
  providers: [SyncDevicesService, SyncPullService, SyncPushService, SyncDeadLetterService, DeviceTokenGuard],
})
export class SyncModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'sync',
      version: '1.0.0',
      dependencies: ['pos', 'accounting', 'core'],
      // Devices authenticate with a device token (DeviceTokenGuard), not with
      // user permissions, so this module owns none.
      permissions: [],
    });
  }
}
