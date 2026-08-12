import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { CashSessionService } from './cash-session.service';
import { IsBoolean, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Min, IsIn } from 'class-validator';
import { PaginationDto } from '../../../kernel/common/pagination.dto';

class OpenSessionDto {
  @IsString() cashRegisterId!: string;
  @IsOptional() @IsNumber() @Min(0) openingFloat?: number;
  @IsOptional() @IsString() notes?: string;
  /** Denomination breakdown captured at open: { "50000": 3, "20000": 5, ... }. */
  @IsOptional() @IsObject() openingDenomination?: Record<string, number>;
  /** Offline-first: when the drawer was actually opened on the device (ISO-8601). */
  @IsOptional() @IsISO8601() occurredAt?: string;
}

class CloseSessionDto {
  @IsNumber() @Min(0) closingCounted!: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() varianceReason?: string;
  @IsOptional() @IsString() @IsIn(['pending_review', 'approved', 'rejected']) varianceStatus?: string;
  /** Manager sign-off for a large variance. */
  @IsOptional() @IsString() approvedById?: string;
  @IsOptional() @IsString() approverEmail?: string;
  @IsOptional() @IsString() managerPin?: string;
  @IsOptional() @IsObject() closingDenomination?: Record<string, number>;
  /** Offline-first: when the drawer was actually closed on the device (ISO-8601). */
  @IsOptional() @IsISO8601() occurredAt?: string;
  /** Optional session ID to close a session opened by another cashier on a shared terminal. */
  @IsOptional() @IsString() sessionId?: string;
}

class RecordMovementDto {
  @IsOptional() @IsString() sessionId?: string;
  @IsString() movementType!: 'pay_in' | 'pay_out' | 'adjustment';
  @IsNumber() amount!: number;
  @IsOptional() @IsString() reason?: string;
  /** Manager sign-off — required for pay_out (cash leaving the drawer). */
  @IsOptional() @IsString() approvedById?: string;
  @IsOptional() @IsString() approverEmail?: string;
  @IsOptional() @IsString() managerPin?: string;
  /** Offline-first: when the movement actually happened on the device (ISO-8601). */
  @IsOptional() @IsISO8601() occurredAt?: string;
}

class ReopenSessionDto {
  @IsString() reason!: string;
}

class BankDepositDto {
  @IsNumber() @Min(0) amount!: number;
  @IsString() bankName!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsNumber() @Min(0) remainingFloat?: number;
  @IsOptional() @IsString() notes?: string;
}

class VarianceUpdateDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() @IsIn(['pending_review', 'approved', 'rejected']) status?: string;
}

class ReconcileSessionDto {
  @IsOptional() @IsNumber() @Min(0) depositAmount?: number;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

class DailyResetDto {
  @IsString() date!: string;
  @IsOptional() @IsBoolean() force?: boolean;
}

@Controller('cash-sessions')
@UseInterceptors(IdempotencyInterceptor)
export class CashSessionController {
  constructor(private readonly sessions: CashSessionService) {}

  @Get('open')
  @RequirePermissions(PERMISSIONS.cashSession.read)
  findOpen() {
    return this.sessions.findOpen();
  }

  @Get('history')
  @RequirePermissions(PERMISSIONS.cashSession.read)
  history(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('registerId') registerId?: string,
  ) {
    return this.sessions.history(
      page ? Math.max(1, Number(page)) : 1,
      perPage ? Math.min(100, Math.max(1, Number(perPage))) : 20,
      registerId,
    );
  }

  @Get('report/daily')
  @RequirePermissions(PERMISSIONS.cashSession.read)
  dailyReconciliation(@Query('date') date: string) {
    return this.sessions.dailyReconciliation(date);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.cashSession.read)
  findOne(@Param('id') id: string) {
    return this.sessions.findById(id);
  }

  @Get(':id/movements')
  @RequirePermissions(PERMISSIONS.cashSession.read)
  getMovements(@Param('id') id: string) {
    return this.sessions.getMovements(id);
  }

  @Get(':id/expected')
  @RequirePermissions(PERMISSIONS.cashSession.read)
  async expected(@Param('id') id: string) {
    const value = await this.sessions.expectedCash(id);
    return { sessionId: id, expectedCash: value.toString() };
  }

  @Post('open')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.open)
  open(@Body() dto: OpenSessionDto) {
    return this.sessions.open(dto);
  }

  @Post('close')
    @Idempotent()
    @RequirePermissions(PERMISSIONS.cashSession.close)
    close(@Body() dto: CloseSessionDto) {
      return this.sessions.close({
        closingCounted: dto.closingCounted,
        notes: dto.notes,
        varianceReason: dto.varianceReason,
        varianceStatus: dto.varianceStatus,
        approvedById: dto.approvedById,
        approverEmail: dto.approverEmail,
        managerPin: dto.managerPin,
        closingDenomination: dto.closingDenomination,
        occurredAt: dto.occurredAt,
        sessionId: dto.sessionId,
      });
    }

  @Post('movement')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.open)
  recordMovement(@Body() dto: RecordMovementDto) {
    return this.sessions.recordMovement(dto.sessionId, {
      movementType: dto.movementType,
      amount: dto.amount,
      reason: dto.reason,
      approvedById: dto.approvedById,
      approverEmail: dto.approverEmail,
      managerPin: dto.managerPin,
      occurredAt: dto.occurredAt,
    });
  }

  @Post(':id/reopen')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.reopen)
  reopen(@Param('id') id: string, @Body() dto: ReopenSessionDto) {
    return this.sessions.reopen(id, dto.reason);
  }

  @Post(':id/banking')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.close)
  banking(@Param('id') id: string, @Body() dto: BankDepositDto) {
    return this.sessions.recordBankDeposit(id, dto);
  }

  @Patch(':id/variance')
  @RequirePermissions(PERMISSIONS.cashSession.close)
  updateVariance(@Param('id') id: string, @Body() dto: VarianceUpdateDto) {
    return this.sessions.updateVariance(id, {
      reason: dto.reason,
      status: dto.status as any,
    });
  }

  @Patch(':id/reconcile')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.reconcile)
  reconcile(@Param('id') id: string, @Body() dto: ReconcileSessionDto) {
    return this.sessions.reconcile(id, {
      depositAmount: dto.depositAmount,
      bankName: dto.bankName,
      reference: dto.reference,
      notes: dto.notes,
    });
  }

  @Post('reconcile/daily')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.reconcile)
  dailyReset(@Body() dto: DailyResetDto) {
    return this.sessions.dailyReset(dto.date);
  }
}