import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../idempotency/idempotency.interceptor';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('staff')
@Controller('roles')
@UseInterceptors(IdempotencyInterceptor)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.role.read)
  list() {
    return this.roles.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.role.read)
  findOne(@Param('id') id: string) {
    return this.roles.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.role.create)
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.role.update)
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.role.delete)
  remove(@Param('id') id: string) {
    return this.roles.remove(id);
  }
}
