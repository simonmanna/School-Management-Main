import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MfaService } from './mfa.service';
import { OneTimeTokenService } from './one-time-token.service';
import { StaffModule } from './staff/staff.module';

/**
 * Auth controller + service + RBAC management.
 *
 * - AuthController / AuthService: login, MFA, refresh, password reset/change.
 * - StaffModule (imported): roles + users + permissions catalog admin endpoints.
 *
 * The JWT/password services, Prisma, audit and event bus are all provided by
 * the global KernelModule. Throttling is registered globally in KernelModule.
 */
@Module({
  imports: [StaffModule],
  controllers: [AuthController],
  providers: [AuthService, MfaService, OneTimeTokenService],
  exports: [MfaService, OneTimeTokenService],
})
export class AuthModule {}
