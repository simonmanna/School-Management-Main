import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { releasedResultSetWhere } from '../assessment/result-status';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { EVENTS } from '@erp/shared';
import type { IssueCertificateDto, RecordExternalResultDto } from './cert.dto';

// Crockford-ish base32 without ambiguous chars (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function verificationCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  return `CERT-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/**
 * Certification (A6): transcripts, external (UNEB) results, and issued
 * certificates. Transcripts and certificates read the published result spine;
 * nothing here recomputes marks.
 */
@Injectable()
export class TranscriptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Roll every published term result for a student into a cumulative transcript. */
  async build(studentProfileId: string) {
    const organizationId = this.tenant.organizationId;
    const terms = await this.prisma.client.studentTermResult.findMany({
      where: { studentProfileId, resultSet: releasedResultSetWhere() },
      include: { resultSet: true },
      orderBy: { createdAt: 'asc' },
    });
    if (terms.length === 0) throw new BadRequestException('No published results to build a transcript from');

    const subjectRows = await this.prisma.client.studentSubjectResult.findMany({
      where: { studentProfileId, resultSetId: { in: terms.map((t: any) => t.resultSetId) } },
    });

    // Cumulative GPA weighted by subjects per term.
    let gpaWeighted = new Prisma.Decimal(0);
    let subjTotal = 0;
    for (const t of terms) {
      if (t.gpa != null) gpaWeighted = gpaWeighted.add(new Prisma.Decimal(t.gpa).mul(t.subjectsCount));
      subjTotal += t.subjectsCount;
    }
    const cumulativeGpa = subjTotal > 0 ? gpaWeighted.div(subjTotal).toDecimalPlaces(2) : new Prisma.Decimal(0);

    const payload = {
      cumulativeGpa: cumulativeGpa.toString(),
      calculationVersion: terms[terms.length - 1]?.resultSet.calculationVersion ?? 'v1',
      sourceResultSetIds: terms.map((t: any) => t.resultSetId),
      terms: terms.map((t: any) => ({
        termId: t.termId,
        resultSetRevision: t.resultSet.revision,
        gpa: t.gpa != null ? String(t.gpa) : null,
        aggregate: t.aggregate,
        division: t.division,
        meanPercent: t.meanPercent != null ? String(t.meanPercent) : null,
        classRank: t.classRank,
        subjects: subjectRows.filter((s: any) => s.resultSetId === t.resultSetId).map((s: any) => ({ subjectId: s.subjectId, grade: s.grade, finalPercent: s.finalPercent != null ? String(s.finalPercent) : null })),
      })),
      generatedAt: new Date().toISOString(),
    };

    const deterministicId = `tr_${studentProfileId.slice(0, 20)}`.replace(/-/g, '');
    const row = await this.prisma.client.$transaction(async (tx: any) => {
      const upserted = await tx.academicTranscript.upsert({
        where: { id: deterministicId },
        create: { id: deterministicId, organizationId, studentProfileId, payload: payload as any },
        update: { payload: payload as any, generatedAt: new Date() },
      });
      await this.audit.recordInTx(tx, { entity: 'AcademicTranscript', entityId: upserted.id, action: 'create', newValues: { studentProfileId, terms: terms.length } });
      return upserted;
    });
    this.events.publish(EVENTS.SchoolTranscriptIssued, { organizationId, transcriptId: row.id, studentProfileId });
    return row;
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.academicTranscript.findMany({ where: { studentProfileId }, orderBy: { generatedAt: 'desc' } });
  }
}

@Injectable()
export class ExternalExamResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  async record(dto: RecordExternalResultDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const result = await tx.externalExamResult.upsert({
        where: { organizationId_studentProfileId_level_year: { organizationId, studentProfileId: dto.studentProfileId, level: dto.level, year: dto.year } },
        create: {
          organizationId, studentProfileId: dto.studentProfileId, board: dto.board ?? 'UNEB', level: dto.level, year: dto.year,
          indexNumber: dto.indexNumber ?? null, aggregate: dto.aggregate ?? null, division: dto.division ?? null,
          verified: dto.verified ?? false, importedPayload: (dto.importedPayload as any) ?? {},
        },
        update: { indexNumber: dto.indexNumber ?? null, aggregate: dto.aggregate ?? null, division: dto.division ?? null, verified: dto.verified ?? false },
      });
      // Replace subject rows.
      await tx.externalExamSubjectResult.deleteMany({ where: { externalResultId: result.id } });
      for (const s of dto.subjects ?? []) {
        await tx.externalExamSubjectResult.create({ data: { organizationId, externalResultId: result.id, subject: s.subject, grade: s.grade, mark: s.mark ?? null, result: s.result ?? null } });
      }
      this.events.publish(EVENTS.SchoolExternalResultRecorded, { organizationId, externalResultId: result.id, studentProfileId: dto.studentProfileId, level: dto.level, year: dto.year });
      return tx.externalExamResult.findFirst({ where: { id: result.id }, include: { subjects: true } });
    });
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.externalExamResult.findMany({ where: { studentProfileId }, include: { subjects: true }, orderBy: { year: 'desc' } });
  }
}

@Injectable()
export class CertificateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
  ) {}

  async issue(dto: IssueCertificateDto) {
    const organizationId = this.tenant.organizationId;
    const year = new Date().getFullYear();
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId }, include: { partner: true } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      const serialNumber = await this.sequence.next(`certificate:${year}`, { prefix: 'CERT-', padding: 6 }, tx);
      const code = verificationCode();
      const payload = { holderName: student.partner?.name ?? 'Unknown', ...(dto.payload as any ?? {}) };

      const cert = await tx.certificate.create({
        data: {
          organizationId, studentProfileId: dto.studentProfileId, type: dto.type, status: 'issued',
          serialNumber, verificationCode: code, title: dto.title, payload: payload as any,
          issuedAt: new Date(), issuedById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, { entity: 'Certificate', entityId: cert.id, action: 'issue', newValues: { type: dto.type, serialNumber } });
      this.events.publish(EVENTS.SchoolCertificateIssued, { organizationId, certificateId: cert.id, studentProfileId: dto.studentProfileId, type: dto.type, serialNumber });
      return cert;
    });
  }

  async revoke(id: string, reason: string, isVoid = false) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const cert = await tx.certificate.findFirst({ where: { id } });
      if (!cert) throw new NotFoundException(`Certificate ${id} not found`);
      if (['revoked', 'void'].includes(cert.status)) throw new BadRequestException(`Certificate already ${cert.status}`);
      await tx.certificate.updateMany({
        where: { id },
        data: isVoid
          ? { status: 'void', voidedAt: new Date(), revokeReason: reason }
          : { status: 'revoked', revokedAt: new Date(), revokeReason: reason },
      });
      await this.audit.recordInTx(tx, { entity: 'Certificate', entityId: id, action: isVoid ? 'cancel' : 'reject', newValues: { reason, void: isVoid } });
      this.events.publish(EVENTS.SchoolCertificateRevoked, { organizationId, certificateId: id, reason, voided: isVoid });
      return tx.certificate.findFirst({ where: { id } });
    });
  }

  async byStudent(studentProfileId: string) {
    return this.prisma.client.certificate.findMany({ where: { studentProfileId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * PUBLIC verification. Looks the code up globally (cross-tenant) via raw SQL —
   * so it works without a tenant context — and returns ONLY holder name, type,
   * status and issue date. No marks, no PII, no enumeration.
   */
  async verify(code: string): Promise<{ valid: boolean; holderName?: string; type?: string; status?: string; issuedAt?: Date; serialNumber?: string }> {
    const rows = (await this.prisma.client.$queryRawUnsafe(
      `SELECT "type", "status", "issuedAt", "serialNumber", "payload"->>'holderName' AS holder FROM "Certificate" WHERE "verificationCode" = $1 LIMIT 1`,
      code,
    )) as Array<{ type: string; status: string; issuedAt: Date; serialNumber: string; holder: string }>;
    if (rows.length === 0) return { valid: false };
    const r = rows[0];
    return { valid: r.status === 'issued', holderName: r.holder, type: r.type, status: r.status, issuedAt: r.issuedAt, serialNumber: r.serialNumber };
  }
}
