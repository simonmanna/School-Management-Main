import { Injectable } from '@nestjs/common';
import type { Position } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreatePositionDto, UpdatePositionDto } from './dto.types';

@Injectable()
export class PositionService extends BaseCrudService<Position, CreatePositionDto, UpdatePositionDto> {
  protected readonly entityName = 'Position';
  protected readonly searchFields = ['name'];

  constructor(prisma: PrismaService) {
    super(prisma.client.position as unknown as CrudDelegate);
  }
}