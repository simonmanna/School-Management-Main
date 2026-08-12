/**
 * POS Phase A — Manager-override controller.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import { PosOverridesService } from './pos-overrides.service';

class SetPinDto {
  @ApiProperty({ minLength: 4, maxLength: 8, description: '4–8 digit numeric PIN' })
  @IsString() pin!: string;
}

class VerifyPinDto {
  @ApiProperty() @IsString() pin!: string;
}

class VerifyOverrideDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() pin?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() password?: string;
  @ApiProperty({ enum: ['discount', 'void', 'manual_refund'] })
  @IsIn(['discount', 'void', 'manual_refund'])
  overrideKind!: 'discount' | 'void' | 'manual_refund';
}

@ApiTags('pos/override')
@ApiBearerAuth()
@Controller('pos/override')
export class PosOverridesController {
  constructor(private readonly svc: PosOverridesService) {}

  /** Manager sets their own PIN. */
  @Post('pin')
  @RequirePermissions('pos:override')
  setPin(@CurrentUser() user: { sub: string }, @Body() dto: SetPinDto) {
    if (!user?.sub) throw new BadRequestException('No user in context');
    return this.svc.setPin(user.sub, dto.pin);
  }

  /** Cashier verifies a manager's credentials. */
  @Post('verify')
  @RequirePermissions('pos:read')
  verify(@Body() dto: VerifyOverrideDto) {
    return this.svc.verify(dto);
  }

  /** Current user verifies their own PIN (e.g. to delete a cart item). */
  @Post('verify-pin')
  @RequirePermissions('pos:read')
  verifyPin(@CurrentUser() user: { sub: string }, @Body() dto: VerifyPinDto) {
    if (!user?.sub) throw new BadRequestException('No user in context');
    return this.svc.verifyCurrentUserPin(user.sub, dto.pin);
  }
}