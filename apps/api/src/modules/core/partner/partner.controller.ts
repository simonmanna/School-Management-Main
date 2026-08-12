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
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';

@Controller('partners')
export class PartnerController {
  constructor(private readonly partners: PartnerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.partner.read)
  list(@Query() query: PaginationDto) {
    return this.partners.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.partner.read)
  findOne(@Param('id') id: string) {
    return this.partners.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.partner.create)
  create(@Body() dto: CreatePartnerDto) {
    return this.partners.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.partner.update)
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.partner.delete)
  remove(@Param('id') id: string) {
    return this.partners.remove(id);
  }
}
