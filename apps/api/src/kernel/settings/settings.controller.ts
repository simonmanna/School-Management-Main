import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { IsBoolean, IsDefined, IsIn, IsOptional, IsString } from 'class-validator';
import {
  COSTING_METHODS,
  PERMISSIONS,
  STOCK_DISTRIBUTION_STRATEGIES,
  type CostingMethod,
  type StockDistributionStrategy,
} from '@erp/shared';
import { SettingsService } from './settings.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { ScopeType } from './setting-registry';

const SCOPE_TYPES = ['organization', 'warehouse', 'category', 'product'] as const;

class SetSettingDto {
  @IsDefined()
  value!: unknown;

  @IsOptional()
  @IsIn([...SCOPE_TYPES])
  scopeType?: ScopeType;

  @IsOptional()
  @IsString()
  scopeId?: string;
}

/** Org-level inventory-tracking defaults new products inherit. All optional (partial update). */
class InventoryDefaultsDto {
  @IsOptional()
  @IsIn([...COSTING_METHODS])
  costingMethod?: CostingMethod;

  @IsOptional()
  @IsIn([...STOCK_DISTRIBUTION_STRATEGIES])
  pickingStrategy?: StockDistributionStrategy;

  @IsOptional()
  @IsBoolean()
  batchTracking?: boolean;

  @IsOptional()
  @IsBoolean()
  expiryTracking?: boolean;

  @IsOptional()
  @IsBoolean()
  serialTracking?: boolean;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.setting.read)
  list() {
    return this.settings.listForOrganization();
  }

  // NOTE: declared before the `:key` routes so the static path wins the match.
  @Get('inventory-defaults')
  @RequirePermissions(PERMISSIONS.setting.read)
  getInventoryDefaults() {
    return this.settings.getInventoryDefaults();
  }

  @Put('inventory-defaults')
  @RequirePermissions(PERMISSIONS.setting.update)
  setInventoryDefaults(@Body() dto: InventoryDefaultsDto) {
    return this.settings.setInventoryDefaults({ ...dto });
  }

  /**
   * Effective values for a registry group at a scope, each tagged with the level
   * it resolved from. e.g. GET /settings/effective?group=inventory&productId=abc
   */
  @Get('effective')
  @RequirePermissions(PERMISSIONS.setting.read)
  effective(
    @Query('group') group: 'inventory' | 'accounting' | 'purchasing',
    @Query('warehouseId') warehouseId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('productId') productId?: string,
  ) {
    const resolved: 'inventory' | 'accounting' | 'purchasing' =
      group === 'accounting' || group === 'purchasing' ? group : 'inventory';
    return this.settings.listEffective(resolved, {
      warehouseId,
      categoryId,
      productId,
    });
  }

  @Put(':key')
  @RequirePermissions(PERMISSIONS.setting.update)
  set(@Param('key') key: string, @Body() dto: SetSettingDto) {
    return this.settings.set(key, dto.value, { scopeType: dto.scopeType, scopeId: dto.scopeId });
  }

  /** Remove an override at a scope so the value falls back up the cascade. */
  @Delete(':key')
  @RequirePermissions(PERMISSIONS.setting.update)
  unset(
    @Param('key') key: string,
    @Query('scopeType') scopeType?: ScopeType,
    @Query('scopeId') scopeId?: string,
  ) {
    return this.settings.unset(key, { scopeType, scopeId });
  }
}
