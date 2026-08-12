/**
 * POS Shift Handover controller (module 8). Gated by pos:close_session — a
 * handover closes the outgoing cashier's session. The incoming PIN and manager
 * approval are verified inside the service.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosShiftService } from './pos-shift.service';

class HandoverBody {
  @ApiProperty() @IsString() cashRegisterId!: string;
  @ApiProperty({ description: 'Outgoing cashier blind cash count at handover.' })
  @IsNumber() @Min(0) closingCounted!: number;
  @ApiProperty() @IsString() incomingUserId!: string;
  @ApiProperty({ description: "Incoming cashier's POS PIN." })
  @IsString() incomingPin!: string;
  @ApiProperty({ description: 'Manager user id approving the handover (needs pos:override).' })
  @IsString() approvedById!: string;
  @ApiProperty({ description: "Approving manager's POS PIN (verified server-side)." })
  @IsString() managerPin!: string;
  @ApiProperty({ required: false, description: 'Required when counted cash differs from expected.' })
  @IsOptional() @IsString() varianceReason?: string;
  @ApiProperty({ required: false, description: 'Incoming opening float. Defaults to the counted cash carried over.' })
  @IsOptional() @IsNumber() @Min(0) openingFloat?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}

@ApiTags('pos/shift')
@ApiBearerAuth()
@Controller('pos/shift')
export class PosShiftController {
  constructor(private readonly svc: PosShiftService) {}

  @Post('handover')
  @RequirePermissions('pos:close_session')
  handover(@Body() body: HandoverBody) {
    return this.svc.handover(body);
  }
}
