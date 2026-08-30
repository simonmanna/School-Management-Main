import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';
import { IncomeHeadsController } from './income-heads.controller';
import { IncomeHeadsService } from './income-heads.service';

/**
 * Other Revenue / Income tracker (fine, donation, grant, interest, canteen…).
 * Imports AccountingModule for PostingService so cash-ins post Dr cash/bank /
 * Cr revenue into the shared GL. All other dependencies (Prisma, tenancy,
 * audit, events, sequence) come from the global KernelModule.
 */
@Module({
  imports: [AccountingModule],
  controllers: [IncomeController, IncomeHeadsController],
  providers: [IncomeService, IncomeHeadsService],
  exports: [IncomeService, IncomeHeadsService],
})
export class IncomeModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'income',
      version: '1.0.0',
      dependencies: ['core', 'accounting'],
      permissions: [...Object.values(PERMISSIONS.income)],
    });
  }
}
