import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import type { UpsertImmunisationDto } from './dto.types';

/** Date-only, so a due date is a day and not an instant. */
function day(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`'${value}' is not a date.`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Immunisation as rows, not a tick on a document checklist.
 *
 * Admissions already asks for the card and files the scan, which answers "did
 * they hand something in". A nursery has to answer a different question: which
 * dose, when the next one is due, and who has no record at all. An exemption is
 * recorded in place of a dose, so "not vaccinated" and "we never asked" stay
 * distinguishable — they call for different conversations.
 */
@Injectable()
export class ImmunisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly placements: PlacementLookupService,
    private readonly scope: DataScopeService,
  ) {}

  async upsert(dto: UpsertImmunisationDto) {
    if (!dto.administeredOn && !dto.exemptionReason?.trim()) {
      throw new BadRequestException('Record the date the dose was given, or why the child is exempt.');
    }
    await this.scope.assertMayReadStudent(dto.studentProfileId);
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      const vaccine = dto.vaccine.trim();
      const doseLabel = dto.doseLabel?.trim() ?? null;
      const existing = await tx.immunisationRecord.findFirst({
        where: { studentProfileId: dto.studentProfileId, vaccine, doseLabel },
      });
      const data = {
        administeredOn: dto.administeredOn ? day(dto.administeredOn) : null,
        nextDueOn: dto.nextDueOn ? day(dto.nextDueOn) : null,
        certificateDocumentId: dto.certificateDocumentId ?? null,
        exemptionReason: dto.exemptionReason?.trim() ?? null,
        notes: dto.notes ?? null,
        recordedById: this.tenant.userId ?? null,
      };
      const row = existing
        ? await tx.immunisationRecord.update({ where: { id: existing.id }, data })
        : await tx.immunisationRecord.create({
            data: {
              organizationId: this.tenant.organizationId,
              studentProfileId: dto.studentProfileId,
              vaccine,
              doseLabel,
              ...data,
            },
          });
      await this.audit.recordInTx(tx, {
        entity: 'ImmunisationRecord',
        entityId: row.id,
        action: existing ? 'update' : 'create',
        oldValues: existing ?? undefined,
        newValues: row,
      });
      return row;
    });
  }

  async forStudent(studentProfileId: string) {
    await this.scope.assertMayReadStudent(studentProfileId);
    return this.prisma.client.immunisationRecord.findMany({
      where: { studentProfileId },
      orderBy: [{ vaccine: 'asc' }, { administeredOn: 'asc' }],
    });
  }

  async remove(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.immunisationRecord.findFirst({ where: { id } });
      if (!row) throw new NotFoundException(`Immunisation record ${id} not found`);
      await this.scope.assertMayReadStudent(row.studentProfileId);
      await tx.immunisationRecord.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'ImmunisationRecord', entityId: id, action: 'delete', oldValues: row });
    });
  }

  /**
   * What the school has to chase: doses due or overdue, and children in the
   * class with no record at all. The second list is the one that matters — a
   * child nobody has asked about is invisible in a report built only from rows
   * that exist.
   */
  async dueForClass(classId: string, opts: { withinDays?: number; sectionId?: string } = {}) {
    const withinDays = opts.withinDays ?? 30;
    await this.scope.assertMayReadClass(classId, opts.sectionId ?? null);
    const placed = await this.placements.roster({
      classIds: [classId],
      ...(opts.sectionId ? { sectionIds: [opts.sectionId] } : {}),
    });
    const visible = await this.scope.visibleStudentIds(placed.map((l: any) => l.student.id));
    const learners = visible === 'all' ? placed : placed.filter((l: any) => visible.has(l.student.id));
    const ids = learners.map((l: any) => l.student.id);
    if (!ids.length) return { classId, withinDays, due: [], noRecord: [] };

    const horizon = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.client.immunisationRecord.findMany({
      where: { studentProfileId: { in: ids }, nextDueOn: { not: null, lte: horizon } },
      orderBy: { nextDueOn: 'asc' },
    });
    const anyRecord = new Set<string>(
      (
        await this.prisma.client.immunisationRecord.findMany({
          where: { studentProfileId: { in: ids } },
          select: { studentProfileId: true },
          distinct: ['studentProfileId'],
        })
      ).map((r: any) => r.studentProfileId),
    );
    const nameOf = new Map<string, string>(
      learners.map((l: any) => [l.student.id, l.student.partner?.name ?? l.student.admissionNo]),
    );

    return {
      classId,
      withinDays,
      due: rows.map((r: any) => ({
        ...r,
        studentName: nameOf.get(r.studentProfileId) ?? null,
        overdue: r.nextDueOn != null && r.nextDueOn < new Date(),
      })),
      noRecord: learners
        .filter((l: any) => !anyRecord.has(l.student.id))
        .map((l: any) => ({
          studentProfileId: l.student.id,
          studentName: nameOf.get(l.student.id) ?? null,
          admissionNo: l.student.admissionNo,
        })),
    };
  }
}
