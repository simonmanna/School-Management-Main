import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';

/**
 * RentalService — vertical-specific business logic.
 * Use PostingService for any financial effect; never write to JournalLine directly.
 */
@Injectable()
export class RentalService {
  constructor(private readonly prisma: PrismaService) {}

  // TODO: implement vertical behaviour here.
}
