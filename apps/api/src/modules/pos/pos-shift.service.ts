/**
 * POS Shift Handover (module 8) — hands a register from one cashier to the next
 * without closing the day. Validates the incoming cashier's POS PIN and a
 * manager approval, then atomically closes the outgoing session (blind count +
 * variance) and opens a fresh session on the same register for the incoming
 * cashier, carrying the counted cash forward as the opening float.
 */
import { Injectable } from '@nestjs/common';
import { CashSessionService } from '../accounting/treasury/cash-session.service';
import { PosAuthService } from './pos-auth.service';
import { PosOverridesService } from './pos-overrides.service';

export interface PosHandoverDto {
  cashRegisterId: string;
  closingCounted: number;
  incomingUserId: string;
  incomingPin: string;
  approvedById: string;
  managerPin: string;
  varianceReason?: string;
  openingFloat?: number;
  notes?: string;
}

@Injectable()
export class PosShiftService {
  constructor(
    private readonly sessions: CashSessionService,
    private readonly auth: PosAuthService,
    private readonly overrides: PosOverridesService,
  ) {}

  async handover(dto: PosHandoverDto) {
    // 1) Incoming cashier proves identity with their own POS PIN (throws if bad).
    await this.auth.pinLogin(dto.incomingUserId, dto.incomingPin);
    // 2) A manager must approve: verify their PIN server-side AND that they hold
    //    pos:override (defence in depth — don't trust a client-supplied id alone).
    await this.auth.pinLogin(dto.approvedById, dto.managerPin);
    await this.overrides.assertCanOverride(dto.approvedById, 'shift_handover');
    // 3) Atomically close the outgoing session and open the incoming one.
    return this.sessions.handover({
      cashRegisterId: dto.cashRegisterId,
      closingCounted: dto.closingCounted,
      incomingUserId: dto.incomingUserId,
      varianceReason: dto.varianceReason,
      openingFloat: dto.openingFloat,
      notes: dto.notes,
      approvedById: dto.approvedById,
    });
  }
}
