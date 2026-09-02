import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ReadOnlyMiddleware } from './kernel/common/read-only.middleware';
import { LoggerModule } from 'nestjs-pino';
import { KernelModule } from './kernel/kernel.module';
import { AuthModule } from './kernel/auth/auth.module';
import { CoreModule } from './modules/core/core.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BeverageModule } from './modules/beverage/beverage.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { IncomeModule } from './modules/income/income.module';
import { CrmModule } from './modules/crm/crm.module';
import { HealthModule } from './health/health.module';
import { MetricsController } from './observability/metrics.controller';
import { AppController } from './app.controller';
import { PosModule } from './modules/pos/pos.module';
import { SyncModule } from './modules/sync/sync.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { BackupModule } from './modules/backup/backup.module';
import { FixedAssetModule } from './modules/fixed-asset/fixed-asset.module';
import { TaskModule } from './modules/task/task.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { RentalModule } from './modules/rental/rental.module';
import { RepairModule } from './modules/repair/repair.module';
import { HrModule } from './modules/hr/hr.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { SchoolModule } from './modules/school/school.module';

/**
 * Opt-in modules. A café upgrading to this schema gets every table, but should
 * only run the subsystems it actually uses — hiding navigation is not enough,
 * because a registered module still runs its `OnModuleInit`, crons, queue
 * consumers and event handlers (BeverageModule has a boot hook). Gating the
 * import is the only way to keep unused code fully dark.
 *
 * Default OFF. Flip one at a time, one restart each, once the release is stable.
 */
const enabled = (flag: string): boolean => process.env[flag] === 'true';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
        // Phase 7 — personal data is excluded from logs.
        //
        // pino-http does not serialise a request body by default, so the
        // `req.body.*` paths below are a belt-and-braces guard for the day
        // somebody adds a body serialiser to debug an endpoint. The paths that
        // matter TODAY are the query strings: a school's logs are read by
        // whoever supports the server, and `?search=Nakato%20Sarah` puts a
        // named child in a file that outlives the request.
        //
        // Ids are deliberately NOT redacted. A studentProfileId is meaningless
        // without the database, and without it no incident can be traced.
        redact: {
          paths: [
            // Credentials and session material.
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.refreshToken',
            'req.body.accessToken',
            'req.body.mfaSecret',
            'req.body.code',
            'req.body.newPassword',
            'req.body.currentPassword',
            'req.body.token',
            'req.body.pin',
            // Free-text search: the commonest way a learner's name reaches a log.
            'req.query.search',
            'req.query.q',
            'req.query.name',
            'req.query.phone',
            // Personal data on the school and family records.
            'req.body.phone',
            'req.body.email',
            'req.body.msisdn',
            'req.body.dateOfBirth',
            'req.body.nationalId',
            'req.body.guardianPhone',
            'req.body.indexNumber',
            'req.body.candidateNumber',
          ],
          censor: '[REDACTED]',
        },
        genReqId: (req) => ((req.headers['x-request-id'] as string) ?? undefined) as any,
        customProps: () => ({ service: 'cafe-pos-api' }),
      },
    }),
    KernelModule,
        DocumentsModule,
        AuthModule,
    CoreModule,
    AccountingModule,
    InventoryModule,
    InvoicingModule,
    ProcurementModule,
    ExpensesModule,
    IncomeModule,
    CrmModule,
    PosModule,
    SyncModule,
    BackupModule,
    HealthModule,
    ...(enabled('ENABLE_BEVERAGE') ? [BeverageModule] : []),
    ...(enabled('ENABLE_ASSETS') ? [FixedAssetModule] : []),
    ...(enabled('ENABLE_TASKS') ? [TaskModule] : []),
    ...(enabled('ENABLE_MANUFACTURING') ? [ManufacturingModule] : []),
    ...(enabled('ENABLE_RENTAL') ? [RentalModule] : []),
    ...(enabled('ENABLE_REPAIR') ? [RepairModule] : []),
    ...(enabled('ENABLE_HR') ? [HrModule] : []),
        ...(enabled('ENABLE_ORDERS') ? [OrdersModule] : []),
    ...(enabled('ENABLE_COMMUNICATION') ? [CommunicationModule] : []),
    ...(enabled('ENABLE_SCHOOL') ? [SchoolModule] : []),
      ],
  controllers: [AppController, MetricsController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // P4: on the cloud reporting replica (READ_ONLY_MODE=true) this rejects
    // every write before it reaches a handler. No-op on the cafe LAN server.
    consumer.apply(ReadOnlyMiddleware).forRoutes('*');
  }
}
