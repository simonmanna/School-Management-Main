import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import type { CreateIncidentDto, NotifyGuardianDto, ReviewIncidentDto } from './dto.types';

/**
 * The incident log: a bumped head, a fever, a bite, a child briefly
 * unaccounted for.
 *
 * Keeping these is a licensing requirement in most places and it is the school's
 * only answer when a parent asks six weeks later. Two things are deliberately
 * part of the record rather than side effects of it:
 *
 *   - Notification. `guardianNotifiedAt` being null on a serious incident is
 *     itself what a head teacher needs to see, so it is a column and a report,
 *     not a message that may or may not have been sent.
 *   - Review. A serious incident is signed off by someone other than the person
 *     who recorded it, on a separate grant.
 */
@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateIncidentDto) {
    const occurredAt = new Date(dto.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('occurredAt is not a valid date.');
    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('An incident cannot be recorded as having happened in the future.');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
      const row = await tx.childIncident.create({
        data: {
          organizationId: this.tenant.organizationId,
          studentProfileId: dto.studentProfileId,
          kind: dto.kind,
          severity: dto.severity ?? 'MINOR',
          occurredAt,
          location: dto.location ?? null,
          description: dto.description,
          actionTaken: dto.actionTaken ?? null,
          bodyPart: dto.bodyPart ?? null,
          firstAidById: dto.firstAidById ?? null,
          recordedById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ChildIncident',
        entityId: row.id,
        action: 'create',
        newValues: row,
      });
      return row;
    });
  }

  /** Record that the family was told, how, and when. */
  async notifyGuardian(id: string, dto: NotifyGuardianDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.childIncident.findFirst({ where: { id } });
      if (!row) throw new NotFoundException(`Incident ${id} not found`);
      const at = dto.at ? new Date(dto.at) : new Date();
      const updated = await tx.childIncident.update({
        where: { id },
        data: {
          guardianNotifiedAt: at,
          guardianNotifiedById: this.tenant.userId ?? null,
          guardianNotifiedHow: dto.how,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ChildIncident',
        entityId: id,
        action: 'update',
        oldValues: { guardianNotifiedAt: row.guardianNotifiedAt },
        newValues: { guardianNotifiedAt: at, how: dto.how },
      });
      return updated;
    });
  }

  /**
   * Sign off. Refused while the family has not been told: closing the record
   * before anyone has spoken to a parent is the failure this log exists to
   * prevent.
   */
  async review(id: string, dto: ReviewIncidentDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.childIncident.findFirst({ where: { id } });
      if (!row) throw new NotFoundException(`Incident ${id} not found`);
      if (!row.guardianNotifiedAt) {
        throw new BadRequestException(
          'Record that the family has been told before signing this off — that is what the log is for.',
        );
      }
      const updated = await tx.childIncident.update({
        where: { id },
        data: {
          reviewedAt: new Date(),
          reviewedById: this.tenant.userId ?? null,
          reviewNotes: dto.reviewNotes ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ChildIncident',
        entityId: id,
        action: 'update',
        oldValues: { reviewedAt: row.reviewedAt },
        newValues: { reviewedAt: updated.reviewedAt },
      });
      return updated;
    });
  }

  async forStudent(studentProfileId: string) {
    return this.prisma.client.childIncident.findMany({
      where: { studentProfileId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  /**
   * The head teacher's view. Unnotified first, then unreviewed, because those
   * are the two things that need doing rather than reading.
   */
  async outstanding() {
    const rows = await this.prisma.client.childIncident.findMany({
      where: { OR: [{ guardianNotifiedAt: null }, { reviewedAt: null }] },
      include: { studentProfile: { include: { partner: true } } },
      orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
      take: 200,
    });
    return rows.map((r: any) => ({
      ...r,
      studentName: r.studentProfile?.partner?.name ?? r.studentProfile?.admissionNo ?? null,
      needs: [
        ...(r.guardianNotifiedAt ? [] : ['tell the family']),
        ...(r.reviewedAt ? [] : ['head teacher sign-off']),
      ],
    }));
  }
}
