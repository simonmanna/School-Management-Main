import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { OneTimeTokenService } from './one-time-token.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { MfaLoginDto } from './dto/mfa-login.dto';
import { MfaEnrollDto } from './dto/mfa-enroll.dto';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './jwt-token.service';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';

@ApiTags('auth')
@Controller('auth')
@UseInterceptors(IdempotencyInterceptor)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly tokens: OneTimeTokenService,
  ) {}

  /**
   * Phase B1: rate-limit on login. 10 attempts / 5 min / IP. Combined with
   * the per-account lockout (10 failed → 15min lock), this gives defense in
   * depth against credential stuffing.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 5 * 60 * 1000 } })
  @Idempotent()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 5 * 60 * 1000 } })
  @Post('mfa-login')
  mfaLogin(@Body() dto: MfaLoginDto, @Req() req: Request) {
    return this.auth.mfaLogin(dto, req);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto, req);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeSession(user, id);
  }

  // ---- MFA enrollment ----

  /** Step 1: returns the TOTP secret + QR code. Secret is not yet persisted. */
  @Post('mfa/enroll')
  enroll(@CurrentUser() user: AuthUser) {
    return this.auth.enrollMfa(user);
  }

  /** Step 2: verify a TOTP code, then persist the secret. */
  @Post('mfa/verify')
  verifyEnroll(@CurrentUser() user: AuthUser, @Body() dto: MfaEnrollDto) {
    return this.auth.verifyMfaEnrollment(user, dto.code);
  }

  @Post('mfa/disable')
  disable(@CurrentUser() user: AuthUser, @Body() dto: MfaEnrollDto) {
    return this.auth.disableMfa(user, dto.code);
  }

  // ---- Password reset / change ----

  /** Step 1: request a reset link. Always returns ok (enumeration protection). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.tokens.requestReset(dto.email, dto.organizationCode, req);
  }

  /** Step 2: apply a reset token + new password. */
  @Public()
  @HttpCode(200)
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.tokens.applyReset(dto.token, dto.newPassword);
  }

  /** Authenticated password change (current password required). */
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  async change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}