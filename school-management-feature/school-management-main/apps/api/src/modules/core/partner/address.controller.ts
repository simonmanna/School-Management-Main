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
import { AddressService } from './address.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Controller('addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.partner.read)
  list(@Query() query: PaginationDto) {
    return this.addresses.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.partner.read)
  findOne(@Param('id') id: string) {
    return this.addresses.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.partner.create)
  create(@Body() dto: CreateAddressDto) {
    return this.addresses.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.partner.update)
  update(@Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.addresses.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.partner.delete)
  remove(@Param('id') id: string) {
    return this.addresses.remove(id);
  }
}