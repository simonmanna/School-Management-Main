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
import { ContactService } from './contact.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@Controller('contacts')
export class ContactController {
  constructor(private readonly contacts: ContactService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.partner.read)
  list(@Query() query: PaginationDto) {
    return this.contacts.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.partner.read)
  findOne(@Param('id') id: string) {
    return this.contacts.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.partner.create)
  create(@Body() dto: CreateContactDto) {
    return this.contacts.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.partner.update)
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.partner.delete)
  remove(@Param('id') id: string) {
    return this.contacts.remove(id);
  }
}