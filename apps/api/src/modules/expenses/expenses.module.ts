import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';

/**
 * Standalone expense tracker (petty-cash / operating expenses), separate from
 * vendor bills (AP). Imports AccountingModule for PostingService so cash-outs
 * post Dr expense / Cr cash-bank into the shared GL. All other dependencies
 * (Prisma, tenancy, audit, events, sequence) come from the global KernelModule.
 */
@Module({
  imports: [AccountingModule],
  controllers: [ExpensesController, ExpenseCategoriesController],
  providers: [ExpensesService, ExpenseCategoriesService],
  exports: [ExpensesService, ExpenseCategoriesService],
})
export class ExpensesModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'expenses',
      version: '1.0.0',
      dependencies: ['core', 'accounting'],
      permissions: [...Object.values(PERMISSIONS.expense)],
    });
  }
}
