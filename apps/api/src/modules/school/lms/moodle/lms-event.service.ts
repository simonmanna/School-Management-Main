import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../kernel/tenancy/tenant-context.service';

export interface LmsEventInput {
  eventName: string; // 'mod_quiz.attempt_submitted'
  component: string; // 'mod_quiz' | 'core_course' | …
  action: string; // viewed | created | updated | submitted | graded | deleted
  target: string; // course_module | attempt | post | submission | course
  contextId?: string;
  courseOfferingId?: string;
  courseModuleId?: string;
  objectId?: string;
  studentProfileId?: string;
  other?: Record<string, unknown>;
}

/**
 * The LMS standard log (ADR-014 §3.8) — Moodle's logstore. One row per mutation,
 * written by the plugin base and the spine. Powers every report (activity,
 * participation, live logs, engagement) with no extra tables. Kept as an append-only
 * table decoupled from the typed domain-event outbox.
 */
@Injectable()
export class LmsEventService {
  private readonly logger = new Logger('LmsEventService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Fire-and-forget log write. Never throws into the caller's happy path. */
  async log(input: LmsEventInput): Promise<void> {
    try {
      await this.prisma.client.lmsEvent.create({ data: this.row(input) });
    } catch (err) {
      this.logger.warn(`LMS event log failed (non-critical): ${String(err)}`);
    }
  }

  /** Transactional log write — use when the event must commit atomically with its cause. */
  async logInTx(tx: Prisma.TransactionClient, input: LmsEventInput): Promise<void> {
    await tx.lmsEvent.create({ data: this.row(input) });
  }

  private row(input: LmsEventInput) {
    return {
      organizationId: this.tenant.organizationId,
      eventName: input.eventName,
      component: input.component,
      action: input.action,
      target: input.target,
      contextId: input.contextId ?? null,
      courseOfferingId: input.courseOfferingId ?? null,
      courseModuleId: input.courseModuleId ?? null,
      objectId: input.objectId ?? null,
      userId: this.tenant.userId ?? null,
      studentProfileId: input.studentProfileId ?? null,
      other: (input.other ?? {}) as Prisma.InputJsonValue,
    };
  }
}
