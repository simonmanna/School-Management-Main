import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsDefined } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { SettingsService } from './settings.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';

class SetSettingDto {
  @IsDefined()
  value!: unknown;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.setting.read)
  list() {
    return this.settings.listForOrganization();
  }

  @Put(':key')
  @RequirePermissions(PERMISSIONS.setting.update)
  set(@Param('key') key: string, @Body() dto: SetSettingDto) {
    return this.settings.set(key, dto.value);
  }
}
