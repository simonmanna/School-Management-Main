import { Global, Module } from '@nestjs/common';
import { ACCOUNTING_BOOTSTRAP } from '../../../kernel/common/org-bootstrap.tokens';
import { AccountingBootstrapService } from './accounting-bootstrap.service';

/**
 * Publishes the accounting bootstrap hook under a kernel-owned token.
 *
 * Global so `CoreModule` can inject it without importing `AccountingModule` —
 * core sits below accounting in the layering (ADR-011), and a Nest module import
 * is also a source import, which the architecture lint rejects.
 */
@Global()
@Module({
  providers: [
    AccountingBootstrapService,
    { provide: ACCOUNTING_BOOTSTRAP, useExisting: AccountingBootstrapService },
  ],
  exports: [ACCOUNTING_BOOTSTRAP],
})
export class AccountingBootstrapModule {}
