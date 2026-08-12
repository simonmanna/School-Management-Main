import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Public } from '../../kernel/auth/decorators/public.decorator';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import type { AuthUser } from '../../kernel/auth/jwt-token.service';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../../kernel/prisma/prisma.service';

class BootstrapDto {
  @ApiProperty() @IsString() organizationCode!: string;
  @ApiProperty() @IsString() organizationName!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() timezone?: string;
  @ApiProperty({ required: false, default: 'USD' }) @IsOptional() @IsString() currencyCode?: string;
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

class InviteUserDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() firstName!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() lastName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() roleId?: string;
}

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly svc: OrganizationsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Public — create a new tenant. In a real SaaS this sits behind billing. */
  @Public()
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
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const org = await this.prisma.raw.organization.findUnique({ where: { id: user.organizationId } });
    if (!org) throw new Error('Organization not found');
    return org;
  }

  @ApiBearerAuth()
  @Patch('me/settings')
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.svc.updateSettings(dto);
  }

  /**
   * Set the current user's active branch. `defaultBranchId: null` grants
   * org-wide (all-branch) access. Drives BranchScopeService scoping.
   */
  @ApiBearerAuth()
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


  @Get('users')
  async listUsers() {
    return this.prisma.client.user.findMany({
      where: { deletedAt: null },
      include: { roles: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @ApiBearerAuth()
  @Post('users/invite')
  invite(@Body() dto: InviteUserDto) {
    return this.svc.inviteUser(dto);
  }

  @ApiBearerAuth()
  @Patch('users/:id/deactivate')
  async deactivate(@Param('id') id: string) {
    await this.prisma.client.user.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }
}
