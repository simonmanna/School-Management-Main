import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import type {
  CreatePickupAuthorizationDto,
  ReleaseChildDto,
  RevokePickupAuthorizationDto,
} from './dto.types';

/**
 * Who may collect a child, and the record that they did.
 *
 * `StudentGuardian.canPickup` already answers this for guardians and stays the
 * source of truth for them — this module reads it rather than duplicating it.
 * What it adds is the two things a gate actually needs and the guardian table
 * cannot express: a named person who is not a guardian, and permission good for
 * one day only.
 *
 * Releasing a child to the wrong adult is the one mistake a nursery cannot
 * undo, so the release path refuses by default and records an explicit reason
 * when a school overrides it.
 */
@Injectable()
export class PickupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
  ) {}

  private may(permission: string): boolean {
    const held = this.tenant.permissions;
    return held.includes('*') || held.includes(permission);
  }

  async create(dto: CreatePickupAuthorizationDto) {
    if (!dto.contactId && !dto.personName?.trim()) {
      throw new BadRequestException('Name the collector: either an existing contact, or a person and their phone.');
    }
    const kind = dto.kind ?? 'STANDING';
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (kind === 'ONE_OFF' && !validTo) {
      throw new BadRequestException('A one-off authorization needs the day it is good for.');
    }
    if (validTo && validTo < validFrom) {
      throw new BadRequestException('A pick-up authorization cannot end before it starts.');
    }
    await this.scope.assertMayReadStudent(dto.studentProfileId);

    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
      if (dto.contactId) {
        const contact = await tx.contact.findFirst({ where: { id: dto.contactId } });
        if (!contact) throw new NotFoundException(`Contact ${dto.contactId} not found`);
      }

      const row = await tx.pickupAuthorization.create({
        data: {
          organizationId: this.tenant.organizationId,
          studentProfileId: dto.studentProfileId,
          kind,
          contactId: dto.contactId ?? null,
          personName: dto.personName?.trim() ?? null,
          personPhone: dto.personPhone ?? null,
          relationship: dto.relationship ?? null,
          idType: dto.idType ?? null,
          idNumber: dto.idNumber ?? null,
          photoDocumentId: dto.photoDocumentId ?? null,
          validFrom,
          validTo,
          notes: dto.notes ?? null,
          authorizedById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PickupAuthorization',
        entityId: row.id,
        action: 'create',
        newValues: row,
      });
      return row;
    });
  }

  /**
   * Withdrawn, not deleted. After a custody change, who was allowed to collect
   * this child last term is exactly the question that gets asked.
   */
  async revoke(id: string, dto: RevokePickupAuthorizationDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.pickupAuthorization.findFirst({ where: { id } });
      if (!row) throw new NotFoundException(`Pick-up authorization ${id} not found`);
      await this.scope.assertMayReadStudent(row.studentProfileId);
      if (row.revokedAt) return row;
      const updated = await tx.pickupAuthorization.update({
        where: { id },
        data: {
          revokedAt: new Date(),
          revokedById: this.tenant.userId ?? null,
          revokeReason: dto.reason,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PickupAuthorization',
        entityId: id,
        action: 'update',
        oldValues: { revokedAt: null },
        newValues: { revokedAt: updated.revokedAt, reason: dto.reason },
      });
      return updated;
    });
  }

  /**
   * Everyone who may collect this child right now: guardians flagged for
   * pick-up, plus live authorizations. One list, because that is what the person
   * at the gate is holding.
   */
  async whoMayCollect(studentProfileId: string, atRaw?: string) {
    await this.scope.assertMayReadStudent(studentProfileId);
    const at = atRaw ? new Date(atRaw) : new Date();
    const guardians = await this.prisma.client.studentGuardian.findMany({
      where: { studentProfileId, canPickup: true },
      include: { guardianContact: true },
    });
    const authorizations = await this.prisma.client.pickupAuthorization.findMany({
      where: {
        studentProfileId,
        revokedAt: null,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gte: at } }],
      },
      include: { contact: true },
      orderBy: { validFrom: 'desc' },
    });
    return {
      at: at.toISOString(),
      guardians: guardians.map((g: any) => ({
        studentGuardianId: g.id,
        contactId: g.guardianContactId,
        name: [g.guardianContact?.firstName, g.guardianContact?.lastName].filter(Boolean).join(' ') || 'Guardian',
        phone: g.guardianContact?.phone ?? null,
        relationship: g.relationship,
        source: 'guardian' as const,
      })),
      authorizations: authorizations.map((a: any) => ({
        authorizationId: a.id,
        kind: a.kind,
        name: a.personName ?? [a.contact?.firstName, a.contact?.lastName].filter(Boolean).join(' '),
        phone: a.personPhone ?? a.contact?.phone ?? null,
        relationship: a.relationship,
        idType: a.idType,
        idNumber: a.idNumber,
        validTo: a.validTo,
        source: 'authorization' as const,
      })),
    };
  }

  /** Every authorization ever, including withdrawn ones — the audit view. */
  async history(studentProfileId: string) {
    await this.scope.assertMayReadStudent(studentProfileId);
    return this.prisma.client.pickupAuthorization.findMany({
      where: { studentProfileId },
      include: { contact: true, events: { orderBy: { collectedAt: 'desc' }, take: 20 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The child was handed over.
   *
   * The authority is always named and stored (audit F06, invariant I-040):
   *   - `guardian`: a StudentGuardian of THIS child with `canPickup` now — the
   *     ordinary handover, never an override;
   *   - `authorization`: a live PickupAuthorization for this child;
   *   - `override`: nobody on the list — its own grant plus a written reason.
   *
   * A retried or double-clicked release returns the first record instead of
   * handing the same child over twice.
   */
  async release(dto: ReleaseChildDto) {
    await this.scope.assertMayReadStudent(dto.studentProfileId);
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
      // Serialize releases of one child so two gate clicks cannot both pass the
      // "already released today?" check below.
      await tx.$queryRawUnsafe(`SELECT id FROM "StudentProfile" WHERE id = $1 FOR UPDATE`, student.id);

      if (dto.idempotencyKey) {
        const replay = await tx.pickupEvent.findFirst({ where: { organizationId, idempotencyKey: dto.idempotencyKey } });
        if (replay) {
          if (replay.studentProfileId !== dto.studentProfileId) {
            throw new ConflictException('That request key was already used for a different child.');
          }
          return replay;
        }
      }

      const collectedAt = dto.collectedAt ? new Date(dto.collectedAt) : new Date();
      if (Number.isNaN(collectedAt.getTime())) throw new BadRequestException('collectedAt is not a valid date.');

      let source: 'guardian' | 'authorization' | 'override';
      let collectedByName = '';
      let authorization: any = null;
      let guardianLink: any = null;

      if (dto.studentGuardianId) {
        guardianLink = await tx.studentGuardian.findFirst({
          where: { id: dto.studentGuardianId, studentProfileId: dto.studentProfileId },
          include: { guardianContact: true },
        });
        if (!guardianLink) throw new NotFoundException('That guardian is not linked to this child.');
        if (!guardianLink.canPickup) {
          throw new BadRequestException("That guardian is not on this child's pick-up list.");
        }
        source = 'guardian';
        collectedByName =
          [guardianLink.guardianContact?.firstName, guardianLink.guardianContact?.lastName].filter(Boolean).join(' ') ||
          dto.collectedByName?.trim() ||
          'Guardian';
      } else if (dto.authorizationId) {
        authorization = await tx.pickupAuthorization.findFirst({
          where: { id: dto.authorizationId, studentProfileId: dto.studentProfileId },
          include: { contact: true },
        });
        if (!authorization) {
          throw new NotFoundException(`Pick-up authorization ${dto.authorizationId} is not for this child`);
        }
        if (authorization.revokedAt) {
          throw new BadRequestException(
            `That authorization was withdrawn${authorization.revokeReason ? `: ${authorization.revokeReason}` : ''}.`,
          );
        }
        if (authorization.validFrom > collectedAt || (authorization.validTo && authorization.validTo < collectedAt)) {
          throw new BadRequestException('That authorization is not valid today.');
        }
        source = 'authorization';
        collectedByName =
          authorization.personName ||
          [authorization.contact?.firstName, authorization.contact?.lastName].filter(Boolean).join(' ') ||
          dto.collectedByName?.trim() ||
          '';
      } else {
        collectedByName = dto.collectedByName?.trim() ?? '';
        if (!collectedByName) throw new BadRequestException('Record who collected the child.');
        if (!dto.overrideReason?.trim()) {
          throw new BadRequestException(
            `${collectedByName} is not authorized to collect this child. Choose someone on the pick-up list, or record why you are releasing the child anyway.`,
          );
        }
        if (!this.may(PERMISSIONS.school.overridePickup)) {
          throw new ForbiddenException('Releasing a child to someone not on the pick-up list needs the override grant.');
        }
        source = 'override';
      }
      if (!collectedByName) throw new BadRequestException('Record who collected the child.');

      // One handover per child per day: a second click is the same handover.
      const dayStart = new Date(Date.UTC(collectedAt.getUTCFullYear(), collectedAt.getUTCMonth(), collectedAt.getUTCDate()));
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const earlier = await tx.pickupEvent.findFirst({
        where: { studentProfileId: dto.studentProfileId, collectedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { collectedAt: 'desc' },
      });
      if (earlier) {
        const sameHandover =
          earlier.authorizationSource === source &&
          (earlier.studentGuardianId ?? null) === (guardianLink?.id ?? null) &&
          (earlier.authorizationId ?? null) === (authorization?.id ?? null) &&
          earlier.collectedByName === collectedByName;
        if (sameHandover) return earlier;
        throw new ConflictException(
          `This child was already released today to ${earlier.collectedByName}. Check the gate log before recording another handover.`,
        );
      }

      const row = await tx.pickupEvent.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          authorizationId: authorization?.id ?? null,
          studentGuardianId: guardianLink?.id ?? null,
          authorizationSource: source,
          collectedByName,
          collectedAt,
          releasedById: this.tenant.userId ?? null,
          overrideReason: source === 'override' ? dto.overrideReason!.trim() : null,
          notes: dto.notes ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PickupEvent',
        entityId: row.id,
        action: 'create',
        newValues: row,
      });
      return row;
    });
  }

  /** The gate log for a day — who left, with whom, and any override. */
  async releasesOn(onDateRaw: string) {
    const day = new Date(onDateRaw);
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const seatWhere = await this.scope.studentReadWhere();
    return this.prisma.client.pickupEvent.findMany({
      where: { collectedAt: { gte: from, lt: to }, ...(seatWhere ? { studentProfile: seatWhere } : {}) },
      include: { studentProfile: { include: { partner: true } } },
      orderBy: { collectedAt: 'desc' },
    });
  }
}
