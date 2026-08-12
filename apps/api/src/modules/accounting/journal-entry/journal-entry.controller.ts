import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { JournalEntryService } from './journal-entry.service';
import { CreateJournalEntryDto, ReverseJournalEntryDto } from './dto/create-journal-entry.dto';

@Controller('journal-entries')
@UseInterceptors(IdempotencyInterceptor)
export class JournalEntryController {
  constructor(private readonly entries: JournalEntryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.journalEntry.read)
  list(@Query() query: PaginationDto) {
    return this.entries.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.journalEntry.read)
  findOne(@Param('id') id: string) {
    return this.entries.findOne(id);
  }

  /** Maker: stage a manual entry as a draft (does not post to the ledger). */
  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.journalEntry.create)
  create(@Body() dto: CreateJournalEntryDto) {
    return this.entries.createManual(dto);
  }

  /** Checker: approve + post a draft. Rejected if the approver created the draft. */
  @Post(':id/post')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.journalEntry.post)
  post(@Param('id') id: string) {
    return this.entries.post(id);
  }

  /** Discard a draft that was never posted. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.journalEntry.create)
  discard(@Param('id') id: string) {
    return this.entries.discard(id);
  }

  @Post(':id/reverse')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.journalEntry.reverse)
  reverse(@Param('id') id: string, @Body() dto: ReverseJournalEntryDto) {
    return this.entries.reverse(id, dto);
  }
}
