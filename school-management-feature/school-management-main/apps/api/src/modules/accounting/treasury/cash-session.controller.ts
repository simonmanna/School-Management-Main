import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { CashSessionService } from './cash-session.service';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

class OpenSessionDto {
  @IsString() cashRegisterId!: string;
  @IsOptional() @IsNumber() @Min(0) openingFloat?: number;
  @IsOptional() @IsString() notes?: string;
}

class CloseSessionDto {
  @IsNumber() closingCounted!: number;
  @IsOptional() @IsString() notes?: string;
}

class RecordMovementDto {
  @IsOptional() @IsString() sessionId?: string;
  @IsString() movementType!: 'pay_in' | 'pay_out' | 'adjustment';
  @IsNumber() amount!: number;
  @IsOptional() @IsString() reason?: string;
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
    return this.sessions.close(dto);
  }

  @Post('movement')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.cashSession.open)
  recordMovement(@Body() dto: RecordMovementDto) {
    return this.sessions.recordMovement(dto.sessionId, {
      movementType: dto.movementType,
      amount: dto.amount,
      reason: dto.reason,
    });
  }
}