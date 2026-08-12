import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { INVENTORY_MOVEMENT_TYPES, PERMISSIONS } from '@erp/shared';
import type { InventoryMovementType } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { InventoryPostingRuleControllerService } from './posting-rule.controller';

@Controller('inventory/posting-rules')
export class PostingRuleController {
  constructor(private readonly svc: InventoryPostingRuleControllerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.read)
  list(
    @Query('movementType') movementType?: string,
    @Query('productId') productId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.svc.list(movementType, productId, categoryId);
  }

  @Get('overview')
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.read)
  overview() {
    return this.svc.overview();
  }

  @Get('movement-types')
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.read)
  movementTypes() {
    return INVENTORY_MOVEMENT_TYPES.map((t) => ({
      code: t,
      label: t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));
  }

  @Get('resolve-preview')
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.read)
  resolvePreview(
    @Query('productId') productId: string,
    @Query('movementType') movementType: InventoryMovementType,
  ) {
    return this.svc.resolvePreview(productId, movementType);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.create)
  create(
    @Body()
    dto: {
      movementType: InventoryMovementType;
      lineIndex: number;
      debitOrCredit: 'debit' | 'credit';
      accountSource: string;
      accountMappingKey?: string;
      literalAccountId?: string;
      productId?: string;
      categoryId?: string;
    },
  ) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.update)
  update(
    @Param('id') id: string,
    @Body()
    dto: {
      accountSource?: string;
      accountMappingKey?: string;
      literalAccountId?: string;
      isActive?: boolean;
    },
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.inventoryPostingRule.delete)
  async remove(@Param('id') id: string) {
    await this.svc.remove(id);
  }
}
