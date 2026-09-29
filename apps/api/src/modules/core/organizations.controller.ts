import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Public } from '../../kernel/auth/decorators/public.decorator';
import { assertHostSecret } from '../../kernel/auth/guards/operator-secret.guard';
import { NoPermissionRequired } from '../../kernel/auth/decorators/no-permission-required.decorator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import type { AuthUser } from '../../kernel/auth/jwt-token.service';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../../kernel/prisma/prisma.service';

class BootstrapDto {
  @ApiProperty() @IsString() organizationCode!: string;
  @ApiProperty() @IsString() organizationName!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() timezone?: string;
  @ApiProperty({ required: false, default: 'UGX' }) @IsOptional() @IsString() currencyCode?: string;
  @ApiProperty() @IsEmail() adminEmail!: string;
  @ApiProperty() @IsString() adminFirstName!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() adminLastName?: string;
  @ApiProperty({ required: false, minLength: 8 }) @IsOptional() @IsString() @MinLength(8) adminPassword?: string;
}

class AcceptInviteDto {
  @ApiProperty() @IsString() token!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) newPassword!: string;
}

class UpdateSettingsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() timezone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currencyCode?: string;
  @ApiProperty({ type: 'object', additionalProperties: true, required: false })
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

/**
 * Guards run before pipes, so an anonymous caller gets 403 before the body is
 * validated — a 400 listing the required fields would document the endpoint
 * for them (E2E audit S1).
 */
@Injectable()
export class ProvisioningSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest().headers?.['x-provisioning-secret'];
    assertProvisioningSecret(Array.isArray(header) ? header[0] : header);
    return true;
  }
}

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly svc: OrganizationsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create a new tenant. Not reachable by an ordinary caller: the request must
   * carry `X-Provisioning-Secret` matching the `PROVISIONING_SECRET` env var.
   * With the env var unset the endpoint is closed — tenant creation is an
   * operator action, never a self-service one.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @UseGuards(ProvisioningSecretGuard)
  @Post('bootstrap')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.svc.bootstrap(dto);
  }

  @Public()
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.svc.acceptInvite(dto.token, dto.newPassword);
  }

  @ApiBearerAuth()
  @NoPermissionRequired('returns the organization of the calling user')
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const org = await this.prisma.raw.organization.findUnique({ where: { id: user.organizationId } });
    if (!org) throw new Error('Organization not found');
    return org;
  }

  @ApiBearerAuth()
  @RequirePermissions('setting:update')
  @Patch('me/settings')
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.svc.updateSettings(dto);
  }

  /**
   * Set the current user's active branch. `defaultBranchId: null` grants
   * org-wide (all-branch) access. Drives BranchScopeService scoping.
   */
  @ApiBearerAuth()
  @NoPermissionRequired('sets the active branch of the calling user')
  @Patch('me/branch')
  async setMyBranch(
    @CurrentUser() user: AuthUser,
    @Body() dto: { defaultBranchId: string | null },
  ) {
    await this.prisma.client.user.update({
      where: { id: user.sub },
      data: { defaultBranchId: dto.defaultBranchId ?? null },
    });
    return { ok: true, defaultBranchId: dto.defaultBranchId ?? null };
  }

  // User listing, invitation and deactivation live on `/users` (UsersService),
  // which enforces the role-assignment and manage-target escalation guards.
}

/** Constant-time check of the operator provisioning secret. Fails closed when unset. */
export function assertProvisioningSecret(provided: string | undefined): void {
  assertHostSecret('PROVISIONING_SECRET', provided, 'Tenant provisioning is not permitted');
}
