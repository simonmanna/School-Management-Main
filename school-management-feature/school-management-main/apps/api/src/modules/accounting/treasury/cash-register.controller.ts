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
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CashRegisterService } from './cash-register.service';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

class CreateCashRegisterDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() defaultAccountId!: string;
  @IsOptional() @IsString() locationId?: string;
}

class UpdateCashRegisterDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() defaultAccountId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('cash-registers')
export class CashRegisterController {
  constructor(private readonly registers: CashRegisterService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.cashRegister.read)
  list(@Query() query: PaginationDto) {
    return this.registers.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.cashRegister.read)
  findOne(@Param('id') id: string) {
    return this.registers.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.cashRegister.create)
  create(@Body() dto: CreateCashRegisterDto) {
    return this.registers.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.cashRegister.update)
  update(@Param('id') id: string, @Body() dto: UpdateCashRegisterDto) {
    return this.registers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.cashRegister.delete)
  remove(@Param('id') id: string) {
    return this.registers.remove(id);
  }
}