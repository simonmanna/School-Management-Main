import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PortalAccountService, type InvitePortalAccountDto } from './portal-account.service';

/**
 * Registrar-facing provisioning for portal logins. Separate permission from the
 * portal itself (`school:portal:accounts:write`): being able to USE the parent
 * portal must not imply being able to MINT accounts that see other families.
 */
@Controller('school/portal-accounts')
export class PortalAccountController {
  constructor(private readonly accounts: PortalAccountService) {}

  @Post('invite')
  @RequirePermissions(PERMISSIONS.school.managePortalAccounts)
  invite(@Body() dto: InvitePortalAccountDto) {
    return this.accounts.invite(dto);
  }

  @Get('student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.managePortalAccounts)
  listForStudent(@Param('studentProfileId') id: string) {
    return this.accounts.listForStudent(id);
  }

  @Delete(':portalIdentityId')
  @RequirePermissions(PERMISSIONS.school.managePortalAccounts)
  revoke(@Param('portalIdentityId') id: string) {
    return this.accounts.revoke(id);
  }
}
