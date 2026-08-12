import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { CreditNoteService } from './credit-note.service';
import { CreateCreditNoteDto } from './dto/credit-note.dto';

@Controller('credit-notes')
@UseInterceptors(IdempotencyInterceptor)
export class CreditNoteController {
  constructor(private readonly creditNotes: CreditNoteService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.creditNote.read)
  list(@Query() query: PaginationDto) {
    return this.creditNotes.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.creditNote.read)
  findOne(@Param('id') id: string) {
    return this.creditNotes.findOne(id);
  }

  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.creditNote.create)
  create(@Body() dto: CreateCreditNoteDto) {
    return this.creditNotes.create(dto);
  }

  @Post(':id/post')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.creditNote.post)
  post(@Param('id') id: string) {
    return this.creditNotes.post(id);
  }
}
