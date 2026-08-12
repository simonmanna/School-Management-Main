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
import { JournalService } from './journal.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';

@Controller('journals')
export class JournalController {
  constructor(private readonly journals: JournalService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.journal.read)
  list(@Query() query: PaginationDto) {
    return this.journals.list({ ...query, pageSize: query.pageSize ?? 100 });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.journal.read)
  findOne(@Param('id') id: string) {
    return this.journals.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.journal.create)
  create(@Body() dto: CreateJournalDto) {
    return this.journals.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.journal.update)
  update(@Param('id') id: string, @Body() dto: UpdateJournalDto) {
    return this.journals.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.journal.delete)
  remove(@Param('id') id: string) {
    return this.journals.remove(id);
  }
}
