/** Meals V1.5 — cafeteria wallet controller (ledger-backed). */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealWalletService } from './meal-wallet.service';
import { WalletTopUpDto, WalletPurchaseDto, WalletAdjustDto } from './dto.types';

@Controller('school/meals/wallet')
export class MealWalletController {
  constructor(private readonly service: MealWalletService) {}

  @Post('top-up')
  @RequirePermissions(PERMISSIONS.school.manageWallet)
  topUp(@Body() dto: WalletTopUpDto) {
    return this.service.topUp(dto);
  }

  @Post('purchase')
  @RequirePermissions(PERMISSIONS.school.manageWallet)
  purchase(@Body() dto: WalletPurchaseDto) {
    return this.service.purchase(dto);
  }

  @Post('refund')
  @RequirePermissions(PERMISSIONS.school.manageWallet)
  refund(@Body() dto: WalletAdjustDto) {
    return this.service.adjust(dto, 'refund');
  }

  @Post('adjust')
  @RequirePermissions(PERMISSIONS.school.manageWallet)
  adjust(@Body() dto: WalletAdjustDto) {
    return this.service.adjust(dto, 'adjustment');
  }

  @Get(':accountId/history')
  @RequirePermissions(PERMISSIONS.school.mealsRead)
  history(@Param('accountId') accountId: string) {
    return this.service.history(accountId);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.mealsRead)
  byStudent(@Param('studentProfileId') studentProfileId: string) {
    return this.service.byStudent(studentProfileId);
  }

  @Get(':accountId/reconcile')
  @RequirePermissions(PERMISSIONS.school.mealReports)
  reconcile(@Param('accountId') accountId: string) {
    return this.service.reconcile(accountId);
  }
}
