import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { endTeachingAccess, LEAVING_STATUSES, type StaffStatusValue } from './staff-lifecycle';

type OffboardedPayload = {
  organizationId: string;
  employeeId: string;
  partnerId: string | null;
  userId: string | null;
  lastWorkingDay: string;
  /** HR's offboarding reason; absent on events published before it was carried. */
  reason?: string | null;
};

/**
 * HR's reason → the staff status the school records. Everything used to land
 * on 'terminated', so a teacher who retired or resigned appeared on the staff
 * register as dismissed.
 */
export function leavingStatusFor(reason: string | null | undefined): StaffStatusValue {
  switch (reason) {
    case 'resignation':
      return 'resigned';
    case 'retirement':
      return 'retired';
    case 'contract_expiry':
      return 'inactive';
    default:
      return 'terminated';
  }
}

/**
 * HR posted a leaver's offboarding (`hr.employee.offboarded`). HR has already
 * disabled the login; the school side ends the person's teaching: StaffProfile
 * → resigned / retired / terminated per HR's reason (with history), allocations end-dated at the last working day,
 * live lessons unassigned for cover, class-teacher roles cleared.
 *
 * The event is the only bridge — HR may not import the school vertical (ADR-011).
 * Idempotent: a staff profile already in a leaving status is left alone.
 */
@Injectable()
export class StaffOffboardingSubscriber implements OnModuleInit {
  private readonly logger = new Logger(StaffOffboardingSubscriber.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.events.subscribe(EVENTS.HrEmployeeOffboarded, (p: OffboardedPayload) => this.onOffboarded(p));
  }

  async onOffboarded(payload: OffboardedPayload): Promise<void> {
    if (!payload.partnerId) return;
    try {
      await this.tenant.run(
        { organizationId: payload.organizationId, userId: 'system:hr-offboarding', permissions: [] },
        () =>
          this.prisma.client.$transaction(async (tx: any) => {
            const staff = await tx.staffProfile.findFirst({ where: { partnerId: payload.partnerId } });
            if (!staff) return;
            if (LEAVING_STATUSES.includes(staff.status as StaffStatusValue)) return;
            const at = new Date(payload.lastWorkingDay);
            const toStatus = leavingStatusFor(payload.reason);
            await tx.staffProfile.updateMany({ where: { id: staff.id }, data: { status: toStatus } });
            await tx.staffStatusHistory.create({
              data: {
                organizationId: staff.organizationId,
                staffProfileId: staff.id,
                fromStatus: staff.status,
                toStatus,
                reason: `HR offboarding posted${payload.reason ? ` (${payload.reason})` : ''} (last working day ${payload.lastWorkingDay.slice(0, 10)})`,
                changedById: null,
              },
            });
            const ended = await endTeachingAccess(tx, staff, at, null);
            await this.audit.recordInTx(tx, {
              entity: 'StaffProfile',
              entityId: staff.id,
              action: 'update',
              oldValues: { status: staff.status },
              newValues: { status: toStatus, employmentEnded: ended, source: 'hr.employee.offboarded' },
            });
          }),
      );
    } catch (err) {
      // Delivered from the outbox after HR committed, so rethrowing cannot undo
      // the offboarding; it leaves the event for the outbox to retry.
      this.logger.error(`offboarding sync failed for employee ${payload.employeeId}: ${(err as Error).message}`);
      throw err;
    }
  }
}
