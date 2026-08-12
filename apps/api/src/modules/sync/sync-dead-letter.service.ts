import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Dead-letter review (P5).
 *
 * Every offline op the server refused lands here. These are almost always
 * money — a sale rung up on a tablet, printed, handed to a customer, then
 * rejected on sync. They stay `open` until a human decides what happened, and
 * the decision is audited. Nothing here silently expires.
 */
@Injectable()
export class SyncDeadLetterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(status: string = 'open') {
    const rows = await this.prisma.client.syncOpDeadLetter.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Attach device names so the review screen reads "Counter tablet", not a uuid.
    const deviceIds = [...new Set(rows.map((r: any) => r.deviceId))];
    const devices = deviceIds.length
      ? await this.prisma.client.posDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(devices.map((d: any) => [d.id, d.name]));

    return rows.map((r: any) => ({
      id: r.id,
      opId: r.opId,
      deviceId: r.deviceId,
      deviceName: nameById.get(r.deviceId) ?? 'unknown device',
      deviceSeq: r.deviceSeq,
      opType: r.opType,
      actorUserId: r.actorUserId,
      occurredAt: r.occurredAt,
      error: r.error,
      httpStatus: r.httpStatus,
      status: r.status,
      payload: r.payload,
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
    }));
  }

  async counts() {
    const [open, resolved, discarded] = await Promise.all([
      this.prisma.client.syncOpDeadLetter.count({ where: { status: 'open' } }),
      this.prisma.client.syncOpDeadLetter.count({ where: { status: 'resolved' } }),
      this.prisma.client.syncOpDeadLetter.count({ where: { status: 'discarded' } }),
    ]);
    return { open, resolved, discarded };
  }

  /**
   * Mark a dead-lettered op as dealt with.
   *
   * `resolved`  — the sale was re-entered manually or was already recorded.
   * `discarded` — it should never post (duplicate, test, cancelled sale).
   *
   * Deliberately NOT a "retry" button: these ops failed a business rule
   * (closed session, revoked device, stale table). Replaying them blindly is
   * how you double-post. A manager decides and records why.
   */
  async resolve(id: string, status: 'resolved' | 'discarded', note: string) {
    if (!note?.trim()) {
      throw new BadRequestException('A note is required — record what happened to this sale');
    }
    const row = await this.prisma.client.syncOpDeadLetter.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Dead-lettered op not found');
    if (row.status !== 'open') throw new BadRequestException(`Already ${row.status}`);

    const updated = await this.prisma.client.syncOpDeadLetter.update({
      where: { id },
      data: {
        status,
        resolutionNote: note.trim(),
        resolvedById: this.tenant.userId ?? null,
        resolvedAt: new Date(),
      },
    });

    await this.audit.record({
      entity: 'SyncOpDeadLetter',
      entityId: id,
      action: 'update' as any,
      newValues: { status, note: note.trim(), opType: row.opType, opId: row.opId },
    });

    return { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt };
  }
}
