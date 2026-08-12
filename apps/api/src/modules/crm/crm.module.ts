import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { CoreModule } from '../core/core.module';
import { CrmService } from './crm.service';
import { CrmAnalyticsService } from './crm-analytics.service';
import { DealsController, ActivitiesController, CrmAnalyticsController } from './crm.controller';

/**
 * CRM module (Phase F.7 → A). Sales pipeline + activity timeline + analytics.
 * Built on top of Partner (no new partner tables). Dedicated `crm:*`
 * permissions (Phase A.4) — CRM access is granted independently of partner
 * management.
 */
@Module({
  imports: [CoreModule],
  controllers: [DealsController, ActivitiesController, CrmAnalyticsController],
  providers: [CrmService, CrmAnalyticsService],
  exports: [CrmService],
})
export class CrmModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'crm',
      version: '2.0.0',
      dependencies: ['core'],
      permissions: [
        'crm:dashboard:read',
        'crm:deal:read',
        'crm:deal:write',
        'crm:activity:read',
        'crm:activity:write',
      ],
    });
  }
}
