import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CashSessionService } from '../../accounting/treasury/cash-session.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';

/** The one register a school fee desk uses when it keeps cash in a drawer. */
const FEE_DESK_CODE = 'FEE-DESK';

/**
 * The fee desk's cash drawer (ADR-032 P3, audit F09).
 *
 * A `drawer` school takes cash through the cashier's open cash session, so the
 * receipt, the drawer movement and the GL agree when the drawer is closed and
 * counted. This service is the school-facing door onto the shared CashSession
 * engine: it provisions the fee-desk register on first use, and opens and
 * closes the caller's own session. A `cashbook` school never needs it.
 */
@Injectable()
export class CashDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly sessions: CashSessionService,
    private readonly accounts: AccountDeterminationService,
  ) {}

  private async mode(): Promise<'drawer' | 'cashbook'> {
    const profile = await this.prisma.client.schoolProfile.findFirst({ select: { cashCustodyMode: true } });
    return profile?.cashCustodyMode === 'drawer' ? 'drawer' : 'cashbook';
  }

  private async mySession() {
    const userId = this.tenant.userId;
    if (!userId) return null;
    return this.prisma.client.cashSession.findFirst({
      where: { userId, status: 'open' },
      orderBy: { openedAt: 'desc' },
      include: { cashRegister: { select: { id: true, name: true, code: true } } },
    });
  }

  /** What the fee desk needs to know before taking cash. */
  async status() {
    const mode = await this.mode();
    const session = await this.mySession();
    const expectedCash = session ? (await this.sessions.expectedCash(session.id)).toString() : null;
    return {
      mode,
      mustOpenDrawer: mode === 'drawer' && !session,
      session: session
        ? {
            id: session.id,
            openedAt: session.openedAt,
            openingFloat: session.openingFloat.toString(),
            register: session.cashRegister,
            expectedCash,
          }
        : null,
    };
  }

  private async feeDeskRegisterId(): Promise<string> {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.cashRegister.findFirst({
      where: { organizationId, code: FEE_DESK_CODE, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
    const defaultAccountId = await this.accounts.settlementAccount('cash');
    try {
      const created = await this.prisma.client.cashRegister.create({
        data: { organizationId, code: FEE_DESK_CODE, name: 'Fee desk', defaultAccountId, createdBy: this.tenant.userId ?? null },
        select: { id: true },
      });
      return created.id;
    } catch (err: any) {
      // Two cashiers opening at once: the unique (org, code) index picks one.
      if (err?.code === 'P2002') {
        const again = await this.prisma.client.cashRegister.findFirst({ where: { organizationId, code: FEE_DESK_CODE }, select: { id: true } });
        if (again) return again.id;
      }
      throw err;
    }
  }

  /** Open the caller's drawer. Returns the open one if it is already open. */
  async open(openingFloat = 0) {
    if ((await this.mode()) !== 'drawer') {
      throw new BadRequestException('This school records cash in a cashbook; there is no drawer to open.');
    }
    if (!(openingFloat >= 0)) throw new BadRequestException('The opening float cannot be negative.');
    const current = await this.mySession();
    if (current) return this.status();
    const cashRegisterId = await this.feeDeskRegisterId();
    await this.sessions.open({ cashRegisterId, openingFloat } as any);
    return this.status();
  }

  /** Count and close the caller's drawer. A difference needs a reason. */
  async close(dto: { closingCounted: number; varianceReason?: string; notes?: string }) {
    const session = await this.mySession();
    if (!session) throw new BadRequestException('You have no open drawer to close.');
    return this.sessions.close({ ...dto, sessionId: session.id } as any);
  }
}
