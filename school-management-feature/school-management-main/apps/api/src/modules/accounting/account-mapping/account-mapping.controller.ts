import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AccountMappingService } from './account-mapping.service';

class SetMappingDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;
}

@Controller('account-mappings')
export class AccountMappingController {
  constructor(private readonly mappings: AccountMappingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.accountMapping.read)
  list() {
    return this.mappings.list();
  }

  @Put(':key')
  @RequirePermissions(PERMISSIONS.accountMapping.update)
  set(@Param('key') key: string, @Body() dto: SetMappingDto) {
    return this.mappings.set(key, dto.accountId);
  }
}
