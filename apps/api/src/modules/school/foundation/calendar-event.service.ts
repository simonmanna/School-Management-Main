import { Injectable } from '@nestjs/common';
import type { SchoolCalendarEvent } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateCalendarEventDto, UpdateCalendarEventDto } from './config.dto';

@Injectable()
export class CalendarEventService extends BaseCrudService<
  SchoolCalendarEvent,
  CreateCalendarEventDto,
  UpdateCalendarEventDto
> {
  protected readonly entityName = 'SchoolCalendarEvent';
  protected readonly searchFields = ['title', 'description'];
  protected readonly defaultOrderBy = { startDate: 'asc' as const };

  constructor(prisma: PrismaService) {
    super(prisma.client.schoolCalendarEvent as unknown as CrudDelegate);
  }
}
