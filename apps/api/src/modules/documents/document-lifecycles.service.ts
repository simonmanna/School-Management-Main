/**
 * Lifecycle/transition read service (Phase 1.4). The Phase 2 engine consumes
 * findTransition() to resolve declarative guards for each action.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';

@Injectable()
export class DocumentLifecyclesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.raw.documentLifecycle.findMany({
      include: { transitions: { orderBy: [{ fromState: 'asc' }, { action: 'asc' }] } },
      orderBy: { code: 'asc' },
    });
  }

  getByCode(code: string) {
    return this.prisma.raw.documentLifecycle.findUnique({
      where: { code },
      include: { transitions: { orderBy: [{ fromState: 'asc' }, { action: 'asc' }] } },
    });
  }

  findTransition(lifecycleId: string, fromState: string, action: string) {
    return this.prisma.raw.documentTransition.findUnique({
      where: { lifecycleId_fromState_action: { lifecycleId, fromState, action } },
    });
  }
}