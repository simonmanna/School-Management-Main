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
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../idempotency/idempotency.interceptor';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('staff')
@Controller('users')
@UseInterceptors(IdempotencyInterceptor)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.user.read)
  list(@Query() query: { search?: string; page?: string; pageSize?: string }) {
    return this.users.list({
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.user.read)
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.user.create)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.user.update)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.user.update)
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(id, dto.newPassword);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.user.update)
  unlock(@Param('id') id: string) {
    return this.users.unlock(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.user.delete)
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
