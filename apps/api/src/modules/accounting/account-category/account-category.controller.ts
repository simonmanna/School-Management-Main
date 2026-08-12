import { Controller, Get, Param } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AccountCategoryService } from './account-category.service';

/**
 * Read-only. The account-category catalog is global and system-managed — it is
 * written solely by the boot seeder, never by a tenant. See
 * AccountCategoryService for why.
 */
@Controller('account-categories')
export class AccountCategoryController {
  constructor(private readonly categories: AccountCategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.accountCategory.read)
  list() {
    return this.categories.list();
  }

  /** Catalog plus this organization's account counts. Above `@Get(':id')`. */
  @Get('usage')
  @RequirePermissions(PERMISSIONS.accountCategory.read)
  usage() {
    return this.categories.listWithUsage();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.accountCategory.read)
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }
}
