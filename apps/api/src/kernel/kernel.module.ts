import { Global, Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { TenantContextService } from './tenancy/tenant-context.service';
import { PrismaService } from './prisma/prisma.service';
import { EventBus } from './events/event-bus';
import { EventOutboxService } from './events/event-outbox.service';
import { OutboxWorker } from './events/outbox.worker';
import { AuditService } from './audit/audit.service';
import { AuditLogController } from './audit/audit-log.controller';
import { SettingsService } from './settings/settings.service';
import { SettingResolverService } from './settings/setting-resolver.service';
import { SettingsController } from './settings/settings.controller';
import { CompanySettingsController } from './settings/company-settings.controller';
import { ModuleRegistry } from './module-loader/module-registry.service';
import { SequenceService } from './sequence/sequence.service';
import { JwtTokenService } from './auth/jwt-token.service';
import { PasswordService } from './auth/password.service';
import { OneTimeTokenService } from './auth/one-time-token.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { ModuleEnabledGuard } from './module-loader/module-enabled.guard';
import { WorkflowService } from './workflow/workflow.service';
import { WorkflowRegistry } from './workflow/workflow.registry';
import { IdempotencyService } from './idempotency/idempotency.service';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { EncryptionService } from './encryption/encryption.service';
import { NotificationsModule } from './notifications/notifications.module';
import { FilesModule } from './files/files.module';
import { SearchModule } from './search/search.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { RecurringModule } from './recurring/recurring.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { CronWorkersModule } from './workers/cron-workers.module';
import { ThreeWayMatchModule } from './three-way-match/three-way-match.module';
import { LifecycleRegistry } from './lifecycle/lifecycle.registry';
import { LifecycleService } from './lifecycle/lifecycle.service';
import { MilestoneRegistry } from './milestones/milestone.registry';
import { MilestoneService } from './milestones/milestone.service';
import { FulfillmentRegistry } from './fulfillment/fulfillment.registry';

/**
 * The platform runtime (Phase 0). Global so every feature module can inject
 * these services. Registers the two global guards (auth then permissions)
 * and the global throttler guard for edge rate limiting.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot([
      // Default: 100 req / 60s / IP. Specific endpoints (login, MFA, password
      // reset) override with @Throttle({ default: { limit, ttl } }).
      { name: 'default', ttl: 60_000, limit: 100 },
      // A burst tier for normal API traffic — 600 req / 10 min / IP.
      { name: 'burst', ttl: 600_000, limit: 600 },
    ]),
    ScheduleModule.forRoot(),
    NotificationsModule,
    FilesModule,
    SearchModule,
    ApprovalsModule,
    RecurringModule,
    WebhooksModule,
    FeatureFlagsModule,
    CronWorkersModule,
    ThreeWayMatchModule,
  ],
  // CompanySettingsController first: its static `company`/`developer` routes must
  // be registered before SettingsController's catch-all `:key` PUT so
  // `PUT /settings/company` reaches the company handler (same static-first
  // rule documented in settings.controller.ts).
  controllers: [CompanySettingsController, SettingsController, AuditLogController],
  providers: [
    TenantContextService,
    PrismaService,
    EventBus,
    EventOutboxService,
    OutboxWorker,
    AuditService,
    SettingsService,
    SettingResolverService,
    ModuleRegistry,
    SequenceService,
    JwtTokenService,
    PasswordService,
    OneTimeTokenService,
    WorkflowService,
    WorkflowRegistry,
    IdempotencyService,
    IdempotencyInterceptor,
    EncryptionService,
    LifecycleRegistry,
    LifecycleService,
    MilestoneRegistry,
    MilestoneService,
    FulfillmentRegistry,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ModuleEnabledGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [
    TenantContextService,
    PrismaService,
    EventBus,
    EventOutboxService,
    OutboxWorker,
    AuditService,
    SettingsService,
    SettingResolverService,
    ModuleRegistry,
    SequenceService,
    JwtTokenService,
    PasswordService,
    OneTimeTokenService,
    WorkflowService,
    WorkflowRegistry,
    IdempotencyService,
    EncryptionService,
    LifecycleRegistry,
    LifecycleService,
    MilestoneRegistry,
    MilestoneService,
    FulfillmentRegistry,
  ],
})
export class KernelModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({ name: 'kernel', version: '1.5.0', dependencies: [] });
  }
}
