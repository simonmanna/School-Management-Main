import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const QUAL_TYPES = ['degree', 'diploma', 'teaching_qual', 'license', 'professional'];
const TRAINING_STATUSES = ['enrolled', 'completed', 'cancelled'];

/**
 * HrTrainingService — qualifications, certifications (with expiry alerts) and
 * CPD/training. Particularly important for schools (teaching licenses expire).
 */
@Injectable()
export class HrTrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
  ) {}

  private orgId() {
    return this.tenant.organizationId;
  }

  // ── Qualifications ───────────────────────────────────────────────────────────

  async listQualifications(query: any = {}) {
    const orgId = await this.orgId();
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrQualification.findMany({ where, orderBy: [{ graduatedAt: 'desc' }] }),
      this.prisma.client.hrQualification.count({ where }),
    ]);
    return { rows, total };
  }

  async createQualification(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.title) throw new BadRequestException('employeeId and title are required');
    if (dto.type && !QUAL_TYPES.includes(dto.type)) throw new BadRequestException(`Invalid qualification type: ${dto.type}`);
    return this.prisma.client.hrQualification.create({
      data: {
        organizationId: orgId,
        employeeId: dto.employeeId,
        type: dto.type ?? 'degree',
        title: dto.title,
        institution: dto.institution ?? null,
        graduatedAt: dto.graduatedAt ? new Date(dto.graduatedAt) : null,
        certificateNumber: dto.certificateNumber ?? null,
        documentId: dto.documentId ?? null,
        createdBy: userId,
      },
    });
  }

  async deleteQualification(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrQualification.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Qualification not found');
    return this.prisma.client.hrQualification.update({ where: { id }, data: { deletedAt: new Date(), createdBy: userId } });
  }

  // ── Certifications (expiry-driven) ──────────────────────────────────────────

  async listCertifications(query: any = {}) {
    const orgId = await this.orgId();
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrCertification.findMany({ where, orderBy: [{ expiryDate: 'asc' }] }),
      this.prisma.client.hrCertification.count({ where }),
    ]);
    return { rows, total };
  }

  /** Certifications expiring within N days (for alerts). */
  async listExpiringCertifications(days = 30) {
    const orgId = await this.orgId();
    const horizon = new Date(Date.now() + days * 86400000);
    return this.prisma.client.hrCertification.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'active',
        expiryDate: { gte: new Date(), lte: horizon },
      },
      include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
    });
  }

  async createCertification(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.name) throw new BadRequestException('employeeId and name are required');
    const expiry = dto.expiryDate ? new Date(dto.expiryDate) : null;
    const status = expiry && expiry < new Date() ? 'expired' : 'active';
    return this.prisma.client.hrCertification.create({
      data: {
        organizationId: orgId,
        employeeId: dto.employeeId,
        name: dto.name,
        issuer: dto.issuer ?? null,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
        expiryDate: expiry,
        documentId: dto.documentId ?? null,
        status,
        createdBy: userId,
      },
    });
  }

  async refreshCertificationStatus(id: string) {
    const orgId = await this.orgId();
    const row = await this.prisma.client.hrCertification.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Certification not found');
    const status = row.expiryDate && new Date(row.expiryDate) < new Date() ? 'expired' : 'active';
    return this.prisma.client.hrCertification.update({ where: { id }, data: { status } });
  }

  async deleteCertification(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrCertification.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Certification not found');
    return this.prisma.client.hrCertification.update({ where: { id }, data: { deletedAt: new Date(), createdBy: userId } });
  }

  // ── Training / CPD ───────────────────────────────────────────────────────────

  async listTrainings(query: any = {}) {
    const orgId = await this.orgId();
    const where: any = { organizationId: orgId };
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.hrTraining.findMany({ where, orderBy: [{ title: 'asc' }] }),
      this.prisma.client.hrTraining.count({ where }),
    ]);
    return { rows, total };
  }

  async createTraining(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.title) throw new BadRequestException('title is required');
    const code = dto.code ?? (await this.seq.next('hr_training', { prefix: 'TRN-', padding: 5 }));
    const existing = await this.prisma.client.hrTraining.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: String(code).toUpperCase() } },
    });
    if (existing) throw new BadRequestException(`Training code "${code}" already exists`);
    return this.prisma.client.hrTraining.create({
      data: {
        organizationId: orgId,
        code: String(code).toUpperCase(),
        title: dto.title,
        provider: dto.provider ?? null,
        cost: dto.cost ?? null,
        cpdHours: dto.cpdHours ?? null,
        category: dto.category ?? null,
        description: dto.description ?? null,
        createdBy: userId,
      },
    });
  }

  async deleteTraining(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTraining.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Training not found');
    return this.prisma.client.hrTraining.update({ where: { id }, data: { deletedAt: new Date(), createdBy: userId } });
  }

  async enroll(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.trainingId || !dto.employeeId) throw new BadRequestException('trainingId and employeeId are required');
    const training = await this.prisma.client.hrTraining.findFirst({ where: { id: dto.trainingId, organizationId: orgId } });
    if (!training) throw new NotFoundException('Training not found');
    const emp = await this.prisma.client.hrEmployee.findFirst({ where: { id: dto.employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundException('Employee not found');
    return this.prisma.client.hrTrainingEnrollment.create({
      data: {
        organizationId: orgId,
        trainingId: dto.trainingId,
        employeeId: dto.employeeId,
        status: 'enrolled',
        createdBy: userId,
      },
    });
  }

  async setEnrollmentStatus(id: string, status: string, certificateUrl?: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!TRAINING_STATUSES.includes(status)) throw new BadRequestException(`Invalid status: ${status}`);
    const row = await this.prisma.client.hrTrainingEnrollment.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Enrollment not found');
    return this.prisma.client.hrTrainingEnrollment.update({
      where: { id },
      data: {
        status,
        completedAt: status === 'completed' ? new Date() : row.completedAt,
        certificateUrl: certificateUrl ?? row.certificateUrl,
        createdBy: userId,
      },
    });
  }

  async deleteEnrollment(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTrainingEnrollment.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Enrollment not found');
    return this.prisma.client.hrTrainingEnrollment.update({ where: { id }, data: { deletedAt: new Date(), createdBy: userId } });
  }

  /** Per-employee CPD totals (for accreditation reports). */
  async cpdReport() {
    const orgId = await this.orgId();
    const rows = await this.prisma.client.hrTrainingEnrollment.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'completed' },
      include: { training: true, employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
    });
    const byEmp: Record<string, { employee: any; hours: number; count: number }> = {};
    for (const r of rows) {
      byEmp[r.employeeId] ??= { employee: r.employee, hours: 0, count: 0 };
      byEmp[r.employeeId].hours += r.training?.cpdHours ?? 0;
      byEmp[r.employeeId].count += 1;
    }
    return Object.values(byEmp).sort((a, b) => b.hours - a.hours);
  }
}
