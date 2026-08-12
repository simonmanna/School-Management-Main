import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MfaService } from './mfa.service';

/**
 * Auth controller + service. The JWT/password services, Prisma, audit and
 * event bus are all provided by the global KernelModule.
 *
 * Phase B1: throttler (rate-limit on auth endpoints) + MFA service.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60 * 1000, // 1 minute
        limit: 60,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, MfaService],
  exports: [MfaService],
})
export class AuthModule {}