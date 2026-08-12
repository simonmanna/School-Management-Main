import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AccountMappingService } from './account-mapping.service';

class SetMappingDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  /** Override the expected-category check. Logged as a deliberate exception. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller('account-mappings')
export class AccountMappingController {
  constructor(private readonly mappings: AccountMappingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.accountMapping.read)
  list() {
    return this.mappings.list();
  }

  /** Catalog of known keys + the categories each expects. Drives the web picker. */
  @Get('registry')
  @RequirePermissions(PERMISSIONS.accountMapping.read)
  registry() {
    return this.mappings.registry();
  }

  /** Required keys with no mapping — these throw at posting time. */
  @Get('missing')
  @RequirePermissions(PERMISSIONS.accountMapping.read)
  missing() {
    return this.mappings.missingRequired();
  }

  @Put(':key')
  @RequirePermissions(PERMISSIONS.accountMapping.update)
  set(@Param('key') key: string, @Body() dto: SetMappingDto) {
    return this.mappings.set(key, dto.accountId, { force: dto.force });
  }
}
