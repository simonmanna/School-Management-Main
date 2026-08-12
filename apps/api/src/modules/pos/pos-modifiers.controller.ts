/**
 * POS P4 — Modifiers + Combos controller.
 * GET endpoints are read-only (`pos:read`); POST endpoints require the
 * product-management permission (re-use `product:create`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosModifiersService } from './pos-modifiers.service';

class CreateGroupDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() category?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() color?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() icon?: string;
  @ApiProperty({ required: false, enum: ['ADD_ON', 'MODIFIER'], default: 'ADD_ON' })
  @IsOptional() @IsIn(['ADD_ON', 'MODIFIER'])
  groupType?: 'ADD_ON' | 'MODIFIER';
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(999) minSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(999) maxSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
}

class CreateModifierDto {
  @ApiProperty() @IsString() groupId!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() kitchenPrintName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(99999999) priceDelta?: number;
  @ApiProperty({ required: false }) @IsOptional() isDefault?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
}

class CreateComboItemDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty() @IsNumber() @Min(1) @Max(9999) quantity!: number;
}

class CreateComboDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(99999999) price!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() imageUrl?: string;
  @ApiProperty({ type: [CreateComboItemDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateComboItemDto)
  items!: CreateComboItemDto[];
}

class UpdateComboDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(99999999) price?: number;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() description?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() imageUrl?: string | null;
  @ApiProperty({ required: false, type: [CreateComboItemDto] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateComboItemDto)
  items?: CreateComboItemDto[];
}

class AssignGroupDto {
  @ApiProperty() @IsString() modifierGroupId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() sortOrder?: number;
}

class UpdateGroupDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() category?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() color?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() icon?: string;
  @ApiProperty({ required: false, enum: ['ADD_ON', 'MODIFIER'] })
  @IsOptional() @IsIn(['ADD_ON', 'MODIFIER'])
  groupType?: 'ADD_ON' | 'MODIFIER';
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(999) minSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(999) maxSelect?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() isActive?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() expectedVersion?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ipAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userAgent?: string;
}

class UpdateModifierDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() kitchenPrintName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(99999999) priceDelta?: number;
  @ApiProperty({ required: false }) @IsOptional() isDefault?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(9999) sortOrder?: number;
  @ApiProperty({ required: false }) @IsOptional() isActive?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() expectedUpdatedAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ipAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userAgent?: string;
}

@ApiTags('pos/modifiers')
@ApiBearerAuth()
@Controller('pos/modifiers')
export class PosModifiersController {
  constructor(private readonly svc: PosModifiersService) {}

  @Get('groups')
  @RequirePermissions('pos:read')
  listGroups(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listGroups({
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('groups')
  @RequirePermissions('product:create')
  createGroup(@Body() dto: CreateGroupDto) {
    return this.svc.createGroup(dto);
  }

  @Post('modifiers')
  @RequirePermissions('product:create')
  createModifier(@Body() dto: CreateModifierDto) {
    return this.svc.createModifier(dto);
  }

  @Get('combos')
  @RequirePermissions('pos:read')
  listCombos() {
    return this.svc.listCombos();
  }

  @Get('combos/:id')
  @RequirePermissions('pos:read')
  getCombo(@Param('id') id: string) {
    return this.svc.getCombo(id);
  }

  @Post('combos')
  @RequirePermissions('product:create')
  createCombo(@Body() dto: CreateComboDto) {
    return this.svc.createCombo(dto);
  }

  @Patch('combos/:id')
  @RequirePermissions('product:update')
  updateCombo(@Param('id') id: string, @Body() dto: UpdateComboDto, @Req() req: any) {
    (dto as any).ipAddress = req.ip;
    (dto as any).userAgent = req.headers?.['user-agent'];
    return this.svc.updateCombo(id, dto as any);
  }

  @Delete('combos/:id')
  @RequirePermissions('product:delete')
  deleteCombo(@Param('id') id: string) {
    return this.svc.deleteCombo(id);
  }

  @Get('products/:productId/bundle')
  @RequirePermissions('pos:read')
  getProductBundle(@Param('productId') productId: string) {
    return this.svc.getProductBundle(productId);
  }

  @Post('products/:productId/groups')
  @RequirePermissions('product:create')
  assignGroup(@Param('productId') productId: string, @Body() dto: AssignGroupDto) {
    return this.svc.assignGroupToProduct(productId, dto.modifierGroupId, dto.sortOrder);
  }

  // ─── Edit / delete (M-E) ───────────────────────────────────────────────

  @Patch('groups/:id')
  @RequirePermissions('product:update')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateGroupDto, @Req() req: any) {
    dto.ipAddress = req.ip;
    dto.userAgent = req.headers?.['user-agent'];
    return this.svc.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  @RequirePermissions('product:delete')
  deleteGroup(@Param('id') id: string) {
    return this.svc.deleteGroup(id);
  }

  @Patch('modifiers/:id')
  @RequirePermissions('product:update')
  updateModifier(@Param('id') id: string, @Body() dto: UpdateModifierDto, @Req() req: any) {
    dto.ipAddress = req.ip;
    dto.userAgent = req.headers?.['user-agent'];
    return this.svc.updateModifier(id, dto);
  }

  @Delete('modifiers/:id')
  @RequirePermissions('product:delete')
  deleteModifier(@Param('id') id: string) {
    return this.svc.deleteModifier(id);
  }

  @Delete('products/:productId/groups/:groupId')
  @RequirePermissions('product:delete')
  unassignGroup(@Param('productId') productId: string, @Param('groupId') groupId: string) {
    return this.svc.unassignGroupFromProduct(productId, groupId);
  }

  /** M-F — modifier sales report (count + add-on revenue per modifier). */
  @Get('report/sales')
  @RequirePermissions('pos:reports')
  modifierSalesReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.modifierSalesReport(from, to);
  }

  // ─── Menu-item modifiers (MENU) ────────────────────────────────────────

  /** All menu items with an isAssigned flag — for the admin checkbox UI. */
  @Get('groups/:id/menu-items')
  @RequirePermissions('pos:read')
  getGroupMenuItems(@Param('id') id: string) {
    return this.svc.getGroupMenuItems(id);
  }

  @Get('menu-items/:menuItemId/bundle')
  @RequirePermissions('pos:read')
  getMenuItemBundle(@Param('menuItemId') menuItemId: string) {
    return this.svc.getMenuItemBundle(menuItemId);
  }

  @Post('menu-items/:menuItemId/groups')
  @RequirePermissions('product:create')
  assignGroupToMenuItem(@Param('menuItemId') menuItemId: string, @Body() dto: AssignGroupDto) {
    return this.svc.assignGroupToMenuItem(menuItemId, dto.modifierGroupId, dto.sortOrder);
  }

  @Delete('menu-items/:menuItemId/groups/:groupId')
  @RequirePermissions('product:delete')
  unassignGroupFromMenuItem(@Param('menuItemId') menuItemId: string, @Param('groupId') groupId: string) {
    return this.svc.unassignGroupFromMenuItem(menuItemId, groupId);
  }
}