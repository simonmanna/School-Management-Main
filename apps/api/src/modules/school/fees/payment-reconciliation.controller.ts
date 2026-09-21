import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PaymentReconciliationService } from './payment-reconciliation.service';

@Controller('school/finance/imports')
export class PaymentReconciliationController {
  constructor(private readonly recon: PaymentReconciliationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list() {
    return this.recon.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  getBatch(@Param('id') id: string) {
    return this.recon.getBatch(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.reconcilePayments)
  importBatch(
    @Body()
    dto: {
      provider: string;
      filename: string;
      statementPeriod?: string;
      rows: Array<{ externalRef: string; payerPhone?: string; payerName?: string; amount: number; transactionDate?: string; narration?: string }>;
    },
  ) {
    return this.recon.importBatch(dto);
  }

  @Post(':batchId/rows/:rowId/confirm')
  @RequirePermissions(PERMISSIONS.school.reconcilePayments)
  confirmRow(
    @Param('batchId') batchId: string,
    @Param('rowId') rowId: string,
    @Body() body: { studentProfileId?: string },
  ) {
    return this.recon.confirmRow(batchId, rowId, body?.studentProfileId);
  }

  /** Post every HIGH-confidence matched row through the payment engine. */
  @Post(':batchId/confirm-high')
  @RequirePermissions(PERMISSIONS.school.reconcilePayments)
  confirmHigh(@Param('batchId') batchId: string) {
    return this.recon.confirmHighConfidence(batchId);
  }
}
