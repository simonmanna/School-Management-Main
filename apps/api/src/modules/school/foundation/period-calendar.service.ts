import { Injectable } from '@nestjs/common';
import type { Period, SchoolCalendarEvent } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type {
  CreateCalendarEventDto,
  CreatePeriodDto,
  UpdateCalendarEventDto,
  UpdatePeriodDto,
} from './dto.types';

@Injectable()
export class PeriodService extends BaseCrudService<Period, CreatePeriodDto, UpdatePeriodDto> {
  protected readonly entityName = 'Period';
  protected readonly searchFields = ['name'];
  protected readonly defaultOrderBy: Record<string, 'asc' | 'desc'> = { order: 'asc' as const };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.period as unknown as CrudDelegate);
  }
}

@Injectable()
export class CalendarService extends BaseCrudService<SchoolCalendarEvent, CreateCalendarEventDto, UpdateCalendarEventDto> {
  protected readonly entityName = 'SchoolCalendarEvent';
  protected readonly searchFields = ['title', 'description'];
  protected readonly defaultOrderBy: Record<string, 'asc' | 'desc'> = { startDate: 'asc' as const };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.schoolCalendarEvent as unknown as CrudDelegate);
  }

  /** Returns events for a given date range. Useful for the dashboard "this week" view. */
  async eventsBetween(from: Date, to: Date) {
    return this.prisma.client.schoolCalendarEvent.findMany({
      where: { startDate: { gte: from }, endDate: { lte: to } },
      orderBy: { startDate: 'asc' },
    });
  }
}