/**
 * POS — Menu management HTTP API.
 *
 * Endpoints (all under /api/v1/pos/menu*):
 *   GET    /menu/items                List all (admin view)
 *   GET    /menu/items/available      The shape the POS terminal + digital-menu load on startup
 *   GET    /menu/items/:id            Detail with ingredients
 *   POST   /menu/items                Create
 *   PATCH  /menu/items/:id            Update metadata (price, image, availability, etc.)
 *   PATCH  /menu/items/:id/availability  Quick toggle for 86'ing
 *   DELETE /menu/items/:id            Soft-disable (sets isAvailable=false)
 *
 *   GET    /menu/categories           List active categories (display order)
 *   POST   /menu/categories           Create
 *
 * Auth: global JWT guard is mounted in main.ts (no @UseGuards here). Endpoints
 * are gated by the `@RequirePermissions` decorator where write operations live.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosMenuService } from './pos-menu.service';
import { PosVariantService } from './pos-variant.service';
import { PosAccompanimentService } from './pos-accompaniment.service';
import { PaginationDto } from '../../kernel/common/pagination.dto';

/* ====================== DTOs ====================== */

class CreateMenuItemDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() code?: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ required: false, description: 'Whole currency units (UGX). E.g. 5000 = UGX 5,000' })
  @IsOptional() @IsNumber() basePrice?: number;
  @ApiProperty({ required: false, default: true })
  @IsOptional() @IsBoolean() isInventoryTracked?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() image?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() preparationTime?: number;
  @ApiProperty({ required: false, default: true }) @IsOptional() @IsBoolean() isAvailable?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() displayOrder?: number;
  @ApiProperty({ required: false, type: () => [IngredientDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IngredientDto)
  ingredients?: IngredientDto[];
}
class IngredientDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ required: false, default: 1 }) @IsOptional() @IsNumber() quantity?: number;
}

class UpdateMenuItemDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() code?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsNumber() basePrice?: number | null;
  @ApiProperty({ required: false, default: true })
  @IsOptional() @IsBoolean() isInventoryTracked?: boolean;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() image?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsNumber() preparationTime?: number | null;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isAvailable?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() displayOrder?: number;
  @ApiProperty({ required: false, type: () => [IngredientDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IngredientDto)
  ingredients?: IngredientDto[];
}

class CreateCategoryDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() parentId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() image?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() icon?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() displayOrder?: number;
}

class CreateVariantDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsNumber() @Min(0) price!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
}

class UpdateVariantDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) price?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() expectedUpdatedAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ipAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userAgent?: string;
}

class CreateAccompanimentGroupDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() category?: string;
  @ApiProperty({ required: false, default: true }) @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiProperty({ required: false, default: 1 }) @IsOptional() @IsNumber() @Min(0) @Max(999) minSelect?: number;
  @ApiProperty({ required: false, default: 1 }) @IsOptional() @IsNumber() @Min(0) @Max(999) maxSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
}

class UpdateAccompanimentGroupDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() category?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(999) minSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(999) maxSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() expectedUpdatedAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ipAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userAgent?: string;
}

class CreateAccompanimentOptionDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false, default: 0 }) @IsOptional() @IsNumber() @Min(0) @Max(99999999) priceImpact?: number;
  @ApiProperty({ required: false, default: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() inventoryItemId?: string;
}

class UpdateAccompanimentOptionDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(99999999) priceImpact?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() inventoryItemId?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() expectedUpdatedAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ipAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userAgent?: string;
}

/* ====================== Controller ====================== */

@Controller('pos/menu')
export class PosMenuController {
  constructor(
    private readonly svc: PosMenuService,
    private readonly variantSvc: PosVariantService,
    private readonly accompanimentSvc: PosAccompanimentService,
  ) {}

  // ─── Categories ───
  @Get('categories')
  listCategories() { return this.svc.listCategories(); }

  @Post('categories')
  @RequirePermissions('product:create')
  createCategory(@Body() body: CreateCategoryDto) { return this.svc.createCategory(body); }

  @Patch('categories/:id')
  @RequirePermissions('product:update')
  updateCategory(@Param('id') id: string, @Body() body: Partial<CreateCategoryDto>) {
    return this.svc.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @RequirePermissions('product:delete')
  deleteCategory(@Param('id') id: string) { return this.svc.deleteCategory(id); }

  @Get('categories/deleted')
  @RequirePermissions('menuCategories.view')
  listDeletedCategories() { return this.svc.listDeletedCategories(); }

  @Patch('categories/:id/restore')
  @RequirePermissions('menuCategories.edit')
  restoreCategory(@Param('id') id: string) { return this.svc.restoreCategory(id); }

  // ─── Items ───
  @Get('items/available')
  available() { return this.svc.listAvailable(); }

  @Get('items')
  list(@Query() query: PaginationDto) { return this.svc.listAll(query); }

  @Get('items/:id')
  getOne(@Param('id') id: string) { return this.svc.getOne(id); }

  @Post('items')
  @RequirePermissions('product:create')
  create(@Body() body: CreateMenuItemDto) { return this.svc.create(body); }

  @Patch('items/:id')
  @RequirePermissions('product:update')
  update(@Param('id') id: string, @Body() body: UpdateMenuItemDto) {
    return this.svc.update(id, body);
  }

  @Patch('items/:id/availability')
    @RequirePermissions('product:update')
    setAvail(@Param('id') id: string, @Body() body: { isAvailable: boolean }) {
      return this.svc.setAvailability(id, body.isAvailable);
    }

    @Delete('items/:id')
    @RequirePermissions('product:delete')
    remove(@Param('id') id: string) { return this.svc.disable(id); }

    @Delete('items/:id/hard')
    @RequirePermissions('product:delete')
    hardDelete(@Param('id') id: string) { return this.svc.deleteItem(id); }

    @Patch('items/:id/restore')
    @RequirePermissions('product:update')
    restoreItem(@Param('id') id: string) { return this.svc.restoreItem(id); }

    @Get('items/deleted')
    @RequirePermissions('menuItems.view')
    listDeletedItems() { return this.svc.listDeletedItems(); }

    // ─── Full bundle (terminal) ───────────────────────────────────────────────

  /** All configuration for a menu item: variants, accompaniments, add-ons, modifiers. */
  @Get('items/:id/bundle')
  @RequirePermissions('pos:read')
  getBundle(@Param('id') id: string) {
    return this.svc.getFullBundle(id);
  }

  // ─── Variants ─────────────────────────────────────────────────────────────

  @Get('items/:menuItemId/variants')
  @RequirePermissions('pos:read')
  listVariants(@Param('menuItemId') menuItemId: string) {
    return this.variantSvc.listVariants(menuItemId);
  }

  @Post('items/:menuItemId/variants')
  @RequirePermissions('product:create')
  createVariant(@Param('menuItemId') menuItemId: string, @Body() dto: CreateVariantDto) {
    return this.variantSvc.createVariant(menuItemId, dto);
  }

  @Patch('items/:menuItemId/variants/:variantId')
  @RequirePermissions('product:update')
  updateVariant(@Param('variantId') variantId: string, @Body() dto: UpdateVariantDto, @Req() req: any) {
    (dto as any).ipAddress = req.ip;
    (dto as any).userAgent = req.headers?.['user-agent'];
    return this.variantSvc.updateVariant(variantId, dto as any);
  }

  @Delete('items/:menuItemId/variants/:variantId')
  @RequirePermissions('product:delete')
  deleteVariant(@Param('variantId') variantId: string) {
    return this.variantSvc.deleteVariant(variantId);
  }

  // ─── Accompaniment Groups (standalone CRUD — global, like ModifierGroup) ──

  @Get('accompaniments/groups')
  @RequirePermissions('pos:read')
  listAllAccompanimentGroups(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.accompanimentSvc.listAllGroups({
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('accompaniments/report/sales')
  @RequirePermissions('pos:reports')
  accompanimentSalesReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accompanimentSvc.accompanimentSalesReport(from, to);
  }

  @Post('accompaniments/groups')
  @RequirePermissions('product:create')
  createAccompanimentGroup(@Body() dto: CreateAccompanimentGroupDto) {
    return this.accompanimentSvc.createGroup(dto);
  }

  @Patch('accompaniments/groups/:groupId')
  @RequirePermissions('product:update')
  updateAccompanimentGroup(@Param('groupId') groupId: string, @Body() dto: UpdateAccompanimentGroupDto, @Req() req: any) {
    (dto as any).ipAddress = req.ip;
    (dto as any).userAgent = req.headers?.['user-agent'];
    return this.accompanimentSvc.updateGroup(groupId, dto as any);
  }

  @Delete('accompaniments/groups/:groupId')
  @RequirePermissions('product:delete')
  deleteAccompanimentGroup(@Param('groupId') groupId: string) {
    return this.accompanimentSvc.deleteGroup(groupId);
  }

  // ─── Accompaniment Options ────────────────────────────────────────────────

  @Post('accompaniments/groups/:groupId/options')
  @RequirePermissions('product:create')
  createAccompanimentOption(@Param('groupId') groupId: string, @Body() dto: CreateAccompanimentOptionDto) {
    return this.accompanimentSvc.createOption(groupId, dto);
  }

  @Patch('accompaniments/options/:optionId')
  @RequirePermissions('product:update')
  updateAccompanimentOption(@Param('optionId') optionId: string, @Body() dto: UpdateAccompanimentOptionDto, @Req() req: any) {
    (dto as any).ipAddress = req.ip;
    (dto as any).userAgent = req.headers?.['user-agent'];
    return this.accompanimentSvc.updateOption(optionId, dto as any);
  }

  @Delete('accompaniments/options/:optionId')
  @RequirePermissions('product:delete')
  deleteAccompanimentOption(@Param('optionId') optionId: string) {
    return this.accompanimentSvc.deleteOption(optionId);
  }

  // ─── Per-MenuItem assignment (which groups apply to this item) ───────────

  @Get('items/:menuItemId/accompaniments')
  @RequirePermissions('pos:read')
  listMenuItemAccompaniments(@Param('menuItemId') menuItemId: string) {
    return this.accompanimentSvc.listGroupsForMenuItem(menuItemId);
  }

  @Post('items/:menuItemId/accompaniments')
  @RequirePermissions('product:create')
  assignAccompanimentGroup(@Param('menuItemId') menuItemId: string, @Body() dto: { accompanimentGroupId: string; sortOrder?: number }) {
    return this.accompanimentSvc.assignGroupToMenuItem(menuItemId, dto.accompanimentGroupId, dto.sortOrder);
  }

  @Delete('items/:menuItemId/accompaniments/:groupId')
  @RequirePermissions('product:delete')
  unassignAccompanimentGroup(@Param('menuItemId') menuItemId: string, @Param('groupId') groupId: string) {
    return this.accompanimentSvc.unassignGroupFromMenuItem(menuItemId, groupId);
  }
}
