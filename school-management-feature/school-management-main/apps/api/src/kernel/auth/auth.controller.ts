import { Body, Controller, Delete, Get, Param, Post, Req, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { MfaLoginDto } from './dto/mfa-login.dto';
import { MfaEnrollDto } from './dto/mfa-enroll.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './jwt-token.service';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';

@Controller('auth')
@UseInterceptors(IdempotencyInterceptor)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
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
}