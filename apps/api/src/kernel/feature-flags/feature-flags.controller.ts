import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { ModuleRegistry } from '../module-loader/module-registry.service';
import { FeatureFlagsService } from './feature-flags.service';

class SetFlagDto {
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true, required: false })
  @IsOptional() payload?: Record<string, unknown>;
}

class SetModuleConfigDto {
  @ApiProperty({ type: 'object', additionalProperties: true, required: false })
  @IsOptional() config?: Record<string, unknown>;
}

@ApiTags('feature-flags')
@ApiBearerAuth()
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(
    private readonly svc: FeatureFlagsService,
    private readonly registry: ModuleRegistry,
  ) {}

  @Get() list() { return this.svc.list(); }
  @Post() set(@Body() dto: SetFlagDto) { return this.svc.set(dto.key, dto.enabled, dto.payload); }
  @Delete(':key') unset(@Param('key') key: string) { return this.svc.unset(key).then(() => ({ ok: true })); }

  /**
   * The modules this deployment can actually serve — i.e. every module whose
   * NestJS module was imported at boot and registered a manifest (ADR-005).
   * The Modules page renders this rather than a hardcoded catalog, so it can
   * never offer a module the process does not have, nor hide one it does.
   */
  @Get('modules/catalog') catalog() {
    return this.registry
      .list()
      .map((m) => ({ name: m.name, version: m.version, dependencies: m.dependencies }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  @Get('modules') modules() { return this.svc.listModules(); }
  @Post('modules/:name/enable') enable(@Param('name') name: string, @Body() dto: SetModuleConfigDto) {
    return this.svc.enableModule(name, dto.config);
  }
  @Patch('modules/:name/disable') disable(@Param('name') name: string) {
    return this.svc.disableModule(name).then(() => ({ ok: true }));
  }
}
