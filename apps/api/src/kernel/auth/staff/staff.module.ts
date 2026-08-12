import { Module } from '@nestjs/common';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { PermissionsController } from './permissions.controller';

/**
 * Staff management — RBAC for users and roles. Sits inside kernel/auth because
 * the user / role entities already live in the kernel schema; we only add the
 * admin endpoints (no schema changes). PasswordService is provided by the
 * global KernelModule, so we don't need to import it here.
 */
@Module({
  controllers: [RolesController, UsersController, PermissionsController],
  providers: [RolesService, UsersService],
  exports: [RolesService, UsersService],
})
export class StaffModule {}
