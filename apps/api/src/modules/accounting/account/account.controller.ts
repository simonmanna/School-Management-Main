import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

class AccountTreeQueryDto {
  @IsOptional() @IsString() includeInactive?: string;
  @IsOptional() @IsString() includeBalances?: string;
  @IsOptional() @IsString() asOf?: string;
  @IsOptional() @IsString() categoryKey?: string;
  @IsOptional() @IsString() classification?: string;
}

class ReorderItemDto {
  @IsString() id!: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() parentAccountId?: string | null;
}

class ReorderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}

class DeprecateDto {
  @IsOptional() @IsBoolean() deprecated?: boolean;
}

@Controller('accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.account.read)
  list(@Query() query: PaginationDto) {
    return this.accounts.list({ ...query, pageSize: query.pageSize ?? 200 });
  }

  /**
   * The chart of accounts as a forest. MUST stay above `@Get(':id')` — Nest
   * matches routes in declaration order and 'tree' would otherwise be read as an id.
   */
  @Get('tree')
  @RequirePermissions(PERMISSIONS.account.read)
  tree(@Query() query: AccountTreeQueryDto) {
    return this.accounts.tree({
      includeInactive: query.includeInactive === 'true',
      includeBalances: query.includeBalances === 'true',
      asOf: query.asOf,
      categoryKey: query.categoryKey,
      classification: query.classification,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.account.read)
  findOne(@Param('id') id: string) {
    return this.accounts.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.account.create)
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }

  /** Bulk sortOrder / parent update for drag-reorder. Above `@Patch(':id')`. */
  @Patch('reorder')
  @RequirePermissions(PERMISSIONS.account.update)
  reorder(@Body() dto: ReorderDto) {
    return this.accounts.reorder(dto.items);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.account.update)
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(id, dto);
  }

  /** Soft-retire: blocks new postings, preserves history. */
  @Patch(':id/deprecate')
  @RequirePermissions(PERMISSIONS.account.update)
  deprecate(@Param('id') id: string, @Body() dto: DeprecateDto) {
    return this.accounts.deprecate(id, dto.deprecated ?? true);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.account.delete)
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
