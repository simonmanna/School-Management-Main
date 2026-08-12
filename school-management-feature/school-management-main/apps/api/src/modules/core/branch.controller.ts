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
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { BranchService } from './branch.service';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

class CreateBranchDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() timezone?: string;
}

class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('branches')
export class BranchController {
  constructor(private readonly branches: BranchService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.branch.read)
  list(@Query() query: PaginationDto) {
    return this.branches.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.branch.read)
  findOne(@Param('id') id: string) {
    return this.branches.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.branch.create)
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.branch.update)
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.branch.delete)
  remove(@Param('id') id: string) {
    return this.branches.remove(id);
  }
}