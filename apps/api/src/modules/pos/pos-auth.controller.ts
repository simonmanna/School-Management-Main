/**
 * POS PIN authentication — cashier login + user switching + self-service PIN/password changes.
 *
 * Uses the existing `User.pinHash` (bcrypt) field. No JWT issued; the frontend
 * stores the verified userId + permissions in a session-level store and sends
 * the userId in the `X-Pos-User` header on subsequent requests.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import { PosAuthService } from './pos-auth.service';
import { IsString, Length, MinLength } from 'class-validator';
import type { AuthUser } from '../../kernel/auth/jwt-token.service';

class PinLoginDto {
  @IsString() userId!: string;
  @IsString() @Length(4, 8) pin!: string;
}

class ChangePinDto {
  @IsString() @Length(4, 8) currentPin!: string;
  @IsString() @Length(4, 8) newPin!: string;
}

class ChangePasswordDto {
  @IsString() @Length(4, 8) currentPin!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

@ApiTags('pos/auth')
@ApiBearerAuth()
@Controller('pos/auth')
export class PosAuthController {
  constructor(private readonly svc: PosAuthService) {}

  @Get('staff')
  @HttpCode(200)
  @RequirePermissions('pos:read')
  listStaff() {
    return this.svc.listStaff();
  }

  @Post('pin-login')
  @HttpCode(200)
  @RequirePermissions('pos:read')
  pinLogin(@Body() dto: PinLoginDto) {
    return this.svc.pinLogin(dto.userId, dto.pin);
  }

  @Post('change-pin')
  @HttpCode(200)
  @RequirePermissions('pos:read')
  changePin(@CurrentUser() user: AuthUser, @Body() dto: ChangePinDto) {
    return this.svc.changePin(user.sub, dto.currentPin, dto.newPin);
  }

  @Post('change-password')
  @HttpCode(200)
  @RequirePermissions('pos:read')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.svc.changePassword(user.sub, dto.currentPin, dto.newPassword);
  }
}
